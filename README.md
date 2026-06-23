# ⚖️ 智慧判決書摘要及爭點解析 Chrome Extension

這是一款專門針對 **司法院裁判書查詢系統** (`judgment.judicial.gov.tw`) 所開發的 Manifest V3 智慧型 Chrome 瀏覽器擴充功能。本工具旨在透過先進的 AI 技術（Gemini API），協助法學研究人員、律師與學生快速擷取、摘要判決事實、自動解析法學爭點、套用三層智慧標籤，並提供基於 RAG 向量检索技術的「智慧文庫問答」與 incremental 雲端同步功能。

---

## 🌟 核心功能特色

1. **AI 智慧摘要與爭點解析**：
   - 自動提取判決次元資料（案號、法院、裁判日期、案由、案件類別）。
   - 自動生成事實摘要（限 500 字，口語流暢）與最終判決結論。
   - 深入剖析「法學爭點」，包含兩造（檢察官/被告、原告/被告）主張、法院論理與裁判依據。
   - 列出所有適用法條與相關歷史判例。
2. **多資料庫管理與三層智慧標籤系統**：
   - 支援建立多個獨立隔離的資料庫（例如：刑事案例庫、勞資糾紛研究庫）。
   - **系統標籤 (System)**：依法院與案件類別自動生成。
   - **AI 標籤 (AI)**：Gemini 依據分析信心度自動配置（$\ge 0.7$ 自動套用，$0.4 \sim 0.7$ 提供建議套用）。
   - **使用者標籤 (User)**：使用者手動建立與刪除，支持多選批次管理。
3. **客製化 RAG 智慧文庫問答**：
   - 當前判決書在儲存時，會於背景自動將文字進行 **500 字元 + 100 字元 overlapping** 切塊。
   - 使用 `gemini-embedding-001` 免費額度配額管理生成 768 維度的向量，並以 pure-JS 實現本地 Cosine 相似度計算。
   - 結合 IndexedDB 搜尋，採 **70% 向量 + 30% 關鍵字** 進行「混合檢索（Hybrid Search）」。
   - 使用者可選擇在當前或跨多個資料庫進行自然語言法學問答，AI 會自動摘要回答並附上精確來源引用。
4. **離線 ZIP 備份（含向量）**：
   - 提供 ZIP 備份匯出與匯入功能，**一律完整包含向量嵌入**，匯入後不耗費任何 Gemini API 配額即可立即進行 RAG 問答。
   - 匯入支援 **增量比對 (Last-Writer-Wins)**，自動識別並整合重複判決書。
5. **Cloudflare Worker 雲端增量同步**：
   - 支援將本地資料庫同步至自行部署的 Cloudflare Workers 與 D1 資料庫。
   - 透過 `/api/sync/diff` 時間戳進行**增量上傳/下載**，減少網路頻寬消耗。
   - 採用啟用碼驗證發放 30 天效期的 JWT 進行端點安全防護。
6. **極致美學懸浮視窗 (Glassmorphism UI)**：
   - Shadow DOM 樣式隔離，完全防堵與目標裁判網頁之樣式衝突。
   - 支援拖曳移動、拖拉縮放大小、記憶視窗位置大小。
   - 磨砂玻璃背景特效，支援深色 (Dark) 與淺色 (Light) 主題快速切換。

---

## 📂 檔案結構總覽

