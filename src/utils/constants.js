// ===================================================================
// 常數定義 — 法律判決 AI 摘要助手
// ===================================================================

// Gemini API 設定
export const GEMINI_API = {
  BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/models',
  MODELS: {
    FLASH: 'gemini-3.5-flash',
    PRO: 'gemini-3.5-pro',
  },
  EMBEDDING_MODEL: 'gemini-embedding-001',
  EMBEDDING_DIMENSIONS: 768,
  EMBEDDING_TASK_TYPE: 'RETRIEVAL_DOCUMENT',
  EMBEDDING_QUERY_TASK_TYPE: 'RETRIEVAL_QUERY',
};

// Free Tier 配額限制（保守估計）
export const RATE_LIMITS = {
  EMBEDDING_RPM: 14,           // 每分鐘請求數（留安全邊界）
  EMBEDDING_RPD: 1400,         // 每日請求數（留安全邊界）
  EMBEDDING_MIN_INTERVAL_MS: 4300, // 最小請求間隔 ms
  EMBEDDING_BATCH_SIZE: 100,   // 每次批次嵌入最大文本數
  GENERATION_RPM: 10,          // 生成模型每分鐘請求數
  RETRY_BASE_DELAY_MS: 1000,   // 指數退避基礎延遲
  RETRY_MAX_ATTEMPTS: 3,       // 最大重試次數
};

// IndexedDB 設定
export const DB_CONFIG = {
  META_DB_NAME: '_legal_ai_meta',
  META_DB_VERSION: 2,
  STORES: {
    DATABASES: 'databases',
    SETTINGS: 'settings',
    LAWS: 'laws',
  },
  // 使用者資料庫的 store 名稱
  USER_DB_STORES: {
    JUDGMENTS: 'judgments',
    EMBEDDINGS: 'embeddings',
    TAGS: 'tags',
    JUDGMENT_TAGS: 'judgment_tags',
  },
  USER_DB_VERSION: 1,
};

// 快取設定
export const CACHE_CONFIG = {
  L1_MAX_SIZE: 50,             // 記憶體快取最大筆數
  HASH_PREFIX_LENGTH: 500,     // 用於 hash 的原始文字前 N 字
};

// RAG 設定
export const RAG_CONFIG = {
  CHUNK_SIZE: 1000,            // tokens
  CHUNK_OVERLAP: 150,          // tokens
  TOP_K: 5,                    // 搜尋結果數
  SIMILARITY_THRESHOLD: 0.3,   // 最低相似度門檻
  VECTOR_WEIGHT: 0.7,          // 混合搜尋中向量權重
  KEYWORD_WEIGHT: 0.3,         // 混合搜尋中關鍵字權重
};

// Cloud Sync 設定
export const SYNC_CONFIG = {
  AUTO_SYNC_INTERVAL_MINUTES: 15,
  JWT_REFRESH_DAYS: 25,        // JWT 30 天到期，提前 5 天刷新
  ALARM_NAME: 'legal-ai-auto-sync',
};

// 標籤系統設定
export const TAG_CONFIG = {
  TYPES: {
    SYSTEM: 'system',
    AI: 'ai',
    USER: 'user',
  },
  AUTO_APPLY_THRESHOLD: 0.7,   // AI 標籤自動套用信心度門檻
  SUGGEST_THRESHOLD: 0.4,      // AI 標籤建議門檻
  DEFAULT_COLORS: {
    system: '#6366F1',         // Indigo
    ai: '#8B5CF6',             // Violet
    user: '#06B6D4',           // Cyan
  },
  CATEGORIES: [
    '案件類別',
    '法學爭點',
    '罪名',
    '法院層級',
    '程序爭點',
    '民事類型',
    '行政類型',
    '自訂',
  ],
};

