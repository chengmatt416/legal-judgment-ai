/**
 * 智慧標籤系統管理模組
 */

import { DB_CONFIG } from '../utils/constants.js';
import { generateUUID } from '../utils/crypto.js';
import { openUserDB, getJudgmentById } from './database-manager.js';

/**
 * 列出資料庫中所有的標籤定義
 * @param {string} dbId 
 * @returns {Promise<array>}
 */
export async function listAllTags(dbId) {
  const db = await openUserDB(dbId);
  const storeName = DB_CONFIG.USER_DB_STORES.TAGS;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();

    request.onsuccess = () => {
      const list = request.result || [];
      // 依使用次數多到少排序
      resolve(list.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0)));
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 為特定的判決書新增一個標籤（如果該標籤尚未定義，則建立新的定義）
 * @param {string} dbId - 資料庫 ID
 * @param {string} judgmentId - 判決書 ID
 * @param {string} tagName - 標籤名稱
 * @param {string} category - 分類群組 (例如：法學爭點、罪名、自訂)
 * @param {string} type - 'user' 或 'ai'
 * @param {number} confidence - 信心度
 * @returns {Promise<array>} - 更新後的該判決書標籤列表
 */
export async function addTagToJudgment(dbId, judgmentId, tagName, category = '自訂', type = 'user', confidence = 1.0) {
  const db = await openUserDB(dbId);
  const stores = DB_CONFIG.USER_DB_STORES;
  
  const tx = db.transaction([stores.TAGS, stores.JUDGMENT_TAGS, stores.JUDGMENTS], 'readwrite');
  
  try {
    const tagsStore = tx.objectStore(stores.TAGS);
    const jtStore = tx.objectStore(stores.JUDGMENT_TAGS);

    // 1. 搜尋此標籤是否已存在定義中
    const getTagReq = tagsStore.index('name').get(tagName);
    let tagObj = await new Promise((res) => {
      getTagReq.onsuccess = () => res(getTagReq.result);
      getTagReq.onerror = () => res(null);
    });

    if (!tagObj) {
      // 建立新標籤定義
      tagObj = {
        id: generateUUID(),
        name: tagName,
        color: getRandomTagColor(type),
        type: type,
        category: category,
        usageCount: 1,
        createdAt: new Date().toISOString()
      };
      tagsStore.put(tagObj);
    } else {
      // 標籤已存在，檢查是否已和此判決書關聯
      const assocId = `${judgmentId}_${tagObj.id}`;
      const checkAssocReq = jtStore.get(assocId);
      const isLinked = await new Promise((res) => {
        checkAssocReq.onsuccess = () => res(!!checkAssocReq.result);
        checkAssocReq.onerror = () => res(false);
      });

      if (isLinked) {
        // 如果已經有關聯，直接返回
        tx.abort();
        const fullJudgment = await getJudgmentById(dbId, judgmentId);
        return fullJudgment.tags;
      }

      // 未關聯，增加使用次數
      tagObj.usageCount = (tagObj.usageCount || 0) + 1;
      // 如果原本是 AI 標籤，但使用者手動再次新增，可以選擇將 type 升級為 user（視需要而定，此處維持原樣但更新使用次數）
      tagsStore.put(tagObj);
    }

    // 2. 建立關聯
    const assocId = `${judgmentId}_${tagObj.id}`;
    const assocItem = {
      id: assocId,
      judgmentId: judgmentId,
      tagId: tagObj.id,
      source: type === 'ai' ? 'ai-auto' : 'user-manual',
      confidence: confidence,
      taggedAt: new Date().toISOString()
    };
    jtStore.put(assocItem);

    // 3. 更新判決書最後變更時間 (用於雲端同步比對)
    const judgmentStore = tx.objectStore(stores.JUDGMENTS);
    const getJReq = judgmentStore.get(judgmentId);
    const judgment = await new Promise(res => {
      getJReq.onsuccess = () => res(getJReq.result);
    });
    if (judgment) {
      judgment.updatedAt = new Date().toISOString();
      judgmentStore.put(judgment);
    }

    await new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });

    // 讀取並回傳更新後的標籤陣列
    const updatedJudgment = await getJudgmentById(dbId, judgmentId);
    return updatedJudgment.tags;

  } catch (err) {
    tx.abort();
    console.error('[TagManager] 新增標籤關係失敗:', err);
    throw err;
  }
}

/**
 * 解除判決書與標籤的關聯
 * @param {string} dbId 
 * @param {string} judgmentId 
 * @param {string} tagId 
 * @returns {Promise<array>} - 更新後的該判決書標籤列表
 */
export async function removeTagFromJudgment(dbId, judgmentId, tagId) {
  const db = await openUserDB(dbId);
  const stores = DB_CONFIG.USER_DB_STORES;
  
  const tx = db.transaction([stores.TAGS, stores.JUDGMENT_TAGS, stores.JUDGMENTS], 'readwrite');
  
  try {
    const tagsStore = tx.objectStore(stores.TAGS);
    const jtStore = tx.objectStore(stores.JUDGMENT_TAGS);

    // 1. 刪除關聯
    const assocId = `${judgmentId}_${tagId}`;
    jtStore.delete(assocId);

    // 2. 扣減標籤使用計數
    const tagObj = await new Promise((res) => {
      const req = tagsStore.get(tagId);
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    });

    if (tagObj) {
      tagObj.usageCount = Math.max(0, (tagObj.usageCount || 1) - 1);
      
      // 如果使用次數歸零，且非系統預設標籤，則將標籤定義從全域徹底刪除
      if (tagObj.usageCount === 0 && tagObj.type !== 'system') {
        tagsStore.delete(tagId);
      } else {
        tagsStore.put(tagObj);
      }
    }

    // 3. 更新判決書最後變更時間
    const judgmentStore = tx.objectStore(stores.JUDGMENTS);
    const getJReq = judgmentStore.get(judgmentId);
    const judgment = await new Promise(res => {
      getJReq.onsuccess = () => res(getJReq.result);
    });
    if (judgment) {
      judgment.updatedAt = new Date().toISOString();
      judgmentStore.put(judgment);
    }

    await new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });

    const updatedJudgment = await getJudgmentById(dbId, judgmentId);
    return updatedJudgment ? updatedJudgment.tags : [];

  } catch (err) {
    tx.abort();
    console.error('[TagManager] 移除標籤關係失敗:', err);
    throw err;
  }
}

/**
 * 取得特定判決書的所有標籤 (獨立查詢用)
 */
export async function getTagsForJudgment(dbId, judgmentId) {
  const judgment = await getJudgmentById(dbId, judgmentId);
  return judgment ? judgment.tags : [];
}

/**
 * 依標籤種類產生隨機和諧代表色
 */
function getRandomTagColor(type) {
  const systemColors = ['#4F46E5', '#6366F1', '#4338CA', '#3730A3'];
  const aiColors = ['#7C3AED', '#8B5CF6', '#6D28D9', '#5B21B6'];
  const userColors = ['#0891B2', '#06B6D4', '#0E7490', '#0F766E', '#10B981', '#059669'];

  let palette = userColors;
  if (type === 'system') palette = systemColors;
  else if (type === 'ai') palette = aiColors;

  return palette[Math.floor(Math.random() * palette.length)];
}
