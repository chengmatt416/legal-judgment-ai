/**
 * 法律判決 AI 摘要助手 — Service Worker (事件協調中心)
 */

import { MESSAGE_TYPES } from '../utils/constants.js';
import { validateApiKey, analyzeJudgment, getEmbeddings } from './gemini-client.js';
import { 
  getSettings, 
  saveSettings, 
  listDatabases, 
  createDatabase, 
  deleteDatabase, 
  getActiveDatabaseId,
  getJudgmentById,
  saveEmbeddingsData
} from '../database/database-manager.js';
import { getJudgmentCached, saveJudgmentCached, clearL1Cache } from '../database/cache-layer.js';
import { addTagToJudgment, removeTagFromJudgment } from '../database/tag-manager.js';
import { chunkJudgment, ragQuery } from '../rag/rag-engine.js';
import { aiSearchAgent, calculateCourtFee, fetchJudgmentContent } from '../rag/ai-search-agent.js';
import { getLawArticle } from '../database/law-manager.js';
import { exportDatabaseToZip, importDatabaseFromZip } from '../sync/export-import.js';
import { syncToCloud, activateCloudSync } from '../sync/sync-client.js';

// 偵測安裝事件，初始化預設設定
chrome.runtime.onInstalled.addListener(() => {
  console.log('[ServiceWorker] 擴充功能安裝成功！');
  // 初始化 Meta DB
  listDatabases().then(dbs => {
    console.log('[ServiceWorker] 偵測到資料庫清單已就緒，數量:', dbs.length);
  });
});

// 監聽來自各處的 Message
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[ServiceWorker] 收到訊息:', message.type, message);

  // 異步執行包裝
  handleMessageAsync(message, sender)
    .then(result => {
      sendResponse(result);
    })
    .catch(err => {
      console.error('[ServiceWorker] 處理 Message 發生異常:', err);
      sendResponse({ success: false, error: err.message });
    });

  return true; // 保持 message 通道開啟以利異步回傳
});

/**
 * 異步訊息分流器
 */
