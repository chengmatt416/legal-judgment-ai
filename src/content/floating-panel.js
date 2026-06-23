/**
 * 法律判決 AI 摘要助手 — 懸浮視窗 UI 元件 (Shadow DOM)
 */

class LegalJudgmentFloatingPanel {
  constructor() {
    this.host = null;
    this.shadowRoot = null;
    this.container = null;
    this.theme = 'dark';
    
    // 預設位置大小
    this.width = 520;
    this.height = 600;
    this.top = 80;
    this.right = 20;
    this.isMinimized = false;
    
    // 拖曳與縮放狀態
    this.isDragging = false;
    this.isResizing = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.containerStartX = 0;
    this.containerStartY = 0;
    this.resizeType = '';
    
    // 資料快取
    this.currentData = null;
    
    // 繫結事件處理器 (確保 this 指向)
    this.handleHeaderMouseDown = this.handleHeaderMouseDown.bind(this);
    this.handleResizeMouseDown = this.handleResizeMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
  }

  /**
   * 初始化並注入懸浮視窗到頁面
   */
  async init() {
    if (this.host) return; // 避免重複建立

    // 載入使用者先前儲存的位置與大小設定
    await this.loadPositionAndSettings();

    // 建立 Host 元素並掛載 Shadow DOM
    this.host = document.createElement('div');
    this.host.id = 'legal-judgment-ai-floating-panel-host';
    this.shadowRoot = this.host.attachShadow({ mode: 'open' });

    // 注入 CSS 連結
    const cssUrl = chrome.runtime.getURL('src/content/floating-panel.css');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssUrl;
    this.shadowRoot.appendChild(link);

    // 建立主結構
    const rootEl = document.createElement('div');
    rootEl.className = `panel-root theme-${this.theme}`;
    this.root = rootEl;
    
    const containerEl = document.createElement('div');
    containerEl.className = 'panel-container';
    containerEl.style.width = `${this.width}px`;
    containerEl.style.height = `${this.height}px`;
    containerEl.style.top = `${this.top}px`;
    
    // 使用 right 定位，防止視窗跑出右側
    containerEl.style.right = `${this.right}px`;
    
    this.container = containerEl;
    rootEl.appendChild(containerEl);
    this.shadowRoot.appendChild(rootEl);
    document.body.appendChild(this.host);

    // 渲染骨架
    this.renderSkeleton();

    // 繫結事件
    this.setupEventListeners();
  }

