/**
 * Cloudflare Worker 主入口檔案 (index.js)
 */

import { generateJwt, authenticate } from './auth.js';
import { getOrCreateUser, pullChanges, pushChanges } from './database.js';
import { diffChanges } from './sync.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // 1. 處理 CORS 預檢請求 (Preflight)
    if (request.method === 'OPTIONS') {
      return handleCors(new Response(null, { status: 204 }));
    }

    try {
      // 2. 路由分流
      // (a) 啟用帳戶與發放 JWT Token (免 Token 驗證)
      if (pathname === '/api/auth/activate' && request.method === 'POST') {
        const { activationCode } = await request.json();
        
        if (!activationCode) {
          return errorResponse('請提供啟用碼。', 400);
        }

        // 驗證啟用碼是否在環境變數配置的許可清單中
        const allowedCodes = (env.ACTIVATION_CODES || '').split(',').map(c => c.trim());
        if (!allowedCodes.includes(activationCode)) {
          return errorResponse('無效的啟用碼。', 403);
        }

        // 取得或建立使用者 ID
        const userId = await getOrCreateUser(env.DB, activationCode);
        
        // 產生 JWT Token
        const token = await generateJwt(userId, env.JWT_SECRET);
        
        return jsonResponse({ success: true, token, userId });
      }

      // --- 以下路由均需要 JWT 認證 ---
      const userId = await authenticate(request, env);
      if (!userId) {
        return errorResponse('未經授權，JWT Token 無效或已過期。', 401);
      }

      // (b) 驗證 JWT 狀態
      if (pathname === '/api/auth/verify' && request.method === 'GET') {
        return jsonResponse({ success: true, userId });
      }

      // (c) 差異比對 (增量同步第一步)
      if (pathname === '/api/sync/diff' && request.method === 'POST') {
        const { judgments = [] } = await request.json();
        const diff = await diffChanges(env.DB, userId, judgments);
        return jsonResponse({ success: true, ...diff });
      }

      // (d) 上傳同步資料 (Push)
      if (pathname === '/api/sync/push' && request.method === 'POST') {
        const changes = await request.json();
        const result = await pushChanges(env.DB, userId, changes);
        return jsonResponse(result);
      }

      // (e) 下拉同步資料 (Pull)
      if (pathname === '/api/sync/pull' && request.method === 'GET') {
        const lastSync = url.searchParams.get('lastSync') || '0';
        const data = await pullChanges(env.DB, userId, lastSync);
        return jsonResponse({ success: true, ...data });
      }

      // 404 Not Found
      return errorResponse('找不到指定的 API 端點。', 404);

    } catch (err) {
      console.error('Worker Error:', err);
      return errorResponse(`伺服器內部錯誤: ${err.message}`, 500);
    }
  }
};

/**
 * CORS 回應處理
 */
function handleCors(response) {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return response;
}

/**
 * 快速回傳 JSON 輔助函數
 */
function jsonResponse(data, status = 200) {
  const res = new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
  return handleCors(res);
}

/**
 * 快速回傳錯誤 JSON
 */
function errorResponse(message, status = 400) {
  return jsonResponse({ success: false, error: message }, status);
}
