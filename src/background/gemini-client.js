/**
 * Gemini API 客戶端 — 負責 AI 摘要、爭點分析、向量嵌入與配額管理
 */

import { GEMINI_API, RATE_LIMITS } from '../utils/constants.js';

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
 * 驗證 Gemini API Key 是否有效 (支援多個密鑰以逗號/空格/換行分隔，需全數驗證通過)
 * @param {string} apiKey - 使用者輸入的 API Key 字串
 * @returns {Promise<boolean>} - 是否全數有效
 */
export async function validateApiKey(apiKey) {
  if (!apiKey) return false;
  const keys = apiKey.split(/[\s,;\n]+/).map(k => k.trim()).filter(Boolean);
  if (keys.length === 0) return false;

  for (const key of keys) {
    const url = `${GEMINI_API.BASE_URL}/${GEMINI_API.MODELS.FLASH}:generateContent?key=${key}`;
    const payload = {
      contents: [{ parts: [{ text: 'Hello' }] }],
      generationConfig: { maxOutputTokens: 5 }
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 秒超時限制

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (res.status !== 200) {
        console.warn(`[GeminiClient] API Key 驗證失敗: ${key.slice(0, 8)}... (HTTP ${res.status})`);
        return false;
      }
    } catch (err) {
      clearTimeout(timeoutId);
      console.error(`[GeminiClient] API Key 驗證出錯: ${key.slice(0, 8)}...`, err);
      return false;
    }
  }
  return true;
}

/**
 * 取得系統提示詞
 */
