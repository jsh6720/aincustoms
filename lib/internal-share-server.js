"use strict";

const crypto = require("node:crypto");
const net = require("node:net");
const { promisify } = require("node:util");
const Y = require("yjs");

const scrypt = promisify(crypto.scrypt);
const COOKIE = "__Host-internal-share-session";
const SESSION_SECONDS = 8 * 60 * 60;
const BODY_LIMIT = 768 * 1024;
const UPDATE_LIMIT = 512 * 1024;
const SYNC_PAGE = 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_MESSAGES = {
  400: "요청 형식을 확인해 주세요.",
  401: "비밀번호를 확인하거나 다시 로그인해 주세요.",
  403: "인증 정보를 새로 확인해 주세요.",
  405: "지원하지 않는 요청입니다.",
  409: "같은 저장 번호에 다른 내용이 있습니다. 새로고침 후 확인해 주세요.",
  413: "저장 한도를 초과했습니다. 입력을 줄이거나 관리자에게 문의해 주세요.",
  415: "JSON 요청만 사용할 수 있습니다.",
  429: "로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.",
  503: "공유문서 연결을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.",
};

class HttpError extends Error {
  constructor(status, code, retryAfter) {
    super(code === "PASSWORD_CHANGED" ? "공유 비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해 주세요." : SAFE_MESSAGES[status] || SAFE_MESSAGES[503]);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function fail(status, code, retryAfter) { throw new HttpError(status, code, retryAfter); }

function canonicalBase64url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  return bytes.toString("base64url") === value ? bytes : null;
}

function readConfig(env) {
  const { salt, key } = parsePasswordHash(env.INTERNAL_SHARE_PASSWORD_HASH);
  const secret = env.INTERNAL_SHARE_SESSION_SECRET;
  let url;
  try { url = new URL(env.SUPABASE_URL); } catch { fail(503, "NOT_CONFIGURED"); }
  if (typeof secret !== "string" || secret.length < 32 ||
      !env.SUPABASE_SERVICE_ROLE_KEY || url.protocol !== "https:" || url.username || url.password ||
      url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    fail(503, "NOT_CONFIGURED");
  }
  return { salt, key, secret, supabaseUrl: url.origin, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY };
}

function parsePasswordHash(value) {
  const parts = typeof value === "string" ? value.split(":") : [];
  const salt = canonicalBase64url(parts[1]), key = canonicalBase64url(parts[2]);
  if (parts.length !== 3 || parts[0] !== "scrypt" || !salt || salt.length < 16 || salt.length > 64 || !key || key.length !== 64) {
    fail(503, "NOT_CONFIGURED");
  }
  return { salt, key };
}

function withCredentialState(config, state) {
  if (!state || !Number.isSafeInteger(state.revision) || state.revision < 0) fail(503, "AUTH_STATE_UNAVAILABLE");
  if (state.revision === 0 && state.password_hash === null) return { ...config, revision: 0 };
  if (state.revision === 0 || typeof state.password_hash !== "string") fail(503, "AUTH_STATE_UNAVAILABLE");
  return { ...config, ...parsePasswordHash(state.password_hash), revision: state.revision };
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(24);
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt:${salt.toString("base64url")}:${key.toString("base64url")}`;
}

function hmac(secret, text) { return crypto.createHmac("sha256", secret).update(text).digest(); }
function sessionSignature(config, encoded) {
  // Changing either the session secret or password hash immediately revokes cookies.
  const key = hmac(config.secret, `internal-share-auth-v1:${config.salt.toString("base64url")}:${config.key.toString("base64url")}`);
  return hmac(key, encoded);
}
function safeEqual(left, right) {
  const a = Buffer.isBuffer(left) ? left : Buffer.from(String(left));
  const b = Buffer.isBuffer(right) ? right : Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function verifyPassword(password, config) {
  const derived = await scrypt(password, config.salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return safeEqual(derived, config.key);
}

function issueSession(config, now = Date.now()) {
  const issued = Math.floor(now / 1000);
  const data = { aud: "internal-share", v: 1, iat: issued, exp: issued + SESSION_SECONDS,
    nonce: crypto.randomBytes(24).toString("base64url") };
  const encoded = Buffer.from(JSON.stringify(data)).toString("base64url");
  return { token: `${encoded}.${sessionSignature(config, encoded).toString("base64url")}`, data };
}

function cookieValue(req) {
  const raw = req.headers?.cookie;
  if (typeof raw !== "string" || raw.length > 16384) return "";
  const matches = raw.split(";").map(value => value.trim()).filter(value => value.startsWith(`${COOKIE}=`));
  return matches.length === 1 ? matches[0].slice(COOKIE.length + 1) : "";
}

function readSession(req, config, now = Date.now()) {
  const token = cookieValue(req);
  if (!token || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const signature = canonicalBase64url(parts[1]);
  if (!signature || !safeEqual(signature, sessionSignature(config, parts[0]))) return null;
  try {
    const payload = canonicalBase64url(parts[0]);
    if (!payload) return null;
    const data = JSON.parse(payload.toString("utf8"));
    const seconds = Math.floor(now / 1000);
    if (!data || data.aud !== "internal-share" || data.v !== 1 || !Number.isSafeInteger(data.iat) ||
        !Number.isSafeInteger(data.exp) || data.exp - data.iat !== SESSION_SECONDS ||
        data.iat > seconds + 60 || data.exp <= seconds ||
        typeof data.nonce !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(data.nonce)) return null;
    return data;
  } catch { return null; }
}

function csrfToken(config, session) {
  return hmac(config.secret, `internal-share-csrf-v1:${session.nonce}`).toString("base64url");
}

function assertOrigin(req) {
  const origin = req.headers?.origin;
  const host = req.headers?.host;
  if (typeof origin !== "string" || typeof host !== "string" ||
      !/^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(host) || origin !== `https://${host}` ||
      req.headers?.["sec-fetch-site"] === "cross-site") fail(403, "ORIGIN_REJECTED");
}

