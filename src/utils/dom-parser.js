/**
 * 司法裁判網網頁解析工具
 */

import { DOM_SELECTORS } from './constants.js';

/**
 * 從網頁 DOM 中擷取判決書的所有資訊
 * @param {Document} doc - 要解析的 document 物件，預設為當前 window.document
 * @returns {object|null} - 擷取出的判決書資訊，若非判決書頁面則傳回 null
 */
export function parseJudgmentPage(doc = document) {
  // 檢查是否包含判決書內容特徵
  const hasContent = !!doc.querySelector(DOM_SELECTORS.CONTENT_AREA) || 
                       doc.body.innerText.includes('裁判字號') || 
                       doc.body.innerText.includes('裁判案號') ||
                       doc.body.innerText.includes('主文');
  
  if (!hasContent) {
    return null;
  }

  // 1. 提取全文
  const rawText = extractRawText(doc);
  if (!rawText || rawText.trim().length < 50) {
    return null;
  }

  // 2. 提取法院名稱
  const court = extractCourtName(doc, rawText);

  // 3. 提取案號
  const caseNumber = extractCaseNumber(doc, rawText);

  // 4. 提取裁判日期
  const date = extractJudgmentDate(doc, rawText);

  // 5. 提取案由
  const cause = extractCause(doc, rawText);

  // 6. 判定案件類別 (民事/刑事/行政/家事/其他)
  const caseType = determineCaseType(caseNumber, cause, rawText, doc.location.href);

  // 7. 取得來源網址
  const sourceUrl = doc.location.href;

  return {
    caseNumber,
    court,
    date,
    cause,
    caseType,
    rawText,
    sourceUrl,
    parsedAt: new Date().toISOString()
  };
}

/**
 * 提取判決書全文文字
 */
function extractRawText(doc) {
  // 優先尋找主體內容元素
  const container = doc.querySelector(DOM_SELECTORS.CONTENT_AREA);
  if (container) {
    return container.innerText;
  }

  // 搜尋含有特定文字的 pre 元素
  const preElements = doc.getElementsByTagName('pre');
  for (const pre of preElements) {
    if (pre.innerText.includes('主文') || pre.innerText.includes('事實') || pre.innerText.includes('理由')) {
      return pre.innerText;
    }
  }

  // 備用方案：如果網頁結構改變，尋找最大文字容器
  const textDivs = Array.from(doc.querySelectorAll('div, td')).filter(el => {
    const text = el.innerText || '';
    return text.includes('主文') && (text.includes('理由') || text.includes('事實'));
  });

  if (textDivs.length > 0) {
    // 依長度排序，取最長的
    textDivs.sort((a, b) => b.innerText.length - a.innerText.length);
    return textDivs[0].innerText;
  }

  // 最極端備用：直接拿 body text
  return doc.body.innerText;
}

/**
 * 提取法院名稱
 */
function extractCourtName(doc, rawText) {
  // 嘗試從標題元素提取
  const titleEl = doc.querySelector(DOM_SELECTORS.COURT_NAME);
  if (titleEl && titleEl.innerText.trim()) {
    return cleanCourtName(titleEl.innerText);
  }

  // 嘗試從全文前 200 字匹配常見法院名稱
  const snippet = rawText.slice(0, 200);
  const courtPatterns = [
    /司法院/g,
    /最高法院/g,
    /最高行政法院/g,
    /臺灣高等法院\s*[^\s]*/g,
    /福建高等法院\s*[^\s]*/g,
    /智慧財產及商業法院/g,
    /臺灣[^\s]*地方法院/g,
    /福建[^\s]*地方法院/g,
    /臺灣[^\s]*少年法院/g,
    /高雄少年及家事法院/g,
  ];

  for (const pattern of courtPatterns) {
    const match = snippet.match(pattern);
    if (match) {
      return cleanCourtName(match[0]);
    }
  }

  // 嘗試網頁標題
  const title = doc.title || '';
  if (title.includes('裁判書')) {
    const parts = title.split(' ');
    if (parts.length > 0 && parts[0].includes('法院')) {
      return cleanCourtName(parts[0]);
    }
  }

  return '未知法院';
}

function cleanCourtName(name) {
  return name.replace(/裁判書|公報|主文|正本/g, '').replace(/\s+/g, '').trim();
}

/**
 * 提取案號
 */
