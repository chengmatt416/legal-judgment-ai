/**
 * 法律判決 AI 摘要助手 — 控制台控制器 (ES Module)
 */

import { 
  getSettings, 
  saveSettings, 
  listDatabases, 
  listJudgments, 
  deleteJudgment,
  getDatabaseMeta 
} from '../database/database-manager.js';
import { listAllTags } from '../database/tag-manager.js';

// 全域快取資料
let currentSettings = {};
let allJudgmentsList = []; // 用於在文庫中快取當前載入的判決清單
let selectedReport = null; // 當前在 Modal 中查看的判決書

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 初始化導覽頁籤切換
  initTabNavigation();

  // 2. 載入基本設定
  await loadSettingsForm();

  // 3. 初始化文庫管理 (預設顯示分頁)
  await initLibraryTab();

  // 4. 綁定事件監聽
  setupEventListeners();
});

/* ===================================================================
   導覽與頁籤切換
   =================================================================== */
function initTabNavigation() {
  const menuItems = document.querySelectorAll('.menu-item');
  const panes = document.querySelectorAll('.tab-pane');

  menuItems.forEach(item => {
    item.addEventListener('click', () => {
      menuItems.forEach(i => i.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      item.classList.add('active');
      const tabName = item.getAttribute('data-tab');
      document.getElementById(`tab-${tabName}`).classList.add('active');

      // 切換分頁時進行特定資料重載
      if (tabName === 'library') {
        loadLibraryDatabaseSelector();
      } else if (tabName === 'stats') {
        loadStatsTab();
      } else if (tabName === 'settings') {
        loadSettingsForm();
      } else if (tabName === 'ai-search') {
        loadAISearchTab();
      }
    });
  });
}

/* ===================================================================
   系統進階設定 Tab
   =================================================================== */
async function loadSettingsForm() {
  currentSettings = await getSettings();

  const keysString = currentSettings.geminiApiKey || '';
  renderApiKeys('options-api-keys-container', keysString);
  
  // 檢查金鑰數量並決定是否顯示警告橫幅
  const keys = keysString.split(/[\s,;\n]+/).map(k => k.trim()).filter(Boolean);
  const hintAlert = document.getElementById('options-key-hint-alert');
  if (hintAlert) {
    if (keys.length > 0 && keys.length < 3) {
      hintAlert.style.display = 'block';
    } else {
      hintAlert.style.display = 'none';
    }
  }

  document.getElementById('opt-model').value = currentSettings.geminiModel || 'gemini-3.5-flash';
  
  // 懸浮視窗偏好
  const size = currentSettings.panelSize || { width: 520, height: 600 };
  document.getElementById('opt-panel-width').value = size.width;
  document.getElementById('opt-panel-height').value = size.height;

  // 雲端同步
  document.getElementById('opt-worker-url').value = currentSettings.cloudWorkerUrl || '';
  document.getElementById('opt-auto-sync').checked = !!currentSettings.autoSyncEnabled;
}

async function saveSettingsForm() {
  const apiKey = getCollectedApiKeys('options-api-keys-container');
  const model = document.getElementById('opt-model').value;
  const width = parseInt(document.getElementById('opt-panel-width').value, 10) || 520;
  const height = parseInt(document.getElementById('opt-panel-height').value, 10) || 600;
  const workerUrl = document.getElementById('opt-worker-url').value.trim();
  const autoSync = document.getElementById('opt-auto-sync').checked;

  const newSettings = {
    geminiApiKey: apiKey,
    geminiModel: model,
    panelSize: { width, height },
    cloudWorkerUrl: workerUrl,
    autoSyncEnabled: autoSync
  };

  if (apiKey) {
    showToast('正在驗證 API 密鑰...');
    chrome.runtime.sendMessage({ type: 'VALIDATE_API_KEY', apiKey }, async (response) => {
      if (response && response.success && response.isValid) {
        try {
          await saveSettings(newSettings);
          
          const keys = apiKey.split(/[\s,;\n]+/).map(k => k.trim()).filter(Boolean);
          const hintAlert = document.getElementById('options-key-hint-alert');
          if (hintAlert) {
            if (keys.length > 0 && keys.length < 3) {
              hintAlert.style.display = 'block';
            } else {
              hintAlert.style.display = 'none';
            }
          }

          if (keys.length < 3) {
            showToast('✅ 設定已儲存！建議設定至少 3 組金鑰以防 RPD/RPM 限制。');
          } else {
            showToast('✅ 設定已驗證並儲存成功！');
          }
        } catch (err) {
          showToast(`❌ 儲存失敗: ${err.message}`);
        }
      } else {
        showToast('❌ 驗證失敗：部分金鑰無效，請確認後再儲存。');
      }
    });
  } else {
    try {
      await saveSettings(newSettings);
      showToast('✅ 設定已成功儲存！');
    } catch (err) {
      showToast(`❌ 儲存失敗: ${err.message}`);
    }
  }
}

/**
 * 重置整個系統 (IndexedDB 全清空)
 */
async function resetAllData() {
  const confirmed = confirm('⚠️ 警告！此操作將會刪除所有本地資料庫、已分析之判決書與 AI 摘要報告。\n確定要繼續嗎？');
  if (!confirmed) return;

  const doubleConfirmed = confirm('請再次確認：您即將永久刪除全部資料！');
  if (!doubleConfirmed) return;

  showToast('正在清除資料與設定...');

  // 1. 取得所有資料庫
  const dbs = await listDatabases();
  
  // 2. 依序刪除 IndexedDB 資料庫
  for (const dbMeta of dbs) {
    const dbName = `_legal_ai_db_${dbMeta.id}`;
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve(); // 忽略錯誤
    });
  }

  // 3. 刪除 meta 資料庫
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('_legal_ai_meta');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });

  // 4. 清除 storage 內容
  chrome.storage.local.clear(() => {
    showToast('🔥 系統已完全重置，即將重新載入頁面...');
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  });
}