function assertCsrf(body, config, session) {
  if (typeof body.csrf !== "string" || body.csrf.length > 128 ||
      !safeEqual(body.csrf, csrfToken(config, session))) fail(403, "CSRF_REJECTED");
}

function clientKey(req, config) {
  // Vercel overwrites the forwarding header at its edge; socket fallback supports tests.
  const forwarded = req.headers?.["x-vercel-forwarded-for"] || req.headers?.["x-forwarded-for"];
  let ip = String(Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket?.remoteAddress || "unknown")
    .split(",")[0].trim().toLowerCase().replace(/^::ffff:/, "");
  if (net.isIP(ip) === 6) ip = new URL(`http://[${ip}]`).hostname;
  else if (!net.isIP(ip)) ip = "unknown";
  return hmac(config.secret, `internal-share-login-v1:${ip}`).toString("hex");
}

async function readBody(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers?.["content-type"] || "")) {
    fail(415, "JSON_REQUIRED");
  }
  const length = req.headers?.["content-length"];
  if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > BODY_LIMIT)) {
    fail(413, "BODY_TOO_LARGE");
  }
  let raw = req.body;
  if (raw === undefined && req[Symbol.asyncIterator]) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > BODY_LIMIT) fail(413, "BODY_TOO_LARGE");
      chunks.push(bytes);
    }
    raw = Buffer.concat(chunks);
  }
  if (Buffer.isBuffer(raw)) raw = raw.toString("utf8");
  if (typeof raw === "string") {
    if (Buffer.byteLength(raw) > BODY_LIMIT) fail(413, "BODY_TOO_LARGE");
    try { raw = JSON.parse(raw); } catch { fail(400, "INVALID_JSON"); }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(400, "INVALID_BODY");
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(raw)); } catch { fail(400, "INVALID_BODY"); }
  if (bytes > BODY_LIMIT) fail(413, "BODY_TOO_LARGE");
  return raw;
}

function validateUpdate(value) {
  if (typeof value !== "string" || !value || value.length > Math.ceil(UPDATE_LIMIT / 3) * 4) {
    fail(value && value.length > Math.ceil(UPDATE_LIMIT / 3) * 4 ? 413 : 400, "INVALID_UPDATE");
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail(400, "INVALID_UPDATE");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > UPDATE_LIMIT) fail(413, "UPDATE_TOO_LARGE");
  if (!bytes.length || bytes.toString("base64") !== value) fail(400, "INVALID_UPDATE");
  try {
    let consumed;
    class CompleteUpdateDecoder extends Y.UpdateDecoderV1 {
      constructor(decoder) { super(decoder); consumed = decoder; }
    }
    Y.decodeUpdateV2(bytes, CompleteUpdateDecoder);
    if (!consumed || consumed.pos !== bytes.length) fail(400, "INVALID_YJS_UPDATE");
  } catch { fail(400, "INVALID_YJS_UPDATE"); }
  return value;
}

