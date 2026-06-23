/**
 * D1 資料庫操作輔助模組
 */

/**
 * 依啟用碼尋找使用者，若不存在則建立新使用者（首次綁定）
 */
export async function getOrCreateUser(db, activationCode) {
  const selectQuery = 'SELECT id FROM users WHERE activation_code = ? LIMIT 1';
  const existing = await db.prepare(selectQuery).bind(activationCode).first();

  if (existing) {
    return existing.id;
  }

  // 建立新使用者
  const userId = crypto.randomUUID();
  const insertQuery = 'INSERT INTO users (id, activation_code, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)';
  await db.prepare(insertQuery).bind(userId, activationCode).run();
  
  return userId;
}

/**
 * 更新使用者最後同步時間
 */
export async function updateUserLastSync(db, userId) {
  const query = 'UPDATE users SET last_sync = CURRENT_TIMESTAMP WHERE id = ?';
  await db.prepare(query).bind(userId).run();
}

/**
 * 從雲端下拉此使用者在 `lastSync` 之後的所有更新資料
 * @param {object} db - D1 Database 實例
 * @param {string} userId - 使用者 ID
 * @param {string} lastSync - ISO 時間戳記，若為空或 '0' 則拉取全部
 */
export async function pullChanges(db, userId, lastSync) {
  const filterTime = lastSync && lastSync !== '0' ? lastSync : '1970-01-01T00:00:00.000Z';

  // 1. 拉取判決書
  const qJudgments = 'SELECT * FROM judgments WHERE user_id = ? AND updated_at > ?';
  const judgments = (await db.prepare(qJudgments).bind(userId, filterTime).all()).results || [];

  // 2. 拉取標籤定義
  const qTags = 'SELECT * FROM tags WHERE user_id = ? AND created_at > ?';
  // 註：標籤的變更通常以建立時間戳或全量為準，這裡為防漏用 created_at 比對
  const tags = (await db.prepare(qTags).bind(userId, filterTime).all()).results || [];

  // 3. 拉取判決標籤關聯
  // 因為 judgment_tags 包含外鍵 judgments(id)，我們只拉取屬於此使用者 judgments 的關聯
  const qJudgmentTags = `
    SELECT jt.* FROM judgment_tags jt
    JOIN judgments j ON jt.judgment_id = j.id
    WHERE j.user_id = ? AND jt.tagged_at > ?
  `;
  const judgmentTags = (await db.prepare(qJudgmentTags).bind(userId, filterTime).all()).results || [];

  // 4. 拉取向量分塊
  const qEmbeddings = `
    SELECT e.* FROM embeddings e
    JOIN judgments j ON e.judgment_id = j.id
    WHERE j.user_id = ? AND j.updated_at > ?
  `;
  const embeddings = (await db.prepare(qEmbeddings).bind(userId, filterTime).all()).results || [];

  return {
    judgments,
    tags,
    judgmentTags,
    embeddings
  };
}

/**
 * 將使用者在本地端異動的資料上傳更新至雲端 (批次 transaction 操作)
 */
export async function pushChanges(db, userId, changes) {
  const { judgments = [], tags = [], judgmentTags = [], embeddings = [] } = changes;
  const statements = [];

  // 1. 寫入/更新 判決書
  for (const j of judgments) {
    const stmt = db.prepare(`
      INSERT INTO judgments (id, user_id, database_name, case_number, court, date, case_type, cause, summary_json, source_url, analyzed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        database_name = excluded.database_name,
        case_number = excluded.case_number,
        court = excluded.court,
        date = excluded.date,
        case_type = excluded.case_type,
        cause = excluded.cause,
        summary_json = excluded.summary_json,
        source_url = excluded.source_url,
        analyzed_at = excluded.analyzed_at,
        updated_at = excluded.updated_at
    `).bind(
      j.id,
      userId,
      j.databaseName || j.databaseId, // 雲端統一存 databaseName
      j.caseNumber,
      j.court,
      j.date,
      j.caseType,
      j.cause,
      typeof j.summaryJson === 'string' ? j.summaryJson : JSON.stringify(j.summaryJson),
      j.sourceUrl,
      j.analyzedAt,
      j.updatedAt
    );
    statements.push(stmt);
  }

  // 2. 寫入/更新 標籤定義
  for (const t of tags) {
    const stmt = db.prepare(`
      INSERT INTO tags (id, user_id, name, color, type, category, usage_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        color = excluded.color,
        type = excluded.type,
        category = excluded.category,
        usage_count = excluded.usage_count
    `).bind(
      t.id,
      userId,
      t.name,
      t.color,
      t.type,
      t.category,
      t.usageCount || 0,
      t.createdAt
    );
    statements.push(stmt);
  }

  // 3. 寫入/更新 判決標籤關聯
  for (const jt of judgmentTags) {
    const stmt = db.prepare(`
      INSERT INTO judgment_tags (id, judgment_id, tag_id, source, confidence, tagged_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source = excluded.source,
        confidence = excluded.confidence,
        tagged_at = excluded.tagged_at
    `).bind(
      jt.id || `${jt.judgmentId}_${jt.tagId}`,
      jt.judgmentId,
      jt.tagId,
      jt.source,
      jt.confidence || 1.0,
      jt.taggedAt
    );
    statements.push(stmt);
  }

  // 4. 寫入/更新 向量嵌入 (注意，D1 沒有 ON CONFLICT，我們在寫入前需要整批清理)
  // 為確保效能，我們可以用 DELETE FROM 再 INSERT
  const uniqueJudgmentIds = [...new Set(embeddings.map(e => e.judgmentId))];
  for (const jId of uniqueJudgmentIds) {
    const deleteStmt = db.prepare('DELETE FROM embeddings WHERE judgment_id = ?').bind(jId);
    statements.push(deleteStmt);
  }

  for (const e of embeddings) {
    // 檢查 vector 格式：客戶端傳來的可能是二進位或陣列或 base64 字串
    let vecStr = '';
    if (typeof e.vector === 'string') {
      vecStr = e.vector;
    } else if (e.vector && (e.vector instanceof Float32Array || Array.isArray(e.vector))) {
      // 容錯：將數值陣列序列化
      const f32 = new Float32Array(e.vector);
      const bytes = new Uint8Array(f32.buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      vecStr = btoa(binary);
    } else if (e.vector_text) {
      vecStr = e.vector_text;
    }

    const stmt = db.prepare(`
      INSERT INTO embeddings (id, judgment_id, chunk_text, vector_text, chunk_type)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      e.id,
      e.judgmentId,
      e.chunkText,
      vecStr,
      e.chunkType
    );
    statements.push(stmt);
  }

  // 5. 執行 Batch 寫入以維持資料庫一致性
  if (statements.length > 0) {
    await db.batch(statements);
  }

  // 6. 更新使用者最後同步時間
  await updateUserLastSync(db, userId);

  return {
    success: true,
    pushedJudgments: judgments.length,
    pushedTags: tags.length,
    pushedRelations: judgmentTags.length,
    pushedEmbeddings: embeddings.length
  };
}