```
legal-judgment-ai/
├── manifest.json              # 擴充功能設定檔 (Manifest V3)
├── _locales/zh_TW/            # 語系設定檔
│   └── messages.json
├── icons/                     # 擴充功能圖示 (16x16, 48x48, 128x128)
├── src/
│   ├── background/
│   │   ├── service-worker.js  # 協調中心、訊息分流與分析流程
│   │   └── gemini-client.js   # Gemini API 呼叫、Embedding 配額管理
│   ├── content/
│   │   ├── content-script.js  # 偵測判決書頁面與 UI 掛載
│   │   ├── floating-panel.js  # 懸浮視窗交互邏輯 (拖曳、縮放、事件)
│   │   └── floating-panel.css # 磨砂玻璃外觀與雙主題 CSS 樣式
│   ├── database/
│   │   ├── database-manager.js# IndexedDB 初始化與 Judgments CRUD
│   │   ├── tag-manager.js     # 三層智慧標籤操作與統計
│   │   └── cache-layer.js     # L1 (Memory) 與 L2 (IndexedDB) 快取
│   ├── rag/
│   │   └── rag-engine.js      # 文本分塊、混合檢索與 context 組裝
│   ├── sync/
│   │   ├── sync-client.js     # 雲端同步 HTTP 增量流程
│   │   └── export-import.js   # JSZip 打包匯出、Last-Writer-Wins 匯入
│   ├── utils/
│   │   ├── crypto.js          # SHA-256 雜湊 (計算判決書唯一 ID)
│   │   └── constants.js       # 全域常數、API 端點與預設設定
│   └── lib/
│       └── jszip.min.js       # 本地 JSZip 庫
├── cloudflare-worker/         # 雲端同步 Worker 專案
│   ├── src/
│   │   ├── index.js           # API 路由與 CORS 處理
│   │   ├── auth.js            # Web Crypto JWT 驗證與認證
│   │   ├── sync.js            # 差異比對 diff 演算法
│   │   └── database.js        # D1 批次語法批次寫入
│   ├── schema.sql             # D1 資料庫結構定義
│   ├── wrangler.toml          # Worker 部署配置
│   └── package.json           # 依賴配置
└── README.md                  # 專案說明書
```

---

## 🛠️ 安裝與部署指南

### 第一部分：瀏覽器擴充功能安裝

#### Chrome / Edge 瀏覽器安裝
1. 開啟瀏覽器，進入擴充功能管理頁面：`chrome://extensions/`（Edge 為 `edge://extensions/`）。
2. 在右上角開啟 **「開發者模式」** (Developer mode)。
3. 點選 **「載入未封裝擴充功能」** (Load unpacked)。
4. 選擇本專案編譯後的目錄：`legal-judgment-ai/dist/chrome-edge`（**請勿選擇專案根目錄，以免產生 ES 模組載入錯誤**）。
5. 安裝完成後，將「法律判決 AI 助手」釘選至工具列。
6. 點擊圖示，輸入您的 **Gemini API Key** 並點選「儲存」。

