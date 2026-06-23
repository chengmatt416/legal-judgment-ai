/**
 * 密碼學與雜湊工具函數
 */

/**
 * 計算字串的 SHA-256 Hex 雜湊值
 * @param {string} text - 要計算的文字
 * @returns {Promise<string>} - SHA-256 hex 字串
 */
export async function sha256(text) {
  const msgUint8 = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * 產生 UUID v4
 * @returns {string} - UUID 字串
 */
export function generateUUID() {
  return crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

/**
 * 針對判決書產生唯一的快取與資料庫識別碼
 * @param {string} caseNumber - 案號 (例如：111年度台上字第1234號)
 * @param {string} court - 法院名稱 (例如：最高法院)
 * @param {string} rawText - 判決書全文
 * @param {number} prefixLength - 用於雜湊的全文前綴長度 (預設 500 字)
 * @returns {Promise<string>} - 唯一識別碼
 */
export async function generateJudgmentId(caseNumber, court, rawText, prefixLength = 500) {
  const normalizedCaseNumber = (caseNumber || '').trim();
  const normalizedCourt = (court || '').trim();
  const rawTextSnippet = (rawText || '').slice(0, prefixLength).replace(/\s+/g, '');
  const signature = `${normalizedCaseNumber}_${normalizedCourt}_${rawTextSnippet}`;
  return sha256(signature);
}
