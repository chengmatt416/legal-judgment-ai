/**
 * 雲端同步客戶端模組
 */

import { getSettings, saveSettings, openUserDB, getDatabaseMeta, getJudgmentById } from '../database/database-manager.js';
import { listAllTags } from '../database/tag-manager.js';
import { sha256 } from '../utils/crypto.js';
import { DB_CONFIG } from '../utils/constants.js';

/**
 * 驗證並啟用雲端同步
 * @param {string} activationCode - 啟用碼
 * @returns {Promise<object>} - { success: true } 或 { success: false, error }
 */
export async function activateCloudSync(activationCode) {
  const settings = await getSettings();
  const workerUrl = settings.cloudWorkerUrl || 'http://localhost:8787'; // 預設本地測試或設定值

  try {
    const res = await fetch(`${workerUrl}/api/auth/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activationCode })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || '啟用驗證失敗');
    }

    // 儲存 Token 到設定中，並開啟同步開關
    await saveSettings({
      cloudSyncEnabled: true,
      cloudJwt: data.token,
      autoSyncEnabled: true,
      activationCode: activationCode // 暫存備查
    });

    console.log('[SyncClient] 雲端同步啟用成功！使用者 ID:', data.userId);
    return { success: true };
  } catch (err) {
    console.error('[SyncClient] 啟用雲端同步出錯:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 執行增量資料上傳與下載同步 (Push & Pull)
 * @param {string} dbId - 本地資料庫 ID
 * @returns {Promise<object>} - 同步結果統計
 */
export async function syncToCloud(dbId) {
  const settings = await getSettings();
  if (!settings.cloudSyncEnabled || !settings.cloudJwt) {
    return { success: false, error: '雲端同步功能尚未啟用。' };
  }

  const workerUrl = settings.cloudWorkerUrl;
  const jwt = settings.cloudJwt;
  const stores = DB_CONFIG.USER_DB_STORES;

  try {
    console.log(`[SyncClient] 開始與雲端同步資料庫: ${dbId}...`);

    // 1. 取得本地所有判決書的 ID 與更新時間
    const db = await openUserDB(dbId);
    const judgmentsLocal = await new Promise((res) => {
      db.transaction(stores.JUDGMENTS, 'readonly')
        .objectStore(stores.JUDGMENTS)
        .getAll().onsuccess = (e) => res(e.target.result || []);
    });

    const clientJudgmentsMeta = judgmentsLocal.map(j => ({
      id: j.id,
      updatedAt: j.updatedAt
    }));

    // 2. 第一步：呼叫 Ddiff API，比對哪些需要 Push (上傳) 或 Pull (下載)
    const diffRes = await fetch(`${workerUrl}/api/sync/diff`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`
      },
      body: JSON.stringify({ judgments: clientJudgmentsMeta })
    });

    if (diffRes.status === 401) {
      // Token 過期，關閉同步狀態並拋出錯誤
      await saveSettings({ cloudSyncEnabled: false });
      throw new Error('雲端驗證授權失效 (JWT 過期)，已自動停用雲端同步。請重新輸入啟用碼。');
    }

    const diffData = await diffRes.json();
    if (!diffRes.ok || !diffData.success) {
      throw new Error(diffData.error || '無法取得雲端差異比對資料');
    }

    const { needPush = [], needPull = [] } = diffData;
    console.log(`[SyncClient] 比對結果：需要上傳 ${needPush.length} 筆，需要下載 ${needPull.length} 筆`);

    let pushResult = { pushedJudgments: 0 };
    let pullResult = { pulledJudgments: 0 };

    // 3. 第二步：執行 Push (本地資料較新，上傳至雲端)
    if (needPush.length > 0) {
      const dbMeta = await getDatabaseMeta(dbId);
      const pushPayload = {
        judgments: [],
        tags: [],
        judgmentTags: [],
        embeddings: []
      };

      // 提取需要上傳的判決書與其所有關聯資料 (向量嵌入、標籤關聯)
      const tagsStore = db.transaction(stores.TAGS, 'readonly').objectStore(stores.TAGS);
      const jtStore = db.transaction(stores.JUDGMENT_TAGS, 'readonly').objectStore(stores.JUDGMENT_TAGS);
      const embStore = db.transaction(stores.EMBEDDINGS, 'readonly').objectStore(stores.EMBEDDINGS);

      // (a) 讀取標籤定義 (全量上傳定義以防遺漏)
      const allTags = await new Promise(res => {
        tagsStore.getAll().onsuccess = (e) => res(e.target.result || []);
      });
      pushPayload.tags = allTags;

      for (const jId of needPush) {
        const localJ = judgmentsLocal.find(j => j.id === jId);
        if (localJ) {
          // 加入判決主體，並帶上資料庫名稱
          pushPayload.judgments.push({
            ...localJ,
            databaseName: dbMeta.name
          });

          // 讀取該判決的所有向量嵌入
          const embs = await new Promise(res => {
            embStore.index('judgmentId').getAll(jId).onsuccess = (e) => res(e.target.result || []);
          });
          const formattedEmbs = embs.map(e => ({
            ...e,
            vector: e.vector instanceof Float32Array ? Array.from(e.vector) : e.vector
          }));
          pushPayload.embeddings.push(...formattedEmbs);

          // 讀取該判決的所有標籤關聯
          const jts = await new Promise(res => {
            jtStore.index('judgmentId').getAll(jId).onsuccess = (e) => res(e.target.result || []);
          });
          pushPayload.judgmentTags.push(...jts);
        }
      }

      // 送出 Push 請求
      const pushRes = await fetch(`${workerUrl}/api/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwt}`
        },
        body: JSON.stringify(pushPayload)
      });

      const pushResData = await pushRes.json();
      if (!pushRes.ok || !pushResData.success) {
        throw new Error(pushResData.error || '上傳同步資料失敗');
      }
      pushResult = pushResData;
    }

    // 4. 第三步：執行 Pull (雲端資料較新，下載至本地)
    // 依據 Last-Sync 時間戳進行增量下載
    const lastSyncTimeKey = `lastSyncTime_${dbId}`;
    const localLastSyncRes = await chrome.storage.local.get([lastSyncTimeKey]);
    const lastSyncTime = localLastSyncRes[lastSyncTimeKey] || '0';

    const pullRes = await fetch(`${workerUrl}/api/sync/pull?lastSync=${lastSyncTime}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${jwt}`
      }
    });

    const pullData = await pullRes.json();
    if (!pullRes.ok || !pullData.success) {
      throw new Error(pullData.error || '下載同步資料失敗');
    }

    // 5. 第四步：寫入本地 (處理衝突，採用 Last-Writer-Wins)
    const { judgments: pJudgments = [], tags: pTags = [], judgmentTags: pJudgmentTags = [], embeddings: pEmbeddings = [] } = pullData;
    
    if (pJudgments.length > 0 || pTags.length > 0) {
      const tx = db.transaction([stores.JUDGMENTS, stores.EMBEDDINGS, stores.TAGS, stores.JUDGMENT_TAGS], 'readwrite');
      const jStore = tx.objectStore(stores.JUDGMENTS);
      const eStore = tx.objectStore(stores.EMBEDDINGS);
      const tStore = tx.objectStore(stores.TAGS);
      const jtStore = tx.objectStore(stores.JUDGMENT_TAGS);

      // (a) 寫入標籤定義
      for (const t of pTags) {
        tStore.put(t);
      }

      // (b) 寫入判決書 (比對時間戳，若雲端時間較新才寫入)
      for (const j of pJudgments) {
        const getLocalReq = jStore.get(j.id);
        const localExJ = await new Promise(res => {
          getLocalReq.onsuccess = () => res(getLocalReq.result);
          getLocalReq.onerror = () => res(null);
        });

        let shouldWrite = false;
        if (!localExJ) {
          shouldWrite = true;
        } else {
          const cloudTime = new Date(j.updatedAt);
          const localTime = new Date(localExJ.updatedAt);
          if (cloudTime > localTime) {
            shouldWrite = true;
          }
        }

        if (shouldWrite) {
          // 寫入判決主體
          j.databaseId = dbId;
          // 解析從雲端傳下來的 JSON 字串
          if (typeof j.summary_json === 'string') {
            j.summaryJson = JSON.parse(j.summary_json);
            delete j.summary_json;
          } else if (j.summary_json) {
            j.summaryJson = j.summary_json;
            delete j.summary_json;
          }
          jStore.put(j);

          // 下載並寫入向量
          // 先清理
          const exEmbKeys = await new Promise(res => {
            eStore.index('judgmentId').getAllKeys(j.id).onsuccess = (e) => res(e.target.result || []);
          });
          for (const k of exEmbKeys) {
            eStore.delete(k);
          }
          // 寫入
          for (const e of pEmbeddings) {
            if (e.judgment_id === j.id) {
              // 還原為 Float32Array 格式
              const f32Vector = base64ToFloat32Array(e.vector_text);
              eStore.put({
                id: e.id,
                judgmentId: e.judgment_id,
                chunkText: e.chunk_text,
                vector: f32Vector,
                chunkType: e.chunk_type
              });
            }
          }

          // 下載並寫入標籤關聯
          // 先清理
          const exJtKeys = await new Promise(res => {
            jtStore.index('judgmentId').getAllKeys(j.id).onsuccess = (e) => res(e.target.result || []);
          });
          for (const k of exJtKeys) {
            jtStore.delete(k);
          }
          // 寫入
          for (const jt of pJudgmentTags) {
            if (jt.judgment_id === j.id) {
              jtStore.put({
                id: jt.id,
                judgmentId: jt.judgment_id,
                tagId: jt.tag_id,
                source: jt.source,
                confidence: jt.confidence,
                taggedAt: jt.tagged_at
              });
            }
          }

          pullResult.pulledJudgments++;
        }
      }

      await new Promise((res, rej) => {
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    }

    // 6. 更新本地同步時間戳記
    const currentSyncTime = new Date().toISOString();
    await chrome.storage.local.set({ [lastSyncTimeKey]: currentSyncTime });

    console.log(`[SyncClient] 同步完成！上傳 ${pushResult.pushedJudgments} 筆判決，下載 ${pullResult.pulledJudgments} 筆判決。`);
    return {
      success: true,
      pushed: pushResult.pushedJudgments,
      pulled: pullResult.pulledJudgments
    };

  } catch (err) {
    console.error('[SyncClient] 同步失敗:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 輔助還原 base64 向量為 Float32Array
 */
function base64ToFloat32Array(base64) {
  if (!base64) return new Float32Array(0);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}
