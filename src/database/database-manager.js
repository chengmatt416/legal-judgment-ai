/**
 * IndexedDB 資料庫管理模組
 */

import { DB_CONFIG, DEFAULT_SETTINGS } from '../utils/constants.js';
import { generateUUID } from '../utils/crypto.js';

// 快取打開的資料庫實例
const openedDatabases = {};

/**
 * 開啟或建立 Meta 資料庫
 * @returns {Promise<IDBDatabase>}
 */
export function openMetaDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_CONFIG.META_DB_NAME, DB_CONFIG.META_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // 建立 settings store
      if (!db.objectStoreNames.contains(DB_CONFIG.STORES.SETTINGS)) {
        db.createObjectStore(DB_CONFIG.STORES.SETTINGS);
      }
      
      // 建立 databases list store
      if (!db.objectStoreNames.contains(DB_CONFIG.STORES.DATABASES)) {
        db.createObjectStore(DB_CONFIG.STORES.DATABASES, { keyPath: 'id' });
      }

      // 建立 laws store
      if (!db.objectStoreNames.contains(DB_CONFIG.STORES.LAWS)) {
        db.createObjectStore(DB_CONFIG.STORES.LAWS, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * 取得所有設定值
 * @returns {Promise<object>}
 */
export async function getSettings() {
  const db = await openMetaDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_CONFIG.STORES.SETTINGS, 'readonly');
    const store = transaction.objectStore(DB_CONFIG.STORES.SETTINGS);
    const request = store.get('all');

    request.onsuccess = () => {
      const settings = request.result || {};
      // 混合預設值以防新加入的設定項不存在
      resolve({ ...DEFAULT_SETTINGS, ...settings });
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 儲存設定值
 * @param {object} newSettings - 要儲存的設定項
 * @returns {Promise<object>} - 更新後的完整設定
 */
export async function saveSettings(newSettings) {
  const current = await getSettings();
  const updated = { ...current, ...newSettings };
  
  const db = await openMetaDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_CONFIG.STORES.SETTINGS, 'readwrite');
    const store = transaction.objectStore(DB_CONFIG.STORES.SETTINGS);
    const request = store.put(updated, 'all');

    request.onsuccess = () => resolve(updated);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 列出所有使用者資料庫
 * @returns {Promise<array>}
 */
export async function listDatabases() {
  const db = await openMetaDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_CONFIG.STORES.DATABASES, 'readonly');
    const store = transaction.objectStore(DB_CONFIG.STORES.DATABASES);
    const request = store.getAll();

    request.onsuccess = async () => {
      let list = request.result || [];
      
      // 如果還沒有任何資料庫，自動建立一個預設資料庫
      if (list.length === 0) {
        const defaultDb = {
          id: 'default',
          name: '預設資料庫',
          description: '預設用於存放判決書摘要的資料庫',
          color: '#6366F1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isActive: true
        };
        await saveDatabaseMeta(defaultDb);
        list = [defaultDb];
      }
      
      resolve(list);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 儲存或更新資料庫元資料 (Meta)
 */
async function saveDatabaseMeta(dbMeta) {
  const db = await openMetaDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_CONFIG.STORES.DATABASES, 'readwrite');
    const store = transaction.objectStore(DB_CONFIG.STORES.DATABASES);
    const request = store.put(dbMeta);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 取得當前啟用的資料庫 ID
 * @returns {Promise<string>}
 */
export async function getActiveDatabaseId() {
  const settings = await getSettings();
  const dbs = await listDatabases();
  
  // 檢查設定的 active 庫是否存在，若不存在或沒設定，就取第一個
  const activeId = settings.activeDatabaseId;
  const exists = dbs.some(d => d.id === activeId);
  
  if (activeId && exists) {
    return activeId;
  }
  
  const defaultActive = dbs.find(d => d.isActive) || dbs[0];
  if (defaultActive) {
    // 寫回設定
    await saveSettings({ activeDatabaseId: defaultActive.id });
    return defaultActive.id;
  }
  
  return 'default';
}

/**
 * 建立新資料庫
 * @param {string} name - 資料庫名稱
 * @param {string} description - 描述
 * @param {string} color - 代表色 (Hex)
 * @returns {Promise<object>} - 建立的資料庫物件
 */
export async function createDatabase(name, description, color = '#06B6D4') {
  const id = generateUUID();
  const newDb = {
    id,
    name,
    description,
    color,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isActive: false,
    syncStatus: 'idle'
  };
  
  await saveDatabaseMeta(newDb);
  // 觸發初始化使用者資料庫實例的 schema
  await openUserDB(id);
  return newDb;
}

/**
 * 刪除資料庫 (並刪除對應的 IndexedDB)
 * @param {string} dbId - 資料庫 ID
 */
export async function deleteDatabase(dbId) {
  if (dbId === 'default') {
    throw new Error('不能刪除預設資料庫。');
  }

  // 1. 關閉連接並從快取中清除
  if (openedDatabases[dbId]) {
    openedDatabases[dbId].close();
    delete openedDatabases[dbId];
  }

  // 2. 刪除 IndexedDB 實體
  const dbName = `_legal_ai_db_${dbId}`;
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  // 3. 從 Meta 庫移除
  const db = await openMetaDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_CONFIG.STORES.DATABASES, 'readwrite');
    const store = transaction.objectStore(DB_CONFIG.STORES.DATABASES);
    const request = store.delete(dbId);
    
    request.onsuccess = async () => {
      // 若刪除的是當前啟用的庫，將啟用庫切回 default
      const activeId = await getActiveDatabaseId();
      if (activeId === dbId) {
        await saveSettings({ activeDatabaseId: 'default' });
        // 將 default 庫設為 isActive = true
        const defaultDb = await getDatabaseMeta('default');
        if (defaultDb) {
          defaultDb.isActive = true;
          await saveDatabaseMeta(defaultDb);
        }
      }
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 取得特定資料庫的元資料
 */
export async function getDatabaseMeta(dbId) {
  const db = await openMetaDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_CONFIG.STORES.DATABASES, 'readonly');
    const store = transaction.objectStore(DB_CONFIG.STORES.DATABASES);
    const request = store.get(dbId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ===================================================================
   使用者資料庫 (Judgments / Embeddings / Tags) 核心操作
   =================================================================== */

/**
 * 開啟特定的使用者資料庫實例
 * @param {string} dbId 
 * @returns {Promise<IDBDatabase>}
 */
export function openUserDB(dbId) {
  if (openedDatabases[dbId]) {
    return Promise.resolve(openedDatabases[dbId]);
  }

  const dbName = `_legal_ai_db_${dbId}`;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_CONFIG.USER_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const stores = DB_CONFIG.USER_DB_STORES;

      // 1. 判決書 Judgments Store
      if (!db.objectStoreNames.contains(stores.JUDGMENTS)) {
        const jStore = db.createObjectStore(stores.JUDGMENTS, { keyPath: 'id' });
        jStore.createIndex('caseNumber', 'caseNumber', { unique: false });
        jStore.createIndex('court', 'court', { unique: false });
        jStore.createIndex('date', 'date', { unique: false });
        jStore.createIndex('caseType', 'caseType', { unique: false });
        jStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // 2. 向量嵌入 Embeddings Store
      if (!db.objectStoreNames.contains(stores.EMBEDDINGS)) {
        const eStore = db.createObjectStore(stores.EMBEDDINGS, { keyPath: 'id' });
        eStore.createIndex('judgmentId', 'judgmentId', { unique: false });
      }

      // 3. 標籤定義 Tags Store
      if (!db.objectStoreNames.contains(stores.TAGS)) {
        const tStore = db.createObjectStore(stores.TAGS, { keyPath: 'id' });
        tStore.createIndex('name', 'name', { unique: true });
        tStore.createIndex('type', 'type', { unique: false });
        tStore.createIndex('category', 'category', { unique: false });
      }

      // 4. 判決書-標籤關聯 Store (多對多)
      if (!db.objectStoreNames.contains(stores.JUDGMENT_TAGS)) {
        const jtStore = db.createObjectStore(stores.JUDGMENT_TAGS, { keyPath: 'id' });
        jtStore.createIndex('judgmentId', 'judgmentId', { unique: false });
        jtStore.createIndex('tagId', 'tagId', { unique: false });
        // 用於複合搜尋
        jtStore.createIndex('judgmentId_tagId', ['judgmentId', 'tagId'], { unique: true });
      }
    };

    request.onsuccess = (event) => {
      openedDatabases[dbId] = event.target.result;
      resolve(openedDatabases[dbId]);
    };

    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * 寫入或更新判決書的所有關聯資料（包括摘要、分塊、向量嵌入以及自動套用標籤）
 * @param {string} dbId - 資料庫 ID
 * @param {object} judgment - 判決書主要內容
 * @param {array} chunks - 切碎的文字段落陣列 [{ text, type }]
 * @param {number[][]} vectors - 與 chunks 1對1對應的 768 維向量陣列
 * @param {array} suggestedTags - AI 產生的建議標籤陣列
 * @returns {Promise<object>} - 回傳包含已儲存標籤的完整判決書資料
 */
export async function saveJudgmentData(dbId, judgment, chunks, vectors, suggestedTags = []) {
  const db = await openUserDB(dbId);
  const stores = DB_CONFIG.USER_DB_STORES;
  
  // 建立交易，涵蓋所有相關 store
  const tx = db.transaction([stores.JUDGMENTS, stores.EMBEDDINGS, stores.TAGS, stores.JUDGMENT_TAGS], 'readwrite');
  
  try {
    const judgmentStore = tx.objectStore(stores.JUDGMENTS);
    const embeddingStore = tx.objectStore(stores.EMBEDDINGS);
    const tagsStore = tx.objectStore(stores.TAGS);
    const jtStore = tx.objectStore(stores.JUDGMENT_TAGS);

    // 1. 寫入判決書主表
    judgment.databaseId = dbId;
    judgment.updatedAt = new Date().toISOString();
    await new Promise((res, rej) => {
      const req = judgmentStore.put(judgment);
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    });

    // 2. 清理該判決書既有的向量（如果存在）並寫入新向量
    const existingEmbeddingsReq = embeddingStore.index('judgmentId').getAllKeys(judgment.id);
    const existingKeys = await new Promise((res, rej) => {
      existingEmbeddingsReq.onsuccess = () => res(existingEmbeddingsReq.result);
      existingEmbeddingsReq.onerror = () => rej(existingEmbeddingsReq.error);
    });
    for (const key of existingKeys) {
      embeddingStore.delete(key);
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vector = vectors[i];
      const embeddingId = `${judgment.id}_${i}`;
      
      const embeddingItem = {
        id: embeddingId,
        judgmentId: judgment.id,
        chunkText: chunk.text,
        vector: vector, // 儲存為 Float32Array 陣列
        chunkType: chunk.type
      };
      
      embeddingStore.put(embeddingItem);
    }

    // 3. 處理系統標籤與 AI 自動標籤 (信心度 >= 0.7 自動套用)
    const tagsToApply = [];
    
    // (a) 系統標籤：案件類別 (例如：刑事、民事)
    if (judgment.caseType) {
      tagsToApply.push({
        name: judgment.caseType,
        type: 'system',
        category: '案件類別',
        confidence: 1.0
      });
    }
    // (b) 系統標籤：法院層級 (例如：最高法院)
    if (judgment.court) {
      tagsToApply.push({
        name: judgment.court,
        type: 'system',
        category: '法院層級',
        confidence: 1.0
      });
    }

    // (c) AI 標籤：信心度 >= 0.7 的自動加入
    for (const sugTag of suggestedTags) {
      if (sugTag.confidence >= 0.7) {
        tagsToApply.push({
          name: sugTag.name,
          type: 'ai',
          category: sugTag.category || '法學爭點',
          confidence: sugTag.confidence
        });
      }
    }

    // 將篩選出的標籤寫入定義表並建立關聯
    for (const tagInfo of tagsToApply) {
      // 檢查標籤定義是否已存在
      const getTagReq = tagsStore.index('name').get(tagInfo.name);
      let tagObj = await new Promise((res) => {
        getTagReq.onsuccess = () => res(getTagReq.result);
        getTagReq.onerror = () => res(null);
      });

      if (!tagObj) {
        tagObj = {
          id: generateUUID(),
          name: tagInfo.name,
          color: getRandomTagColor(tagInfo.type),
          type: tagInfo.type,
          category: tagInfo.category,
          usageCount: 1,
          createdAt: new Date().toISOString()
        };
        tagsStore.put(tagObj);
      } else {
        // 更新使用次數
        tagObj.usageCount = (tagObj.usageCount || 0) + 1;
        tagsStore.put(tagObj);
      }

      // 建立多對多關聯 (判決書 ↔ 標籤)
      const assocId = `${judgment.id}_${tagObj.id}`;
      const assocItem = {
        id: assocId,
        judgmentId: judgment.id,
        tagId: tagObj.id,
        source: tagInfo.type === 'system' ? 'system' : 'ai-auto',
        confidence: tagInfo.confidence,
        taggedAt: new Date().toISOString()
      };
      jtStore.put(assocItem);
    }

    // 等待交易完成
    await new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });

    // 4. 更新資料庫的最後更新時間
    const dbMeta = await getDatabaseMeta(dbId);
    if (dbMeta) {
      dbMeta.updatedAt = new Date().toISOString();
      await saveDatabaseMeta(dbMeta);
    }

    // 回傳包含最新標籤清單的判決書資料
    return await getJudgmentById(dbId, judgment.id);

  } catch (err) {
    tx.abort();
    console.error('[DatabaseManager] 寫入判決書事務失敗，已回復 transaction:', err);
    throw err;
  }
}

/**
 * 取得特定判決書，包含關聯的標籤
 */
export async function getJudgmentById(dbId, id) {
  const db = await openUserDB(dbId);
  const stores = DB_CONFIG.USER_DB_STORES;

  // 1. 取得判決主體
  const judgment = await new Promise((resolve, reject) => {
    const tx = db.transaction(stores.JUDGMENTS, 'readonly');
    const request = tx.objectStore(stores.JUDGMENTS).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  if (!judgment) return null;

  // 2. 取得關聯的標籤 ID 清單
  const tagRelations = await new Promise((resolve, reject) => {
    const tx = db.transaction(stores.JUDGMENT_TAGS, 'readonly');
    const index = tx.objectStore(stores.JUDGMENT_TAGS).index('judgmentId');
    const request = index.getAll(id);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });

  // 3. 取得每個標籤的詳細資訊
  const tags = [];
  if (tagRelations.length > 0) {
    const tx = db.transaction(stores.TAGS, 'readonly');
    const tagStore = tx.objectStore(stores.TAGS);
    
    for (const rel of tagRelations) {
      const tag = await new Promise((res) => {
        const req = tagStore.get(rel.tagId);
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(null);
      });
      if (tag) {
        tags.push(tag);
      }
    }
  }

  judgment.tags = tags;
  return judgment;
}

/**
 * 列出資料庫內所有的判決書（可選包含/不包含全文以加快傳輸）
 * @param {string} dbId 
 * @param {boolean} includeRawText - 是否包含全文欄位
 */
export async function listJudgments(dbId, includeRawText = false) {
  const db = await openUserDB(dbId);
  const stores = DB_CONFIG.USER_DB_STORES;
  
  const rawList = await new Promise((resolve, reject) => {
    const tx = db.transaction(stores.JUDGMENTS, 'readonly');
    const request = tx.objectStore(stores.JUDGMENTS).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });

  // 整理回傳清單，綁定標籤並過濾欄位
  const result = [];
  for (const item of rawList) {
    const fullItem = await getJudgmentById(dbId, item.id);
    if (!includeRawText) {
      delete fullItem.rawText;
    }
    result.push(fullItem);
  }

  // 依時間新到舊排序
  return result.sort((a, b) => new Date(b.analyzedAt) - new Date(a.analyzedAt));
}

/**
 * 刪除判決書（同步移除向量與關聯標籤計數）
 */
export async function deleteJudgment(dbId, judgmentId) {
  const db = await openUserDB(dbId);
  const stores = DB_CONFIG.USER_DB_STORES;

  const tx = db.transaction([stores.JUDGMENTS, stores.EMBEDDINGS, stores.TAGS, stores.JUDGMENT_TAGS], 'readwrite');
  
  try {
    const jStore = tx.objectStore(stores.JUDGMENTS);
    const eStore = tx.objectStore(stores.EMBEDDINGS);
    const tStore = tx.objectStore(stores.TAGS);
    const jtStore = tx.objectStore(stores.JUDGMENT_TAGS);

    // 1. 刪除判決主體
    jStore.delete(judgmentId);

    // 2. 刪除向量分塊
    const embeddingKeys = await new Promise((res) => {
      const req = eStore.index('judgmentId').getAllKeys(judgmentId);
      req.onsuccess = () => res(req.result || []);
    });
    for (const key of embeddingKeys) {
      eStore.delete(key);
    }

    // 3. 取得關聯標籤，並扣減標籤使用計數
    const relations = await new Promise((res) => {
      const req = jtStore.index('judgmentId').getAll(judgmentId);
      req.onsuccess = () => res(req.result || []);
    });

    for (const rel of relations) {
      // 刪除關聯記錄
      jtStore.delete(rel.id);
      
      // 更新標籤使用數
      const tagObj = await new Promise((res) => {
        const req = tStore.get(rel.tagId);
        req.onsuccess = () => res(req.result);
      });
      if (tagObj) {
        tagObj.usageCount = Math.max(0, (tagObj.usageCount || 1) - 1);
        if (tagObj.usageCount === 0 && tagObj.type === 'user') {
          // 如果使用者自訂標籤沒有任何引用，直接刪除該標籤定義
          tStore.delete(tagObj.id);
        } else {
          tStore.put(tagObj);
        }
      }
    }

    await new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });

    // 更新資料庫的最後更新時間
    const dbMeta = await getDatabaseMeta(dbId);
    if (dbMeta) {
      dbMeta.updatedAt = new Date().toISOString();
      await saveDatabaseMeta(dbMeta);
    }

    return true;
  } catch (err) {
    tx.abort();
    console.error('[DatabaseManager] 刪除判決書事務失敗:', err);
    throw err;
  }
}

/**
 * 取得特定資料庫內所有的向量嵌入資料 (用於 RAG 全檢索)
 */
export async function getAllEmbeddings(dbId) {
  const db = await openUserDB(dbId);
  const stores = DB_CONFIG.USER_DB_STORES;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores.EMBEDDINGS, 'readonly');
    const request = tx.objectStore(stores.EMBEDDINGS).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 僅儲存或更新向量嵌入資料 (用於非同步延遲向量化)
 * @param {string} dbId - 資料庫 ID
 * @param {string} judgmentId - 判決書 ID
 * @param {array} chunks - 切碎的文字段落陣列
 * @param {array} vectors - 與 chunks 一對一對應的向量陣列
 */
export async function saveEmbeddingsData(dbId, judgmentId, chunks, vectors) {
  const db = await openUserDB(dbId);
  const storeName = DB_CONFIG.USER_DB_STORES.EMBEDDINGS;
  
  const tx = db.transaction(storeName, 'readwrite');
  const embeddingStore = tx.objectStore(storeName);
  
  // 1. 清理該判決書既有的向量
  const existingKeys = await new Promise((res, rej) => {
    const req = embeddingStore.index('judgmentId').getAllKeys(judgmentId);
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => rej(req.error);
  });
  for (const key of existingKeys) {
    embeddingStore.delete(key);
  }
  
  // 2. 寫入新向量
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const vector = vectors[i];
    const embeddingId = `${judgmentId}_${i}`;
    
    const embeddingItem = {
      id: embeddingId,
      judgmentId: judgmentId,
      chunkText: chunk.text,
      vector: vector,
      chunkType: chunk.type
    };
    
    embeddingStore.put(embeddingItem);
  }
  
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

/* ===================================================================
   輔助工具
   =================================================================== */

/**
 * 依標籤種類產生隨機和諧代表色
 */
function getRandomTagColor(type) {
  const systemColors = ['#4F46E5', '#6366F1', '#4338CA', '#3730A3']; // 藍靛系
  const aiColors = ['#7C3AED', '#8B5CF6', '#6D28D9', '#5B21B6'];     // 紫色系
  const userColors = ['#0891B2', '#06B6D4', '#0E7490', '#0F766E', '#10B981', '#059669']; // 青綠藍系

  let palette = userColors;
  if (type === 'system') palette = systemColors;
  else if (type === 'ai') palette = aiColors;

  return palette[Math.floor(Math.random() * palette.length)];
}
