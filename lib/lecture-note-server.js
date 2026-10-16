"use strict";

// Standalone lecture notebook at /note/lecture: two fixed accounts
// (editor, viewer), one JSON document in a private Supabase Storage bucket.
const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);
const COOKIE = "__Host-lecture-note-session";
const SESSION_SECONDS = 12 * 60 * 60;
const BUCKET = "lecture-notes";
const OBJECT = "notebook.json";
const DOC_LIMIT = 900 * 1024;
const ACCOUNTS = {
  master: { role: "editor", hash: "scrypt:Tpc30EZgDQdRWmHBwqu48w:Cb5Sm13h4TKus5G6-9pDO4ytGBkWw-9DTaPx2o7BbYA119vZyQ0ia6Nh8Gi4GKcaEacmsZagWsgbryk6WAALgA" },
  customs: { role: "viewer", hash: "scrypt:-ZtPNOcKHHmCG9BOnXjg4A:-6dcWoTipZYlhRgaMgxM0jjidSZEaYPB4gzaI0nXsY533JFgtGvE7mGRg7qhFQ8wkXPU-ACkJHUqBKLtger00g" },
};
const EMPTY = { notes: [], updatedAt: null };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

function config(env) {
  const base = env.INTERNAL_SHARE_SESSION_SECRET;
  let url;
  try { url = new URL(env.SUPABASE_URL); } catch { fail(503, "저장소 설정을 확인해 주세요."); }
  if (typeof base !== "string" || base.length < 32 || !env.SUPABASE_SERVICE_ROLE_KEY) fail(503, "저장소 설정을 확인해 주세요.");
  return {
    secret: crypto.createHmac("sha256", base).update("lecture-note-session-v1").digest(),
    storage: `${url.origin}/storage/v1`,
    key: env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

async function verifyPassword(password, stored) {
  const [, salt, key] = stored.split(":");
  const expected = Buffer.from(key, "base64url");
  const derived = await scrypt(password, Buffer.from(salt, "base64url"), expected.length);
  return crypto.timingSafeEqual(derived, expected);
}

const sign = (cfg, text) => crypto.createHmac("sha256", cfg.secret).update(text).digest("base64url");

function issue(cfg, user, now) {
  const payload = Buffer.from(JSON.stringify({ u: user, exp: Math.floor(now / 1000) + SESSION_SECONDS })).toString("base64url");
  return `${payload}.${sign(cfg, payload)}`;
}

function readSession(req, cfg, now) {
  const raw = String(req.headers?.cookie || "").split(";").map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const [payload, mac] = raw.slice(COOKIE.length + 1).split(".");
  if (!payload || !mac) return null;
  const expected = sign(cfg, payload);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!ACCOUNTS[data.u] || !(data.exp > now / 1000)) return null;
    return { user: data.u, role: ACCOUNTS[data.u].role, csrf: sign(cfg, `csrf:${payload}`) };
  } catch { return null; }
}

function storage(cfg, fetchImpl) {
  const headers = { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` };
  const call = (path, options = {}) => fetchImpl(`${cfg.storage}/${path}`, {
    ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(10000),
  }).catch(() => fail(503, "저장소에 연결하지 못했습니다."));
  return {
    async read() {
      const response = await call(`object/${BUCKET}/${OBJECT}`);
      if (response.status === 400 || response.status === 404) return EMPTY;
      if (!response.ok) fail(503, "노트를 불러오지 못했습니다.");
      return response.json();
    },
    async write(doc) {
      const put = () => call(`object/${BUCKET}/${OBJECT}`, {
        method: "POST", body: JSON.stringify(doc),
        headers: { "Content-Type": "application/json", "x-upsert": "true", "cache-control": "no-cache" },
      });
      let response = await put();
      if (response.status === 400 || response.status === 404) {
        // First save creates the private bucket.
        await call("bucket", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) });
        response = await put();
      }
      if (!response.ok) fail(503, "노트를 저장하지 못했습니다.");
    },
  };
}

function cleanNotes(notes) {
  if (!Array.isArray(notes) || notes.length > 100) fail(400, "노트 형식을 확인해 주세요.");
  const ids = new Set();
  return notes.map(note => {
    const { id, title, body } = note || {};
    if (typeof id !== "string" || !/^[a-z0-9-]{1,64}$/.test(id) || ids.has(id) ||
        typeof title !== "string" || !title.trim() || title.length > 120 || typeof body !== "string") fail(400, "노트 형식을 확인해 주세요.");
    ids.add(id);
    return { id, title: title.trim(), body };
  });
}

async function readBody(req) {
  let raw = req.body;
  if (raw === undefined && req[Symbol.asyncIterator]) {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    raw = Buffer.concat(chunks).toString("utf8");
  }
  if (Buffer.isBuffer(raw)) raw = raw.toString("utf8");
  if (typeof raw === "string") {
    if (Buffer.byteLength(raw) > DOC_LIMIT) fail(413, "노트 용량이 너무 큽니다.");
    try { raw = JSON.parse(raw); } catch { fail(400, "요청 형식을 확인해 주세요."); }
  }
  if (!raw || typeof raw !== "object") fail(400, "요청 형식을 확인해 주세요.");
  return raw;
}

function createLectureNoteHandler(options = {}) {
  const env = options.env || process.env;
  const now = options.now || Date.now;
  return async function lectureNoteHandler(req, res) {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const cfg = config(env);
      const store = storage(cfg, options.fetch || globalThis.fetch);
      const session = readSession(req, cfg, now());
      if (req.method === "GET") {
        if (!session) return res.status(200).json({ authenticated: false });
        const doc = await store.read();
        return res.status(200).json({ authenticated: true, user: session.user, role: session.role, csrf: session.csrf, ...doc });
      }
      if (req.method !== "POST") fail(405, "지원하지 않는 요청입니다.");
      if (req.headers?.origin !== `https://${req.headers?.host}`) fail(403, "허용되지 않은 요청입니다.");
      const body = await readBody(req);
      if (body.action === "login") {
        const account = Object.hasOwn(ACCOUNTS, body.id) ? ACCOUNTS[body.id] : null;
        const ok = account && typeof body.password === "string" && body.password.length <= 256 &&
          await verifyPassword(body.password, account.hash);
        if (!ok) fail(401, "아이디 또는 비밀번호를 확인해 주세요.");
        res.setHeader("Set-Cookie", `${COOKIE}=${issue(cfg, body.id, now())}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`);
        return res.status(200).json({ ok: true });
      }
      if (body.action === "logout") {
        res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
        return res.status(200).json({ ok: true });
      }
      if (!session) fail(401, "다시 로그인해 주세요.");
      if (body.csrf !== session.csrf) fail(403, "페이지를 새로고침해 주세요.");
      if (body.action !== "save") fail(400, "알 수 없는 요청입니다.");
      if (session.role !== "editor") fail(403, "열람 전용 계정입니다.");
      const current = await store.read();
      if ((current.updatedAt || null) !== (body.baseUpdatedAt || null)) fail(409, "다른 곳에서 먼저 저장되었습니다. 새로고침 후 다시 저장해 주세요.");
      const doc = { notes: cleanNotes(body.notes), updatedAt: new Date(now()).toISOString() };
      await store.write(doc);
      return res.status(200).json({ updatedAt: doc.updatedAt });
    } catch (error) {
      const safe = error instanceof HttpError ? error : new HttpError(503, "잠시 후 다시 시도해 주세요.");
      return res.status(safe.status).json({ error: safe.message });
    }
  };
}

module.exports = { createLectureNoteHandler, verifyPassword, ACCOUNTS };
