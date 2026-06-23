/**
 * ZIP 匯出與匯入管理模組
 */

import '../lib/jszip.min.js'; // 這會將 JSZip 載入至 globalThis.JSZip
import { DB_CONFIG, EXPORT_CONFIG } from '../utils/constants.js';
import { 
  openUserDB, 
  getDatabaseMeta, 
  listJudgments 
} from '../database/database-manager.js';
import { generateUUID } from '../utils/crypto.js';

// 取得全域 JSZip 實例
const getJSZip = () => {
  if (globalThis.JSZip) return globalThis.JSZip;
  if (self.JSZip) return self.JSZip;
  throw new Error('JSZip 壓縮庫尚未載入。');
};

/**
 * 輔助函數：將 Float32Array 向量轉為 Base64 字串
 */
function vectorToBase64(floatArray) {
  if (!floatArray) return '';
  const f32 = floatArray instanceof Float32Array ? floatArray : new Float32Array(floatArray);
  const bytes = new Uint8Array(f32.buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * 輔助函數：將 Base64 字串還原為 Float32Array 向量
 */
function base64ToVector(base64) {
  if (!base64) return new Float32Array(0);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}

/**
 * 匯出資料庫為 ZIP Base64 字串
 * @param {string} dbId - 資料庫 ID
 * @param {boolean} includeRawText - 是否包含原始全文
 * @returns {Promise<string>} - ZIP 檔案的 Base64 字串
 */
export async function exportDatabaseToZip(dbId, includeRawText = true) {
  const JSZip = getJSZip();
  const zip = new JSZip();
  const stores = DB_CONFIG.USER_DB_STORES;
  
  // 1. 取得資料庫 Meta 資訊
  const dbMeta = await getDatabaseMeta(dbId);
  if (!dbMeta) throw new Error('找不到指定的資料庫。');

  // 2. 開啟使用者資料庫實例並讀取全部資料
  const db = await openUserDB(dbId);

  // 讀取標籤
  const tagsList = await new Promise((res) => {
    const tx = db.transaction(stores.TAGS, 'readonly');
    tx.objectStore(stores.TAGS).getAll().onsuccess = (e) => res(e.target.result || []);
  });

  // 讀取判決書與關聯
  const judgmentsList = await listJudgments(dbId, true); // 包含全文

  // 讀取判決與標籤關聯
  const judgmentTagsList = await new Promise((res) => {
    const tx = db.transaction(stores.JUDGMENT_TAGS, 'readonly');
    tx.objectStore(stores.JUDGMENT_TAGS).getAll().onsuccess = (e) => res(e.target.result || []);
  });

  // 讀取向量嵌入
  const embeddingsList = await new Promise((res) => {
    const tx = db.transaction(stores.EMBEDDINGS, 'readonly');
    tx.objectStore(stores.EMBEDDINGS).getAll().onsuccess = (e) => res(e.target.result || []);
  });

  // 3. 建立 ZIP 結構與寫入檔案
  // (a) metadata / manifest
  const manifest = {
    version: EXPORT_CONFIG.MANIFEST_VERSION,
    exportedAt: new Date().toISOString(),
    databaseId: dbId,
    databaseName: dbMeta.name,
    judgmentsCount: judgmentsList.length,
    tagsCount: tagsList.length,
    includeRawText: includeRawText
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  // (b) database metadata
  zip.file('databases/database-meta.json', JSON.stringify(dbMeta, null, 2));

  // (c) tags list
  zip.file('tags/tags.json', JSON.stringify(tagsList, null, 2));

  // (d) judgment tags associations
  zip.file('tags/judgment-tags.json', JSON.stringify(judgmentTagsList, null, 2));

  // (e) judgments & embeddings
  const judgmentsFolder = zip.folder('judgments');
  const vectorsMap = {};

  for (const judgment of judgmentsList) {
    // 複製判決物件，以防修改快取
    const jCopy = { ...judgment };
    if (!includeRawText) {
      delete jCopy.rawText; // 如果使用者選擇不包含全文以縮減體積
    }
    // 移除 listJudgments 附帶的 tags 欄位，維持資料表結構乾淨
    delete jCopy.tags;

    judgmentsFolder.file(`judgment-${judgment.id}.json`, JSON.stringify(jCopy, null, 2));
  }

  // (f) 向量資料 (序列化為 base64 Map)
  for (const emb of embeddingsList) {
    vectorsMap[emb.id] = {
      judgmentId: emb.judgmentId,
      chunkText: emb.chunkText,
      chunkType: emb.chunkType,
      vectorBase64: vectorToBase64(emb.vector)
    };
  }
  zip.file('embeddings/vectors.json', JSON.stringify(vectorsMap, null, 2));

  // 4. 打包壓縮
  const zipContent = await zip.generateAsync({
    type: 'base64',
    compression: 'DEFLATE',
    compressionOptions: { level: EXPORT_CONFIG.ZIP_COMPRESSION_LEVEL }
  });

  return zipContent;
}

/**
 * 從 ZIP Base64 匯入資料庫 (支援增量合併與 Last-Writer-Wins 衝突處理)
 * @param {string} targetDbId - 目標資料庫 ID
 * @param {string} zipBase64 - ZIP 檔案 Base64 字串
 * @returns {Promise<object>} - 匯入結果摘要
 */
export async function importDatabaseFromZip(targetDbId, zipBase64) {
  const JSZip = getJSZip();
  const zip = await JSZip.loadAsync(zipBase64, { base64: true });
  const stores = DB_CONFIG.USER_DB_STORES;

  // 1. 讀取並檢驗 manifest
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new Error('無效的壓縮檔：找不到 manifest.json。');
  }
  const manifest = JSON.parse(await manifestFile.async('text'));

  // 2. 讀取匯入的資料
  const tagsText = await zip.file('tags/tags.json').async('text');
  const tagsImport = JSON.parse(tagsText);

  const jTagsText = await zip.file('tags/judgment-tags.json').async('text');
  const jTagsImport = JSON.parse(jTagsText);

  const vectorsText = await zip.file('embeddings/vectors.json').async('text');
  const vectorsImport = JSON.parse(vectorsText);

  // 3. 讀取所有判決書檔案
  const judgmentsImport = [];
  const judgmentsFiles = zip.folder('judgments').file(/judgment-.*\.json/);
  for (const file of judgmentsFiles) {
    const text = await file.async('text');
    judgmentsImport.push(JSON.parse(text));
  }

  // 4. 開始匯入至目標資料庫 (開交易)
  const db = await openUserDB(targetDbId);
  const tx = db.transaction([stores.JUDGMENTS, stores.EMBEDDINGS, stores.TAGS, stores.JUDGMENT_TAGS], 'readwrite');
  
  let importedCount = 0;
  let skippedCount = 0;
  let overwrittenCount = 0;

  try {
    const jStore = tx.objectStore(stores.JUDGMENTS);
    const eStore = tx.objectStore(stores.EMBEDDINGS);
    const tStore = tx.objectStore(stores.TAGS);
    const jtStore = tx.objectStore(stores.JUDGMENT_TAGS);

    // (a) 寫入/更新標籤定義
    for (const tag of tagsImport) {
      // 檢查是否已有同名或同 ID 的標籤
      const getTagReq = tStore.get(tag.id);
      const existingTag = await new Promise(res => {
        getTagReq.onsuccess = () => res(getTagReq.result);
        getTagReq.onerror = () => res(null);
      });

      if (!existingTag) {
        tStore.put(tag);
      } else {
        // 合併使用次數
        existingTag.usageCount = Math.max(existingTag.usageCount || 0, tag.usageCount || 0);
        tStore.put(existingTag);
      }
    }

    // (b) 寫入判決書 (增量比對，Last-Writer-Wins 策略)
    for (const judgment of judgmentsImport) {
      const getJReq = jStore.get(judgment.id);
      const existingJ = await new Promise(res => {
        getJReq.onsuccess = () => res(getJReq.result);
        getJReq.onerror = () => res(null);
      });

      let shouldWrite = false;
      let isOverwrite = false;

      if (!existingJ) {
        shouldWrite = true;
        importedCount++;
      } else {
        // 比對最後更新時間
        const importTime = new Date(judgment.updatedAt || judgment.analyzedAt);
        const localTime = new Date(existingJ.updatedAt || existingJ.analyzedAt);
        
        if (importTime > localTime) {
          shouldWrite = true;
          isOverwrite = true;
          overwrittenCount++;
        } else {
          skippedCount++;
        }
      }

      if (shouldWrite) {
        // 寫入判決書主表
        judgment.databaseId = targetDbId; // 綁定到當前目標資料庫
        jStore.put(judgment);

        // 寫入此判決關聯的向量嵌入 (對應 embeddings/)
        // 先清理該判決既有的向量分塊
        const existingEmbKeys = await new Promise(res => {
          eStore.index('judgmentId').getAllKeys(judgment.id).onsuccess = (e) => res(e.target.result || []);
        });
        for (const k of existingEmbKeys) {
          eStore.delete(k);
        }

        // 從匯入資料中尋找並寫入該判決的所有向量
        for (const [embId, embData] of Object.entries(vectorsImport)) {
          if (embData.judgmentId === judgment.id) {
            const embeddingItem = {
              id: embId,
              judgmentId: judgment.id,
              chunkText: embData.chunkText,
              vector: base64ToVector(embData.vectorBase64), // 還原成 Float32Array
              chunkType: embData.chunkType
            };
            eStore.put(embeddingItem);
          }
        }

        // 寫入此判決的標籤關聯 (對應 judgment-tags)
        // 先清理舊關聯
        const existingJtKeys = await new Promise(res => {
          jtStore.index('judgmentId').getAllKeys(judgment.id).onsuccess = (e) => res(e.target.result || []);
        });
        for (const k of existingJtKeys) {
          jtStore.delete(k);
        }

        // 寫入匯入的關聯
        for (const jTag of jTagsImport) {
          if (jTag.judgmentId === judgment.id) {
            jtStore.put(jTag);
          }
        }
      }
    }

    // 等待交易提交
    await new Promise((res, reject) => {
      tx.oncomplete = () => res();
      tx.onerror = () => reject(tx.error);
    });

    return {
      success: true,
      summary: {
        totalImported: importedCount,
        overwritten: overwrittenCount,
        skipped: skippedCount,
        databaseName: manifest.databaseName
      }
    };

  } catch (err) {
    tx.abort();
    console.error('[ExportImport] 匯入資料庫事務失敗:', err);
    throw err;
  }
}