async function handleMessageAsync(message, sender) {
  const settings = await getSettings();
  const dbId = await getActiveDatabaseId();

  switch (message.type) {
    // =================================================================
    // 判決書摘要分析流程
    // =================================================================
    case 'TRIGGER_ANALYSIS': {
      // 1. 取得目標分頁與 frameId (優先使用發送者分頁資訊，保障 frame 與 tab 定位)
      let targetTabId = null;
      let targetFrameId = null;

      if (sender && sender.tab) {
        targetTabId = sender.tab.id;
        targetFrameId = sender.frameId;
      } else {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!activeTab) {
          return { success: false, error: '找不到活動的網頁分頁。' };
        }
        targetTabId = activeTab.id;
      }

      const sendOptions = typeof targetFrameId === 'number' ? { frameId: targetFrameId } : undefined;

      // 2. 指示 Content Script 開啟懸浮視窗並顯示讀取中
      try {
        await chrome.tabs.sendMessage(targetTabId, { 
          type: 'SHOW_FLOATING_PANEL', 
          text: '正在擷取網頁判決書內容...',
          progress: 10
        }, sendOptions);
      } catch (err) {
        return { success: false, error: '無法在此網頁上載入懸浮視窗。請重新整理該網頁後再試。' };
      }

      // 3. 指示 Content Script 擷取網頁 DOM 內容
      let domData;
      try {
        const extractRes = await chrome.tabs.sendMessage(targetTabId, { type: 'EXTRACT_JUDGMENT' }, sendOptions);
        if (!extractRes || !extractRes.success) {
          throw new Error(extractRes?.error || '網頁擷取失敗');
        }
        domData = extractRes.data;
      } catch (err) {
        await chrome.tabs.sendMessage(targetTabId, { type: 'SUMMARY_ERROR', error: err.message }, sendOptions);
        return { success: false, error: err.message };
      }

      // 4. 開始分析，首先進行 Cache 檢查
      try {
        await chrome.tabs.sendMessage(targetTabId, { 
          type: 'SUMMARY_PROGRESS', 
          text: '正在檢查本地資料庫快取...',
          progress: 30
        }, sendOptions);

        // 檢查 L1 / L2 Cache
        const cachedJudgment = await getJudgmentCached(dbId, domData.caseNumber, domData.court, domData.rawText);
        if (cachedJudgment) {
          // 快取命中，直接發送結果顯示
          await chrome.tabs.sendMessage(targetTabId, { 
            type: 'SUMMARY_RESULT', 
            data: cachedJudgment 
          }, sendOptions);
          return { success: true, cached: true };
        }

        // 快取未命中，需要呼叫 AI
        if (!settings.geminiApiKey) {
          throw new Error('尚未設定 Gemini API Key。請先點選擴充功能圖示進入設定畫面輸入 API Key。');
        }

        await chrome.tabs.sendMessage(targetTabId, { 
          type: 'SUMMARY_PROGRESS', 
          text: '正在呼叫 Gemini 分析判決事實與解析爭點 (此步需花費約 5-10 秒)...',
          progress: 50
        }, sendOptions);

        // 呼叫 Gemini 進行摘要與解析 (使用 Structured Output JSON)
        const parsedAnalysis = await analyzeJudgment(settings.geminiApiKey, domData.rawText, settings.geminiModel);

        await chrome.tabs.sendMessage(targetTabId, { 
          type: 'SUMMARY_PROGRESS', 
          text: '正在將分析摘要儲存至本地資料庫...',
          progress: 80
        }, sendOptions);
 
        // 組合資料主體
        const judgmentToSave = {
          caseNumber: parsedAnalysis.metadata.caseNumber || domData.caseNumber,
          court: parsedAnalysis.metadata.court || domData.court,
          date: parsedAnalysis.metadata.date || domData.date,
          caseType: parsedAnalysis.metadata.caseType || domData.caseType,
          cause: parsedAnalysis.metadata.cause || domData.cause,
          rawText: domData.rawText,
          summaryJson: parsedAnalysis, // 完整儲存 AI 回傳 JSON
          sourceUrl: domData.sourceUrl,
          analyzedAt: new Date().toISOString(),
          modelUsed: settings.geminiModel
        };
 
        // 對判決書進行切塊
        const chunks = chunkJudgment(judgmentToSave);
 
        // 1. 優先儲存至資料庫與快取 (不等待向量，傳入空向量 [])
        const savedJudgment = await saveJudgmentCached(dbId, judgmentToSave, chunks, [], parsedAnalysis.suggestedTags);
 
        // 2. 立即將結果回傳給 Content Script 渲染懸浮面板，提升使用者體感反應速度
        await chrome.tabs.sendMessage(targetTabId, { 
          type: 'SUMMARY_RESULT', 
          data: savedJudgment 
        }, sendOptions);
 
        // 3. 在背景非同步執行向量嵌入生成與儲存
        (async () => {
          try {
            await chrome.tabs.sendMessage(targetTabId, { 
              type: 'SUMMARY_PROGRESS', 
              text: '摘要已完成！正在背景生成 RAG 向量索引...',
              progress: 90
            }, sendOptions);
 
            const chunkTexts = chunks.map(c => c.text);
            const vectors = await getEmbeddings(settings.geminiApiKey, chunkTexts);
            
            // 寫入向量資料
            await saveEmbeddingsData(dbId, savedJudgment.id, chunks, vectors);
            console.log('[ServiceWorker] RAG 向量背景生成並儲存成功！');
 
            await chrome.tabs.sendMessage(targetTabId, { 
              type: 'SUMMARY_PROGRESS', 
              text: '背景向量索引生成完成！您可以開始進行智慧問答。',
              progress: 100
            }, sendOptions);
          } catch (embErr) {
            console.error('[ServiceWorker] 背景向量嵌入生成失敗:', embErr);
            await chrome.tabs.sendMessage(targetTabId, { 
              type: 'SUMMARY_PROGRESS', 
              text: '⚠️ 向量生成失敗，本案僅支援摘要閱讀，暫不支援智慧問答。',
              progress: 100
            }, sendOptions);
          }
        })();
 
        // 如果啟用了雲端同步，觸發背景同步 (Fire and Forget)
        if (settings.cloudSyncEnabled && settings.autoSyncEnabled) {
          chrome.runtime.sendMessage({ type: 'SYNC_TO_CLOUD' }).catch(() => {});
        }
 
        return { success: true, cached: false };
 
      } catch (err) {
        console.error('[ServiceWorker] 分析過程出錯:', err);
        await chrome.tabs.sendMessage(targetTabId, { 
          type: 'SUMMARY_ERROR', 
          error: err.message 
        }, sendOptions);
        return { success: false, error: err.message };
      }
    }

    // =================================================================
    // RAG 向量查詢
    // =================================================================
    case 'RAG_QUERY': {
      if (!settings.geminiApiKey) {
        return { success: false, error: '請先設定 Gemini API Key。' };
      }
      const targetDbId = message.databaseId || dbId;
      const result = await ragQuery(targetDbId, settings.geminiApiKey, message.query);
      return { success: true, answer: result.answer, sources: result.sources };
    }

    // =================================================================
    // AI 智慧搜尋與裁判費計算
    // =================================================================
    case 'AI_SEARCH_QUERY': {
      if (!settings.geminiApiKey) {
        return { success: false, error: '請先設定 Gemini API Key。' };
      }
      
      // 判斷是否為 Content Script 呼叫（有 sender.tab）或擴充功能頁面呼叫（如 options.html）
      const callerTabId = sender.tab ? sender.tab.id : null;
      const isExtensionPage = !sender.tab; // options.html 等擴充功能頁面沒有 sender.tab
      
      // 統一推送進度與結果的輔助函數
      async function pushToSender(msgPayload) {
        if (isExtensionPage) {
          // 擴充功能頁面：使用 runtime.sendMessage 廣播給所有擴充功能 context
          chrome.runtime.sendMessage(msgPayload).catch(() => {});
        } else if (callerTabId) {
          // Content Script：使用 tabs.sendMessage 傳送給特定 tab 的 content script
          chrome.tabs.sendMessage(callerTabId, msgPayload).catch(() => {});
        }
      }
      
      // 啟動背景非同步任務，不阻礙當前訊息通道，防止 30 秒 Port 關閉的超時硬限制
      (async () => {
        try {
          const result = await aiSearchAgent(
            settings.geminiApiKey,
            settings.geminiModel,
            message.mode,
            message.prompt,
            (progress) => {
              pushToSender({ type: 'AI_SEARCH_PROGRESS', progress });
            }
          );
          
          pushToSender({ type: 'AI_SEARCH_RESULT', data: result });
        } catch (err) {
          console.error('[ServiceWorker] 背景 AI 智慧搜尋發生錯誤:', err);
          pushToSender({ type: 'AI_SEARCH_ERROR', error: err.message });
        }
      })();
      
      return { success: true, status: 'started' };
    }

    case 'COURT_FEE_CALCULATE': {
      const result = calculateCourtFee(message.amount, message.caseType);
      return { success: true, ...result };
    }

    case 'SAVE_CITATION_TO_DB': {
      if (!settings.geminiApiKey) {
        return { success: false, error: '請先設定 Gemini API Key。' };
      }
      try {
        const html = await fetchJudgmentContent(message.url);
        const rawText = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)?.[1]?.replace(/<[^>]*>/g, '').trim() || html.replace(/<[^>]*>/g, '').trim();
        
        const caseNumberMatch = rawText.slice(0, 500).match(/(\d+)\s*年度\s*([^號]+)\s*字\s*第\s*(\d+)\s*號/);
        const caseNumber = caseNumberMatch ? `${caseNumberMatch[1]}年度${caseNumberMatch[2]}字第${caseNumberMatch[3]}號` : '未知案號';
        
        const courtMatch = rawText.slice(0, 200).match(/(最高法院|最高行政法院|臺灣高等法院|.*?地方法院)/);
        const court = courtMatch ? courtMatch[1] : '未知法院';
        
        const causeMatch = rawText.slice(0, 1000).match(/(?:裁判案由|案由)[】\s：:]*([^\n]+)/);
        const cause = causeMatch ? causeMatch[1].trim() : '未知案由';
        
        const dateMatch = rawText.slice(0, 1000).match(/中華民國\s*(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日/);
        let date = new Date().toISOString().slice(0, 10);
        if (dateMatch) {
          const year = parseInt(dateMatch[1], 10) + 1911;
          const month = dateMatch[2].padStart(2, '0');
          const day = dateMatch[3].padStart(2, '0');
          date = `${year}-${month}-${day}`;
        }
        
        const caseType = rawText.includes('刑') ? '刑事' : '民事';

        const cached = await getJudgmentCached(dbId, caseNumber, court, rawText);
        if (cached) {
          return { success: true, message: '此判決已存在於資料庫中！', judgment: cached };
        }

        const parsedAnalysis = await analyzeJudgment(settings.geminiApiKey, rawText, settings.geminiModel);
        
        const judgmentToSave = {
          caseNumber: parsedAnalysis.metadata.caseNumber || caseNumber,
          court: parsedAnalysis.metadata.court || court,
          date: parsedAnalysis.metadata.date || date,
          caseType: parsedAnalysis.metadata.caseType || caseType,
          cause: parsedAnalysis.metadata.cause || cause,
          rawText,
          summaryJson: parsedAnalysis,
          sourceUrl: message.url,
          analyzedAt: new Date().toISOString(),
          modelUsed: settings.geminiModel
        };

        const chunks = chunkJudgment(judgmentToSave);
        const savedJudgment = await saveJudgmentCached(dbId, judgmentToSave, chunks, [], parsedAnalysis.suggestedTags);

        (async () => {
          try {
            const chunkTexts = chunks.map(c => c.text);
            const vectors = await getEmbeddings(settings.geminiApiKey, chunkTexts);
            await saveEmbeddingsData(dbId, savedJudgment.id, chunks, vectors);
            console.log('[ServiceWorker] 引用判決書向量生成成功！');
          } catch (embErr) {
            console.error('[ServiceWorker] 引用判決書向量生成失敗:', embErr);
          }
        })();

        return { success: true, judgment: savedJudgment };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    // =================================================================
    // 適用法條查詢
    // =================================================================
    case 'GET_LAW_ARTICLE': {
      try {
        const article = await getLawArticle(message.lawName, message.articleNumber);
        return { success: true, article };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    // =================================================================
    // 標籤管理
    // =================================================================
    case 'ADD_TAG': {
      const updatedTags = await addTagToJudgment(dbId, message.judgmentId, message.tagName, message.category, message.tagType, message.confidence);
      return { success: true, updatedTags };
    }

    case 'REMOVE_TAG': {
      const updatedTags = await removeTagFromJudgment(dbId, message.judgmentId, message.tagId);
      return { success: true, updatedTags };
    }

    // =================================================================
    // 設定管理
    // =================================================================
    case 'GET_SETTINGS': {
      return { success: true, settings };
    }

    case 'UPDATE_SETTINGS': {
      const updatedSettings = await saveSettings(message.settings);
      
      // 如果切換了資料庫，清空 L1 Cache
      if (message.settings.activeDatabaseId && message.settings.activeDatabaseId !== settings.activeDatabaseId) {
        clearL1Cache();
      }

      return { success: true, settings: updatedSettings };
    }

    case 'VALIDATE_API_KEY': {
      const isValid = await validateApiKey(message.apiKey);
      return { success: true, isValid };
    }

    // =================================================================
    // 資料庫管理
    // =================================================================
    case 'LIST_DATABASES': {
      const databases = await listDatabases();
      return { success: true, databases };
    }

    case 'CREATE_DATABASE': {
      const newDb = await createDatabase(message.name, message.description, message.color);
      return { success: true, database: newDb };
    }

    case 'DELETE_DATABASE': {
      await deleteDatabase(message.dbId);
      return { success: true };
    }

    // =================================================================
    // 匯出匯入 (ZIP) / 雲端同步
    // =================================================================
    case 'EXPORT_ZIP': {
      const base64Zip = await exportDatabaseToZip(message.dbId, message.includeRawText);
      return { success: true, zipData: base64Zip };
    }

    case 'IMPORT_ZIP': {
      const importRes = await importDatabaseFromZip(message.dbId, message.zipData);
      return importRes;
    }

    case 'SYNC_TO_CLOUD': {
      const syncRes = await syncToCloud(dbId);
      return syncRes;
    }

    case 'SYNC_FROM_CLOUD': {
      const syncRes = await syncToCloud(dbId);
      return syncRes;
    }

    case 'ACTIVATE_CLOUD': {
      const activeRes = await activateCloudSync(message.activationCode);
      return activeRes;
    }

    // 這些訊息是 background 主動廣播給擴充功能頁面（如 options.html）的通知，
    // service worker 本身收到後直接忽略即可（不需回應）。
    case 'AI_SEARCH_RESULT':
    case 'AI_SEARCH_ERROR':
    case 'AI_SEARCH_PROGRESS':
      return { success: true, ignored: true };

    default:
      return { success: false, error: `未知的 Message 類型: ${message.type}` };
  }
}
