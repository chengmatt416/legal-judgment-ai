/**
 * 法律判決 AI 摘要助手 — Content Script
 * 負責網頁 DOM 擷取與懸浮視窗的注入與事件協調
 */

// 全域變數，保持單一懸浮視窗實例
let panelInstance = null;

/**
 * 延遲載入 parseJudgmentPage，因為 DOM 載入後可能有些微延遲
 */
import { parseJudgmentPage } from '../utils/dom-parser.js';

/**
 * 取得當前網頁的判決書資料
 */
async function extractCurrentJudgment() {
  try {
    return parseJudgmentPage(document);
  } catch (error) {
    console.error('[ContentScript] DOM 解析錯誤:', error);
    return null;
  }
}

/**
 * 初始化並顯示懸浮視窗
 */
async function getOrInitPanel() {
  if (!panelInstance || !panelInstance.host) {
    if (!window.LegalJudgmentFloatingPanel) {
      console.error('[ContentScript] LegalJudgmentFloatingPanel 未載入！');
      return null;
    }
    panelInstance = new window.LegalJudgmentFloatingPanel();
    await panelInstance.init();
  }
  return panelInstance;
}

/**
 * 控制快捷按鈕的顯示/隱藏
 */
function toggleQuickButton(visible) {
  const btn = document.getElementById('legal-ai-quick-btn');
  if (btn) {
    btn.style.display = visible ? 'flex' : 'none';
  } else if (visible) {
    // 若按鈕原本不存在但被要求顯示，重新嘗試檢查與注入
    checkAndInjectButton();
  }
}

/**
 * 建立並注入 AI 摘要快捷按鈕到頁面
 */
function createAndInjectButton() {
  // 避免重複注入
  if (document.getElementById('legal-ai-quick-btn')) {
    return;
  }

  // 建立按鈕元素 (Rich Aesthetics / Glassmorphism)
  const btn = document.createElement('button');
  btn.id = 'legal-ai-quick-btn';
  btn.innerHTML = '✨ AI 判決摘要';
  
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    zIndex: '99998', // 略低於懸浮面板層級
    background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
    color: '#ffffff',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '30px',
    padding: '12px 24px',
    fontSize: '14.5px',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 8px 32px 0 rgba(99, 102, 241, 0.37)',
    backdropFilter: 'blur(4px)',
    transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
  });

  // 懸停動畫
  btn.addEventListener('mouseover', () => {
    btn.style.transform = 'translateY(-3px) scale(1.05)';
    btn.style.boxShadow = '0 12px 40px 0 rgba(99, 102, 241, 0.5)';
  });
  btn.addEventListener('mouseout', () => {
    btn.style.transform = 'translateY(0) scale(1)';
    btn.style.boxShadow = '0 8px 32px 0 rgba(99, 102, 241, 0.37)';
  });

  // 點擊事件 (觸發背景分析流程)
  btn.addEventListener('click', () => {
    btn.style.opacity = '0.5';
    btn.style.pointerEvents = 'none';

    chrome.runtime.sendMessage({ type: 'TRIGGER_ANALYSIS' }, (res) => {
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
      if (res && res.success) {
        // 分析啟動，隱藏快捷按鈕以防遮擋懸浮面板
        toggleQuickButton(false);
      } else {
        alert(`❌ 觸發失敗：${res?.error || '請先於擴充功能選單設定 API Key'}`);
      }
    });
  });

  document.body.appendChild(btn);
  console.log('[ContentScript] AI 摘要快捷按鈕注入成功。');
}

/**
 * 檢查是否在判決書頁面，如果是且未注入按鈕則注入
 */
async function checkAndInjectButton() {
  // 1. 如果按鈕已經存在，或懸浮視窗主體已經存在，就不處理
  if (document.getElementById('legal-ai-quick-btn') || document.getElementById('legal-judgment-ai-floating-panel-host')) {
    return;
  }

  // 2. 檢測是否在查詢首頁 (default.aspx)
  const isHomepage = window.location.pathname.endsWith('default.aspx') || window.location.href.endsWith('/FJUD/') || window.location.pathname === '/FJUD/default.aspx';
  if (isHomepage) {
    createAndInjectSearchButton();
    return;
  }

  // 3. 快速同步偵測是否具有判決書的特徵
  const hasContent = !!document.querySelector('#jud, #judContent, .judgment-content, [id*="jud"]') || 
                     (document.body && (
                       document.body.innerText.includes('裁判字號') || 
                       document.body.innerText.includes('裁判案號') ||
                       document.body.innerText.includes('主文')
                     ));

  if (!hasContent) {
    return;
  }

  // 4. 擷取判決書內容並檢查是否有效 (異步解析)
  const parsedData = await extractCurrentJudgment();
  if (!parsedData || !parsedData.rawText || parsedData.rawText.trim().length < 50) {
    return;
  }

  // 5. 執行按鈕注入
  createAndInjectButton();
}

/**
 * 在查詢首頁建立並注入 AI 智慧查詢快捷按鈕
 */
