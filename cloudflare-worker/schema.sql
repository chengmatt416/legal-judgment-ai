-- D1 Database Schema — Legal Judgment Sync

-- 使用者與啟用關係表
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  activation_code TEXT UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_sync DATETIME
);

-- 判決書資料表
CREATE TABLE IF NOT EXISTS judgments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  database_name TEXT NOT NULL,
  case_number TEXT NOT NULL,
  court TEXT NOT NULL,
  date TEXT NOT NULL,
  case_type TEXT NOT NULL,
  cause TEXT,
  summary_json TEXT,
  source_url TEXT,
  analyzed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 標籤定義表
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  usage_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 判決書-標籤關係對照表
CREATE TABLE IF NOT EXISTS judgment_tags (
  id TEXT PRIMARY KEY, -- judgmentId_tagId
  judgment_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  tagged_at TEXT NOT NULL,
  FOREIGN KEY (judgment_id) REFERENCES judgments(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- 向量嵌入表 (以 text 儲存 Base64 格式，便於傳輸且防二進位轉碼錯誤)
CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  judgment_id TEXT NOT NULL,
  chunk_text TEXT NOT NULL,
  vector_text TEXT NOT NULL,
  chunk_type TEXT NOT NULL,
  FOREIGN KEY (judgment_id) REFERENCES judgments(id) ON DELETE CASCADE
);

-- 建立索引以優化查詢效能
CREATE INDEX IF NOT EXISTS idx_judgments_user_updated ON judgments(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);
CREATE INDEX IF NOT EXISTS idx_judgment_tags_judgment ON judgment_tags(judgment_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_judgment ON embeddings(judgment_id);
