/**
 * RAG (Retrieval-Augmented Generation) 搜尋引擎
 */

import { RAG_CONFIG, GEMINI_API } from '../utils/constants.js';
import { getEmbeddings, analyzeJudgment } from '../background/gemini-client.js';
import { getAllEmbeddings, getJudgmentById } from '../database/database-manager.js';

/**
 * 將判決書內容切割為適合 Embedding 的分塊
 * @param {object} judgment - 判決書資料
 * @returns {array} - 分塊陣列 [{ text: string, type: string }]
 */
export function chunkJudgment(judgment) {
  const chunks = [];
  const chunkSize = RAG_CONFIG.CHUNK_SIZE;
  const overlap = RAG_CONFIG.CHUNK_OVERLAP;

  // 1. 摘要分塊
  const summaryObj = typeof judgment.summaryJson === 'string' ? JSON.parse(judgment.summaryJson) : judgment.summaryJson;
  if (summaryObj.summary) {
    chunks.push({
      text: `【事實摘要】${summaryObj.summary}`,
      type: 'summary'
    });
  }
  if (summaryObj.conclusion) {
    chunks.push({
      text: `【判決結論】${summaryObj.conclusion}`,
      type: 'summary'
    });
  }

  // 2. 爭點分塊
  if (summaryObj.legalIssues && summaryObj.legalIssues.length > 0) {
    summaryObj.legalIssues.forEach((issue, idx) => {
      let text = `【爭點 ${idx + 1}：${issue.title}】\n描述：${issue.description}\n`;
      if (issue.legalBasis && issue.legalBasis.length > 0) {
        text += `依據：${issue.legalBasis.join('、')}\n`;
      }
      if (issue.arguments) {
        if (issue.arguments.prosecution) text += `控方主張：${issue.arguments.prosecution}\n`;
        if (issue.arguments.defense) text += `辯方主張：${issue.arguments.defense}\n`;
        if (issue.arguments.courtOpinion) text += `法院認定理由：${issue.arguments.courtOpinion}\n`;
      }
      chunks.push({
        text: text.trim(),
        type: 'issue'
      });
    });
  }

  // 3. 原始全文分塊 (依字數與 overlap 滑動視窗切割)
  const rawText = judgment.rawText || '';
  if (rawText.length > 0) {
    let start = 0;
    while (start < rawText.length) {
      const end = Math.min(start + chunkSize, rawText.length);
      const text = rawText.slice(start, end).trim();
      
      if (text.length > 50) { // 過濾太短的片段
        chunks.push({
          text: `【全文片段】${text}`,
          type: 'content'
        });
      }
      
      start += (chunkSize - overlap);
    }
  }

  return chunks;
}

/**
 * 計算餘弦相似度 (Cosine Similarity)
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 簡易關鍵字相似度 (Keyword Match Ratio)
 */
function keywordSimilarity(text, queryKeywords) {
  if (!queryKeywords || queryKeywords.length === 0) return 0;
  
  let matchCount = 0;
  const lowerText = text.toLowerCase();
  
  for (const kw of queryKeywords) {
    if (lowerText.includes(kw.toLowerCase())) {
      matchCount++;
    }
  }
  
  return matchCount / queryKeywords.length;
}

/**
 * 分詞輔助工具 (簡易中文關鍵字切割)
 */
function extractKeywords(query) {
  // 移除常見標點符號，並以空白切割
  const cleaned = query.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()？?，。；：！「」『』]/g, ' ');
  return cleaned.split(/\s+/).filter(w => w.length >= 2); // 僅保留長度大於等於 2 的詞
}

/**
 * 執行混合搜尋向量檢索
 * @param {string} dbId - 資料庫 ID
 * @param {string} apiKey - API Key
 * @param {string} query - 搜尋提問
 * @returns {Promise<array>} - 相似度排序後的前 Top-K 來源片段
 */