/* ===================================================================
   判決文庫管理 Tab
   =================================================================== */
async function initLibraryTab() {
  await loadLibraryDatabaseSelector();
}

/**
 * 載入文庫中資料庫切換下拉選單
 */
async function loadLibraryDatabaseSelector() {
  const select = document.getElementById('lib-select-db');
  const dbs = await listDatabases();
  select.innerHTML = '';

  const activeId = await getActiveDatabaseIdFromSettings();

  dbs.forEach(db => {
    const opt = document.createElement('option');
    opt.value = db.id;
    opt.innerText = `📁 ${db.name}`;
    if (db.id === activeId) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });

  // 載入所選資料庫的判決書清單
  await loadJudgmentsTable(activeId);
}

async function getActiveDatabaseIdFromSettings() {
  const settings = await getSettings();
  return settings.activeDatabaseId || 'default';
}

/**
 * 載入並渲染判決書表格內容
 */
async function loadJudgmentsTable(dbId) {
  const tbody = document.getElementById('judgment-table-body');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-state">正在讀取判決書清單...</td></tr>';

  try {
    // 讀取全部判決書 (不含 rawText 以加快速度)
    allJudgmentsList = await listJudgments(dbId, false);

    renderJudgments(allJudgmentsList);
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:var(--color-danger)">載入出錯：${err.message}</td></tr>`;
  }
}

/**
 * 渲染判決清單列
 */
function renderJudgments(list) {
  const tbody = document.getElementById('judgment-table-body');
  tbody.innerHTML = '';

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">📂 此資料庫內目前沒有任何已分析的判決書摘要。</td></tr>';
    return;
  }

  list.forEach(j => {
    const tr = document.createElement('tr');
    tr.setAttribute('data-id', j.id);
    
    // 類別標記樣式
    let typeClass = 'badge-default';
    if (j.caseType === '刑事') typeClass = 'badge-danger';
    else if (j.caseType === '民事') typeClass = 'badge-success';

    tr.innerHTML = `
      <td style="font-weight:600; color:var(--gold-primary);">${j.caseNumber}</td>
      <td>${j.court}</td>
      <td><span class="badge ${typeClass}">${j.caseType}</span></td>
      <td>${j.cause || '無'}</td>
      <td>${j.date || '未知'}</td>
      <td>${new Date(j.analyzedAt).toLocaleDateString('zh-TW')}</td>
      <td style="text-align:center;">
        <button class="btn-icon-danger btn-delete-judgment" data-id="${j.id}" title="刪除判決與摘要">🗑️</button>
      </td>
    `;

    // 點選該列開啟詳細報告
    tr.addEventListener('click', (e) => {
      // 如果點選的是刪除按鈕，則不觸發彈出
      if (e.target.classList.contains('btn-delete-judgment')) return;
      openReportModal(j.id);
    });

    tbody.appendChild(tr);
  });

  // 綁定刪除按鈕事件
  tbody.querySelectorAll('.btn-delete-judgment').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const tr = btn.closest('tr');
      const caseNumber = tr.querySelector('td').innerText;
      
      const confirmed = confirm(`確定要刪除「${caseNumber}」的摘要及向量索引嗎？`);
      if (confirmed) {
        const dbId = document.getElementById('lib-select-db').value;
        await deleteJudgment(dbId, id);
        showToast(`已刪除判決摘要：${caseNumber}`);
        loadLibraryDatabaseSelector();
      }
    });
  });
}

/**
 * 本地端檢索過濾 (搜尋框與案件類別)
 */
