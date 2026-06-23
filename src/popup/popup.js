/**
 * 法律判決 AI 摘要助手 — Popup 控制器
 */

// 當前選取的資料庫顏色標記
let selectedDbColor = '#6366F1';

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 初始化主題與基本設定
  await initSettingsAndTheme();

  // 2. 偵測當前分頁是否為判決書網頁
  await detectActiveTab();

  // 3. 載入並渲染資料庫選單
  await loadDatabaseSelector();

  // 4. 綁定事件處理器
  setupEventListeners();
});

/**
 * 載入設定與外觀主題
 */
async function initSettingsAndTheme() {
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
    if (response && response.success) {
      const settings = response.settings;
      
      // 套用主題
      setTheme(settings.theme || 'dark');

      // 填入 API Key
      renderApiKeys('popup-api-keys-container', settings.geminiApiKey);
      if (settings.geminiApiKey) {
        updateApiKeyStatus(true);
      } else {
        updateApiKeyStatus(false);
      }

      // 填入同步啟用狀態
      toggleSyncUI(settings.cloudSyncEnabled, settings.activeDatabaseId);
    }
  });
}

/**
 * 設定外觀主題
 */
function setTheme(theme) {
  const body = document.body;
  if (theme === 'light') {
    body.classList.remove('theme-dark');
    body.classList.add('theme-light');
    document.getElementById('btn-theme-toggle').innerText = '🌙';
  } else {
    body.classList.remove('theme-light');
    body.classList.add('theme-dark');
    document.getElementById('btn-theme-toggle').innerText = '☀️';
  }
}

/**
 * 偵測當前分頁是否可進行判決書分析
 */
async function detectActiveTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const detectMsg = document.getElementById('page-detect-msg');
  const analyzeBtn = document.getElementById('btn-start-analyze');

  if (!activeTab || !activeTab.url) {
    detectMsg.innerText = '⚠️ 無法讀取當前分頁 url。';
    return;
  }

  // 檢查是否為司法院網頁 (支援 data.aspx 或 FJUDQRY03_1.aspx 類型網址)
  const isJudicialSite = activeTab.url.includes('judgment.judicial.gov.tw');
  
  if (isJudicialSite) {
    detectMsg.classList.add('hidden');
    analyzeBtn.classList.remove('hidden');
  } else {
    detectMsg.innerText = '🔍 請前往「司法院裁判書查詢系統」判決全文頁面使用此工具。';
    analyzeBtn.classList.add('hidden');
  }
}

/**
 * 載入並渲染資料庫下拉選單
 */
async function loadDatabaseSelector() {
  const select = document.getElementById('select-active-db');
  
  chrome.runtime.sendMessage({ type: 'LIST_DATABASES' }, (response) => {
    if (response && response.success) {
      const dbs = response.databases || [];
      select.innerHTML = '';

      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settingsRes) => {
        const activeId = settingsRes?.settings?.activeDatabaseId || 'default';
        
        dbs.forEach(db => {
          const opt = document.createElement('option');
          opt.value = db.id;
          opt.innerText = `📁 ${db.name}`;
          if (db.id === activeId) {
            opt.selected = true;
            updateDbMetaInfo(db);
          }
          select.appendChild(opt);
        });

        // 更新底部總體統計
        updateFooterStats(dbs, activeId);
      });
    }
  });
}

/**
 * 更新指定資料庫的細部摘要資訊
 */
function updateDbMetaInfo(db) {
  const info = document.getElementById('db-meta-info');
  const lastUpdate = db.updatedAt ? new Date(db.updatedAt).toLocaleDateString('zh-TW') : '無紀錄';
  info.innerHTML = `標記：<span style="color:${db.color};">●</span> | 描述：${db.description || '無描述'} | 異動時間：${lastUpdate}`;
}

/**
 * 更新統計 footer
 */
function updateFooterStats(dbs, activeId) {
  const currentDb = dbs.find(d => d.id === activeId);
  if (currentDb) {
    // 這裡我們需要知道判決書數量，我們可以透過讀取設定或先給予預估
    // 呼叫 Service Worker 讀取判決書數量
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
      // 由於 listJudgments 可能開銷較大，在資料庫管理中存計數是最理想的。
      // 我們這裡可以使用一鍵讀取或計數
      // 為了快速呈現，我們顯示當前啟用資料庫名稱
      document.getElementById('footer-stats').innerText = `目前選定資料庫：${currentDb.name}`;
    });
  }
}

/**
 * 更新 API Key 狀態 UI
 */
function updateApiKeyStatus(isValid) {
  const status = document.getElementById('api-key-status');
  if (isValid) {
    status.innerText = '✅ API Key 已驗證有效';
    status.className = 'status-indicator success';
  } else {
    status.innerText = '⚠️ API Key 未設定或驗證無效';
    status.className = 'status-indicator error';
  }
}

/**
 * 控制同步 UI 區塊的顯示切換
 */