export async function retrieveContext(dbId, apiKey, query) {
  // 1. 取得查詢詞的向量
  const queryVectors = await getEmbeddings(apiKey, [query]);
  if (!queryVectors || queryVectors.length === 0) {
    throw new Error('無法取得查詢詞的向量嵌入。');
  }
  const queryVector = queryVectors[0];

  // 2. 取得此資料庫內的所有分塊向量
  const allEmbeddingItems = await getAllEmbeddings(dbId);
  if (allEmbeddingItems.length === 0) {
    return [];
  }

  // 3. 準備關鍵字做混合搜尋
  const keywords = extractKeywords(query);

  // 4. 計算每個分塊的相似度分數
  const scoredItems = [];
  for (const item of allEmbeddingItems) {
    // 向量相似度 (Cosine)
    const vecScore = cosineSimilarity(queryVector, item.vector);
    
    // 關鍵字相似度 (以防向量模型漏掉精確專有名詞)
    const kwScore = keywords.length > 0 ? keywordSimilarity(item.chunkText, keywords) : 0;
    
    // 混合加權計分
    const hybridScore = (RAG_CONFIG.VECTOR_WEIGHT * vecScore) + (RAG_CONFIG.KEYWORD_WEIGHT * kwScore);

    if (hybridScore >= RAG_CONFIG.SIMILARITY_THRESHOLD) {
      scoredItems.push({
        ...item,
        score: hybridScore,
        vecScore,
        kwScore
      });
    }
  }

  // 5. 排序並取 Top-K
  scoredItems.sort((a, b) => b.score - a.score);
  const topKItems = scoredItems.slice(0, RAG_CONFIG.TOP_K);

  // 6. 補齊判決書元資料 (案號、法院)
  const results = [];
  for (const item of topKItems) {
    const judgment = await getJudgmentById(dbId, item.judgmentId);
    if (judgment) {
      results.push({
        id: item.id,
        judgmentId: item.judgmentId,
        caseNumber: judgment.caseNumber,
        court: judgment.court,
        chunkText: item.chunkText,
        score: item.score,
        chunkType: item.chunkType
      });
    }
  }

  return results;
}

/**
 * 進行 RAG 問答生成
 * @param {string} dbId - 資料庫 ID
 * @param {string} apiKey - API Key
 * @param {string} query - 使用者法學問答提問
 * @returns {Promise<object>} - 回傳 { answer, sources }
 */
export async function ragQuery(dbId, apiKey, query) {
  // 1. 檢索相關上下文
  const sources = await retrieveContext(dbId, apiKey, query);
  
  if (sources.length === 0) {
    return {
      answer: '抱歉，在此資料庫中沒有找到足夠的相關判決資訊來回答您的問題。請確認資料庫中已儲存相關判決，或嘗試調整您的問題。',
      sources: []
    };
  }

  // 2. 組合 context
  let contextText = '';
  sources.forEach((src, idx) => {
    contextText += `【來源 ${idx + 1}】法院：${src.court} | 案號：${src.caseNumber}\n內容：${src.chunkText}\n\n`;
  });

  // 3. 組合 Prompt
  const prompt = `你是一位專業的台灣法律助理。請依據下方提供的「參考判決資料來源」，回答使用者的問題。
你必須嚴格遵循以下【防幻覺與有憑有據原則】：
1. 你的回答必須【百分之百基於提供的參考判決資料來源】。嚴禁加入任何參考來源中未提及的案情、判決事實、主張或法律見解。
2. 回答中的每一個關鍵事實點或論點，都【必須在句子後方標記對應的來源編號】（如：(參見來源 1) 或 依據【來源 2】所示）。若無參考來源支持，禁止在回答中提及。
3. 若所給的參考判決資料不完整、不相關，或不足以解答使用者的問題，你必須【在回答中誠實地說明參考資料的局限性】，例如說「依據目前提供的參考資料，無法確認...」，切勿虛構事實。

回答要求：
1. 必須全部使用【繁體中文（台灣）】與台灣法律專有術語進行回答，不得使用簡體字或中國大陸法律術語（例如：應使用「原告」、「起訴」、「駁回」、「法院」等台灣習慣的法律術語）。

【參考判決資料來源】
${contextText}

【使用者問題】
${query}

請在回答中，適當引用來源編號（例如：依據【來源 1】所述... 或 (參見來源 2)），以表明回答的出處。`;

  // 4. 呼叫 Gemini Flash 生成回答 (由於是問答，不需要 Structured Output，直接產文字即可)
  const payload = {
    contents: [
      { parts: [{ text: prompt }] }
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048
    }
  };

  let response;
  // 優先且每次皆嘗試最新一代的 gemini-3.5-flash，不永久將降級結果寫入設定中
  const modelsToTry = ['gemini-3.5-flash', GEMINI_API.MODELS.FLASH, 'gemini-3-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-1.5-flash'];

  // 去除重複的模型 ID
  const uniqueModels = [...new Set(modelsToTry)];
  let lastError;

  for (const m of uniqueModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        break; // 呼叫成功，跳出迴圈
      } else {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `API error with status ${response.status}`);
      }
    } catch (err) {
      lastError = err;
      console.warn(`[RAGEngine] ${m} 呼叫失敗，將嘗試下一個備用模型。錯誤: ${err.message}`);
    }
  }

  if (!response || !response.ok) {
    throw lastError || new Error('所有 RAG 備用模型皆呼叫失敗。');
  }

  const resJson = await response.json();

  const answer = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!answer) {
    throw new Error('AI 未能產生回答。');
  }

  return {
    answer: answer.trim(),
    sources: sources
  };
}