// 判決書頁面 DOM 選擇器
export const DOM_SELECTORS = {
  // 司法院裁判書查詢系統 ASP.NET 頁面
  JUDGMENT_CONTENT_PAGE: 'FJUD/data.aspx',
  JUDGMENT_DETAIL_PAGE: 'FJUD/FJUDQRY03_1.aspx',
  // DOM 元素選擇器（需根據實際頁面結構調整）
  CONTENT_AREA: '#jud, #judContent, .judgment-content, [id*="jud"]',
  CASE_NUMBER: '#jud_title, .case-number, [class*="title"]',
  COURT_NAME: '#court, .court-name',
  JUDGMENT_DATE: '#jud_date, .judgment-date',
  CASE_TYPE: '#jud_type, .case-type',
};

// UI 設定
export const UI_CONFIG = {
  FLOATING_PANEL: {
    DEFAULT_WIDTH: 520,
    DEFAULT_HEIGHT: 600,
    MIN_WIDTH: 380,
    MIN_HEIGHT: 300,
    DEFAULT_POSITION: { top: 80, right: 20 },
  },
  THEMES: {
    DARK: 'dark',
    LIGHT: 'light',
  },
  ANIMATION_DURATION_MS: 300,
};

// 訊息類型
export const MESSAGE_TYPES = {
  // Content Script ↔ Service Worker
  EXTRACT_JUDGMENT: 'EXTRACT_JUDGMENT',
  GET_SUMMARY: 'GET_SUMMARY',
  SUMMARY_RESULT: 'SUMMARY_RESULT',
  SUMMARY_PROGRESS: 'SUMMARY_PROGRESS',
  SUMMARY_ERROR: 'SUMMARY_ERROR',

  // RAG
  RAG_QUERY: 'RAG_QUERY',
  RAG_RESULT: 'RAG_RESULT',

  // AI 智慧搜尋
  AI_SEARCH_QUERY: 'AI_SEARCH_QUERY',
  AI_SEARCH_PROGRESS: 'AI_SEARCH_PROGRESS',
  COURT_FEE_CALCULATE: 'COURT_FEE_CALCULATE',
  SAVE_CITATION_TO_DB: 'SAVE_CITATION_TO_DB',

  // 適用法條查詢
  GET_LAW_ARTICLE: 'GET_LAW_ARTICLE',

  // 資料庫管理
  SWITCH_DATABASE: 'SWITCH_DATABASE',
  CREATE_DATABASE: 'CREATE_DATABASE',
  DELETE_DATABASE: 'DELETE_DATABASE',
  LIST_DATABASES: 'LIST_DATABASES',

  // 標籤管理
  ADD_TAG: 'ADD_TAG',
  REMOVE_TAG: 'REMOVE_TAG',
  UPDATE_TAG: 'UPDATE_TAG',
  LIST_TAGS: 'LIST_TAGS',
  BATCH_TAG: 'BATCH_TAG',

  // Cloud Sync
  SYNC_TO_CLOUD: 'SYNC_TO_CLOUD',
  SYNC_FROM_CLOUD: 'SYNC_FROM_CLOUD',
  SYNC_STATUS: 'SYNC_STATUS',
  ACTIVATE_CLOUD: 'ACTIVATE_CLOUD',

  // 匯出匯入
  EXPORT_ZIP: 'EXPORT_ZIP',
  IMPORT_ZIP: 'IMPORT_ZIP',

  // 設定
  GET_SETTINGS: 'GET_SETTINGS',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  VALIDATE_API_KEY: 'VALIDATE_API_KEY',
};

// 匯出匯入設定
export const EXPORT_CONFIG = {
  MANIFEST_VERSION: '1.0.0',
  ZIP_COMPRESSION_LEVEL: 6,
};

// 預設設定
export const DEFAULT_SETTINGS = {
  geminiApiKey: '',
  geminiModel: GEMINI_API.MODELS.FLASH,
  theme: UI_CONFIG.THEMES.DARK,
  language: 'zh-TW',
  cloudSyncEnabled: false,
  cloudWorkerUrl: '',
  cloudJwt: '',
  autoSyncEnabled: false,
  panelPosition: UI_CONFIG.FLOATING_PANEL.DEFAULT_POSITION,
  panelSize: {
    width: UI_CONFIG.FLOATING_PANEL.DEFAULT_WIDTH,
    height: UI_CONFIG.FLOATING_PANEL.DEFAULT_HEIGHT,
  },
};