function getSystemInstruction() {
  return `你是一位專精於中華民國（台灣）法律的資深法學研究員。
請閱讀傳入的法院判決書全文，並進行深入的結構化分析。
你必須依據中華民國法律架構與實務見解進行分析。
所有分析文字（事實摘要、判決結論、爭點說明、法院見解等）必須全部使用【繁體中文（台灣）】及台灣習慣的法律術語（例如：「原告」而非「公訴人」）。

══════════════════════════════════════════════════
【核心鐵律：防幻覺與嚴格引文原則】
══════════════════════════════════════════════════
1. 【百分之百文本依據】：你輸出的每一個字、每一個事實陳述，都必須能在傳入的判決書全文中找到直接的文字依據。嚴格禁止任何形式的推論、想像、填充或「合理推測」。
2. 【禁止幻覺的具體規定】：
   - 禁止憑記憶或知識庫描述案件細節（金額、日期、地點、姓名、行為等），必須直接從傳入文本中提取。
   - 禁止使用「可能」、「應該」、「通常」、「一般而言」等推測性語氣描述本案事實。
   - 禁止引用任何本判決書以外的判決先例、學說或評論。
3. 【缺失資訊處理】：若某項資訊在判決書全文中完全未提及，請填寫「判決書中未記載」，切勿填充任何虛構細節。
4. 【摘要寫作規範】：
   - 案件事實摘要（summary）必須逐句依據判決書「事實」或「理由」欄位的原文進行改寫，禁止添加任何文中不存在的細節。
   - 使用「本案判決記載，…」或「依據判決書，…」等語式明確標示內容來源於文本，而非自行推斷。
   - 若判決書對某事實的描述模糊，忠實反映該模糊性，切勿「補充」使其看起來更完整。
══════════════════════════════════════════════════

請嚴格遵循以下輸出格式規範（輸出必須為合法 JSON，不要包裝在 markdown 語法中）：
1. 案件基本資訊 (metadata)：
   - caseNumber: 案號 (例如：111年度台上字第1234號)，【必須從判決書抬頭或首頁直接複製，不得自行編寫】
   - court: 法院名稱 (例如：最高法院)，【必須從判決書文字中直接提取】
   - date: 裁判日期，格式為 YYYY-MM-DD (例如：2022-03-15)，【必須從判決書中直接讀取，不得推算】
   - caseType: 案件類別，限填 "刑事"、"民事"、"行政"、"家事" 之一
   - cause: 案由 (例如：殺人、給付違約金)，【直接從判決書「案由」欄位提取】
2. 案件事實摘要 (summary)：
   - 【嚴格依據文本】：僅能使用判決書「事實」、「理由」、「主文」等段落中明確記載的內容進行整合改寫。
   - 【禁止推論】：禁止描述任何文中未出現的細節、動機、背景或過程。
   - 精確總結本案的核心事實、原告訴求、被告抗辯、以及法院認定之主要事實，限 500 字以內，文字需流暢。
   - 若判決書事實記載不完整，如實反映（例如：「判決書對此段事實記載較為簡略」），而非自行補充。
3. 判決結論 (conclusion)：
   - 必須引用判決書「主文」段落的原文或緊密改寫，簡述判決之最終結果與核心理據。
4. 法學爭點解析 (legalIssues)：
   - 識別本判決涉及之核心法學爭點（如因果關係認定、正當防衛、契約解除效力等）。每一個爭點必須明確指出「依照此判決書得出之判斷結果或結論」。每一個爭點包含：
     - title: 爭點簡短名稱
     - description: 【完全依據判決書「理由」段落】描述該爭點的具體爭議焦點，並【在結尾處明確指出該爭點依照此判決得出之判定結果】（例如：「判定結果：原告主張有理，契約已合法解除」或「判定結果：被告抗辯之正當防衛成立」）
     - legalBasis: 該爭點相關之法條列舉，【僅能列出判決書中明確援引的法條，禁止添加相關但未被援引的法條】 (例如：["刑法第271條第1項", "民法第259條"])
     - arguments: 包含 prosecution (原告/檢察官之主張，必須依據判決書原文)、defense (被告/辯護人之抗辯，必須依據判決書原文)、courtOpinion (法院針對此爭點之詳細判斷理由，必須依據判決書「理由」欄位原文)
5. 適用法條 (appliedLaws)：
   - 【僅能列出判決書正文中明確援引、引用或適用的法條】，禁止列入「相關但未被本判決援引」的法條。
   - 格式範例：["刑法第271條", "刑事訴訟法第154條"]
6. 智慧標籤建議 (suggestedTags)：
   - 自動生成適合的智慧標籤。每個標籤必須指定信心度與分類：
     - name: 標籤名稱 (例如：共同正當防衛、信賴利益、給付不能)
     - confidence: 信心度 (0.0 到 1.0 的浮點數)，【對於判決書中明確提及的爭點，信心度應高；對於推斷出的標籤，信心度應設為 0.5 以下】
     - category: 標籤分類，限填 "法學爭點"、"罪名"、"程序爭點"、"民事類型"、"行政類型" 之一`;
}

/**
 * 呼叫 Gemini 進行判決書分析與摘要 (內部原始實作)
 * @param {string} apiKey - API Key
 * @param {string} rawText - 判決書全文
 * @param {string} model - 使用的模型
 * @returns {Promise<object>} - 解析後的結構化 JSON 資料
 */
