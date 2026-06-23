/**
 * L1/L2 快取管理層
 */

import { CACHE_CONFIG } from '../utils/constants.js';
import { generateJudgmentId } from '../utils/crypto.js';
import { getJudgmentById, saveJudgmentData } from './database-manager.js';

// L1 Memory 快取 Map (限額 50 筆)
const l1Cache = new Map();
// 追蹤鍵值插入順序用於 eviction (FIFO)
const l1KeysOrder = [];

/**
 * 取得快取資料 (L1 -> L2)
 * @param {string} dbId - 當前資料庫 ID
 * @param {string} caseNumber - 案號
 * @param {string} court - 法院
 * @param {string} rawText - 全文
 * @returns {Promise<object|null>} - 命中快取傳回判決書物件，否則為 null
 */
export async function getJudgmentCached(dbId, caseNumber, court, rawText) {
  // 1. 計算唯一快取識別碼 (SHA-256)
  const id = await generateJudgmentId(caseNumber, court, rawText, CACHE_CONFIG.HASH_PREFIX_LENGTH);
  
  // 2. 檢查 L1 Memory 快取
  const memCacheKey = `${dbId}_${id}`;
  if (l1Cache.has(memCacheKey)) {
    console.log(`[CacheLayer] L1 記憶體快取命中: ${caseNumber} (${court})`);
    return l1Cache.get(memCacheKey);
  }

  // 3. 檢查 L2 IndexedDB 快取
  try {
    const judgment = await getJudgmentById(dbId, id);
    if (judgment) {
      console.log(`[CacheLayer] L2 資料庫快取命中: ${caseNumber} (${court})`);
      // 寫回 L1 快取
      setL1Cache(memCacheKey, judgment);
      return judgment;
    }
  } catch (err) {
    console.error('[CacheLayer] L2 讀取失敗:', err);
  }

  return null;
}

/**
 * 儲存判決書資料至 L1/L2
 */
export async function saveJudgmentCached(dbId, judgment, chunks, vectors, suggestedTags = []) {
  // 1. 計算唯一識別碼並寫入主表實體
  const id = await generateJudgmentId(judgment.caseNumber, judgment.court, judgment.rawText, CACHE_CONFIG.HASH_PREFIX_LENGTH);
  judgment.id = id;

  // 2. 寫入 L2 IndexedDB
  const savedData = await saveJudgmentData(dbId, judgment, chunks, vectors, suggestedTags);

  // 3. 寫入 L1 Memory 快取
  const memCacheKey = `${dbId}_${id}`;
  setL1Cache(memCacheKey, savedData);

  return savedData;
}

/**
 * 寫入 L1 記憶體快取 (含超出容量時的逐出機制)
 */
function setL1Cache(key, value) {
  if (l1Cache.has(key)) {
    // 移到最後面（代表最近存取過）
    l1Cache.delete(key);
    l1Cache.set(key, value);
    return;
  }

  // 超出最大容量上限，移出最舊的快取
  if (l1Cache.size >= CACHE_CONFIG.L1_MAX_SIZE) {
    // Map.prototype.keys().next().value 會取出第一個插入的鍵名 (FIFO 邏輯)
    const oldestKey = l1Cache.keys().next().value;
    l1Cache.delete(oldestKey);
    console.log(`[CacheLayer] L1 記憶體滿，移出最舊快取: ${oldestKey}`);
  }

  l1Cache.set(key, value);
}

/**
 * 清除所有 L1 記憶體快取 (例如切換資料庫或登出時)
 */
export function clearL1Cache() {
  l1Cache.clear();
  console.log('[CacheLayer] L1 記憶體快取已清空。');
}
