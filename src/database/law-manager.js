/**
 * 法律條文存取與爬取管理器 (Law Manager)
 */

import { openMetaDB } from './database-manager.js';
import { DB_CONFIG } from '../utils/constants.js';

// 本機內置 5 大常用法律 PCode 對應表
const LOCAL_LAWS = {
  '中華民國憲法': 'A0000001',
  '民法': 'B0000001',
  '刑法': 'C0000001',
  '民事訴訟法': 'B0010001',
  '刑事訴訟法': 'C0010001'
};

let lawIndex = null;
let lawAliases = null;

/**
 * 延遲載入法規索引 (index.json) 與俗名對應表 (aliases.json)
 */
async function loadMetadata() {
  if (lawIndex && lawAliases) return;
  try {
    const indexUrl = chrome.runtime.getURL('src/lib/index.json');
    const aliasesUrl = chrome.runtime.getURL('src/lib/aliases.json');
    
    const [indexRes, aliasesRes] = await Promise.all([
      fetch(indexUrl),
      fetch(aliasesUrl)
    ]);
    
    lawIndex = await indexRes.json();
    lawAliases = await aliasesRes.json();
    console.log('[LawManager] 載入法規索引成功，法規筆數:', lawIndex.length);
  } catch (err) {
    console.error('[LawManager] 載入法規索引失敗:', err);
    throw err;
  }
}

function normalizeLawName(lawName) {
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

  name = name.trim();
  if (name.startsWith('中華民國') && name !== '中華民國憲法') {
    name = name.slice(4);
  }
  return name;
}

/**
 * 解析法規 JSON 結構為平坦條文列表
 */
function parseLawJSON(json) {
  const lawName = json['法規名稱'] || '';
  const contentArray = json['法規內容'] || [];
  const normalizedName = normalizeLawName(lawName);
  
  const articles = [];
  contentArray.forEach(item => {
    if (item['條號']) {
      // 擷取條號中的數字（支援 10-1 等子法條）
      const numberMatch = item['條號'].match(/[\d-]+/);
      const number = numberMatch ? numberMatch[0] : item['條號'];
      articles.push({
        id: `${normalizedName}_${number}`,
        lawName: normalizedName,
        number: number,
        content: (item['條文內容'] || '').trim()
      });
    }
  });
  return articles;
}

/**
 * 讀取本機內置的法律 JSON
 */
async function loadLocalLawFile(pcode) {
  try {
    const url = chrome.runtime.getURL(`src/lib/laws/${pcode}.json`);
    const res = await fetch(url);
    const json = await res.json();
    return parseLawJSON(json);
  } catch (err) {
    console.error(`[LawManager] 讀取本地法規 ${pcode} 失敗:`, err);
    return [];
  }
}

/**
 * 從 GitHub 靜態 CDN 下載法規 JSON
 */
async function fetchLawFromGitHub(pcode) {
  const url = `https://raw.githubusercontent.com/kong0107/mojLawSplitJSON/gh-pages/FalVMingLing/${pcode}.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`無法下載法規 JSON，HTTP 狀態碼: ${res.status}`);
  }
  const json = await res.json();
  return parseLawJSON(json);
}

/**
 * 將法規條文快取至 IndexedDB laws 表
 */
async function saveLawArticlesToDB(lawName, articles) {
  const db = await openMetaDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_CONFIG.STORES.LAWS, 'readwrite');
    const store = tx.objectStore(DB_CONFIG.STORES.LAWS);
    
    articles.forEach(article => {
      store.put(article);
    });
    
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 從 IndexedDB laws 表中尋找快取的條文
 */
async function getLawArticleFromDB(lawName, articleNumber) {
  const db = await openMetaDB();
  const id = `${lawName}_${articleNumber}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_CONFIG.STORES.LAWS, 'readonly');
    const store = tx.objectStore(DB_CONFIG.STORES.LAWS);
    const req = store.get(id);
    
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 依據法規名稱尋找 PCode
 */
function findPCode(lawName) {
  // 1. 先從官方 index.json 名稱匹配 (比對原名及去首名)
  const exactMatch = lawIndex.find(
    law => law.name === lawName || normalizeLawName(law.name) === lawName
  );
  if (exactMatch) return exactMatch.PCode;
  
  // 2. 從 aliases.json 俗名/縮寫匹配
  for (const [pcode, aliases] of Object.entries(lawAliases)) {
    if (aliases.includes(lawName)) {
      return pcode;
    }
  }
  return null;
}

/**
 * 查詢特定法律的特定法條內容
 * @param {string} lawName - 法律名稱 (如 '民法', '勞動基準法', '勞基法')
 * @param {string} articleNumber - 條號 (如 '767', '24-1')
 * @returns {Promise<object>} - 回傳條文資訊 { lawName, number, content }
 */
export async function getLawArticle(lawName, articleNumber) {
  const normalizedLawName = normalizeLawName(lawName);
  
  // 1. 優先從 IndexedDB 快取查詢
  try {
    const cached = await getLawArticleFromDB(normalizedLawName, articleNumber);
    if (cached) {
      console.log(`[LawManager] 快取命中: ${normalizedLawName} 第 ${articleNumber} 條`);
      return cached;
    }
  } catch (dbErr) {
    console.warn('[LawManager] 查詢 IndexedDB 快取失敗:', dbErr);
  }
  
  // 2. 若為本地常用五大法規，直接讀取本地檔並匯入 IndexedDB
  const localPCode = LOCAL_LAWS[normalizedLawName];
  if (localPCode) {
    console.log(`[LawManager] 從本機載入常用法律: ${normalizedLawName}`);
    const articles = await loadLocalLawFile(localPCode);
    if (articles.length > 0) {
      await saveLawArticlesToDB(normalizedLawName, articles).catch(() => {});
      const article = articles.find(art => art.number === articleNumber);
      if (article) return article;
    }
  }
  
  // 3. 延遲載入 PCode 索引對應表
  await loadMetadata();
  const pcode = findPCode(normalizedLawName);
  
  if (!pcode) {
    console.warn(`[LawManager] 無法識別的法律名稱: ${lawName}`);
    return {
      lawName: normalizedLawName,
      number: articleNumber,
      content: `無法查詢條文。擴充功能目前無法對應法規名稱「${lawName}」，請檢查法規名稱是否正確。`
    };
  }
  
  // 4. 從 GitHub raw Pages 下載該法規的所有條文並快取
  try {
    console.log(`[LawManager] 快取未命中，開始從網路下載法規: ${normalizedLawName} (PCode: ${pcode})`);
    const articles = await fetchLawFromGitHub(pcode);
    if (articles.length > 0) {
      await saveLawArticlesToDB(normalizedLawName, articles).catch(() => {});
      const article = articles.find(art => art.number === articleNumber);
      if (article) return article;
    }
  } catch (err) {
    console.error(`[LawManager] 從網路抓取法規失敗: ${normalizedLawName}`, err);
    return {
      lawName: normalizedLawName,
      number: articleNumber,
      content: `無法從網路讀取「${normalizedLawName}」之法規內容，請確認您的網路連線。`
    };
  }
  
  return {
    lawName: normalizedLawName,
    number: articleNumber,
    content: `找不到該法條內容（${normalizedLawName} 第 ${articleNumber} 條）。該條文可能已廢止或尚未制定。`
  };
}
