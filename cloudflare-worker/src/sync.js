/**
 * 差異比對與資料同步邏輯
 */

/**
 * 比對本地與雲端判決書，決定需要上傳 (Push) 與下載 (Pull) 的 ID 清單
 * @param {object} db - D1 Database 實例
 * @param {string} userId - 使用者 ID
 * @param {array} clientJudgments - 本地判決書元資料 [{ id, updatedAt }]
 */
export async function diffChanges(db, userId, clientJudgments = []) {
  // 1. 取得雲端此使用者所有判決書的 ID 與時間戳
  const query = 'SELECT id, updated_at FROM judgments WHERE user_id = ?';
  const serverResults = (await db.prepare(query).bind(userId).all()).results || [];
  
  const serverMap = new Map();
  for (const s of serverResults) {
    serverMap.set(s.id, s.updated_at);
  }

  const clientMap = new Map();
  for (const c of clientJudgments) {
    clientMap.set(c.id, c.updatedAt);
  }

  const needPush = []; // 本地較新或雲端沒有，需要客戶端上傳
  const needPull = []; // 雲端較新或本地沒有，需要客戶端下載

  // 2. 檢查客戶端哪些需要 Push，或哪些在雲端較舊
  for (const [cId, cUpdated] of clientMap.entries()) {
    if (!serverMap.has(cId)) {
      needPush.push(cId);
    } else {
      const sUpdated = serverMap.get(cId);
      const cTime = new Date(cUpdated);
      const sTime = new Date(sUpdated);
      
      if (cTime > sTime) {
        needPush.push(cId);
      } else if (sTime > cTime) {
        needPull.push(cId);
      }
    }
  }

  // 3. 檢查哪些是雲端有，但客戶端沒有的，需要 Pull
  for (const [sId, sUpdated] of serverMap.entries()) {
    if (!clientMap.has(sId)) {
      needPull.push(sId);
    }
  }

  return {
    needPush,
    needPull
  };
}