function filterLibraryJudgments() {
  const query = document.getElementById('lib-search-input').value.trim().toLowerCase();
  const typeFilter = document.getElementById('lib-filter-type').value;

  const filtered = allJudgmentsList.filter(j => {
    // 1. 案件類別篩選
    if (typeFilter !== 'all' && j.caseType !== typeFilter) {
      return false;
    }

    // 2. 關鍵字搜尋 (包含案號、法院、案由、AI 摘要等欄位)
    if (!query) return true;
    
    const summaryObj = typeof j.summaryJson === 'string' ? JSON.parse(j.summaryJson) : j.summaryJson;
    const summaryText = summaryObj?.summary || '';
    const conclusion = summaryObj?.conclusion || '';

    return (
      (j.caseNumber || '').toLowerCase().includes(query) ||
      (j.court || '').toLowerCase().includes(query) ||
      (j.cause || '').toLowerCase().includes(query) ||
      summaryText.toLowerCase().includes(query) ||
      conclusion.toLowerCase().includes(query)
    );
  });

  renderJudgments(filtered);
}

/* ===================================================================
   判決摘要詳細視窗 Modal
   =================================================================== */
async function openReportModal(judgmentId) {
  const dbId = document.getElementById('lib-select-db').value;
  
  // 開啟詳細載入 (需要讀取全文 rawText 以防複寫匯出)
  const judgment = await getJudgmentById(dbId, judgmentId);
  if (!judgment) return;

  selectedReport = judgment;
  
  const modal = document.getElementById('report-modal');
  const title = document.getElementById('modal-report-title');
  const content = document.getElementById('modal-report-content');

  title.innerText = `⚖️ 判決分析報告：${judgment.caseNumber}`;
  
  const summary = typeof judgment.summaryJson === 'string' ? JSON.parse(judgment.summaryJson) : judgment.summaryJson;

  // 組合 HTML 結構在 Modal 中呈現
  content.innerHTML = `
    <!-- 基本資訊卡片 -->
    <div style="background:var(--bg-input); padding: 16px; border-radius: 8px; margin-bottom: 20px; font-size: 13.5px; border: 1px solid var(--border-color);">
      <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
        <div><strong>案號：</strong>${judgment.caseNumber}</div>
        <div><strong>法院：</strong>${judgment.court}</div>
        <div><strong>裁判日期：</strong>${judgment.date}</div>
        <div><strong>類別案由：</strong>${judgment.caseType} / ${judgment.cause}</div>
      </div>
      
      <!-- 標籤列 -->
      <div style="margin-top: 12px; display:flex; flex-wrap:wrap; gap:6px;">
        ${(judgment.tags || []).map(t => {
          return `<span style="padding:2px 8px; font-size:11px; border-radius:12px; border:1px solid ${t.color || '#e2e8f0'}; color:${t.color || 'var(--text-main)'}; background:${t.color}0a;">${t.name}</span>`;
        }).join('') || '<span style="color:var(--text-muted)">無標籤</span>'}
      </div>
    </div>

    <!-- AI 摘要內容 -->
    <h3>一、案件事實摘要</h3>
    <p style="white-space: pre-line;">${summary.summary}</p>

    <h3>二、判決結論 / 主文重點</h3>
    <p style="white-space: pre-line; border-left:3px solid var(--color-success); padding-left:12px; background:rgba(16,185,129,0.03); padding:10px 12px; border-radius:0 6px 6px 0;">${summary.conclusion}</p>

    <h3>三、引用與適用法條</h3>
    <div style="margin-top:10px;">
      ${(summary.appliedLaws || []).map(law => `<span style="display:inline-block; padding:2px 8px; margin-right:6px; margin-bottom:6px; background:rgba(156,163,175,0.15); border-radius:4px; font-size:12px; font-family:var(--font-serif);">${law}</span>`).join('') || '無引用法條'}
    </div>

    <h3>四、法學爭點解析</h3>
    <div style="margin-top:12px; display:flex; flex-direction:column; gap:14px;">
      ${(summary.legalIssues || []).map((issue, idx) => `
        <div style="border:1px solid var(--border-color); border-radius:8px; overflow:hidden;">
          <div style="background:var(--bg-input); padding: 10px 14px; font-weight:600; border-bottom:1px solid var(--border-color); font-size:13.5px; color:var(--gold-primary);">
            爭點 ${idx + 1}：${issue.title}
          </div>
          <div style="padding:14px; font-size:13px; line-height:1.6;">
            <div style="margin-bottom:8px;"><strong>📌 說明：</strong>${issue.description}</div>
            ${issue.legalBasis && issue.legalBasis.length > 0 ? `<div style="margin-bottom:8px;"><strong>📖 法律依據：</strong>${issue.legalBasis.join('、')}</div>` : ''}
            
            ${issue.arguments ? `
              <div style="background:rgba(156,163,175,0.06); padding: 10px; border-radius:6px; margin-top:8px;">
                ${issue.arguments.prosecution ? `<div style="margin-bottom:4px;"><strong>原告 / 檢察官：</strong>${issue.arguments.prosecution}</div>` : ''}
                ${issue.arguments.defense ? `<div style="margin-bottom:4px;"><strong>被告 / 辯護人：</strong>${issue.arguments.defense}</div>` : ''}
                ${issue.arguments.courtOpinion ? `<div style="border-left:3px solid var(--gold-primary); padding-left:10px; margin-top:8px; font-family:var(--font-serif); background:rgba(201,163,92,0.03); padding:6px 10px;"><strong>法院判定理據：</strong><br/>${issue.arguments.courtOpinion}</div>` : ''}
              </div>
            ` : ''}

            ${issue.relatedCases && issue.relatedCases.length > 0 ? `<div style="margin-top:8px; color:var(--text-muted);"><strong>關聯判例：</strong>${issue.relatedCases.join('、')}</div>` : ''}
          </div>
        </div>
      `).join('') || '無爭點分析'}
    </div>
  `;

  modal.classList.remove('hidden');
}