function createAndInjectSearchButton() {
  if (document.getElementById('legal-ai-quick-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'legal-ai-quick-btn';
  btn.innerHTML = '🤖 AI 智慧查詢';
  
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    zIndex: '99998',
    background: 'linear-gradient(135deg, #C9A35C 0%, #B8924B 100%)',
    color: '#0F172A',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '30px',
    padding: '12px 24px',
    fontSize: '14.5px',
    fontWeight: '700',
    cursor: 'pointer',
    boxShadow: '0 8px 32px 0 rgba(201, 163, 92, 0.3)',
    backdropFilter: 'blur(4px)',
    transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
  });

  btn.addEventListener('mouseover', () => {
    btn.style.transform = 'translateY(-3px) scale(1.05)';
    btn.style.boxShadow = '0 12px 40px 0 rgba(201, 163, 92, 0.5)';
  });
  btn.addEventListener('mouseout', () => {
    btn.style.transform = 'translateY(0) scale(1)';
    btn.style.boxShadow = '0 8px 32px 0 rgba(201, 163, 92, 0.3)';
  });

  btn.addEventListener('click', async () => {
    btn.style.opacity = '0.5';
    btn.style.pointerEvents = 'none';

    const panel = await getOrInitPanel();
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';

    if (panel) {
      toggleQuickButton(false);
      panel.renderHomepageAISearch();
    } else {
      alert('❌ 無法載入 AI 查詢面板');
    }
  });

  document.body.appendChild(btn);
  console.log('[ContentScript] AI 智慧查詢快捷按鈕注入首頁成功。');
}

// 監聽面板關閉/銷毀事件，還原快捷按鈕顯示
window.addEventListener('legal-ai-panel-destroyed', () => {
  toggleQuickButton(true);
});

// 監聽來自 Popup 或 Service Worker 的訊息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[ContentScript] 收到訊息:', message.type, message);

  // 處理非同步重啟
  (async () => {
    try {
      switch (message.type) {
        case 'EXTRACT_JUDGMENT': {
          const judgmentData = await extractCurrentJudgment();
          if (judgmentData) {
            sendResponse({ success: true, data: judgmentData });
          } else {
            sendResponse({ success: false, error: '未能在此頁面識別有效的判決書內容。' });
          }
          break;
        }

        case 'SHOW_FLOATING_PANEL': {
          toggleQuickButton(false); // 隱藏按鈕
          const panel = await getOrInitPanel();
          if (panel) {
            panel.showLoading(message.text || '初始化中...', message.progress || -1);
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: '無法建立懸浮視窗。' });
          }
          break;
        }

        case 'SUMMARY_PROGRESS': {
          toggleQuickButton(false);
          const panel = await getOrInitPanel();
          if (panel) {
            panel.showLoading(message.text, message.progress);
            sendResponse({ success: true });
          }
          break;
        }

        case 'SUMMARY_RESULT': {
          toggleQuickButton(false);
          const panel = await getOrInitPanel();
          if (panel) {
            panel.renderData(message.data);
            sendResponse({ success: true });
          }
          break;
        }

        case 'SUMMARY_ERROR': {
          toggleQuickButton(true); // 出錯時還原按鈕
          const panel = await getOrInitPanel();
          if (panel) {
            panel.showError(message.error);
            sendResponse({ success: true });
          }
          break;
        }

        case 'AI_SEARCH_PROGRESS': {
          if (panelInstance && typeof panelInstance.updateSearchProgress === 'function') {
            panelInstance.updateSearchProgress(message.progress);
          }
          sendResponse({ success: true });
          break;
        }

        case 'AI_SEARCH_RESULT': {
          if (panelInstance && typeof panelInstance.handleAISearchResult === 'function') {
            panelInstance.handleAISearchResult(message.data);
          }
          sendResponse({ success: true });
          break;
        }

        case 'AI_SEARCH_ERROR': {
          if (panelInstance && typeof panelInstance.handleAISearchError === 'function') {
            panelInstance.handleAISearchError(message.error);
          }
          sendResponse({ success: true });
          break;
        }
        
        default:
          sendResponse({ error: '未支援的訊息類型' });
      }
    } catch (err) {
      console.error('[ContentScript] 處理訊息出錯:', err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // 保持異步通道開啟
});

// 註冊 MutationObserver，當網頁結構改變（例如動態載入判決內容）時重新檢查並注入按鈕
let mutationTimeout = null;
const observer = new MutationObserver(() => {
  if (mutationTimeout) {
    clearTimeout(mutationTimeout);
  }
  mutationTimeout = setTimeout(() => {
    checkAndInjectButton();
  }, 500);
});

// 開始觀察 DOM 變化
if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
} else {
  // 如果 body 還未就緒，監聽 DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
    checkAndInjectButton();
  });
}

// 輪詢定時器 (雙重保險，因應 iframe 或特殊動態更新)
setInterval(checkAndInjectButton, 1500);

// 執行快捷按鈕注入
checkAndInjectButton().catch(err => console.error('[ContentScript] 初始化按鈕出錯:', err));