async function analyzeJudgmentRaw(apiKey, rawText, model) {
  const endpointPath = `${model}:generateContent`;
  
  const payload = {
    contents: [
      {
        parts: [
          { text: `【重要提醒】：你只能依據以下傳入的判決書全文進行分析，嚴禁引用任何外部資料、記憶或推論。所有摘要、事實描述、法條引用都必須能在以下文本中找到直接對應文字。若文本中未提及某資訊，請填寫「判決書中未記載」。\n\n以下是判決書全文，請進行摘要與爭點解析：\n\n${rawText}\n\n【再次確認】：你的輸出必須百分之百基於以上判決書原文，禁止添加任何文本中不存在的資訊。` }
        ]
      }
    ],
    systemInstruction: {
      parts: [
        { text: getSystemInstruction() }
      ]
    },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          metadata: {
            type: 'OBJECT',
            properties: {
              caseNumber: { type: 'STRING' },
              court: { type: 'STRING' },
              date: { type: 'STRING' },
              caseType: { type: 'STRING' },
              cause: { type: 'STRING' }
            },
            required: ['caseNumber', 'court', 'date', 'caseType', 'cause']
          },
          summary: { type: 'STRING' },
          conclusion: { type: 'STRING' },
          legalIssues: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                title: { type: 'STRING' },
                description: { type: 'STRING' },
                legalBasis: { type: 'ARRAY', items: { type: 'STRING' } },
                arguments: {
                  type: 'OBJECT',
                  properties: {
                    prosecution: { type: 'STRING' },
                    defense: { type: 'STRING' },
                    courtOpinion: { type: 'STRING' }
                  }
                }
              },
              required: ['title', 'description']
            }
          },
          appliedLaws: { type: 'ARRAY', items: { type: 'STRING' } },
          suggestedTags: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' },
                confidence: { type: 'NUMBER' },
                category: { type: 'STRING' }
              },
              required: ['name', 'confidence', 'category']
            }
          }
        },
        required: ['metadata', 'summary', 'conclusion', 'legalIssues', 'appliedLaws', 'suggestedTags']
      }
    }
  };

  const response = await fetchWithRetry(apiKey, endpointPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const resJson = await response.json();
  
  if (!response.ok) {
    throw new Error(resJson.error?.message || `API error with status ${response.status}`);
  }

  const textResponse = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textResponse) {
    throw new Error('Gemini 未傳回任何內容');
  }

  try {
    return JSON.parse(textResponse);
  } catch (err) {
    console.error('[GeminiClient] JSON 解析失敗。原始回應為：', textResponse);
    throw new Error('AI 回應格式錯誤，無法解析成結構化資料。');
  }
}

/**
 * 呼叫 Gemini 進行判決書分析與摘要 (外層具備自動降級 fallback 機制)
 * @param {string} apiKey - API Key
 * @param {string} rawText - 判決書全文
 * @param {string} model - 使用的模型，預設為 flash
 * @returns {Promise<object>} - 解析後的結構化 JSON 資料
 */
export async function analyzeJudgment(apiKey, rawText, model = GEMINI_API.MODELS.FLASH) {
  const modelsToTry = [];
  
  if (model.includes('flash')) {
    // 優先且每次皆嘗試最新一代的 gemini-3.5-flash，不永久將降級結果寫回設定
    modelsToTry.push('gemini-3.5-flash', model, 'gemini-2.5-flash', 'gemini-1.5-flash');
  } else if (model.includes('pro')) {
    // 優先且每次皆嘗試最新一代的 gemini-3.5-pro，不永久將降級結果寫回設定
    modelsToTry.push('gemini-3.5-pro', model, 'gemini-2.5-pro', 'gemini-1.5-pro');
  } else {
    modelsToTry.push(model);
  }

  // 去除重複的模型 ID 並保持順序
  const uniqueModels = [...new Set(modelsToTry)];
  let lastError;

  for (const m of uniqueModels) {
    try {
      return await analyzeJudgmentRaw(apiKey, rawText, m);
    } catch (err) {
      lastError = err;
      console.warn(`[GeminiClient] ${m} 呼叫失敗，嘗試下一個備用模型。錯誤: ${err.message}`);
    }
  }
  
  throw lastError;
}

/**
 * 批次生成向量嵌入 (Batch Embedding) — 針對 Free Tier 進行速率限制與配額管控
 * @param {string} apiKey - API Key
 * @param {string[]} texts - 要嵌入的文字陣列
 * @returns {Promise<number[][]>} - 向量陣列 [[x1, x2, ...], [y1, y2, ...]]
 */