function toggleSyncUI(enabled, dbId) {
  const activeArea = document.getElementById('sync-active-area');
  const inactiveArea = document.getElementById('sync-inactive-area');
  
  if (enabled) {
    activeArea.classList.remove('hidden');
    inactiveArea.classList.add('hidden');
    
    // 載入最後同步時間
    const syncTimeKey = `lastSyncTime_${dbId}`;
    chrome.storage.local.get([syncTimeKey], (res) => {
      const timeStr = res[syncTimeKey] ? new Date(res[syncTimeKey]).toLocaleString('zh-TW') : '從未同步';
      document.getElementById('sync-time-info').innerText = `上次同步時間：${timeStr}`;
    });
  } else {
    activeArea.classList.add('hidden');
    inactiveArea.classList.remove('hidden');
  }
}

/**
 * 綁定所有事件處理器
 */
function setupEventListeners() {
  // 1. 開啟進階設定頁面
  document.getElementById('btn-open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 2. 切換外觀主題
  document.getElementById('btn-theme-toggle').addEventListener('click', () => {
    const isLight = document.body.classList.contains('theme-light');
    const newTheme = isLight ? 'dark' : 'light';
    setTheme(newTheme);
    chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      settings: { theme: newTheme }
    });
  });

  // 新增金鑰輸入框
  document.getElementById('btn-add-popup-key').addEventListener('click', () => {
    addKeyInputRow('popup-api-keys-container', '');
  });

  // 3. 儲存 API Key
  document.getElementById('btn-save-api-key').addEventListener('click', async () => {
    const apiKey = getCollectedApiKeys('popup-api-keys-container');
    
    if (!apiKey) {
      showToast('請輸入密鑰');
      return;
    }

    showToast('正在驗證 API 密鑰...');
    chrome.runtime.sendMessage({ type: 'VALIDATE_API_KEY', apiKey }, (response) => {
      if (response && response.success && response.isValid) {
        chrome.runtime.sendMessage({
          type: 'UPDATE_SETTINGS',
          settings: { geminiApiKey: apiKey }
        }, () => {
          updateApiKeyStatus(true);
          showToast('✅ API 密鑰驗證並儲存成功！');
        });
      } else {
        updateApiKeyStatus(false);
        showToast('❌ 驗證失敗：部分金鑰無效，請確認後再儲存。');
      }
    });
  });

  // 4. 開始 AI 摘要與解析
  document.getElementById('btn-start-analyze').addEventListener('click', () => {
    showToast('已送出分析請求...');
    chrome.runtime.sendMessage({ type: 'TRIGGER_ANALYSIS' }, (res) => {
      if (res && res.success) {
        showToast('開始分析，已顯示懸浮視窗！');
        window.close(); // 關閉 popup 讓使用者看見網頁上的懸浮視窗
      } else {
        showToast(`❌ 觸發失敗：${res?.error || '請確認是否已設定 API Key'}`);
      }
    });
  });

  // 5. 切換當前活動資料庫
  document.getElementById('select-active-db').addEventListener('change', (e) => {
    const dbId = e.target.value;
    chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      settings: { activeDatabaseId: dbId }
    }, () => {
      loadDatabaseSelector();
      // 重新載入對應同步狀態
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settingsRes) => {
        toggleSyncUI(settingsRes.settings.cloudSyncEnabled, dbId);
      });
      showToast('已切換資料庫');
    });
  });

  // 6. 展開/隱藏新增資料庫欄位
  document.getElementById('btn-toggle-add-db').addEventListener('click', () => {
    const form = document.getElementById('add-db-form');
    form.classList.toggle('hidden');
  });

  document.getElementById('btn-cancel-db').addEventListener('click', () => {
    document.getElementById('add-db-form').classList.add('hidden');
  });

  // 選擇新增資料庫色標
  const colorOptions = document.querySelectorAll('.color-option');
  colorOptions.forEach(opt => {
    opt.addEventListener('click', (e) => {
      colorOptions.forEach(o => o.classList.remove('active'));
      e.target.classList.add('active');
      selectedDbColor = e.target.getAttribute('data-color');
    });
  });

  // 儲存建立新資料庫
  document.getElementById('btn-save-db').addEventListener('click', () => {
    const nameInput = document.getElementById('input-db-name');
    const descInput = document.getElementById('input-db-desc');
    const name = nameInput.value.trim();
    const desc = descInput.value.trim();

    if (!name) {
      showToast('請輸入資料庫名稱');
      return;
    }

    chrome.runtime.sendMessage({
      type: 'CREATE_DATABASE',
      name,
      description: desc,
      color: selectedDbColor
    }, (res) => {
      if (res && res.success) {
        showToast(`✅ 資料庫 ${name} 建立成功！`);
        nameInput.value = '';
        descInput.value = '';
        document.getElementById('add-db-form').classList.add('hidden');
        
        // 切換至新建立的庫
        chrome.runtime.sendMessage({
          type: 'UPDATE_SETTINGS',
          settings: { activeDatabaseId: res.database.id }
        }, () => {
          loadDatabaseSelector();
        });
      } else {
        showToast('建立資料庫失敗');
      }
    });
  });

  // 7. 啟用雲端同步
  document.getElementById('btn-activate-sync').addEventListener('click', () => {
    const codeInput = document.getElementById('input-activation-code');
    const code = codeInput.value.trim();

    if (!code) {
      showToast('請輸入同步啟用碼');
      return;
    }

    showToast('正在驗證啟用同步...');
    chrome.runtime.sendMessage({ type: 'ACTIVATE_CLOUD', activationCode: code }, (res) => {
      if (res && res.success) {
        showToast('✅ 雲端同步啟用成功！');
        codeInput.value = '';
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settingsRes) => {
          toggleSyncUI(true, settingsRes.settings.activeDatabaseId);
        });
      } else {
        showToast(`❌ 啟用失敗：${res?.error || '驗證不通過'}`);
      }
    });
  });

  // 8. 立即同步
  document.getElementById('btn-sync-now').addEventListener('click', () => {
    showToast('正在同步雲端資料庫...');
    chrome.runtime.sendMessage({ type: 'SYNC_TO_CLOUD' }, (res) => {
      if (res && res.success) {
        showToast(`✅ 同步完成！上傳 ${res.pushed} 筆，下載 ${res.pulled} 筆。`);
        // 重新整理 UI
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settingsRes) => {
          toggleSyncUI(true, settingsRes.settings.activeDatabaseId);
        });
      } else {
        showToast(`❌ 同步失敗：${res?.error || '網路異常'}`);
      }
    });
  });

  // 9. 離線 ZIP 匯出
  document.getElementById('btn-export-zip').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settingsRes) => {
      const dbId = settingsRes.settings.activeDatabaseId;
      showToast('正在產生壓縮備份檔 (包含向量嵌入)...');
      
      chrome.runtime.sendMessage({ type: 'EXPORT_ZIP', dbId, includeRawText: true }, (res) => {
        if (res && res.success && res.zipData) {
          downloadBase64Zip(res.zipData, `judgment-db-${dbId}-${new Date().toISOString().slice(0, 10)}.zip`);
          showToast('✅ 備份檔匯出成功！');
        } else {
          showToast('❌ 匯出備份失敗');
        }
      });
    });
  });

  // 10. 離線 ZIP 匯入
  const fileInput = document.getElementById('file-import-input');
  document.getElementById('btn-import-zip').addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    showToast('正在解析備份壓縮包...');
    const reader = new FileReader();
    reader.onload = function(evt) {
      const arrayBuffer = evt.target.result;
      const base64Str = arrayBufferToBase64(arrayBuffer);

      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settingsRes) => {
        const dbId = settingsRes.settings.activeDatabaseId;
        
        chrome.runtime.sendMessage({ type: 'IMPORT_ZIP', dbId, zipData: base64Str }, (importRes) => {
          // 清空 file input 防止重複觸發
          fileInput.value = '';
          
          if (importRes && importRes.success) {
            const sum = importRes.summary;
            showToast(`✅ 匯入成功！寫入 ${sum.totalImported} 筆，覆蓋 ${sum.overwritten} 筆，跳過 ${sum.skipped} 筆。`);
            loadDatabaseSelector();
          } else {
            showToast(`❌ 匯入失敗：${importRes?.error || '壓縮格式不符'}`);
          }
        });
      });
    };
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 輔助函數：轉換 ArrayBuffer 為 Base64
 */
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * 輔助函數：觸發瀏覽器下載 Base64 ZIP
 */