function createStore(config, fetchImpl) {
  async function request(path, options = {}) {
    let response;
    try {
      response = await fetchImpl(`${config.supabaseUrl}/rest/v1/${path}`, {
        ...options,
        headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`,
          "Content-Type": "application/json", Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
    } catch { fail(503, "STORAGE_UNAVAILABLE"); }
    let data;
    try { data = await response.json(); } catch { fail(503, "STORAGE_UNAVAILABLE"); }
    if (!response.ok) {
      if (data?.code === "PT409") fail(409, "OPERATION_CONFLICT");
      if (data?.code === "PT413") fail(413, "DOCUMENT_LIMIT");
      fail(503, "STORAGE_UNAVAILABLE");
    }
    return data;
  }
  function rpc(name, body) { return request(`rpc/${name}`, { method: "POST", body: JSON.stringify(body) }); }
  return {
    authState: () => rpc("internal_share_auth_state", {}),
    changePassword: (revision, hash) => rpc("internal_share_password_change", { p_expected_revision: revision, p_password_hash: hash }),
    guard: key => rpc("internal_share_login_guard", { p_client_key: key }),
    complete: (key, attemptId) => rpc("internal_share_login_complete", { p_client_key: key, p_attempt_id: attemptId }),
    append: body => rpc("internal_share_append", { p_op_id: body.op_id, p_update_base64: body.update, p_author: body.author || null }),
    sync: after => request(`internal_share_updates?document_id=eq.team&select=seq,op_id,update_base64&seq=gt.${after}&order=seq.asc&limit=${SYNC_PAGE + 1}`),
  };
}

function createInternalShareHandler(options = {}) {
  const env = options.env || process.env;
  const now = options.now || Date.now;
  const passwordVerifier = options.passwordVerifier || verifyPassword;
  return async function internalShareHandler(req, res) {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Vary", "Cookie, Origin");
    try {
      const bootstrap = readConfig(env);
      // Reject invalid methods/origins/bodies before doing any database work.
      if (!["GET", "POST"].includes(req.method)) {
        res.setHeader("Allow", "GET, POST"); fail(405, "METHOD_NOT_ALLOWED");
      }
      let body;
      if (req.method === "POST") { assertOrigin(req); body = await readBody(req); }
      const store = createStore(bootstrap, options.fetch || globalThis.fetch);
      // Never cache or fall back on an unavailable credential state. The NULL
      // revision-zero bootstrap is the only permitted environment fallback.
      const config = withCredentialState(bootstrap, await store.authState());
      const session = readSession(req, config, now());
      if (req.method === "GET") {
        const action = req.query?.action || "session";
        if (action === "session") {
          return res.status(200).json(session ? { authenticated: true, csrf: csrfToken(config, session) } : { authenticated: false });
        }
        if (action !== "sync") fail(400, "UNKNOWN_ACTION");
        if (!session) fail(401, "AUTH_REQUIRED");
        const raw = req.query?.after ?? "0";
        if (typeof raw !== "string" || !/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
          fail(400, "INVALID_CURSOR");
        }
        const after = Number(raw);
        const rows = await store.sync(after);
        if (!Array.isArray(rows) || rows.length > SYNC_PAGE + 1) fail(503, "INVALID_STORAGE_RESPONSE");
        rows.forEach((row, index) => {
          if (!row || !Number.isSafeInteger(row.seq) || row.seq !== after + index + 1 ||
              typeof row.op_id !== "string" || !UUID.test(row.op_id)) fail(503, "INVALID_STORAGE_RESPONSE");
          try { validateUpdate(row.update_base64); } catch { fail(503, "INVALID_STORAGE_RESPONSE"); }
        });
        const updates = rows.slice(0, SYNC_PAGE).map(row => ({ seq: row.seq, op_id: row.op_id, update: row.update_base64 }));
        return res.status(200).json({ updates, cursor: updates.at(-1)?.seq ?? after, hasMore: rows.length > SYNC_PAGE });
      }
      if (body.action === "login") {
        if (typeof body.password !== "string" || !body.password.length || Buffer.byteLength(body.password) > 1024) {
          fail(400, "INVALID_PASSWORD");
        }
        const key = clientKey(req, config);
        const guard = await store.guard(key);
        if (!guard || typeof guard.allowed !== "boolean") fail(503, "LOGIN_GUARD_UNAVAILABLE");
        if (!guard.allowed) {
          const retry = Number.isSafeInteger(guard.retry_after) && guard.retry_after > 0 ? Math.min(900, guard.retry_after) : 900;
          fail(429, "LOGIN_RATE_LIMITED", retry);
        }
        if (typeof guard.attempt_id !== "string" || !UUID.test(guard.attempt_id)) fail(503, "LOGIN_GUARD_UNAVAILABLE");
        if (!await passwordVerifier(body.password, config)) fail(401, "INVALID_PASSWORD");
        if (await store.complete(key, guard.attempt_id) !== true) fail(503, "LOGIN_GUARD_UNAVAILABLE");
        const issued = issueSession(config, now());
        res.setHeader("Set-Cookie", `${COOKIE}=${issued.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`);
        return res.status(200).json({ authenticated: true, csrf: csrfToken(config, issued.data) });
      }
      if (!session) fail(401, "AUTH_REQUIRED");
      assertCsrf(body, config, session);
      if (body.action === "logout") {
        res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
        return res.status(200).json({ authenticated: false });
      }
      if (body.action === "change_password") {
        const { currentPassword, newPassword, confirmPassword } = body;
        if (typeof currentPassword !== "string" || !currentPassword.length || Buffer.byteLength(currentPassword) > 1024 ||
            typeof newPassword !== "string" || newPassword.length < 6 || newPassword.length > 128 ||
            Buffer.byteLength(newPassword) > 1024 || newPassword !== confirmPassword || newPassword === currentPassword) {
          fail(400, "INVALID_NEW_PASSWORD");
        }
        const key = clientKey(req, config), guard = await store.guard(key);
        if (!guard || typeof guard.allowed !== "boolean") fail(503, "LOGIN_GUARD_UNAVAILABLE");
        if (!guard.allowed) fail(429, "LOGIN_RATE_LIMITED", Number.isSafeInteger(guard.retry_after) && guard.retry_after > 0 ? Math.min(900, guard.retry_after) : 900);
        if (typeof guard.attempt_id !== "string" || !UUID.test(guard.attempt_id)) fail(503, "LOGIN_GUARD_UNAVAILABLE");
        if (!await passwordVerifier(currentPassword, config)) fail(401, "INVALID_PASSWORD");
        if (await store.complete(key, guard.attempt_id) !== true) fail(503, "LOGIN_GUARD_UNAVAILABLE");
        const hash = await hashPassword(newPassword);
        const result = await store.changePassword(config.revision, hash);
        if (result?.changed === false) fail(409, "PASSWORD_CHANGED");
        if (result?.changed !== true || result.revision !== config.revision + 1) fail(503, "AUTH_STATE_UNAVAILABLE");
        res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
        return res.status(200).json({ authenticated: false, passwordChanged: true });
      }
      if (body.action !== "append") fail(400, "UNKNOWN_ACTION");
      if (typeof body.op_id !== "string" || !UUID.test(body.op_id)) fail(400, "INVALID_OPERATION_ID");
      validateUpdate(body.update);
      if (body.author !== undefined && (typeof body.author !== "string" || body.author.length > 80 ||
          /[\u0000-\u001f\u007f]/.test(body.author))) fail(400, "INVALID_AUTHOR");
      const result = await store.append(body);
      if (!result || !Number.isSafeInteger(result.seq) || result.seq < 1) fail(503, "INVALID_STORAGE_RESPONSE");
      return res.status(200).json({ seq: result.seq });
    } catch (error) {
      const safe = error instanceof HttpError ? error : new HttpError(503, "UNAVAILABLE");
      if (safe.retryAfter) res.setHeader("Retry-After", String(safe.retryAfter));
      return res.status(safe.status).json({ error: safe.code, message: safe.message });
    }
  };
}

module.exports = { createInternalShareHandler, readConfig, issueSession, readSession, csrfToken,
  verifyPassword, parsePasswordHash, withCredentialState, hashPassword, validateUpdate, COOKIE, SESSION_SECONDS, BODY_LIMIT, UPDATE_LIMIT, SYNC_PAGE };