export async function getEmbeddings(apiKey, texts) {
  if (!texts || texts.length === 0) return [];
  
  // 檢查配額限制
  await checkDailyQuota(texts.length);

  // 切割批次，每批最大 100 筆 (配額限制)
  const batches = [];
  for (let i = 0; i < texts.length; i += RATE_LIMITS.EMBEDDING_BATCH_SIZE) {
    batches.push(texts.slice(i, i + RATE_LIMITS.EMBEDDING_BATCH_SIZE));
  }

  const allEmbeddings = [];

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    
    // 多批次間隔延遲以防觸發 RPM
    if (b > 0) {
      await delay(RATE_LIMITS.EMBEDDING_MIN_INTERVAL_MS);
    }

    const endpointPath = `${GEMINI_API.EMBEDDING_MODEL}:batchEmbedContents`;
    const payload = {
      requests: batch.map(text => ({
        model: `models/${GEMINI_API.EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        taskType: GEMINI_API.EMBEDDING_TASK_TYPE
      }))
    };

    const response = await fetchWithRetry(apiKey, endpointPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const resJson = await response.json();
    if (!response.ok) {
      throw new Error(resJson.error?.message || `Embedding API error: ${response.status}`);
    }

    const embeddings = resJson.embeddings?.map(e => e.values) || [];
    allEmbeddings.push(...embeddings);

    // 紀錄每日配額使用
    await recordQuotaUsage(batch.length);
  }

  return allEmbeddings;
}

/**
 * 具有指數退避與金鑰輪替重試的 fetch 封裝
 */
async function fetchWithRetry(apiKey, endpointPath, options, attempts = 1) {
  const activeKey = getActiveApiKey(apiKey);
  const url = `${GEMINI_API.BASE_URL}/${endpointPath}?key=${activeKey}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 秒超時限制

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    // 如果是 429 (頻率限制), 500 (伺服器錯誤), 503 (服務不可用), 504 (閘道超時)，執行金鑰輪替與重試
    const status = response.status;
    if ((status === 429 || status === 500 || status === 503 || status === 504) && attempts < RATE_LIMITS.RETRY_MAX_ATTEMPTS) {
      const delayMs = RATE_LIMITS.RETRY_BASE_DELAY_MS * Math.pow(2, attempts) + Math.random() * 500;
      console.warn(`[GeminiClient] 觸發 API 異常 (HTTP ${status})，將輪替金鑰並於 ${Math.round(delayMs)}ms 後重試 (第 ${attempts} 次)...`);
      await delay(delayMs);
      return fetchWithRetry(apiKey, endpointPath, options, attempts + 1);
    }
    
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    
    if (err.name === 'AbortError' || (err.message && (err.message.includes('aborted') || err.message.includes('abort')))) {
      throw new Error('呼叫 Gemini API 超時，請檢查網路連線或 API 金鑰有效性。');
    }
    
    if (attempts < RATE_LIMITS.RETRY_MAX_ATTEMPTS) {
      const delayMs = RATE_LIMITS.RETRY_BASE_DELAY_MS * Math.pow(2, attempts);
      console.warn(`[GeminiClient] 網路請求失敗，將於 ${delayMs}ms 後重試...`, err);
      await delay(delayMs);
      return fetchWithRetry(apiKey, endpointPath, options, attempts + 1);
    }
    throw err;
  }
}

/**
 * 延遲函數
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 檢查每日配額上限
 */
async function checkDailyQuota(requiredCount) {
  return new Promise((resolve, reject) => {
    const today = new Date().toISOString().slice(0, 10);
    chrome.storage.local.get(['embeddingQuotaDate', 'embeddingQuotaCount'], (res) => {
      let count = 0;
      if (res.embeddingQuotaDate === today) {
        count = res.embeddingQuotaCount || 0;
      }
      
      if (count + requiredCount > RATE_LIMITS.EMBEDDING_RPD) {
        reject(new Error(`已達到 Gemini Embedding 每日免費額度限制 (${RATE_LIMITS.EMBEDDING_RPD} 次/天)。剩餘額度無法處理此判決。`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * 紀錄配額使用量
 */
async function recordQuotaUsage(count) {
  return new Promise((resolve) => {
    const today = new Date().toISOString().slice(0, 10);
    chrome.storage.local.get(['embeddingQuotaDate', 'embeddingQuotaCount'], (res) => {
      let currentCount = 0;
      if (res.embeddingQuotaDate === today) {
        currentCount = res.embeddingQuotaCount || 0;
      }
      
      chrome.storage.local.set({
        embeddingQuotaDate: today,
        embeddingQuotaCount: currentCount + count
      }, resolve);
    });
  });
}