  /**
   * 從儲存庫讀取位置與外觀設定
   */
  async loadPositionAndSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['panelPosition', 'panelSize', 'theme'], (res) => {
        if (res.panelPosition) {
          this.top = res.panelPosition.top;
          this.right = res.panelPosition.right;
        }
        if (res.panelSize) {
          this.width = res.panelSize.width;
          this.height = res.panelSize.height;
        }
        if (res.theme) {
          this.theme = res.theme;
        }
        resolve();
      });
    });
  }

  /**
   * 儲存當前位置與大小
   */
  savePositionAndSettings() {
    chrome.storage.local.set({
      panelPosition: { top: this.top, right: this.right },
      panelSize: { width: this.width, height: this.height },
      theme: this.theme
    });
  }

  /**
   * 移除懸浮視窗
   */
  destroy() {
    if (this.host) {
      this.host.remove();
      this.host = null;
      this.shadowRoot = null;
      this.container = null;
      this.currentData = null;
      
      // 移除全域滑鼠監聽
      document.removeEventListener('mousemove', this.handleMouseMove);
      document.removeEventListener('mouseup', this.handleMouseUp);
      
      // 發送自訂事件通知面板已被銷毀
      window.dispatchEvent(new CustomEvent('legal-ai-panel-destroyed'));
    }
  }

  /**
   * 顯示/隱藏視窗
   */
  toggleVisibility(visible) {
    if (!this.container) return;
    if (visible) {
      this.container.classList.remove('hidden');
    } else {
      this.container.classList.add('hidden');
    }
  }

  /**
   * 渲染基礎視窗骨架（含控制元件與 Tab 按鈕）
   */
  renderSkeleton() {
    this.container.innerHTML = `
      <!-- 標題列 -->
      <div class="panel-header" id="drag-handle">
        <div class="panel-title">
          <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H7c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.04-.42 1.99-1.07 2.75z"/></svg>
          <span id="panel-title-text">判決書 AI 摘要助手</span>
        </div>
        <div class="panel-controls">
          <button class="control-btn btn-theme" id="btn-theme" title="切換主題">${this.theme === 'dark' ? '☀️' : '🌙'}</button>
          <button class="control-btn btn-minimize" id="btn-minimize" title="最小化">─</button>
          <button class="control-btn btn-close" id="btn-close" title="關閉">✕</button>
        </div>
      </div>

      <!-- 頁籤列 -->
      <div class="panel-tabs">
        <button class="tab-btn active" data-tab="summary">
          <svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
          判決摘要
        </button>
        <button class="tab-btn" data-tab="issues">
          <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
          法學爭點
        </button>
        <button class="tab-btn" data-tab="rag">
          <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
          智慧查詢
        </button>
      </div>

      <!-- 內容區 -->
      <div class="panel-body" id="panel-body">
        <!-- 各分頁由 JavaScript 動態填入 -->
      </div>

      <!-- 底部控制列 -->
      <div class="panel-footer">
        <div class="footer-left">
          <span id="sync-indicator">🟢 已連線</span>
        </div>
        <div class="footer-right">
          <button class="footer-btn" id="btn-copy" title="複製報告">
            <svg style="width:14px;height:14px" viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0-2-.9-2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
            複製
          </button>
          <button class="footer-btn" id="btn-export-pdf" title="匯出 HTML">
            <svg style="width:14px;height:14px" viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4 0-2.05 1.53-3.76 3.56-3.97l1.07-.11.5-.95C8.08 7.14 9.94 6 12 6c2.62 0 4.88 1.86 5.39 4.43l.3 1.5 1.53.11c1.56.1 2.78 1.41 2.78 2.96 0 1.65-1.35 3-3 3zm-5.55-8h-2.9v3H8l4 4 4-4h-2.55z"/></svg>
            匯出
          </button>
        </div>
      </div>

      <!-- 調整大小的拖曳手把 -->
      <div class="resize-handle resize-e" data-direction="e"></div>
      <div class="resize-handle resize-w" data-direction="w"></div>
      <div class="resize-handle resize-s" data-direction="s"></div>
      <div class="resize-handle resize-se" data-direction="se"></div>

      <!-- Toast 提示區 -->
      <div class="toast-msg" id="toast-msg"></div>

      <!-- 新增標籤的彈出視窗 -->
      <div class="tag-input-popup" id="tag-popup">
        <div class="tag-popup-title">🏷️ 新增標籤</div>
        <div class="tag-popup-inputs">
          <input type="text" class="rag-input" id="tag-input-name" placeholder="標籤名稱..." style="padding: 6px 10px; font-size: 12.5px;">
          <select class="tag-popup-select" id="tag-input-category">
            <option value="自訂">自訂</option>
            <option value="法學爭點">法學爭點</option>
            <option value="罪名">罪名</option>
            <option value="程序爭點">程序爭點</option>
            <option value="民事類型">民事類型</option>
            <option value="行政類型">行政類型</option>
          </select>
        </div>
        <div class="tag-popup-actions">
          <button class="tag-popup-btn" id="btn-tag-cancel">取消</button>
          <button class="tag-popup-btn btn-confirm" id="btn-tag-save">確認</button>
        </div>
      </div>
    `;
  }

  /**
   * 設定所有事件監聽器
   */
  setupEventListeners() {
    const shadow = this.shadowRoot;

    // 1. 視窗控制
    shadow.getElementById('btn-close').addEventListener('click', () => this.destroy());
    
    shadow.getElementById('btn-minimize').addEventListener('click', () => {
      this.isMinimized = !this.isMinimized;
      if (this.isMinimized) {
        this.container.style.height = '52px';
        shadow.getElementById('btn-minimize').innerText = '🗖';
      } else {
        this.container.style.height = `${this.height}px`;
        shadow.getElementById('btn-minimize').innerText = '─';
      }
    });

    shadow.getElementById('btn-theme').addEventListener('click', () => {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      const root = shadow.querySelector('.panel-root');
      root.className = `panel-root theme-${this.theme}`;
      shadow.getElementById('btn-theme').innerText = this.theme === 'dark' ? '☀️' : '🌙';
      this.savePositionAndSettings();
    });

    // 2. 拖曳與縮放
    shadow.getElementById('drag-handle').addEventListener('mousedown', this.handleHeaderMouseDown);
    
    const resizers = shadow.querySelectorAll('.resize-handle');
    resizers.forEach(resizer => {
      resizer.addEventListener('mousedown', this.handleResizeMouseDown);
    });

    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mouseup', this.handleMouseUp);

    // 3. Tab 切換
    const tabs = shadow.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        const clickedTab = e.currentTarget;
        tabs.forEach(t => t.classList.remove('active'));
        clickedTab.classList.add('active');
        
        const tabName = clickedTab.getAttribute('data-tab');
        this.switchTab(tabName);
      });
    });

    // 4. 複製與匯出
    shadow.getElementById('btn-copy').addEventListener('click', () => this.copyToClipboard());
    shadow.getElementById('btn-export-pdf').addEventListener('click', () => this.exportAsHtml());

    // 5. 新增標籤 Popup 事件
    shadow.getElementById('btn-tag-cancel').addEventListener('click', () => this.toggleTagPopup(false));
    shadow.getElementById('btn-tag-save').addEventListener('click', () => this.saveCustomTag());

    // 6. 法條與引用判決點擊事件委派
    shadow.addEventListener('click', (e) => {
      const target = e.target;
      
      // 點擊法條連結或法條 Badge
      const lawLink = target.closest('.law-link-inline, .law-link-badge');
      if (lawLink) {
        e.preventDefault();
        e.stopPropagation();
        const lawName = lawLink.getAttribute('data-law');
        const articleNumber = lawLink.getAttribute('data-article');
        if (lawName && articleNumber) {
          this.handleLawLookup(lawName, articleNumber);
        }
        return;
      }
      
      // 點擊引用判決書卡片 (智慧搜尋卡片)
      const citationCard = target.closest('.citation-card');
      if (citationCard && !target.closest('.btn-save-citation')) {
        e.preventDefault();
        e.stopPropagation();
        const btnSave = citationCard.querySelector('.btn-save-citation');
        const url = btnSave ? btnSave.getAttribute('data-url') : null;
        if (url && url !== '#') {
          window.open(url, '_blank');
        }
        return;
      }
    });
  }

  /* ===================================================================
     拖曳與縮放邏輯
     =================================================================== */

  handleHeaderMouseDown(e) {
    if (e.target.closest('.control-btn')) return; // 若點擊按鈕則不拖曳
    this.isDragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.containerStartX = parseFloat(window.getComputedStyle(this.container).right);
    this.containerStartY = parseFloat(window.getComputedStyle(this.container).top);
    e.preventDefault();
  }

  handleResizeMouseDown(e) {
    this.isResizing = true;
    this.resizeType = e.target.getAttribute('data-direction');
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;
    this.containerStartY = parseFloat(window.getComputedStyle(this.container).top);
    this.containerStartX = parseFloat(window.getComputedStyle(this.container).right);
    e.preventDefault();
  }

  handleMouseMove(e) {
    if (this.isDragging) {
      const deltaX = e.clientX - this.dragStartX;
      const deltaY = e.clientY - this.dragStartY;
      
      // 因為我們使用 right 定位，往右移動 deltaX 增加會使 right 減少
      this.right = this.containerStartX - deltaX;
      this.top = this.containerStartY + deltaY;
      
      // 限制在螢幕邊界內
      this.right = Math.max(0, Math.min(window.innerWidth - this.container.offsetWidth, this.right));
      this.top = Math.max(0, Math.min(window.innerHeight - this.container.offsetHeight, this.top));
      
      this.container.style.right = `${this.right}px`;
      this.container.style.top = `${this.top}px`;
    } else if (this.isResizing) {
      const deltaX = e.clientX - this.dragStartX;
      const deltaY = e.clientY - this.dragStartY;

      if (this.resizeType === 'e') {
        // 往右拉增加寬度：因為 right 沒變，拉 right 端寬度會減少，所以 deltaX 往右為正，會使 right 減少
        const newWidth = this.width - deltaX;
        if (newWidth >= 380) {
          this.container.style.width = `${newWidth}px`;
          this.container.style.right = `${this.containerStartX + deltaX}px`;
        }
      } else if (this.resizeType === 'w') {
        // 往左拉增加寬度
        const newWidth = this.width + deltaX;
        if (newWidth >= 380) {
          this.container.style.width = `${newWidth}px`;
        }
      } else if (this.resizeType === 's') {
        const newHeight = this.height + deltaY;
        if (newHeight >= 300) {
          this.container.style.height = `${newHeight}px`;
        }
      } else if (this.resizeType === 'se') {
        const newWidth = this.width - deltaX;
        const newHeight = this.height + deltaY;
        if (newWidth >= 380) {
          this.container.style.width = `${newWidth}px`;
          this.container.style.right = `${this.containerStartX + deltaX}px`;
        }
        if (newHeight >= 300) {
          this.container.style.height = `${newHeight}px`;
        }
      }
    }
  }

  handleMouseUp() {
    if (this.isDragging || this.isResizing) {
      this.isDragging = false;
      this.isResizing = false;
      this.width = this.container.offsetWidth;
      // 只有在未最小化時儲存高度
      if (!this.isMinimized) {
        this.height = this.container.offsetHeight;
      }
      this.savePositionAndSettings();
    }
  }

  /* ===================================================================
     狀態渲染與畫面更新
     =================================================================== */

  /**
   * 顯示載入狀態
   * @param {string} text - 載入說明
   * @param {number} progress - 0 至 100 數字，若為負數則顯示不定進度條
   */
  showLoading(text = '正在分析判決書...', progress = -1) {
    this.toggleVisibility(true);
    const body = this.shadowRoot.getElementById('panel-body');
    
    let progressHtml = '';
    if (progress >= 0) {
      progressHtml = `
        <div class="progress-bar-container">
          <div class="progress-bar-fill" style="width: ${progress}%"></div>
        </div>
        <div style="font-size:12px; margin-top:6px;">${progress}%</div>
      `;
    } else {
      progressHtml = `
        <div class="progress-bar-container">
          <div class="progress-bar-fill indeterminate"></div>
        </div>
      `;
    }

    body.innerHTML = `
      <div class="loading-container">
        <div class="loader-spinner"></div>
        <div class="loading-text">${text}</div>
        ${progressHtml}
      </div>
    `;
  }

  /**
   * 顯示錯誤狀態
   * @param {string} errorMsg - 錯誤訊息
   */
  showError(errorMsg) {
    this.toggleVisibility(true);
    const body = this.shadowRoot.getElementById('panel-body');
    body.innerHTML = `
      <div class="loading-container" style="color: var(--color-danger)">
        <svg viewBox="0 0 24 24" style="width: 48px; height: 48px; fill: currentColor; margin-bottom: 16px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
        <div class="loading-text" style="font-weight: 600;">分析失敗</div>
        <div style="font-size: 13px; text-align: center; max-width: 80%; line-height: 1.5;">${errorMsg}</div>
      </div>
    `;
  }

  /**
   * 渲染已分析完畢的判決書資料
   * @param {object} judgment - 判決書資料實體
   */
  renderData(judgment) {
    this.currentData = judgment;
    this.toggleVisibility(true);
    
    // 更新標題案號
    const titleText = this.shadowRoot.getElementById('panel-title-text');
    titleText.innerText = judgment.caseNumber;

    // 預設切換到第一個 Tab (摘要)
    this.switchTab('summary');
  }

  /**
   * 切換 Tab 分頁
   * @param {string} tabName 
   */
  switchTab(tabName) {
    if (!this.currentData) return;
    
    const body = this.shadowRoot.getElementById('panel-body');
    
    // 更新 Tab 按鈕狀態
    const tabs = this.shadowRoot.querySelectorAll('.tab-btn');
    tabs.forEach(t => {
      if (t.getAttribute('data-tab') === tabName) {
        t.classList.add('active');
      } else {
        t.classList.remove('active');
      }
    });

    if (tabName === 'summary') {
      this.renderSummaryTab(body);
    } else if (tabName === 'issues') {
      this.renderIssuesTab(body);
    } else if (tabName === 'rag') {
      this.renderRAGTab(body);
    }
  }

  /**
   * 渲染摘要分頁
   */
  renderSummaryTab(container) {
    const data = this.currentData;
    const summary = typeof data.summaryJson === 'string' ? JSON.parse(data.summaryJson) : data.summaryJson;
    
    // 取得所有標籤 (包含 system, ai, user 標籤)
    const tagsHtml = this.generateTagsHtml(data.tags || []);

    container.innerHTML = `
      <div class="tab-content active">
        <!-- 案件基本卡片 -->
        <div class="meta-card">
          <div class="meta-grid">
            <div class="meta-item">
              <span class="meta-label">⚖️ 案號</span>
              <span class="meta-value">${data.caseNumber || '未知'}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">🏛️ 法院</span>
              <span class="meta-value">${data.court || '未知'}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">📅 裁判日期</span>
              <span class="meta-value">${data.date || '未知'}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">🏷️ 類別 / 案由</span>
              <span class="meta-value">${data.caseType || '未知'} — ${data.cause || '未知'}</span>
            </div>
          </div>
          
          <!-- 標籤容器 -->
          <div class="tags-container" id="tags-container">
            ${tagsHtml}
            <button class="tag-badge" id="btn-add-tag" style="border-style: dashed; cursor: pointer; background: transparent;">
              + 新增標籤
            </button>
          </div>

          <!-- AI 建議標籤 (如果有) -->
          <div id="suggested-tags-area"></div>
        </div>

        <!-- AI 摘要 -->
        <div class="summary-section">
          <h3 class="summary-title">
            <svg style="width:16px;height:16px" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
            案件事實摘要
          </h3>
          <div class="summary-text">${this.linkifyLaws(summary.summary) || '無摘要'}</div>

          <h3 class="summary-title">
            <svg style="width:16px;height:16px" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
            判決結論 / 主文重點
          </h3>
          <div class="summary-text" style="border-left: 3px solid var(--color-success);">${this.linkifyLaws(summary.conclusion) || '無主文重點'}</div>

          <h3 class="summary-title">
            <svg style="width:16px;height:16px" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
            引用與適用法條
          </h3>
          <div class="applied-laws-list">
            ${(summary.appliedLaws || []).map(law => {
              const parsed = this.parseLawString(law) || { lawName: law, articleNumber: '' };
              return `<span class="law-badge law-link-badge" data-law="${parsed.lawName}" data-article="${parsed.articleNumber}">${law}</span>`;
            }).join('') || '<span style="color:var(--text-muted);font-size:13px;">無引用法條</span>'}
          </div>
        </div>
      </div>
    `;

    // 綁定新增標籤按鈕
    this.shadowRoot.getElementById('btn-add-tag').addEventListener('click', () => this.toggleTagPopup(true));
    
    // 綁定刪除標籤按鈕
    this.shadowRoot.querySelectorAll('.btn-remove-tag').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tagId = btn.getAttribute('data-tag-id');
        this.removeTag(tagId);
      });
    });

    // 處理 AI 建議標籤
    this.renderSuggestedTags(summary.suggestedTags || []);
  }

  /**
   * 生成標籤 HTML 元素
   */
  generateTagsHtml(tags) {
    if (!tags || tags.length === 0) return '';
    return tags.map(tag => {
      let typeClass = 'tag-user';
      if (tag.type === 'system') typeClass = 'tag-system';
      else if (tag.type === 'ai') typeClass = 'tag-ai';

      const colorStyle = tag.color ? `border-color: ${tag.color}; color: ${tag.color}; background: ${tag.color}0a;` : '';

      return `
        <span class="tag-badge ${typeClass}" style="${colorStyle}" title="${tag.category || ''}">
          ${tag.name}
          ${tag.type !== 'system' ? `<button class="btn-remove-tag" data-tag-id="${tag.id}">✕</button>` : ''}
        </span>
      `;
    }).join('');
  }

  /**
   * 渲染 AI 建議標籤區 (信心度 0.4-0.7 建議，0.7 以上已自動加入但在這裡不再重複提示)
   */
  renderSuggestedTags(suggestedTags) {
    if (!suggestedTags || suggestedTags.length === 0) return;

    // 過濾出尚未套用且信心度符合條件的建議標籤
    const currentTagNames = (this.currentData.tags || []).map(t => t.name);
    
    // 找出大於等於 0.4 但小於 0.7 且目前未套用的標籤，或者信心度高於 0.7 但因某些原因被使用者刪除的標籤
    const filteredSuggestions = suggestedTags.filter(item => {
      return item.confidence >= 0.4 && !currentTagNames.includes(item.name);
    });

    if (filteredSuggestions.length === 0) return;

    const area = this.shadowRoot.getElementById('suggested-tags-area');
    area.innerHTML = `
      <div class="tag-suggestion-container">
        <div class="tag-suggestion-title">💡 AI 建議標籤：</div>
        <div class="tag-suggestions">
          ${filteredSuggestions.map((item, idx) => `
            <span class="tag-suggest-badge" data-name="${item.name}" data-category="${item.category || '法學爭點'}" data-conf="${item.confidence}">
              ${item.name} (${Math.round(item.confidence * 100)}%)
            </span>
          `).join('')}
        </div>
      </div>
    `;

    // 綁定建議標籤點擊事件
    area.querySelectorAll('.tag-suggest-badge').forEach(badge => {
      badge.addEventListener('click', () => {
        const name = badge.getAttribute('data-name');
        const category = badge.getAttribute('data-category');
        const confidence = parseFloat(badge.getAttribute('data-conf'));
        this.acceptSuggestedTag(name, category, confidence);
      });
    });
  }

  /**
   * 接受 AI 建議標籤並儲存
   */
  acceptSuggestedTag(name, category, confidence) {
    this.showToast(`正在新增標籤：${name}`);
    chrome.runtime.sendMessage({
      type: 'ADD_TAG',
      judgmentId: this.currentData.id,
      tagName: name,
      category: category,
      tagType: 'ai',
      confidence: confidence
    }, (response) => {
      if (response && response.success) {
        this.currentData.tags = response.updatedTags;
        this.switchTab('summary'); // 重新整理
      } else {
        this.showToast(response?.error || '標籤新增失敗');
      }
    });
  }

  /**
   * 新增自訂標籤
   */
  saveCustomTag() {
    const input = this.shadowRoot.getElementById('tag-input-name');
    const name = input.value.trim();
    const category = this.shadowRoot.getElementById('tag-input-category').value;

    if (!name) {
      this.showToast('請輸入標籤名稱');
      return;
    }

    this.toggleTagPopup(false);
    this.showToast(`新增標籤：${name}`);

    chrome.runtime.sendMessage({
      type: 'ADD_TAG',
      judgmentId: this.currentData.id,
      tagName: name,
      category: category,
      tagType: 'user',
      confidence: 1.0
    }, (response) => {
      input.value = '';
      if (response && response.success) {
        this.currentData.tags = response.updatedTags;
        this.switchTab('summary');
      } else {
        this.showToast(response?.error || '標籤新增失敗');
      }
    });
  }

  /**
   * 移除標籤
   */
  removeTag(tagId) {
    this.showToast('正在移除標籤...');
    chrome.runtime.sendMessage({
      type: 'REMOVE_TAG',
      judgmentId: this.currentData.id,
      tagId: tagId
    }, (response) => {
      if (response && response.success) {
        this.currentData.tags = response.updatedTags;
        this.switchTab('summary');
      } else {
        this.showToast(response?.error || '標籤移除失敗');
      }
    });
  }

  /**
   * 控制標籤 Popup 開關
   */
  toggleTagPopup(visible) {
    const popup = this.shadowRoot.getElementById('tag-popup');
    if (visible) {
      popup.classList.add('show');
      this.shadowRoot.getElementById('tag-input-name').focus();
    } else {
      popup.classList.remove('show');
    }
  }

  /**
   * 渲染法學爭點分頁
   */
  renderIssuesTab(container) {
    const data = this.currentData;
    const summary = typeof data.summaryJson === 'string' ? JSON.parse(data.summaryJson) : data.summaryJson;
    const issues = summary.legalIssues || [];

    if (issues.length === 0) {
      container.innerHTML = `
        <div class="tab-content active" style="text-align: center; color: var(--text-muted); padding-top: 50px;">
          <svg viewBox="0 0 24 24" style="width: 48px; height: 48px; fill: currentColor; margin-bottom: 12px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          <div style="font-size: 14px;">此案件未偵測出顯著法學爭點</div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="tab-content active">
        <div class="issues-list">
          ${issues.map((issue, index) => {
            const hasArguments = issue.arguments && (issue.arguments.prosecution || issue.arguments.defense || issue.arguments.courtOpinion);
            
            return `
              <div class="issue-card" data-index="${index}">
                <div class="issue-header">
                  <div class="issue-title-container">
                    <span class="issue-index">${index + 1}</span>
                    <span class="issue-title">${issue.title}</span>
                  </div>
                  <svg class="issue-toggle-icon" viewBox="0 0 24 24"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>
                </div>
                
                <div class="issue-body">
                  <div class="issue-sub-section">
                    <div class="issue-sub-title">📌 爭點說明</div>
                    <div>${this.linkifyLaws(issue.description) || '無詳細說明'}</div>
                  </div>

                  ${issue.legalBasis && issue.legalBasis.length > 0 ? `
                    <div class="issue-sub-section">
                      <div class="issue-sub-title">📖 法律依據</div>
                      <div class="applied-laws-list">
                        ${issue.legalBasis.map(basis => {
                          const parsed = this.parseLawString(basis) || { lawName: basis, articleNumber: '' };
                          return `<span class="law-badge law-link-badge" data-law="${parsed.lawName}" data-article="${parsed.articleNumber}">${basis}</span>`;
                        }).join('')}
                      </div>
                    </div>
                  ` : ''}

                  ${hasArguments ? `
                    <div class="issue-sub-section">
                      <div class="issue-sub-title">🏛️ 兩造與法院主張</div>
                      ${issue.arguments.prosecution ? `
                        <div style="margin-top: 6px;">
                          <strong style="color:var(--color-system)">• 原告 / 檢察官：</strong>
                          <span style="font-size: 13px;">${this.linkifyLaws(issue.arguments.prosecution)}</span>
                        </div>
                      ` : ''}
                      ${issue.arguments.defense ? `
                        <div style="margin-top: 6px;">
                          <strong style="color:var(--color-danger)">• 被告 / 辯護人：</strong>
                          <span style="font-size: 13px;">${this.linkifyLaws(issue.arguments.defense)}</span>
                        </div>
                      ` : ''}
                      ${issue.arguments.courtOpinion ? `
                        <div class="issue-quote">
                          <strong>💡 法院判定理據：</strong><br/>
                          ${this.linkifyLaws(issue.arguments.courtOpinion)}
                        </div>
                      ` : ''}
                    </div>
                  ` : ''}

                  ${issue.relatedCases && issue.relatedCases.length > 0 ? `
                    <div class="issue-sub-section">
                      <div class="issue-sub-title">📚 關聯判例 / 裁判</div>
                      <div style="font-size: 12.5px; color: var(--text-muted); line-height: 1.5;">
                        ${issue.relatedCases.map(c => `<div>• ${c}</div>`).join('')}
                      </div>
                    </div>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // 綁定展開收合事件
    container.querySelectorAll('.issue-header').forEach(header => {
      header.addEventListener('click', (e) => {
        const card = e.currentTarget.closest('.issue-card');
        card.classList.toggle('expanded');
      });
    });
  }

  /**
   * 渲染智慧查詢 RAG 分頁
   */
  renderRAGTab(container) {
    container.innerHTML = `
      <div class="tab-content active" style="display:flex; flex-direction:column; height: 100%;">
        <div class="rag-search-box">
          <input type="text" class="rag-input" id="rag-input-text" placeholder="輸入法學問答，例如：'因果關係是如何認定的？'...">
          <button class="rag-search-btn" id="btn-rag-search">
            <svg style="width:16px;height:16px" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
            搜尋
          </button>
        </div>

        <div id="rag-result-container" style="flex: 1; overflow-y: auto;">
          <div style="text-align: center; color: var(--text-muted); padding-top: 40px; font-size:13px;">
            🔍 請輸入問題查詢當前及同資料庫中所有判決書內容（RAG 技術）
          </div>
        </div>
      </div>
    `;

    const searchInput = this.shadowRoot.getElementById('rag-input-text');
    const searchBtn = this.shadowRoot.getElementById('btn-rag-search');
    
    // 綁定 Enter 鍵
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.performRAGSearch();
      }
    });

    searchBtn.addEventListener('click', () => this.performRAGSearch());
  }

  /**
   * 執行 RAG 向量查詢
   */
  performRAGSearch() {
    const input = this.shadowRoot.getElementById('rag-input-text');
    const query = input.value.trim();
    if (!query) return;

    const resultArea = this.shadowRoot.getElementById('rag-result-container');
    resultArea.innerHTML = `
      <div class="loading-container" style="min-height: 150px;">
        <div class="loader-spinner" style="width:24px; height:24px; border-width:2px;"></div>
        <div style="font-size: 13px;">正在進行向量檢索與 AI 推理分析...</div>
      </div>
    `;

    // 禁用輸入
    input.disabled = true;
    this.shadowRoot.getElementById('btn-rag-search').disabled = true;

    chrome.runtime.sendMessage({
      type: 'RAG_QUERY',
      query: query,
      databaseId: this.currentData.databaseId // 當前資料庫 ID
    }, (response) => {
      // 恢復輸入
      input.disabled = false;
      this.shadowRoot.getElementById('btn-rag-search').disabled = false;

      if (response && response.success) {
        this.renderRAGResult(resultArea, response.answer, response.sources);
      } else {
        resultArea.innerHTML = `
          <div style="color: var(--color-danger); text-align: center; font-size: 13px; padding-top: 20px;">
            ⚠️ 查詢失敗：${response?.error || '未知錯誤'}
          </div>
        `;
      }
    });
  }

  /**
   * 渲染 RAG 回應結果
   */
  renderRAGResult(container, answer, sources = []) {
    let sourcesHtml = '';
    if (sources && sources.length > 0) {
      sourcesHtml = `
        <div class="rag-source-title">引用判決書資料來源：</div>
        <div class="rag-results">
          ${sources.map(src => `
            <div class="rag-source-card">
              <div class="rag-source-header">
                <span class="rag-source-name">${src.court} — ${src.caseNumber}</span>
                <span class="rag-source-score">匹配度：${Math.round(src.score * 100)}%</span>
              </div>
              <div class="rag-source-snippet" title="${src.chunkText}">${src.chunkText}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    container.innerHTML = `
      <div class="rag-answer">
        <div class="rag-answer-title">
          <svg style="width:16px;height:16px" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          AI 分析回覆：
        </div>
        <div class="rag-answer-text">${answer}</div>
      </div>
      ${sourcesHtml}
    `;
  }

  /* ===================================================================
     檔案匯出與剪貼簿操作
     =================================================================== */

  /**
   * 複製報告內容為文字格式
   */
  copyToClipboard() {
    if (!this.currentData) return;
    const summary = typeof this.currentData.summaryJson === 'string' ? JSON.parse(this.currentData.summaryJson) : this.currentData.summaryJson;
    
    let text = `【法律判決 AI 摘要分析報告】\n`;
    text += `案號：${this.currentData.caseNumber}\n`;
    text += `法院：${this.currentData.court}\n`;
    text += `裁判日期：${this.currentData.date}\n`;
    text += `類別與案由：${this.currentData.caseType} — ${this.currentData.cause}\n\n`;
    
    text += `一、案件事實摘要：\n${summary.summary}\n\n`;
    text += `二、判決結論與重點：\n${summary.conclusion}\n\n`;
    
    text += `三、適用法條：\n${(summary.appliedLaws || []).join(', ')}\n\n`;
    
    text += `四、法學爭點解析：\n`;
    (summary.legalIssues || []).forEach((issue, idx) => {
      text += `（${idx + 1}）${issue.title}\n`;
      text += `   - 說明：${issue.description}\n`;
      if (issue.legalBasis && issue.legalBasis.length > 0) text += `   - 依據：${issue.legalBasis.join(', ')}\n`;
      if (issue.arguments) {
        if (issue.arguments.prosecution) text += `   - 原告/檢察官：${issue.arguments.prosecution}\n`;
        if (issue.arguments.defense) text += `   - 被告/辯護人：${issue.arguments.defense}\n`;
        if (issue.arguments.courtOpinion) text += `   - 法院判定理據：${issue.arguments.courtOpinion}\n`;
      }
      if (issue.relatedCases && issue.relatedCases.length > 0) text += `   - 關聯判例：${issue.relatedCases.join(', ')}\n`;
      text += `\n`;
    });

    if (this.currentData.rawText) {
      text += `五、判決書全文：\n${this.currentData.rawText}\n`;
    }

    navigator.clipboard.writeText(text).then(() => {
      this.showToast('✅ 報告已成功複製到剪貼簿');
    }).catch(err => {
      this.showToast('❌ 複製失敗');
    });
  }

  /**
   * 匯出為精緻 HTML 檔案
   */
  exportAsHtml() {
    if (!this.currentData) return;
    const summary = typeof this.currentData.summaryJson === 'string' ? JSON.parse(this.currentData.summaryJson) : this.currentData.summaryJson;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>判決書摘要_${this.currentData.caseNumber}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Microsoft JhengHei", sans-serif;
      line-height: 1.7;
      color: #1e293b;
      max-width: 800px;
      margin: 40px auto;
      padding: 0 20px;
      background: #f8fafc;
    }
    .report-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03);
    }
    .header {
      border-bottom: 2px solid #C9A35C;
      padding-bottom: 15px;
      margin-bottom: 25px;
    }
    .title {
      color: #1a365d;
      font-size: 24px;
      font-weight: 700;
      margin: 0;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 15px;
      margin-top: 15px;
      background: #f1f5f9;
      padding: 15px;
      border-radius: 8px;
      font-size: 14px;
    }
    .meta-label {
      color: #64748b;
      font-weight: 600;
    }
    h2 {
      color: #C9A35C;
      font-size: 18px;
      border-left: 4px solid #C9A35C;
      padding-left: 10px;
      margin-top: 30px;
    }
    .content-box {
      background: #f8fafc;
      padding: 15px 20px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      white-space: pre-line;
      text-align: justify;
    }
    .issue-card {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      margin-bottom: 15px;
      overflow: hidden;
    }
    .issue-header {
      background: #f1f5f9;
      padding: 12px 15px;
      font-weight: 600;
      color: #1e293b;
      border-bottom: 1px solid #e2e8f0;
    }
    .issue-body {
      padding: 15px;
      font-size: 14px;
    }
    .issue-quote {
      border-left: 3px solid #C9A35C;
      padding-left: 12px;
      background: rgba(201, 163, 92, 0.05);
      padding: 10px 12px;
      border-radius: 0 4px 4px 0;
      margin-top: 10px;
      font-family: Georgia, Cambria, serif;
    }
    .law-badge {
      display: inline-block;
      padding: 3px 8px;
      background: #e2e8f0;
      border-radius: 4px;
      margin-right: 5px;
      margin-bottom: 5px;
      font-size: 12.5px;
    }
    .footer {
      text-align: center;
      margin-top: 40px;
      font-size: 12px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="report-card">
    <div class="header">
      <h1 class="title">⚖️ 法律判決 AI 摘要分析報告</h1>
      <div class="meta-grid">
        <div><span class="meta-label">案號：</span>${this.currentData.caseNumber}</div>
        <div><span class="meta-label">法院：</span>${this.currentData.court}</div>
        <div><span class="meta-label">日期：</span>${this.currentData.date}</div>
        <div><span class="meta-label">案由：</span>${this.currentData.caseType} / ${this.currentData.cause}</div>
      </div>
    </div>

    <h2>一、案件事實摘要</h2>
    <div class="content-box">${summary.summary}</div>

    <h2>二、判決結論 / 主文重點</h2>
    <div class="content-box" style="border-left: 4px solid #10B981;">${summary.conclusion}</div>

    <h2>三、引用與適用法條</h2>
    <div>
      ${(summary.appliedLaws || []).map(law => `<span class="law-badge">${law}</span>`).join('') || '無引用法條'}
    </div>

    <h2>四、法學爭點解析</h2>
    <div style="margin-top: 15px;">
      ${(summary.legalIssues || []).map((issue, idx) => `
        <div class="issue-card">
          <div class="issue-header">爭點 ${idx + 1}：${issue.title}</div>
          <div class="issue-body">
            <div style="margin-bottom: 10px;"><strong>📌 說明：</strong>${issue.description}</div>
            ${issue.legalBasis && issue.legalBasis.length > 0 ? `<div style="margin-bottom:10px;"><strong>📖 法律依據：</strong>${issue.legalBasis.map(b => `<span class="law-badge">${b}</span>`).join('')}</div>` : ''}
            
            ${issue.arguments ? `
              <div style="background:#f8fafc; padding: 12px; border-radius:6px; margin-top:10px;">
                ${issue.arguments.prosecution ? `<div style="margin-bottom:5px;"><strong>原告 / 檢察官：</strong>${issue.arguments.prosecution}</div>` : ''}
                ${issue.arguments.defense ? `<div style="margin-bottom:5px;"><strong>被告 / 辯護人：</strong>${issue.arguments.defense}</div>` : ''}
                ${issue.arguments.courtOpinion ? `<div class="issue-quote"><strong>法院判定理據：</strong><br/>${issue.arguments.courtOpinion}</div>` : ''}
              </div>
            ` : ''}

            ${issue.relatedCases && issue.relatedCases.length > 0 ? `<div style="margin-top: 10px; color:#64748b;"><strong>關聯判例：</strong>${issue.relatedCases.join(', ')}</div>` : ''}
          </div>
        </div>
      `).join('') || '無爭點'}
    </div>

    <h2>五、判決書全文</h2>
    <div class="content-box" style="white-space: pre-wrap; font-family: monospace; font-size: 13px; line-height: 1.6; max-height: 600px; overflow-y: auto; background: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px;">
      ${this.currentData.rawText ? this.currentData.rawText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '無全文資料'}
    </div>

    <div class="footer">
      報告產生時間：${new Date().toLocaleString('zh-TW')} | 由法律判決 AI 摘要助手自動產生
    </div>
  </div>
</body>
</html>
    `;

    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    // 建立臨時 link 觸發下載
    const a = document.createElement('a');
    a.href = url;
    a.download = `判決書摘要_${this.currentData.caseNumber}.html`;
    document.body.appendChild(a);
    a.click();
    
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast('✅ HTML 報告已匯出下載');
  }

  /**
   * 顯示 Toast 氣泡提示
   */
  showToast(message, duration = 3000) {
    const toast = this.shadowRoot.getElementById('toast-msg');
    if (!toast) return;

    toast.innerText = message;
    toast.classList.add('show');
    
    // 清除先前的 timer
    if (this.toastTimer) clearTimeout(this.toastTimer);
    
    this.toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  /**
   * 渲染首頁 AI 智慧查詢入口
   */
  renderHomepageAISearch() {
    this.container.classList.remove('hidden');
    
    // 隱藏 Tab 頁籤與 Footer 報告複製按鈕
    const tabContainer = this.shadowRoot.querySelector('.panel-tabs');
    if (tabContainer) tabContainer.style.display = 'none';
    
    const footerButtons = this.shadowRoot.querySelector('.panel-footer .footer-right');
    if (footerButtons) footerButtons.style.display = 'none';

    const titleText = this.shadowRoot.getElementById('panel-title-text');
    titleText.innerText = '🤖 AI 智慧查詢';

    const body = this.shadowRoot.getElementById('panel-body');
    body.innerHTML = `
      <div class="tab-content active" style="display:flex; flex-direction:column; height: 100%; overflow-y: auto; padding: 14px;">
        <!-- 四大模式選卡列 -->
        <div class="ai-search-modes">
          <div class="mode-card active" data-mode="concept">
            <div class="mode-icon">🔍</div>
            <div class="mode-title">觀念</div>
          </div>
          <div class="mode-card" data-mode="similar">
            <div class="mode-icon">📋</div>
            <div class="mode-title">相似</div>
          </div>
          <div class="mode-card" data-mode="estimate">
            <div class="mode-icon">⚖️</div>
            <div class="mode-title">預估</div>
          </div>
          <div class="mode-card" data-mode="calculator">
            <div class="mode-icon">🧮</div>
            <div class="mode-title">裁判費</div>
          </div>
        </div>

        <!-- 輸入區域 (動態切換) -->
        <div class="ai-search-input-area" style="background: var(--bg-card); border: var(--border-light); border-radius: 10px; padding: 12px; margin-bottom: 12px;">
          <div id="search-mode-container"></div>
        </div>

        <!-- 搜尋進度區 (預設隱藏) -->
        <div class="search-progress-container hidden" id="search-progress-area" style="background: var(--bg-card); border: var(--border-light); border-radius: 10px; padding: 12px; margin-bottom: 12px;">
          <div class="progress-header">
            <span class="progress-spinner"></span>
            <span class="progress-title" id="progress-status-title">搜尋與分析中...</span>
          </div>
          <div class="progress-timeline" id="progress-timeline-steps"></div>
        </div>

        <!-- 搜尋結果區 (預設隱藏) -->
        <div class="ai-result-container hidden" id="ai-result-area" style="background: var(--bg-card); border: var(--border-light); border-radius: 10px; padding: 12px;">
          <div class="result-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <h3 style="margin:0; font-size:14px; color:var(--gold-primary);">💡 AI 分析結果報告</h3>
            <button class="footer-btn" id="btn-copy-ai-answer" style="padding: 4px 8px; font-size: 11px;">📋 複製</button>
          </div>
          <div class="ai-answer-block" id="ai-answer-content"></div>
          
          <div class="citations-section">
            <h4 style="margin:16px 0 10px 0; font-size:12.5px; border-bottom:var(--border-light); padding-bottom:4px;">📎 引用判決書資料來源</h4>
            <div class="citations-grid" id="citations-list-grid"></div>
          </div>
        </div>
      </div>
    `;

    // 綁定選卡事件
    const modeCards = this.shadowRoot.querySelectorAll('.mode-card');
    modeCards.forEach(card => {
      card.addEventListener('click', () => {
        this.shadowRoot.querySelectorAll('.mode-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        const mode = card.getAttribute('data-mode');
        this.switchSearchMode(mode);
      });
    });

    // 預設載入 concept 模式
    this.switchSearchMode('concept');
  }

  switchSearchMode(mode) {
    this.activeSearchMode = mode;
    const container = this.shadowRoot.getElementById('search-mode-container');
    
    // 隱藏進度與結果
    this.shadowRoot.getElementById('search-progress-area').classList.add('hidden');
    this.shadowRoot.getElementById('ai-result-area').classList.add('hidden');
    
    if (mode === 'calculator') {
      container.innerHTML = `
        <div class="calculator-form">
          <h3 style="color:var(--gold-primary); margin:0 0 10px 0; font-size:13px; font-weight:700;">⚖️ 裁判費依法計算機</h3>
          <div class="form-row-group">
            <div class="search-form-group">
              <label>案件審級</label>
              <div class="radio-group">
                <label class="radio-option"><input type="radio" name="calc-level" value="first" checked> 一審</label>
                <label class="radio-option"><input type="radio" name="calc-level" value="second"> 二審</label>
                <label class="radio-option"><input type="radio" name="calc-level" value="third"> 三審</label>
              </div>
            </div>
            <div class="search-form-group">
              <label>訴訟性質</label>
              <div class="radio-group">
                <label class="radio-option"><input type="radio" name="calc-type" value="property" checked> 財產權</label>
                <label class="radio-option"><input type="radio" name="calc-type" value="non-property"> 非財產權</label>
              </div>
            </div>
          </div>
          
          <div class="search-form-group" id="calc-amount-group">
            <label for="calc-amount">訴訟標的金額 (新台幣元)</label>
            <input type="text" id="calc-amount" placeholder="例如：1500000" style="padding:8px; font-size:12.5px; background:var(--bg-input); border:var(--border-light); color:var(--text-main); border-radius:6px; outline:none;">
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
            <span style="font-size:11px; color:var(--text-muted);">* 畸零不滿萬元以萬元計。</span>
            <button class="tag-popup-btn btn-confirm" id="btn-run-calc">🧮 計算</button>
          </div>

          <div id="calculator-result-container" class="hidden"></div>
        </div>
      `;

      const calcTypes = container.querySelectorAll('input[name="calc-type"]');
      calcTypes.forEach(radio => {
        radio.addEventListener('change', (e) => {
          const amountGroup = this.shadowRoot.getElementById('calc-amount-group');
          if (e.target.value === 'non-property') {
            amountGroup.classList.add('hidden');
          } else {
            amountGroup.classList.remove('hidden');
          }
        });
      });

      this.shadowRoot.getElementById('btn-run-calc').addEventListener('click', () => this.handleCourtFeeCalc());

    } else {
      let labelText = '';
      let placeholderText = '';
      
      if (mode === 'concept') {
        labelText = '📝 想查詢的法律觀念';
        placeholderText = '例如：輸入「善意取得」查詢動產或不動產之信賴保護要件...';
      } else if (mode === 'similar') {
        labelText = '📝 案情敘述（尋找相似判決）';
        placeholderText = '例如：輸入「被告在夜間潛入被害人住處，竊取現金三萬元，被警網巡邏人贓俱獲」...';
      } else if (mode === 'estimate') {
        labelText = '📝 描述事實（預估刑度/賠償）';
        placeholderText = '例如：輸入「車禍損害賠償，被害人左腿骨折住院十天，請求精神慰撫金與醫療費」...';
      }

      container.innerHTML = `
        <div class="search-form-group">
          <label for="ai-search-prompt">${labelText}</label>
          <textarea id="ai-search-prompt" class="search-textarea" placeholder="${placeholderText}"></textarea>
        </div>
        <div class="search-form-actions">
          <button class="tag-popup-btn btn-confirm" id="btn-run-ai-search" style="padding:6px 14px;">
            ✨ 開始 AI 檢索
          </button>
        </div>
      `;

      this.shadowRoot.getElementById('btn-run-ai-search').addEventListener('click', () => this.handleAISearch());
    }
  }

  handleCourtFeeCalc() {
    const container = this.shadowRoot.getElementById('calculator-result-container');
    const level = this.shadowRoot.querySelector('input[name="calc-level"]:checked').value;
    const type = this.shadowRoot.querySelector('input[name="calc-type"]:checked').value;
    const amountInput = this.shadowRoot.getElementById('calc-amount');
    
    let amount = 0;
    if (type === 'property') {
      amount = parseFloat(amountInput.value.replace(/,/g, ''));
      if (isNaN(amount) || amount <= 0) {
        this.showToast('⚠️ 請輸入有效的標的金額');
        return;
      }
    }

    chrome.runtime.sendMessage({
      type: 'COURT_FEE_CALCULATE',
      amount: amount,
      caseType: type
    }, (response) => {
      if (response && response.success) {
        container.classList.remove('hidden');
        
        let finalFee = response.firstInstance;
        let levelTitle = '一審';
        if (level === 'second') {
          finalFee = response.secondInstance;
          levelTitle = '二審';
        } else if (level === 'third') {
          finalFee = response.thirdInstance;
          levelTitle = '三審';
        }

        let breakdownHtml = '';
        if (response.breakdown && response.breakdown.length > 0) {
          breakdownHtml = `
            <div class="fee-breakdown" style="border-top:var(--border-light); margin-top:8px; padding-top:8px;">
              <div class="fee-breakdown-title" style="font-size:11.5px; font-weight:600;">明細：</div>
              <div class="fee-breakdown-list">
                ${response.breakdown.map(b => `
                  <div class="fee-breakdown-item" style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-muted);">
                    <span>${b.range}</span>
                    <span>NT$ ${Math.round(b.fee).toLocaleString()}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }

        container.innerHTML = `
          <div class="calculator-result" style="margin-top:10px; padding:10px; background:rgba(201, 163, 92, 0.04); border:1px dashed rgba(201, 163, 92, 0.3); border-radius:6px;">
            <h4 style="margin:0 0 4px 0; font-size:12.5px; color:var(--gold-primary);">計算結果 (${levelTitle})</h4>
            <div class="fee-highlight" style="font-size:20px; font-weight:700; color:var(--gold-primary);">NT$ ${finalFee.toLocaleString()} 元</div>
            <div class="fee-law-basis" style="font-size:11px; color:var(--text-muted); margin-bottom:6px;">${response.lawBasis}</div>
            ${breakdownHtml}
          </div>
        `;
      } else {
        this.showToast('⚠️ 計算失敗：' + (response?.error || '未知錯誤'));
      }
    });
  }

  handleAISearch() {
    const promptInput = this.shadowRoot.getElementById('ai-search-prompt');
    const prompt = promptInput.value.trim();
    if (!prompt) {
      this.showToast('⚠️ 請輸入內容');
      return;
    }

    const progressArea = this.shadowRoot.getElementById('search-progress-area');
    const progressSteps = this.shadowRoot.getElementById('progress-timeline-steps');
    const statusTitle = this.shadowRoot.getElementById('progress-status-title');
    const resultArea = this.shadowRoot.getElementById('ai-result-area');

    progressArea.classList.remove('hidden');
    resultArea.classList.add('hidden');
    progressSteps.innerHTML = '';
    statusTitle.innerText = '正在初始化搜尋策略...';

    promptInput.disabled = true;
    this.shadowRoot.getElementById('btn-run-ai-search').disabled = true;

    chrome.runtime.sendMessage({
      type: 'AI_SEARCH_QUERY',
      mode: this.activeSearchMode,
      prompt: prompt,
      tabId: null // background detects from sender.tab in content script
    }, (response) => {
      // 若啟動失敗（例如未設定 API Key），立即在此處理
      // 成功啟動後，進度與最終結果將由 Content Script 監聽非同步推送
      if (!response || !response.success) {
        promptInput.disabled = false;
        this.shadowRoot.getElementById('btn-run-ai-search').disabled = false;
        statusTitle.innerText = '啟動搜尋失敗';
        const spinner = this.shadowRoot.querySelector('.progress-spinner');
        if (spinner) spinner.style.display = 'none';
        this.showToast('⚠️ 智慧搜尋啟動失敗：' + (response?.error || '未知錯誤'));
      }
      // 若 response.status === 'started'，等待非同步推送
    });
  }

  handleAISearchResult(data) {
    const promptInput = this.shadowRoot.getElementById('ai-search-prompt');
    const runBtn = this.shadowRoot.getElementById('btn-run-ai-search');
    if (promptInput) promptInput.disabled = false;
    if (runBtn) runBtn.disabled = false;

    const statusTitle = this.shadowRoot.getElementById('progress-status-title');
    if (statusTitle) statusTitle.innerText = '分析完成！';
    
    const spinner = this.shadowRoot.querySelector('.progress-spinner');
    if (spinner) spinner.style.display = 'none';

    this.renderAISearchResult(data);
  }

  handleAISearchError(error) {
    const promptInput = this.shadowRoot.getElementById('ai-search-prompt');
    const runBtn = this.shadowRoot.getElementById('btn-run-ai-search');
    if (promptInput) promptInput.disabled = false;
    if (runBtn) runBtn.disabled = false;

    const statusTitle = this.shadowRoot.getElementById('progress-status-title');
    if (statusTitle) statusTitle.innerText = '搜尋發生錯誤';
    
    const spinner = this.shadowRoot.querySelector('.progress-spinner');
    if (spinner) spinner.style.display = 'none';

    this.showToast('⚠️ 智慧搜尋失敗：' + (error || '未知錯誤'));
  }

  updateSearchProgress(progress) {
    const progressSteps = this.shadowRoot.getElementById('progress-timeline-steps');
    const statusTitle = this.shadowRoot.getElementById('progress-status-title');
    
    if (!progressSteps) return;
    statusTitle.innerText = progress.message;

    const stepId = `step-${progress.status}`;
    let stepEl = this.shadowRoot.getElementById(stepId);
    
    this.shadowRoot.querySelectorAll('.progress-step').forEach(el => el.classList.remove('active'));

    if (!stepEl) {
      stepEl = document.createElement('div');
      stepEl.id = stepId;
      stepEl.className = 'progress-step active';
      progressSteps.appendChild(stepEl);
    } else {
      stepEl.className = 'progress-step active';
    }

    stepEl.innerHTML = `<strong>${progress.message}</strong>`;

    if (progress.status === 'completed') {
      this.shadowRoot.querySelectorAll('.progress-step').forEach(el => {
        el.classList.remove('active');
        el.classList.add('done');
      });
    }
  }

  renderAISearchResult(data) {
    const resultArea = this.shadowRoot.getElementById('ai-result-area');
    const answerContent = this.shadowRoot.getElementById('ai-answer-content');
    const citationsGrid = this.shadowRoot.getElementById('citations-list-grid');

    resultArea.classList.remove('hidden');
    answerContent.innerHTML = this.formatMarkdown(data.answer);

    this.shadowRoot.getElementById('btn-copy-ai-answer').onclick = () => {
      navigator.clipboard.writeText(data.answer).then(() => {
        this.showToast('✅ 已複製回答');
      });
    };

    citationsGrid.innerHTML = '';
    if (data.citations && data.citations.length > 0) {
      data.citations.forEach((citation, idx) => {
        const card = document.createElement('div');
        card.className = 'citation-card';
        
        const numLabel = `[${idx}]`;
        const url = citation.url || '#';
        const court = citation.court || '未知法院';
        const caseNumber = citation.caseNumber || '未知案號';
        const relevance = citation.relevance || '引用原因簡述。';

        card.innerHTML = `
          <div class="citation-meta">
            <span class="citation-case">${numLabel} ${caseNumber}</span>
            <span class="citation-court">${court}</span>
          </div>
          <div class="citation-reason">${relevance}</div>
          <div class="citation-actions">
            <a class="tag-popup-btn" href="${url}" target="_blank" style="text-decoration:none; display:inline-block; text-align:center;">🔗 開啟</a>
            <button class="tag-popup-btn btn-confirm btn-save-citation" data-url="${url}">💾 儲存</button>
          </div>
        `;

        card.querySelector('.btn-save-citation').addEventListener('click', (e) => {
          this.saveCitationToDatabase(url, e.target);
        });

        citationsGrid.appendChild(card);
      });
    } else {
      citationsGrid.innerHTML = '<div style="color:var(--text-muted); font-size:11.5px; text-align:center; padding:10px 0;">無引用裁判書資料來源。</div>';
    }
    
    resultArea.scrollIntoView({ behavior: 'smooth' });
  }

  saveCitationToDatabase(url, button) {
    button.disabled = true;
    button.innerText = '⏳ 處理中...';

    chrome.runtime.sendMessage({
      type: 'SAVE_CITATION_TO_DB',
      url: url
    }, (response) => {
      if (response && response.success) {
        button.innerText = '✅ 已儲存';
        button.disabled = true;
        button.style.background = 'transparent';
        button.style.border = '1px solid var(--border-panel)';
        button.style.color = 'var(--text-main)';
        this.showToast(`✅ 已儲存 ${response.judgment?.caseNumber || '判決書'}！`);
      } else {
        button.disabled = false;
        button.innerText = '💾 儲存';
        this.showToast('⚠️ 儲存失敗：' + (response?.error || '網路請求被阻擋'));
      }
    });
  }

  formatMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/### (.*?)\n/g, '<h3 style="color:var(--gold-primary); margin:12px 0 6px 0; font-size:13px; border-left:3px solid var(--gold-primary); padding-left:6px;">$1</h3>')
      .replace(/## (.*?)\n/g, '<h2 style="color:var(--gold-primary); margin:16px 0 8px 0; font-size:13.5px;">$1</h2>')
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--text-main); font-weight:600;">$1</strong>')
      .replace(/-\s(.*?)\n/g, '<li style="margin-left:12px; margin-bottom:2px;">$1</li>')
      .replace(/\n\n/g, '<br/>')
      .replace(/\n/g, '<br/>');
  }

  linkifyLaws(text) {
    if (!text) return '';
    // This regex matches [LawName]第[Article]條 and optionally [Paragraph]項/款 and [前中後]段
    const lawRegex = /([A-Za-z\u4e00-\u9fa5]{2,20}(?:法|律|條例|通則))第\s*([\d-]+)\s*條(?:\s*第\s*[\d-一二三四五六七八九十百]+\s*[項款])*(?:\s*[前中後]段)?/g;
    
    return text.replace(lawRegex, (match, lawName, articleNumber) => {
      const cleanName = this.cleanLawName(lawName);
      
      if (cleanName !== lawName) {
        const index = lawName.indexOf(cleanName);
        if (index > 0) {
          const prefix = lawName.substring(0, index);
          const suffix = match.substring(prefix.length);
          return `${prefix}<span class="law-link-inline" data-law="${cleanName}" data-article="${articleNumber}">${suffix}</span>`;
        }
      }
      return `<span class="law-link-inline" data-law="${cleanName}" data-article="${articleNumber}">${match}</span>`;
    });
  }

  cleanLawName(lawName) {
    let name = lawName.trim();
    // Strip common leading action verbs/prepositions in Taiwan judgments
    const prefixes = [
      /^[應依爰按據與及或之於在等其自亦均係核]+/g,
      /^依據/g,
      /^適用/g,
      /^違反/g,
      /^本於/g,
      /^參照/g,
      /^符合/g,
      /^自應依/g,
      /^應逕依/g,
      /^均應依/g,
      /^核係依/g,
      /^係依/g,
      /^亦依/g,
      /^均依/g,
    ];
    
    let changed = true;
    while (changed) {
      changed = false;
      for (const prefix of prefixes) {
        const newName = name.replace(prefix, '');
        if (newName !== name) {
          name = newName;
          changed = true;
        }
      }
    }
    return name.trim();
  }

  parseLawString(lawStr) {
    const regex = /([A-Za-z\u4e00-\u9fa5]{2,20}(?:法|律|條例|通則))第\s*([\d-]+)\s*條/;
    const match = lawStr.match(regex);
    if (match) {
      return {
        lawName: this.cleanLawName(match[1]),
        articleNumber: match[2].trim()
      };
    }
    return null;
  }

  handleLawLookup(lawName, articleNumber) {
    this.showToast(`🔍 正在查詢 ${lawName} 第 ${articleNumber} 條...`);
    
    chrome.runtime.sendMessage({
      type: 'GET_LAW_ARTICLE',
      lawName: lawName,
      articleNumber: articleNumber
    }, (response) => {
      if (response && response.success && response.article) {
        this.showLawPopup(lawName, articleNumber, response.article.content);
      } else {
        this.showToast(`❌ 無法取得法條內容：${response?.error || '未知錯誤'}`);
      }
    });
  }

  showLawPopup(lawName, articleNumber, content) {
    const existing = this.shadowRoot.querySelector('.law-popup');
    if (existing) {
      existing.remove();
    }

    const popup = document.createElement('div');
    popup.className = 'law-popup';
    
    let popupRight = this.right + this.container.offsetWidth + 20;
    let popupTop = this.top + 40;
    
    if (popupRight + 400 > window.innerWidth) {
      popupRight = Math.max(20, this.right - 420);
    }
    
    popup.style.right = `${popupRight}px`;
    popup.style.top = `${popupTop}px`;
    
    popup.innerHTML = `
      <div class="law-popup-header" id="law-drag-handle">
        <div class="law-popup-title">
          📖 ${lawName} 第 ${articleNumber} 條
        </div>
        <button class="law-popup-close-btn" id="btn-close-law-popup">
          <svg style="width:16px;height:16px" viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>
        </button>
      </div>
      <div class="law-popup-body">
        ${content || '無條文內容。'}
      </div>
    `;
    
    this.root.appendChild(popup);
    
    popup.querySelector('#btn-close-law-popup').addEventListener('click', () => {
      popup.remove();
    });
    
    this.setupLawPopupDrag(popup);
  }

  setupLawPopupDrag(popup) {
    const handle = popup.querySelector('#law-drag-handle');
    let isDraggingLaw = false;
    let startX = 0;
    let startY = 0;
    let startRight = 0;
    let startTop = 0;
    
    const onMouseDown = (e) => {
      isDraggingLaw = true;
      startX = e.clientX;
      startY = e.clientY;
      startRight = parseFloat(window.getComputedStyle(popup).right);
      startTop = parseFloat(window.getComputedStyle(popup).top);
      e.preventDefault();
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };
    
    const onMouseMove = (e) => {
      if (!isDraggingLaw) return;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      
      let right = startRight - deltaX;
      let top = startTop + deltaY;
      
      right = Math.max(0, Math.min(window.innerWidth - popup.offsetWidth, right));
      top = Math.max(0, Math.min(window.innerHeight - popup.offsetHeight, top));
      
      popup.style.right = `${right}px`;
      popup.style.top = `${top}px`;
    };
    
    const onMouseUp = () => {
      isDraggingLaw = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    
    handle.addEventListener('mousedown', onMouseDown);
  }
}

// 註冊至 window 全域，方便 content-script.js 調用
window.LegalJudgmentFloatingPanel = LegalJudgmentFloatingPanel;