function downloadBase64Zip(base64Data, filename) {
  const linkSource = `data:application/zip;base64,${base64Data}`;
  const downloadLink = document.createElement('a');
  downloadLink.href = linkSource;
  downloadLink.download = filename;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}

/**
 * 顯示 Toast 訊息
 */
function showToast(msg, duration = 3000) {
  const toast = document.getElementById('toast-popup');
  toast.innerText = msg;
  toast.classList.add('show');
  
  if (window.toastTimer) clearTimeout(window.toastTimer);
  
  window.toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

/* ===================================================================
   多金鑰動態 UI 輔助函數
   =================================================================== */
function renderApiKeys(containerId, keysString) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  
  const keys = keysString ? keysString.split(/[\s,;\n]+/).map(k => k.trim()).filter(Boolean) : [];
  
  if (keys.length === 0) {
    addKeyInputRow(containerId, '');
  } else {
    keys.forEach(key => {
      addKeyInputRow(containerId, key);
    });
  }
}

function addKeyInputRow(containerId, value = '') {
  const container = document.getElementById(containerId);
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'key-input-row';
  
  const input = document.createElement('input');
  input.type = 'password';
  input.className = 'popup-key-input';
  input.placeholder = '輸入 Gemini API Key...';
  input.value = value;
  
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn-delete-key';
  deleteBtn.innerText = '🗑️';
  deleteBtn.title = '刪除此金鑰';
  deleteBtn.addEventListener('click', () => {
    const rows = container.querySelectorAll('.key-input-row');
    if (rows.length === 1) {
      input.value = '';
    } else {
      row.remove();
    }
  });
  
  row.appendChild(input);
  row.appendChild(deleteBtn);
  container.appendChild(row);
}

function getCollectedApiKeys(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return '';
  const inputs = container.querySelectorAll('.popup-key-input');
  const keys = Array.from(inputs).map(inp => inp.value.trim()).filter(Boolean);
  return keys.join(',');
}