#### Firefox 瀏覽器安裝
1. 開啟 Firefox，進入偵錯頁面：輸入網址 `about:debugging`。
2. 點擊左側的 **「此 Firefox」** (This Firefox)。
3. 點擊 **「載入暫時性附加元件...」** (Load Temporary Add-on...)。
4. 選擇編譯後目錄中的 `legal-judgment-ai/dist/firefox/manifest.json`。
5. 或在正式發布時，直接在 `about:addons` 頁面選擇安裝 **[dist/firefox.zip](file:///Users/chengmatt/projects/legal-judgment-ai/dist/firefox.zip)**。

---

### 第二部分：Cloudflare Worker 雲端同步部署

若您需要啟用跨裝置「雲端同步」功能，請依照以下步驟部署您的 Cloudflare Worker 與 D1 資料庫：

#### 1. 前置準備
請確保您的系統已安裝 Node.js，並擁有 Cloudflare 帳號。

#### 2. 初始化與登入 Cloudflare
開啟終端機，進入 worker 目錄並登入 Cloudflare：
```bash
cd cloudflare-worker
npm install
npx wrangler login
```

#### 3. 建立 D1 資料庫
在 Cloudflare 上建立一個名為 `legal-judgment-sync-db` 的 D1 資料庫：
```bash
npx wrangler d1 create legal-judgment-sync-db
```
執行後，終端機會輸出類似下方的資訊：
```toml
[[d1_databases]]
binding = "DB"
database_name = "legal-judgment-sync-db"
database_id = "xxxx-xxxx-xxxx-xxxx-xxxx"
```
請將這段資訊複製，並覆蓋替換 `cloudflare-worker/wrangler.toml` 檔案底部的對應內容。

#### 4. 初始化資料庫 Schema
使用我們提供的 `schema.sql` 在建立好的 D1 資料庫中建立資料表：
* **本地測試環境**：
  ```bash
  npx wrangler d1 execute legal-judgment-sync-db --local --file=./schema.sql
  ```
* **線上生產環境**：
  ```bash
  npx wrangler d1 execute legal-judgment-sync-db --remote --file=./schema.sql
  ```

#### 5. 配置啟用碼與 JWT 密鑰
開啟 `cloudflare-worker/wrangler.toml`：
- `ACTIVATION_CODES`：設定允許啟用的代碼（多組請用逗號隔開）。例如 `"mycode123,lawyer999"`。
- `JWT_SECRET`：設定用於簽署 Token 的安全密鑰。例如 `"a-very-secure-random-string"`。

> 💡 **安全建議**：在正式部署時，JWT 密鑰最好透過秘密變數上傳，而非明文寫在 toml 中：
> `npx wrangler secret put JWT_SECRET`

#### 6. 部署至 Cloudflare
執行部署指令：
```bash
npx wrangler deploy
```
部署成功後，會獲得一個網址（例如：`https://legal-judgment-sync-worker.username.workers.dev`）。

#### 7. 啟用擴充功能雲端同步
- 複製您獲得的 Worker 網址。
- 點選 Chrome Extension 上的⚙️圖示進入「系統進階設定」。
- 將網址貼入 **Worker API URL** 並點選儲存。
- 返回 Popup 主分頁，於「雲端同步與備份」區塊輸入您在 `ACTIVATION_CODES` 中設定的啟用碼（例如：`admin123`），點選 **「啟用」**。
- 啟用成功後即可隨時點擊 **「立即同步」** 進行雙向增量同步！

---

## 💡 使用說明與工作流程

1. **擷取與分析**：
   - 前往 [司法院裁判書查詢系統](https://judgment.judicial.gov.tw/FJUD/FJUDQRY01.aspx)。
   - 檢索並點選進入任何一篇判決書的**全文詳細內容頁面** (例如網址中包含 `FJUDQRY03_1.aspx` 或 `FJUD/data.aspx`)。
   - 點擊工具列的「法律判決 AI 摘要助手」圖示，點選 **「✨ 開始 AI 摘要與爭點解析」**。
   - 網頁右側將彈出精緻懸浮窗，依序呈現「判決摘要」、「法學爭點（可摺疊卡片，內含兩造主張及法院見解）」、以及「RAG 智慧查詢」介面。
2. **快取重用機制**：
   - 只要點擊分析過的判決書，再次點擊時會在一瞬間從本地 IndexedDB / L1 Memory 快取載入，**完全不耗費任何 Gemini API 配額**。
3. **智慧查詢問答**：
   - 切換至「智慧查詢」Tab。
   - 輸入任何針對此資料庫內判決的提問，例如：「本案關於因果關係之認定，法院主要依據什麼原則？」
   - AI 將結合向量匹配的最佳片段整理出有引用的法理回答。

---

## 🔒 隱私與安全性聲明

1. **自備金鑰 (BYO Key)**：所有 AI 摘要及 Embedding 功能皆使用使用者本人的 Gemini API 金鑰進行，您的金鑰安全儲存於本地 `chrome.storage.local`，絕不上傳給任何第三方。
2. **資料本地化**：在未啟用雲端同步前，所有判決書原文、摘要、向量資料皆以加密形式安全儲存在您本機的瀏覽器 IndexedDB 中。
3. **安全同步**：啟用雲端同步時，傳輸過程全程加密，且雲端 Worker 僅對持有您配置之 JWT Token 的客戶端開放存取權限。