function closeReportModal() {
  document.getElementById('report-modal').classList.add('hidden');
  selectedReport = null;
}

/**
 * Modal 複製文字報告
 */
function copyModalReport() {
  if (!selectedReport) return;
  const summary = typeof selectedReport.summaryJson === 'string' ? JSON.parse(selectedReport.summaryJson) : selectedReport.summaryJson;
  
  let text = `【法律判決 AI 摘要分析報告】\n`;
  text += `案號：${selectedReport.caseNumber}\n`;
  text += `法院：${selectedReport.court}\n`;
  text += `裁判日期：${selectedReport.date}\n`;
  text += `類別與案由：${selectedReport.caseType} — ${selectedReport.cause}\n\n`;
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

  navigator.clipboard.writeText(text).then(() => {
    showToast('✅ 報告已成功複製！');
  }).catch(() => {
    showToast('❌ 複製失敗');
  });
}

/**
 * Modal 匯出 HTML 報告
 */
function exportModalReport() {
  if (!selectedReport) return;
  const summary = typeof selectedReport.summaryJson === 'string' ? JSON.parse(selectedReport.summaryJson) : selectedReport.summaryJson;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>判決書摘要_${selectedReport.caseNumber}</title>
  <style>
    body { font-family: sans-serif; line-height: 1.7; color: #334155; max-width: 800px; margin: 40px auto; padding: 0 20px; background: #f8fafc; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 30px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    h1 { color: #1e3a8a; font-size: 24px; border-bottom: 2px solid #C9A35C; padding-bottom: 12px; margin-bottom: 20px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: #f1f5f9; padding: 15px; border-radius: 8px; font-size: 14px; margin-bottom: 25px; }
    h2 { color: #C9A35C; font-size: 18px; border-left: 4px solid #C9A35C; padding-left: 10px; margin-top: 30px; }
    .box { background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; white-space: pre-line; }
    .issue-card { border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 15px; }
    .issue-header { background: #f1f5f9; padding: 10px 15px; font-weight: 600; }
    .issue-body { padding: 15px; font-size: 13.5px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚖️ 法律判決 AI 摘要分析報告</h1>
    <div class="grid">
      <div><strong>案號：</strong>${selectedReport.caseNumber}</div>
      <div><strong>法院：</strong>${selectedReport.court}</div>
      <div><strong>日期：</strong>${selectedReport.date}</div>
      <div><strong>案由：</strong>${selectedReport.caseType} / ${selectedReport.cause}</div>
    </div>
    <h2>一、案件事實摘要</h2>
    <div class="box">${summary.summary}</div>
    <h2>二、判決結論 / 主文重點</h2>
    <div class="box" style="border-left: 4px solid #10B981;">${summary.conclusion}</div>
    <h2>三、引用與適用法條</h2>
    <div style="margin-top:10px;">${(summary.appliedLaws || []).join('、') || '無'}</div>
    <h2>四、法學爭點解析</h2>
    <div style="margin-top:15px;">
      ${(summary.legalIssues || []).map((issue, idx) => `
        <div class="issue-card">
          <div class="issue-header">爭點 ${idx + 1}：${issue.title}</div>
          <div class="issue-body">
            <div><strong>說明：</strong>${issue.description}</div>
            ${issue.arguments?.courtOpinion ? `<div style="border-left:3px solid #C9A35C; padding-left:10px; background:rgba(201,163,92,0.03); padding:8px 10px; margin-top:10px;"><strong>法院判定理由：</strong><br/>${issue.arguments.courtOpinion}</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  </div>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `判決摘要報告_${selectedReport.caseNumber}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ===================================================================
   數據統計中心 Tab
   =================================================================== */
async function loadStatsTab() {
  const dbId = await getActiveDatabaseIdFromSettings();
  
  // 1. 載入判決書清單做基本加總
  const judgments = await listJudgments(dbId, false);
  document.getElementById('stat-total-judgments').innerText = judgments.length;

  // 2. 載入標籤統計
  const tags = await listAllTags(dbId);
  document.getElementById('stat-total-tags').innerText = tags.length;

  // 3. 載入 Embedding 每日配額 (從 storage 中讀取)
  chrome.storage.local.get(['embeddingQuotaDate', 'embeddingQuotaCount'], (res) => {
    const today = new Date().toISOString().slice(0, 10);
    const count = res.embeddingQuotaDate === today ? (res.embeddingQuotaCount || 0) : 0;
    document.getElementById('stat-quota-used').innerText = `${count} / 1400`;
  });

  // 4. 渲染常用標籤排行榜
  const tagListUl = document.getElementById('stats-tags-list');
  tagListUl.innerHTML = '';
  
  if (tags.length === 0) {
    tagListUl.innerHTML = '<li style="color:var(--text-muted); font-size:13px; text-align:center; padding-top:40px;">目前尚無標籤，分析判決書時會自動建立。</li>';
  } else {
    tags.slice(0, 8).forEach(t => {
      const li = document.createElement('li');
      li.className = 'stats-list-item';
      li.innerHTML = `
        <span>🏷️ <strong>${t.name}</strong> <span style="font-size:11px; color:var(--text-muted);">(${t.category})</span></span>
        <span class="badge" style="background:${t.color}1e; color:${t.color}">${t.usageCount} 次</span>
      `;
      tagListUl.appendChild(li);
    });
  }

  // 5. 渲染資料庫清單分佈
  const dbListUl = document.getElementById('stats-db-list');
  dbListUl.innerHTML = '';
  
  const dbs = await listDatabases();
  for (const dbMeta of dbs) {
    // 讀取該庫判決書數
    const dbJList = await listJudgments(dbMeta.id, false);
    
    const li = document.createElement('li');
    li.className = 'stats-list-item';
    li.innerHTML = `
      <span>📁 <strong>${dbMeta.name}</strong></span>
      <span class="badge" style="background:${dbMeta.color}1e; color:${dbMeta.color}">${dbJList.length} 篇</span>
    `;
    dbListUl.appendChild(li);
  }
}

/* ===================================================================
   事件綁定與 UI 反饋
   =================================================================== */
function setupEventListeners() {
  // 1. 系統設定
  document.getElementById('btn-save-settings').addEventListener('click', saveSettingsForm);
  document.getElementById('btn-reset-all').addEventListener('click', resetAllData);
  document.getElementById('btn-add-options-key').addEventListener('click', () => {
    addKeyInputRow('options-api-keys-container', '');
  });

  // 2. 文庫過濾
  document.getElementById('lib-select-db').addEventListener('change', (e) => {
    const dbId = e.target.value;
    loadJudgmentsTable(dbId);
    
    // 同步寫入設定，確保 popup 也同步切換
    saveSettings({ activeDatabaseId: dbId });
  });

  document.getElementById('lib-search-input').addEventListener('input', filterLibraryJudgments);
  document.getElementById('lib-filter-type').addEventListener('change', filterLibraryJudgments);

  // 3. Modal 視窗關閉
  document.getElementById('btn-close-modal').addEventListener('click', closeReportModal);
  document.getElementById('report-modal').addEventListener('click', (e) => {
    if (e.target.id === 'report-modal') closeReportModal();
  });

  // Modal 報告控制
  document.getElementById('modal-btn-copy').addEventListener('click', copyModalReport);
  document.getElementById('modal-btn-export').addEventListener('click', exportModalReport);
}

/**
 * 顯示 Toast 氣泡提示
 */
/**
 * 顯示 Toast 氣泡提示
 */
function showToast(msg, duration = 3000) {
  const toast = document.getElementById('opt-toast');
  if (toast) {
    toast.innerText = msg;
    toast.classList.add('show');
    if (window.toastTimer) clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }
}

/* ===================================================================
   AI 智慧查詢 Tab
   =================================================================== */
let activeSearchMode = 'concept';

function loadAISearchTab() {
  // 綁定四大模式選卡點擊事件
  const modeCards = document.querySelectorAll('.mode-card');
  modeCards.forEach(card => {
    // 移除舊的 event listener 以免重複綁定
    const newCard = card.cloneNode(true);
    card.parentNode.replaceChild(newCard, card);
    
    newCard.addEventListener('click', () => {
      document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('active'));
      newCard.classList.add('active');
      const mode = newCard.getAttribute('data-mode');
      switchSearchMode(mode);
    });
  });

  // 預設切換至 concept
  switchSearchMode('concept');
  
  // 監聽來自 background 的搜尋進度與最終結果推送
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'AI_SEARCH_PROGRESS') {
      updateSearchProgress(message.progress);
    } else if (message.type === 'AI_SEARCH_RESULT') {
      const promptInput = document.getElementById('ai-search-prompt');
      const runBtn = document.getElementById('btn-run-ai-search');
      if (promptInput) promptInput.disabled = false;
      if (runBtn) runBtn.disabled = false;

      const statusTitle = document.getElementById('progress-status-title');
      if (statusTitle) statusTitle.innerText = '分析完成！';
      
      const spinner = document.querySelector('.progress-spinner');
      if (spinner) spinner.style.display = 'none';

      renderAISearchResult(message.data);
    } else if (message.type === 'AI_SEARCH_ERROR') {
      const promptInput = document.getElementById('ai-search-prompt');
      const runBtn = document.getElementById('btn-run-ai-search');
      if (promptInput) promptInput.disabled = false;
      if (runBtn) runBtn.disabled = false;

      const statusTitle = document.getElementById('progress-status-title');
      if (statusTitle) statusTitle.innerText = '搜尋發生錯誤';
      
      const spinner = document.querySelector('.progress-spinner');
      if (spinner) spinner.style.display = 'none';

      showToast('⚠️ 智慧搜尋失敗：' + (message.error || '未知錯誤'));
    }
  });
}

function switchSearchMode(mode) {
  activeSearchMode = mode;
  const container = document.getElementById('search-mode-container');
  
  // 隱藏進度與結果
  document.getElementById('search-progress-area').classList.add('hidden');
  document.getElementById('ai-result-area').classList.add('hidden');
  
  if (mode === 'calculator') {
    container.innerHTML = `
      <div class="calculator-form">
        <h3 style="color:var(--gold-primary); margin:0 0 10px 0; font-size:14px;">⚖️ 裁判費依法計算機</h3>
        <div class="form-row-group">
          <div class="search-form-group">
            <label>案件審級</label>
            <div class="radio-group">
              <label class="radio-option"><input type="radio" name="calc-level" value="first" checked> 第一審</label>
              <label class="radio-option"><input type="radio" name="calc-level" value="second"> 第二審（上訴）</label>
              <label class="radio-option"><input type="radio" name="calc-level" value="third"> 第三審（上訴）</label>
            </div>
          </div>
          <div class="search-form-group">
            <label>訴訟性質</label>
            <div class="radio-group">
              <label class="radio-option"><input type="radio" name="calc-type" value="property" checked> 財產權訴訟</label>
              <label class="radio-option"><input type="radio" name="calc-type" value="non-property"> 非財產權訴訟</label>
            </div>
          </div>
        </div>
        
        <div class="search-form-group" id="calc-amount-group">
          <label for="calc-amount">訴訟標的金額或價額 (新台幣元)</label>
          <input type="text" id="calc-amount" placeholder="例如：1500000" style="padding:10px; font-size:13px;">
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
          <span style="font-size:11.5px; color:var(--text-muted);">* 畸零之數不滿萬元者，以萬元計算。</span>
          <button class="btn-primary" id="btn-run-calc">🧮 依法計算</button>
        </div>

        <div id="calculator-result-container" class="hidden"></div>
      </div>
    `;

    // 綁定訴訟性質單選鈕切換事件，非財產權時隱藏金額輸入框
    const calcTypes = container.querySelectorAll('input[name="calc-type"]');
    calcTypes.forEach(radio => {
      radio.addEventListener('change', (e) => {
        const amountGroup = document.getElementById('calc-amount-group');
        if (e.target.value === 'non-property') {
          amountGroup.classList.add('hidden');
        } else {
          amountGroup.classList.remove('hidden');
        }
      });
    });

    // 綁定計算按鈕事件
    document.getElementById('btn-run-calc').addEventListener('click', handleCourtFeeCalc);

  } else {
    // 觀念查詢、相似案件、預估刑度/賠償的表單
    let labelText = '';
    let placeholderText = '';
    
    if (mode === 'concept') {
      labelText = '📝 請輸入您想了解或查詢的法律觀念或法理';
      placeholderText = '例如：輸入「善意取得」查詢動產或不動產之善意信賴保護要件...';
    } else if (mode === 'similar') {
      labelText = '📝 請輸入具體案情敘述，AI 將尋找情節相仿之歷審判決';
      placeholderText = '例如：輸入「被告在夜間潛入被害人住處，竊取現金三萬元，被警網巡邏人贓俱獲」...';
    } else if (mode === 'estimate') {
      labelText = '📝 請描述案情事實，AI 將統計歷審量刑刑度與損害賠償金額區間';
      placeholderText = '例如：輸入「車禍損害賠償，被害人左腿骨折住院十天，請求精神慰撫金與醫療費」...';
    }

    container.innerHTML = `
      <div class="search-form-group">
        <label for="ai-search-prompt">${labelText}</label>
        <textarea id="ai-search-prompt" class="search-textarea" placeholder="${placeholderText}"></textarea>
      </div>
      <div class="search-form-actions">
        <button class="btn-primary" id="btn-run-ai-search" style="padding:10px 24px; font-size:13.5px;">
          ✨ 開始多輪 AI 檢索與分析
        </button>
      </div>
    `;

    document.getElementById('btn-run-ai-search').addEventListener('click', handleAISearch);
  }
}

/**
 * 處理裁判費計算邏輯
 */
function handleCourtFeeCalc() {
  const container = document.getElementById('calculator-result-container');
  const level = document.querySelector('input[name="calc-level"]:checked').value;
  const type = document.querySelector('input[name="calc-type"]:checked').value;
  const amountInput = document.getElementById('calc-amount');
  
  let amount = 0;
  if (type === 'property') {
    amount = parseFloat(amountInput.value.replace(/,/g, ''));
    if (isNaN(amount) || amount <= 0) {
      showToast('⚠️ 請輸入有效的起訴標的金額');
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
      let levelTitle = '第一審';
      if (level === 'second') {
        finalFee = response.secondInstance;
        levelTitle = '第二審（上訴）';
      } else if (level === 'third') {
        finalFee = response.thirdInstance;
        levelTitle = '第三審（上訴）';
      }

      let breakdownHtml = '';
      if (response.breakdown && response.breakdown.length > 0) {
        breakdownHtml = `
          <div class="fee-breakdown">
            <div class="fee-breakdown-title">第一審計算明細：</div>
            <div class="fee-breakdown-list">
              ${response.breakdown.map(b => `
                <div class="fee-breakdown-item">
                  <span>${b.range} (${b.calculation})</span>
                  <span>NT$ ${Math.round(b.fee).toLocaleString()} 元</span>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      container.innerHTML = `
        <div class="calculator-result">
          <h4>🧮 計算結果 (${levelTitle})</h4>
          <div class="fee-highlight">NT$ ${finalFee.toLocaleString()} 元</div>
          <div class="fee-law-basis"><strong>依據：</strong>${response.lawBasis}</div>
          ${breakdownHtml}
        </div>
      `;
    } else {
      showToast('⚠️ 計算失敗：' + (response?.error || '未知錯誤'));
    }
  });
}

/**
 * 執行多輪 AI 智慧搜尋
 */
function handleAISearch() {
  const promptInput = document.getElementById('ai-search-prompt');
  const prompt = promptInput.value.trim();
  if (!prompt) {
    showToast('⚠️ 請輸入要查詢的內容');
    return;
  }

  // 準備 UI
  const progressArea = document.getElementById('search-progress-area');
  const progressSteps = document.getElementById('progress-timeline-steps');
  const statusTitle = document.getElementById('progress-status-title');
  const resultArea = document.getElementById('ai-result-area');

  progressArea.classList.remove('hidden');
  resultArea.classList.add('hidden');
  progressSteps.innerHTML = '';
  statusTitle.innerText = '正在初始化搜尋策略...';

  // 禁用輸入與按鈕
  promptInput.disabled = true;
  document.getElementById('btn-run-ai-search').disabled = true;

  // 啟動搜尋（service worker 會透過 chrome.runtime.sendMessage 廣播結果給所有擴充功能 context）
  chrome.runtime.sendMessage({
    type: 'AI_SEARCH_QUERY',
    mode: activeSearchMode,
    prompt: prompt
  }, (response) => {
    // 若啟動失敗（例如未設定 API Key），立即在此處理
    // 成功啟動後，最終結果將由 AI_SEARCH_RESULT / AI_SEARCH_ERROR 事件在 loadAISearchTab 的監聽器中處理
    if (!response || !response.success) {
      promptInput.disabled = false;
      document.getElementById('btn-run-ai-search').disabled = false;
      statusTitle.innerText = '啟動搜尋失敗';
      document.querySelector('.progress-spinner').style.display = 'none';
      showToast('⚠️ 智慧搜尋啟動失敗：' + (response?.error || '未知錯誤'));
    }
    // 若 response.status === 'started'，等待 AI_SEARCH_RESULT / AI_SEARCH_ERROR 非同步推送
  });
}

/**
 * 更新多輪搜尋進度畫面
 */
function updateSearchProgress(progress) {
  const progressSteps = document.getElementById('progress-timeline-steps');
  const statusTitle = document.getElementById('progress-status-title');
  
  if (!progressSteps) return;

  // 更新大標題
  statusTitle.innerText = progress.message;

  // 建立或更新進度步驟
  const stepId = `step-${progress.status}`;
  let stepEl = document.getElementById(stepId);
  
  // 移除所有步驟的 active class
  document.querySelectorAll('.progress-step').forEach(el => el.classList.remove('active'));

  if (!stepEl) {
    stepEl = document.createElement('div');
    stepEl.id = stepId;
    stepEl.className = 'progress-step active';
    progressSteps.appendChild(stepEl);
  } else {
    stepEl.className = 'progress-step active';
  }

  stepEl.innerHTML = `<strong>${progress.message}</strong>`;

  // 如果是完成狀態
  if (progress.status === 'completed') {
    document.querySelectorAll('.progress-step').forEach(el => {
      el.classList.remove('active');
      el.classList.add('done');
    });
  }
}

/**
 * 渲染 AI 智慧搜尋結果
 */
function renderAISearchResult(data) {
  const resultArea = document.getElementById('ai-result-area');
  const answerContent = document.getElementById('ai-answer-content');
  const citationsGrid = document.getElementById('citations-list-grid');

  resultArea.classList.remove('hidden');
  
  // 渲染回答 (簡易 Markdown 轉換)
  answerContent.innerHTML = formatMarkdown(data.answer);

  // 複製回答按鈕
  document.getElementById('btn-copy-ai-answer').onclick = () => {
    navigator.clipboard.writeText(data.answer).then(() => {
      showToast('✅ 已複製 AI 回答內容');
    });
  };

  // 渲染引用來源
  citationsGrid.innerHTML = '';
  if (data.citations && data.citations.length > 0) {
    data.citations.forEach((citation, idx) => {
      const card = document.createElement('div');
      card.className = 'citation-card';
      
      const numLabel = `[${idx}]`;
      const url = citation.url || '#';
      const court = citation.court || '未知法院';
      const caseNumber = citation.caseNumber || '未知案號';
      const relevance = citation.relevance || '本案之裁判法理依據。';

      card.innerHTML = `
        <div class="citation-meta">
          <span class="citation-case">${numLabel} ${caseNumber}</span>
          <span class="citation-court">${court}</span>
        </div>
        <div class="citation-reason">${relevance}</div>
        <div class="citation-actions">
          <a class="btn-secondary btn-small" href="${url}" target="_blank" style="text-decoration:none;">🔗 開啟裁判書</a>
          <button class="btn-primary btn-small btn-save-citation" data-url="${url}">💾 加入本地庫</button>
        </div>
      `;

      // 綁定「加入本地資料庫」按鈕事件
      card.querySelector('.btn-save-citation').addEventListener('click', (e) => {
        saveCitationToDatabase(url, e.target);
      });

      citationsGrid.appendChild(card);
    });
  } else {
    citationsGrid.innerHTML = '<div style="color:var(--text-muted); font-size:12.5px; grid-column:span 2; text-align:center;">無引用裁判書資料來源。</div>';
  }
  
  // 平滑滾動到結果區
  resultArea.scrollIntoView({ behavior: 'smooth' });
}

/**
 * 下載並儲存引用裁判書到本地庫中
 */
function saveCitationToDatabase(url, button) {
  button.disabled = true;
  button.innerText = '⏳ 下載分析中...';

  chrome.runtime.sendMessage({
    type: 'SAVE_CITATION_TO_DB',
    url: url
  }, (response) => {
    if (response && response.success) {
      button.innerText = '✅ 已加入本地庫';
      button.className = 'btn-secondary btn-small';
      showToast(`✅ ${response.judgment?.caseNumber || '判決書'} 已成功儲存並建立向量索引！`);
    } else {
      button.disabled = false;
      button.innerText = '💾 加入本地庫';
      showToast('⚠️ 儲存失敗：' + (response?.error || '網路請求被阻擋或 API 錯誤'));
    }
  });
}

/**
 * 簡易 Markdown 轉換為 HTML 格式
 */
function formatMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/### (.*?)\n/g, '<h3 style="color:var(--gold-primary); margin:16px 0 8px 0; font-size:14px; border-left:3px solid var(--gold-primary); padding-left:8px;">$1</h3>')
    .replace(/## (.*?)\n/g, '<h2 style="color:var(--gold-primary); margin:20px 0 10px 0; font-size:15px;">$1</h2>')
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--text-main); font-weight:600;">$1</strong>')
    .replace(/-\s(.*?)\n/g, '<li style="margin-left:16px; margin-bottom:4px;">$1</li>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}

/* ===================================================================
   多金鑰動態 UI 輔助函數 (Options Page)
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
  row.className = 'options-key-row';
  
  const input = document.createElement('input');
  input.type = 'password';
  input.className = 'options-key-input';
  input.placeholder = '輸入 Gemini API Key...';
  input.style.flex = '1';
  input.value = value;
  
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn-icon-danger'; // 複用現有的刪除按鈕樣式
  deleteBtn.style.padding = '8px 12px';
  deleteBtn.innerText = '🗑️';
  deleteBtn.title = '刪除此金鑰';
  deleteBtn.addEventListener('click', () => {
    const rows = container.querySelectorAll('.options-key-row');
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
  const inputs = container.querySelectorAll('.options-key-input');
  const keys = Array.from(inputs).map(inp => inp.value.trim()).filter(Boolean);
  return keys.join(',');
}