function extractCaseNumber(doc, rawText) {
  // 嘗試從頁面元素尋找
  const caseNumEl = doc.querySelector(DOM_SELECTORS.CASE_NUMBER);
  if (caseNumEl && caseNumEl.innerText.trim()) {
    const text = caseNumEl.innerText.trim();
    const match = text.match(/\d+年度[^號]+號/);
    if (match) return match[0];
  }

  // 從全文前 300 字正規匹配：例如 "111年度台上字第1234號"
  const snippet = rawText.slice(0, 500);
  
  // 標準格式 111年度台上字第1234號
  const stdMatch = snippet.match(/(\d+)\s*年度\s*([^號]+)\s*字\s*第\s*(\d+)\s*號/);
  if (stdMatch) {
    return `${stdMatch[1]}年度${stdMatch[2].replace(/\s+/g, '')}字第${stdMatch[3]}號`;
  }

  // 簡寫格式 111,台上,1234
  const shortMatch = snippet.match(/(\d+)\s*,\s*([^,]+)\s*,\s*(\d+)/);
  if (shortMatch) {
    return `${shortMatch[1]}年度${shortMatch[2]}字第${shortMatch[3]}號`;
  }

  // 標記欄位格式 "【裁判字號】 111,台上,1234"
  const fieldMatch = snippet.match(/(?:裁判字號|案號)[：:\s]*([^\s]+)/);
  if (fieldMatch) {
    return fieldMatch[1].replace(/【|】/g, '').trim();
  }

  return '未知案號';
}

/**
 * 提取裁判日期
 */
function extractJudgmentDate(doc, rawText) {
  // 嘗試從網頁元素尋找
  const dateEl = doc.querySelector(DOM_SELECTORS.JUDGMENT_DATE);
  if (dateEl && dateEl.innerText.trim()) {
    const dateStr = parseChineseDate(dateEl.innerText);
    if (dateStr) return dateStr;
  }

  // 從全文前 1000 字中搜尋 "【裁判日期】1090815" 或 "民國 109 年 8 月 15 日"
  const snippet = rawText.slice(0, 1000);
  
  // 格式一：民國 109 年 8 月 15 日
  const rocMatch = snippet.match(/中華民國\s*(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日/);
  if (rocMatch) {
    const year = parseInt(rocMatch[1], 10) + 1911;
    const month = rocMatch[2].padStart(2, '0');
    const day = rocMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 格式二：【裁判日期】1090815 (民國年月日碼)
  const rocCodeMatch = snippet.match(/裁判日期[】]*\s*(\d{7})/);
  if (rocCodeMatch) {
    const code = rocCodeMatch[1];
    const year = parseInt(code.slice(0, 3), 10) + 1911;
    const month = code.slice(3, 5);
    const day = code.slice(5, 7);
    return `${year}-${month}-${day}`;
  }

  // 格式三：【裁判日期】109.8.15
  const dotMatch = snippet.match(/裁判日期[】\s:]*(\d+)\.(\d+)\.(\d+)/);
  if (dotMatch) {
    const year = parseInt(dotMatch[1], 10) + 1911;
    const month = dotMatch[2].padStart(2, '0');
    const day = dotMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 預設傳回今天
  return new Date().toISOString().slice(0, 10);
}

function parseChineseDate(text) {
  const rocMatch = text.match(/(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日/);
  if (rocMatch) {
    const year = parseInt(rocMatch[1], 10) + 1911;
    const month = rocMatch[2].padStart(2, '0');
    const day = rocMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return null;
}

/**
 * 提取案由
 */
function extractCause(doc, rawText) {
  // 嘗試從網頁元素尋找
  const causeEl = doc.querySelector(DOM_SELECTORS.CASE_TYPE);
  if (causeEl && causeEl.innerText.trim()) {
    return causeEl.innerText.replace(/裁判案由[】\s:]*/g, '').trim();
  }

  // 從全文前 1000 字中搜尋 "【裁判案由】毒品危害防制條例" 或 "案由：毒品"
  const snippet = rawText.slice(0, 1000);
  const causeMatch = snippet.match(/(?:裁判案由|案由)[】\s：:]*([^\n]+)/);
  if (causeMatch) {
    return causeMatch[1].trim();
  }

  return '未知案由';
}

/**
 * 判定案件類別 (民事/刑事/行政/家事/其他)
 */
function determineCaseType(caseNumber, cause, rawText, url) {
  const combined = `${caseNumber} ${cause} ${rawText.slice(0, 1000)} ${url}`;
  
  if (combined.includes('家字') || combined.includes('家事') || combined.includes('離婚') || combined.includes('監護權')) {
    return '家事';
  }
  if (combined.includes('刑') || (combined.includes('上訴') && (combined.includes('罪') || combined.includes('被告') || combined.includes('徒刑')))) {
    // 過濾可能為行政訴訟的刑罰執行
    if (combined.includes('行政訴訟') || combined.includes('行政法院')) {
      return '行政';
    }
    return '刑事';
  }
  if (combined.includes('行政') || (combined.includes('訴') && (combined.includes('政府') || combined.includes('處分') || combined.includes('稅') || combined.includes('罰鍰')))) {
    return '行政';
  }
  if (combined.includes('民') || combined.includes('訴') || combined.includes('給付') || combined.includes('損害賠償') || combined.includes('履行契約')) {
    return '民事';
  }

  return '民事'; // 預設為民事
}
