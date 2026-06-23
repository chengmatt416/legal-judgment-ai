/**
 * AI 智慧搜尋與裁判費計算代理核心模組
 */

import { GEMINI_API } from '../utils/constants.js';

// 司法院裁判書搜尋基礎網址
const JUDICIAL_BASE = 'https://judgment.judicial.gov.tw';
const SEARCH_ENDPOINT = `${JUDICIAL_BASE}/FJUD/qryresult.aspx`;

let keyRotationIndex = 0;

/**
 * 輔助函數：解析可能包含多個 API Key 的字串，並順序輪流挑選使用
 */
function getActiveApiKey(apiKey) {
  if (!apiKey) return '';
  const keys = apiKey.split(/[\s,;\n]+/).map(k => k.trim()).filter(Boolean);
  if (keys.length === 0) return '';
  const index = keyRotationIndex % keys.length;
  keyRotationIndex++;
  return keys[index];
}

/**
 * 輔助函式：修復截斷的 JSON 並嘗試進行解析，具備高度容錯性與降級策略
 */
function repairAndParseJson(text) {
  let cleanedText = text.trim();
  if (cleanedText.startsWith('```json')) {
    cleanedText = cleanedText.slice(7);
  }
  if (cleanedText.startsWith('```')) {
    cleanedText = cleanedText.slice(3);
  }
  if (cleanedText.endsWith('```')) {
    cleanedText = cleanedText.slice(0, -3);
  }
  cleanedText = cleanedText.trim();

  // 1. 嘗試直接解析
  try {
    return JSON.parse(cleanedText);
  } catch (e) {
    console.warn('[ai-search-agent] JSON 直接解析失敗，嘗試修復結尾...', e);
  }

  // 2. 嘗試使用括號補齊修復
  try {
    const repaired = repairTruncatedJson(cleanedText);
    return JSON.parse(repaired);
  } catch (e) {
    console.warn('[ai-search-agent] JSON 補齊修復也失敗，嘗試正則提取 answer...', e);
  }

  // 3. 嘗試正則提取 answer
  // 先嘗試完整匹配的 answer (處理引號與逸出字元)
  const answerRegex = /"answer"\s*:\s*"((?:[^"\\]|\\.)*)"/i;
  const match = cleanedText.match(answerRegex);
  if (match) {
    try {
      const answer = JSON.parse(`"${match[1]}"`);
      return { answer, citations: [] };
    } catch (e) {
      return { answer: match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'), citations: [] };
    }
  }

  // 如果 answer 也是截斷的，匹配到結尾
  const answerTruncatedRegex = /"answer"\s*:\s*"([\s\S]*)$/i;
  const matchTrunc = cleanedText.match(answerTruncatedRegex);
  if (matchTrunc) {
    let rawAnswer = matchTrunc[1];
    // 移除可能存在的 JSON 結尾符號，如 ", "citations" 等
    rawAnswer = rawAnswer.replace(/"\s*,\s*"citations"[\s\S]*$/, '');
    rawAnswer = rawAnswer.replace(/"\s*\}\s*$/, '');
    return {
      answer: rawAnswer.replace(/\\"/g, '"').replace(/\\n/g, '\n') + '...（回答因長度限制未完）',
      citations: []
    };
  }

  throw new Error(`無法解析 AI 回應為 JSON 格式，原始回應為: ${text}`);
}

/**
 * 括號補齊與懸空逗號/冒號修復演算法
 */
function repairTruncatedJson(jsonStr) {
  let inString = false;
  let escape = false;
  const stack = [];

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{' || char === '[') {
        stack.push(char);
      } else if (char === '}') {
        if (stack[stack.length - 1] === '{') stack.pop();
      } else if (char === ']') {
        if (stack[stack.length - 1] === '[') stack.pop();
      }
    }
  }

  let repaired = jsonStr;
  if (inString) {
    repaired += '"';
  }

  while (stack.length > 0) {
    const last = stack.pop();
    if (last === '{') {
      repaired = repaired.trim();
      if (repaired.endsWith(',')) {
        repaired = repaired.slice(0, -1).trim();
      }
      if (repaired.endsWith(':')) {
        repaired += 'null';
      }
      repaired += '}';
    } else if (last === '[') {
      repaired = repaired.trim();
      if (repaired.endsWith(',')) {
        repaired = repaired.slice(0, -1).trim();
      }
      repaired += ']';
    }
  }

  return repaired;
}

/**
 * 輔助函式：發送具有重試與超時機制的 fetch 請求到 Gemini
 */
async function callGemini(apiKey, model, systemPrompt, userPrompt, jsonSchema = null, onChunk = null) {
  const modelsToTry = [];
  if (model.includes('flash')) {
    modelsToTry.push('gemini-3.5-flash', model, 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-1.5-flash');
  } else if (model.includes('pro')) {
    modelsToTry.push('gemini-3.5-pro', model, 'gemini-3-pro-preview', 'gemini-2.5-pro', 'gemini-1.5-pro');
  } else {
    modelsToTry.push(model);
  }
  const uniqueModels = [...new Set(modelsToTry)];
  
  const isStream = typeof onChunk === 'function';
  const apiAction = isStream ? 'streamGenerateContent' : 'generateContent';
  
  const keys = apiKey ? apiKey.split(/[\s,;\n]+/).map(k => k.trim()).filter(Boolean) : [];
  const maxAttempts = Math.max(3, keys.length);
  
  let lastError;
  for (const m of uniqueModels) {
    let modelExists = true;
    const payload = {
      contents: [{ parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8192,
      }
    };

    if (jsonSchema) {
      payload.generationConfig.responseMimeType = 'application/json';
      payload.generationConfig.responseSchema = jsonSchema;
    }

    for (let i = 0; i < maxAttempts; i++) {
      const activeKey = getActiveApiKey(apiKey);
      const url = `${GEMINI_API.BASE_URL}/${m}:${apiAction}?key=${activeKey}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 秒連線建立超時
      
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        clearTimeout(timeoutId); // 成功建立連線，清除連線超時

        if (!res.ok) {
          const resJson = await res.json().catch(() => ({}));
          const errMsg = resJson.error?.message || `Gemini API 回傳錯誤: ${res.status}`;
          const errStatus = res.status;
          
          if (errStatus === 400 || errStatus === 403) {
            const apiErr = new Error(`[API 錯誤] ${errMsg}`);
            apiErr.status = errStatus;
            throw apiErr;
          }
          if (errStatus === 404) {
            console.warn(`[ai-search-agent] 模型 ${m} 不存在 (HTTP 404)，嘗試下一個模型。`);
            break; 
          }
          const otherErr = new Error(errMsg);
          otherErr.status = errStatus;
          throw otherErr;
        }

        let text = "";
        if (isStream && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder("utf-8");
          let accumulatedText = "";
          
          let inactivityTimeoutId;
          let isFirstChunk = true;
          const resetInactivityTimeout = () => {
            if (inactivityTimeoutId) clearTimeout(inactivityTimeoutId);
            const timeoutMs = isFirstChunk ? 45000 : 15000; // 首字 45 秒，後續 15 秒
            inactivityTimeoutId = setTimeout(() => {
              console.warn(`[ai-search-agent] 串流輸出已超過 ${timeoutMs / 1000} 秒無新資料，強制中斷連線。`);
              controller.abort();
            }, timeoutMs);
          };

          resetInactivityTimeout(); // 啟動超時監測

          try {
            while (true) {
              // 為了防止 reader.read() 在 abort 後依然懸掛，我們可以用 Promise.race 加上訊號監測
              const readPromise = reader.read();
              const abortPromise = new Promise((_, reject) => {
                const checkAbort = () => {
                  if (controller.signal.aborted) {
                    reject(new Error('AbortError'));
                  } else {
                    setTimeout(checkAbort, 1000);
                  }
                };
                setTimeout(checkAbort, 1000);
              });

              const { done, value } = await Promise.race([readPromise, abortPromise]);
              if (done) break;
              isFirstChunk = false;
              resetInactivityTimeout(); // 每收到一個 chunk 就重置計時器
              const chunkText = decoder.decode(value, { stream: true });
              accumulatedText += chunkText;
              if (onChunk) {
                onChunk(accumulatedText);
              }
            }
          } finally {
            if (inactivityTimeoutId) clearTimeout(inactivityTimeoutId);
          }

          let responseJson;
          try {
            responseJson = JSON.parse(accumulatedText.trim());
          } catch (jsonParseErr) {
            console.warn('[ai-search-agent] 串流 JSON 解析失敗，嘗試正則提取 text 內容。');
            const textRegex = /"text"\s*:\s*"([\s\S]*?)"/g;
            let match;
            while ((match = textRegex.exec(accumulatedText)) !== null) {
              try {
                text += JSON.parse(`"${match[1]}"`);
              } catch (e) {
                text += match[1];
              }
            }
            if (!text) {
              throw new Error('串流回應 JSON 解析失敗且無法正則提取。');
            }
          }

          if (Array.isArray(responseJson)) {
            for (const chunk of responseJson) {
              const candidate = chunk.candidates?.[0];
              if (candidate?.finishReason === 'SAFETY') {
                throw new Error('[安全限制] 回答因安全過濾器阻擋而無法產生。');
              }
              const partText = candidate?.content?.parts?.[0]?.text;
              if (partText) {
                text += partText;
              }
            }
          }
        } else {
          const resJson = await res.json();
          const candidate = resJson.candidates?.[0];
          if (candidate?.finishReason === 'SAFETY') {
            throw new Error('[安全限制] 回答因安全過濾器阻擋而無法產生。');
          }
          text = candidate?.content?.parts?.[0]?.text || "";
        }

        if (jsonSchema) {
          return repairAndParseJson(text);
        }
        return text;
      } catch (err) {
        clearTimeout(timeoutId);
        
        let errorToThrow = err;
        if (err.name === 'AbortError' || (err.message && (err.message.includes('aborted') || err.message.includes('abort')))) {
          errorToThrow = new Error('呼叫 Gemini API 超時 (連線或串流傳輸中斷)，請檢查網路或 API 金鑰有效性。');
        }
        
        lastError = errorToThrow;
        
        if (errorToThrow.message && errorToThrow.message.includes('[安全限制]')) {
          throw errorToThrow;
        }

        console.warn(`[ai-search-agent] 呼叫 ${m} 失敗 (${i + 1}/${maxAttempts}):`, err.message);
        
        if (err.status === 404 || (err.message && err.message.includes('404'))) {
          modelExists = false;
          break; // Skip retry for 404 errors
        }

        // 決定重試延遲時間
        let delayMs = 1000 * (i + 1);
        if (err.status === 400 || err.status === 403) {
          delayMs = 0; // 金鑰無效或客戶端錯誤時，直接輪替下一把，無需延遲
        }
        
        if (err.name === 'AbortError' || (err.message && (err.message.includes('aborted') || err.message.includes('abort')))) {
          console.warn(`[ai-search-agent] 呼叫 ${m} 超時 (連線或串流中斷)，跳過此模型。`);
          break; // Skip to next model if it times out
        }

        if (delayMs > 0) {
          await new Promise(r => setTimeout(r, delayMs)); // 指數退避延遲
        }
      }
    }

    // 如果該模型的所有嘗試都失敗，且不是因為模型不存在(404)，則直接拋出錯誤，避免漫長地嘗試其他模型
    if (modelExists && lastError) {
      throw lastError;
    }
  }
  throw lastError;
}

// 全域快取 ASP.NET ViewState 驗證參數，儘量在同輪搜尋中減少重複 GET 請求數
let cachedTokens = null;

/**
 * 對司法院網站發送搜尋請求，獲取搜尋結果頁面 HTML
 */
async function fetchJudicialSearch(query) {
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const defaultUrl = `${JUDICIAL_BASE}/FJUD/default.aspx`;
  
  let viewstate = '';
  let generator = '';
  let validation = '';
  
  if (cachedTokens) {
    viewstate = cachedTokens.viewstate;
    generator = cachedTokens.generator;
    validation = cachedTokens.validation;
  } else {
    // 1. GET default.aspx to extract ASP.NET ViewState and EventValidation parameters
    const getRes = await fetch(defaultUrl, {
      headers: { 'User-Agent': userAgent }
    });
    if (!getRes.ok) {
      throw new Error(`無法連接司法院搜尋網站首頁 (HTTP ${getRes.status})`);
    }
    const defaultHtml = await getRes.text();
    
    const viewstateMatch = defaultHtml.match(/id="__VIEWSTATE"\s+value="([^"]+)"/i);
    const generatorMatch = defaultHtml.match(/id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/i);
    const validationMatch = defaultHtml.match(/id="__EVENTVALIDATION"\s+value="([^"]+)"/i);
    
    viewstate = viewstateMatch ? viewstateMatch[1] : '';
    generator = generatorMatch ? generatorMatch[1] : '';
    validation = validationMatch ? validationMatch[1] : '';
    
    cachedTokens = { viewstate, generator, validation };
  }
  
  // 2. POST to default.aspx with form urlencoded parameters
  const params = new URLSearchParams();
  params.append('__VIEWSTATE', viewstate);
  params.append('__VIEWSTATEGENERATOR', generator);
  params.append('__EVENTVALIDATION', validation);
  params.append('txtKW', query);
  params.append('judtype', 'JUDBOOK');
  params.append('whosub', '0');
  params.append('ctl00$cp_content$btnSimpleQry', '送出查詢');
  
  let postRes;
  try {
    postRes = await fetch(defaultUrl, {
      method: 'POST',
      headers: {
        'User-Agent': userAgent,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
  } catch (err) {
    cachedTokens = null; // 發生網絡錯誤時清空快取以重試
    throw err;
  }
  
  if (!postRes.ok) {
    cachedTokens = null; // 發生 HTTP 錯誤時清空快取
    throw new Error(`司法院搜尋請求失敗 (HTTP ${postRes.status})`);
  }
  
  const postHtml = await postRes.text();
  
  // 3. Extract the hidQID or the query list iframe src
  const qidMatch = postHtml.match(/id="hidQID"\s+value="([^"]+)"/i);
  let qid = qidMatch ? qidMatch[1] : '';
  
  if (!qid) {
    cachedTokens = null; // 當無法解析出 QID 時，強制清空快取以防 Token 過期
    // Check if there is an iframe src directly
    const iframeMatch = postHtml.match(/iframe\s+src="([^"]*qryresultlst\.aspx\?[^"]+)"/i);
    if (iframeMatch) {
      const srcUrl = iframeMatch[1].replace(/&amp;/g, '&');
      const listUrl = srcUrl.startsWith('/') ? `${JUDICIAL_BASE}${srcUrl}` : `${JUDICIAL_BASE}/FJUD/${srcUrl}`;
      const listRes = await fetch(listUrl, {
        headers: { 'User-Agent': userAgent }
      });
      if (!listRes.ok) {
        throw new Error(`無法擷取搜尋結果清單 (HTTP ${listRes.status})`);
      }
      return await listRes.text();
    }
    
    if (postHtml.includes('查詢設定錯誤') || postHtml.includes('錯誤')) {
      throw new Error('司法院搜尋設定錯誤，請稍後再試。');
    }
    
    throw new Error('無法取得搜尋識別碼 (hidQID)');
  }
  
  // 4. Fetch the results list page
  const listUrl = `${JUDICIAL_BASE}/FJUD/qryresultlst.aspx?ty=JUDBOOK&q=${encodeURIComponent(qid)}`;
  const listRes = await fetch(listUrl, {
    headers: { 'User-Agent': userAgent }
  });
  
  if (!listRes.ok) {
    throw new Error(`無法擷取搜尋結果清單 (HTTP ${listRes.status})`);
  }
  
  return await listRes.text();
}

/**
 * 解析搜尋結果 HTML (不依賴 DOM 物件，純字串正則解析)
 */
export function parseSearchResultsHTML(html) {
  const results = [];
  const rows = html.split(/<tr[^>]*>/i);
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const linkMatch = row.match(/href=["']([^"']*data\.aspx\?[^"']*id=[^"']+)["']/i);
    if (!linkMatch) continue;

    let relativeUrl = linkMatch[1].replace(/&amp;/g, '&');
    if (!relativeUrl.startsWith('/')) {
      relativeUrl = '/FJUD/' + relativeUrl;
    }
    const url = JUDICIAL_BASE + relativeUrl;

    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(row)) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
    }

    // 擷取下一行的摘要片段作為 context
    let snippet = '';
    if (i + 1 < rows.length && (rows[i+1].includes('summary') || rows[i+1].includes('tdCut'))) {
      const snippetMatch = rows[i+1].match(/class=["']tdCut["']>([\s\S]*?)<\/span>/i);
      if (snippetMatch) {
        snippet = snippetMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      }
    }

    if (cells.length >= 3) {
      const caseNumber = cells[1] || '未知案號';
      const dateStr = cells[2] || '';
      const cause = cells[3] || '未知案由';
      
      let court = '未知法院';
      const courtMatch = caseNumber.match(/^([^\d]+)/);
      if (courtMatch) {
        court = courtMatch[1];
      }

      results.push({
        title: `${caseNumber} (${cause})`,
        caseNumber,
        court,
        date: dateStr,
        cause,
        snippet,
        url
      });
    } else {
      const textMatch = row.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
      const title = textMatch ? textMatch[1].replace(/<[^>]*>/g, '').trim() : '未知判決';
      results.push({
        title,
        caseNumber: title.split(' ')[0] || title,
        court: '未知法院',
        date: '',
        cause: '',
        snippet,
        url
      });
    }
  }
  return results;
}

/**
 * 擷取判決書詳情頁面的內容文字
 */
export async function fetchJudgmentContent(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 秒超時限制

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`無法擷取判決內容 (HTTP ${res.status})`);
    }
    const html = await res.text();
    
    // 優先抓取 <pre> 區塊 (司法院判決書主要存放區)
    const preMatch = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    if (preMatch) {
      return preMatch[1].replace(/<[^>]*>/g, '').trim();
    }

    // 備用：擷取 text
    const cleanText = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleanText;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError' || (err.message && (err.message.includes('aborted') || err.message.includes('abort')))) {
      throw new Error('下載判決書內容超時 (15秒)');
    }
    throw err;
  }
}

/**
 * AI 智慧搜尋代理核心引擎
 */
export async function aiSearchAgent(apiKey, model, mode, userPrompt, onProgress) {
  // 1. 意圖分析階段 (產生第一輪關鍵字)
  onProgress({ status: 'analyzing', message: '正在分析您的查詢意圖，產生首輪搜尋關鍵字...' });
  
  const systemPromptAnalysis = `你是一位專業的台灣法律研究助手。
請分析使用者的法律查詢，並提出【第 1 輪】最適用的司法院搜尋關鍵字字詞（例如：「善意取得」、「給付違約金」等，或以空白分隔的 AND 組合，例如：「正當防衛 因果關係」）。
請注意：
1. 不要包含任何特殊搜尋語法。
2. 搜尋字詞必須精簡，避免贅字。
請輸出為符合 Schema 的 JSON 格式。`;

  const schemaAnalysis = {
    type: 'OBJECT',
    properties: {
      searchQuery: { type: 'STRING' },
      searchStrategy: { type: 'STRING' }
    },
    required: ['searchQuery', 'searchStrategy']
  };

  const intent = await callGemini(apiKey, model, systemPromptAnalysis, `使用者查詢：${userPrompt}`, schemaAnalysis);
  let currentQuery = intent.searchQuery || userPrompt;
  
  onProgress({ 
    status: 'searching', 
    message: `首輪搜尋策略：${intent.searchStrategy}。關鍵字：「${currentQuery}」` 
  });

  const allFoundJudgments = [];
  const fetchedUrls = new Set();
  const searchHistory = [];
  let isSufficient = false;
  let round = 0;
  const maxRounds = 14;

  // 2. 多輪 AI 決定關鍵字搜尋與自我審查迴圈
  while (round < maxRounds && !isSufficient) {
    onProgress({ status: 'searching', message: `[第 ${round + 1} 輪] 正在使用關鍵字「${currentQuery}」搜尋司法院裁判書...` });

    try {
      const searchHtml = await fetchJudicialSearch(currentQuery);
      const parsedResults = parseSearchResultsHTML(searchHtml);

      onProgress({ status: 'searching', message: `[第 ${round + 1} 輪] 搜尋完畢，共找到 ${parsedResults.length} 筆判決。送交 AI 進行關聯性審查...` });

      if (parsedResults.length === 0) {
        // 如果此輪沒有結果，讓 AI 調整關鍵字進行下一輪
        onProgress({ status: 'searching', message: `[第 ${round + 1} 輪] 搜尋結果為 0 筆。請 AI 重新調整關鍵字...` });
        
        const systemPromptRetry = `使用關鍵字「${currentQuery}」在司法院查無判決。
使用者原主題為：${userPrompt}
已嘗試過的搜尋歷史：${JSON.stringify(searchHistory)}
請重新規劃一個不同的關鍵字組合，再次嘗試。請輸出 JSON。`;

        const schemaRetry = {
          type: 'OBJECT',
          properties: {
            nextQuery: { type: 'STRING' },
            reason: { type: 'STRING' }
          },
          required: ['nextQuery', 'reason']
        };

        const retryResult = await callGemini(apiKey, model, systemPromptRetry, `請重新提出關鍵字。`, schemaRetry);
        searchHistory.push({ query: currentQuery, foundCount: 0, reason: '查無資料' });
        currentQuery = retryResult.nextQuery || userPrompt;
        round++;
        continue;
      }

      // 使用 AI 審查此輪結果，挑選相關判決並決定是否繼續下一輪
      const listForAI = parsedResults.slice(0, 15).map((r, idx) => `[${idx}] 案號: ${r.caseNumber} | 案由: ${r.cause} | 摘要特徵（Context）: ${r.snippet || '無'}`);
      const historyStr = searchHistory.map((h, i) => `第 ${i + 1} 輪關鍵字：「${h.query}」，找到 ${h.foundCount} 筆。`).join('\n');
      
      const systemPromptReview = `你是一位專業的台灣法律研究代理人（Agent）。
使用者查詢主題：${userPrompt}
當前已累積收集到 ${allFoundJudgments.length} 篇相關判決。
先前幾輪的搜尋歷史：
${historyStr || '無'}

請檢視以下本輪搜尋出的判決列表：
${listForAI.join('\n')}

任務：
1. 挑選出本輪中與使用者主題高度相關的案件索引（選出最多 3 個）。
2. 評估目前已收集到的判決內容是否已經【足夠】回答使用者問題。
3. 若【不足夠】，請提出【下一輪】搜尋的全新關鍵字組合，以便擴大檢索。如果足夠，請將 isSufficient 設為 true。
請輸出符合 JSON Schema 的格式。`;

      const schemaReview = {
        type: 'OBJECT',
        properties: {
          relevantIndices: {
            type: 'ARRAY',
            items: { type: 'INTEGER' }
          },
          isSufficient: { type: 'BOOLEAN' },
          nextQuery: { type: 'STRING' },
          reason: { type: 'STRING' }
        },
        required: ['relevantIndices', 'isSufficient', 'reason']
      };

      const reviewResult = await callGemini(
        apiKey,
        model,
        systemPromptReview,
        `請進行結果檢閱與下一步決策。`,
        schemaReview
      );

      // 儲存選出的相關判決
      const indices = reviewResult.relevantIndices || [];
      let currentRoundSavedCount = 0;
      for (const idx of indices) {
        if (parsedResults[idx] && !fetchedUrls.has(parsedResults[idx].url)) {
          allFoundJudgments.push(parsedResults[idx]);
          fetchedUrls.add(parsedResults[idx].url);
          currentRoundSavedCount++;
        }
      }

      searchHistory.push({
        query: currentQuery,
        foundCount: parsedResults.length,
        selectedCount: currentRoundSavedCount,
        reason: reviewResult.reason
      });

      isSufficient = reviewResult.isSufficient;
      
      onProgress({ 
        status: 'searching', 
        message: `[第 ${round + 1} 輪] 檢閱完成：本輪選出 ${currentRoundSavedCount} 篇。AI 判定資料是否足夠：${isSufficient ? '🟢 足夠' : '🟡 不足'}。` 
      });

      // 如果不足且要進行下一輪，更新關鍵字
      if (!isSufficient && reviewResult.nextQuery) {
        currentQuery = reviewResult.nextQuery;
      } else if (!isSufficient) {
        // AI 沒給關鍵字但判定不足，跳出迴圈防死鎖
        break;
      }

    } catch (searchErr) {
      console.error(`[ai-search-agent] 第 ${round + 1} 輪搜尋或檢閱失敗:`, searchErr);
    }
    round++;
  }

  // 3. 擷取判決書內容 (最多擷取 5 篇，避免 token 爆炸)
  const finalJudgmentsToAnalyze = allFoundJudgments.slice(0, 5);
  if (finalJudgmentsToAnalyze.length === 0) {
    return {
      answer: `抱歉，經過多輪搜尋，系統未能在司法院網站上找到與「${userPrompt}」直接相關的公開裁判書。這可能是因為：\n1. 關鍵字過於具體或罕見。\n2. 此類案件多以和解、調解結案，或依法不予公開。\n\n建議您調整輸入語法，以更簡潔的觀念詞（如「不當得利」、「消極確認之訴」）重新查詢。`,
      citations: [],
      searchRounds: round,
      totalSearched: 0,
      totalRelevant: 0
    };
  }

  const enrichedJudgments = [];
  for (let i = 0; i < finalJudgmentsToAnalyze.length; i++) {
    const judgment = finalJudgmentsToAnalyze[i];
    onProgress({ 
      status: 'fetching', 
      message: `正在下載並解析相關判決書詳情 (${i + 1}/${finalJudgmentsToAnalyze.length}): ${judgment.caseNumber}` 
    });

    try {
      const fullText = await fetchJudgmentContent(judgment.url);
      // 截取前 3000 字以避免上下文過長
      const truncatedText = fullText.slice(0, 3000);
      enrichedJudgments.push({
        ...judgment,
        contentSnippet: truncatedText
      });
    } catch (fetchErr) {
      console.error(`無法擷取 ${judgment.caseNumber} 內容:`, fetchErr);
      // 仍保留 metadata 資訊
      enrichedJudgments.push({
        ...judgment,
        contentSnippet: '（內容下載失敗）'
      });
    }
  }

  // 4. 綜合分析與輸出答案
  onProgress({ status: 'analyzing', message: '正在對所有擷取的判決書進行深度交叉分析，撰寫分析回答...' });

  let modeInstruction = '';
  if (mode === 'concept') {
    modeInstruction = `你的目標是解答使用者的【法學觀念查詢】。請詳細分析判決書中法院對此法律觀念之闡述、法理慣例及適用要件。`;
  } else if (mode === 'similar') {
    modeInstruction = `你的目標是解答使用者的【相似案件查詢】。請將使用者的案情描述與擷取到的判決書進行情節對比，列出相同點、不同點，並給予訴訟攻防上的評估建議。`;
  } else if (mode === 'estimate') {
    modeInstruction = `你的目標是解答使用者的【預估刑度/賠償】。請統計擷取到判決書中的量刑刑度、易科罰金或損害賠償金額，分析決定賠償高低的關鍵因子。`;
  }

  const systemPromptSynthesis = `你是專精台灣法律的資深法律分析官。
${modeInstruction}

請閱讀以下收集到的判決書內容片段，針對使用者輸入進行綜合分析。
你必須嚴格遵循以下【防幻覺與有憑有據原則】：
1. 你的回答內容（answer）與引用說明（relevance）必須【完全依據所提供的裁判書片段】。嚴禁任何無事實根據的幻想、憑空推論或擴大解釋。
2. 回答中的每一項事實描述或法律觀點，只要有所依據，都必須標明引用裁判書編號（例如：[0], [1]）。
3. 如果收集到的裁判書片段不足以完整回答使用者的問題，你必須【誠實地在回答中點出資料的局限性】，例如說「由於所提供之裁判書片段並未提及...，因此無法確認...」，切勿為了補足答案而編造。

分析要求：
1. 回答內容（answer）與引用說明（relevance）必須全部使用【繁體中文（台灣）】與台灣法律專有術語（例如：使用「原告」、「上訴」、「駁回」等，禁止使用任何簡體字與中國大陸法律術語）。
2. 答案必須嚴謹、清晰，條列化說明，字數約 600-1000 字。
3. 提及判決時，請在文章中使用數字代號引用（例如：[1], [2]），並與 citations 清單的索引一致。
請輸出符合 JSON 格式，包含 answer 及 citations。`;

  const schemaSynthesis = {
    type: 'OBJECT',
    properties: {
      answer: { type: 'STRING' },
      citations: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            caseNumber: { type: 'STRING' },
            court: { type: 'STRING' },
            url: { type: 'STRING' },
            relevance: { type: 'STRING' }
          },
          required: ['caseNumber', 'court', 'url', 'relevance']
        }
      }
    },
    required: ['answer', 'citations']
  };

  const contextData = enrichedJudgments.map((j, idx) => `
[${idx}] 案號：${j.caseNumber}
法院：${j.court}
連結：${j.url}
裁判內容摘要：\n${j.contentSnippet}
---`).join('\n');

  const finalResult = await callGemini(
    apiKey,
    model,
    systemPromptSynthesis,
    `使用者查詢：${userPrompt}\n\n收集到的判決書內容：\n${contextData}`,
    schemaSynthesis,
    (accumulated) => {
      onProgress({ 
        status: 'analyzing', 
        message: `正在對所有擷取的判決書進行深度交叉分析，撰寫分析回答中 (已接收 ${accumulated.length} 字元)...` 
      });
    }
  );

  onProgress({ status: 'completed', message: '分析完成！' });

  return {
    answer: finalResult.answer,
    citations: finalResult.citations || finalJudgmentsToAnalyze,
    searchRounds: round,
    totalSearched: finalJudgmentsToAnalyze.length,
    totalRelevant: finalJudgmentsToAnalyze.length
  };
}

/**
 * 依據中華民國民事訴訟法第 77-13 條計算第一審裁判費
 * 另加計 1.5 倍上訴二審、1.5 倍上訴三審
 */
export function calculateCourtFee(amount, caseType) {
  // 若非財產權訴訟，固定裁判費
  if (caseType === 'non-property') {
    return {
      firstInstance: 3000,
      secondInstance: 4500,
      thirdInstance: 4500,
      lawBasis: '民事訴訟法第 77-14 條：非因財產權而起訴者，徵收裁判費新台幣三千元。',
      breakdown: [
        { range: '非財產權起訴', calculation: '固定金額', fee: 3000 }
      ]
    };
  }

  // 財產權起訴金額級距計算
  const val = parseFloat(amount);
  if (isNaN(val) || val <= 0) {
    return { firstInstance: 0, secondInstance: 0, thirdInstance: 0, error: '金額必須大於 0' };
  }

  let fee = 0;
  const breakdown = [];
  const roundedAmount = Math.ceil(val / 10000) * 10000;

  if (roundedAmount <= 100000) {
    fee = 1000;
    breakdown.push({ range: '10 萬元以下部分', calculation: '起訴額 10 萬元以下，固定徵收', fee: 1000 });
  } else {
    fee = 1000;
    breakdown.push({ range: '10 萬元以下部分', calculation: '固定徵收', fee: 1000 });

    let remaining = roundedAmount - 100000;

    // 逾 10 萬至 100 萬部分 (90 萬額度)
    if (remaining > 0) {
      const segment = Math.min(remaining, 900000);
      const segmentFee = (segment / 10000) * 90;
      fee += segmentFee;
      breakdown.push({ range: '逾 10 萬至 100 萬部分', calculation: `NT$ ${segment.toLocaleString()} / 10,000 × 90`, fee: segmentFee });
      remaining -= segment;
    }

    // 逾 100 萬至 1,000 萬部分 (900 萬額度)
    if (remaining > 0) {
      const segment = Math.min(remaining, 9000000);
      const segmentFee = (segment / 10000) * 80;
      fee += segmentFee;
      breakdown.push({ range: '逾 100 萬至 1,000 萬部分', calculation: `NT$ ${segment.toLocaleString()} / 10,000 × 80`, fee: segmentFee });
      remaining -= segment;
    }

    // 逾 1,000 萬至 1 億部分 (9,000 萬額度)
    if (remaining > 0) {
      const segment = Math.min(remaining, 90000000);
      const segmentFee = (segment / 10000) * 70;
      fee += segmentFee;
      breakdown.push({ range: '逾 1,000 萬至 1 億部分', calculation: `NT$ ${segment.toLocaleString()} / 10,000 × 70`, fee: segmentFee });
      remaining -= segment;
    }

    // 逾 1 億部分
    if (remaining > 0) {
      const segmentFee = (remaining / 10000) * 60;
      fee += segmentFee;
      breakdown.push({ range: '逾 1 億部分', calculation: `NT$ ${remaining.toLocaleString()} / 10,000 × 60`, fee: segmentFee });
    }
  }

  // 四捨五入到整數位
  const firstInstance = Math.round(fee);
  const secondInstance = Math.round(firstInstance * 1.5);
  const thirdInstance = Math.round(firstInstance * 1.5); // 第二審與第三審皆為第一審的 1.5 倍

  return {
    firstInstance,
    secondInstance,
    thirdInstance,
    lawBasis: '依據民事訴訟法第 77-13 條與第 77-16 條規定計算。第二審及第三審上訴，加徵裁判費十分之五（即 1.5 倍）。',
    breakdown
  };
}
