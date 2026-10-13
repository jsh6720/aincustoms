// POST /api/contact (rewritten to /api/cargo-admin?workspace=contact to stay within the Hobby function limit):
// homepage "문의하기" form -> e-mail to the office. Never logs personal data or message bodies.

const MAIL_TO = "jsh@aincustoms.com";
const MAIL_CC = "jhcho@aincustoms.com";
const BODY_LIMIT = 20 * 1024;
const MIN_FILL_MS = 3000;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const INQUIRY_TYPES = ["수출입통관", "품목분류", "FTA·원산지", "수입요건(전파법, 전안법, 수입식품특별법 등)", "조사 대응(관세심사/조사, 외국환검사/조사)", "외환 진단", "기타"];
const LIMITS = { name: 50, company: 100, email: 254, phone: 30, messageMin: 10, messageMax: 3000 };
const EMAIL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const PHONE_RE = /^[0-9+()\-. ]{0,30}$/;
const FALLBACK = "jsh@aincustoms.com / 02-518-5435";

class ContactError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Same env contract as api/cargo-import-request.js (SMTP_HOST/USER/PASS, SMTP_PORT default 465,
// SMTP_SECURE default true unless "false", MAIL_FROM default SMTP_USER).
function smtpConfigFromEnv(env = process.env) {
  const host = env.SMTP_HOST || "";
  const user = env.SMTP_USER || "";
  const pass = env.SMTP_PASS || "";
  if (!host || !user || !pass) return null;
  return {
    transport: {
      host,
      port: Number(env.SMTP_PORT || 465),
      secure: String(env.SMTP_SECURE || "true").toLowerCase() !== "false",
      auth: { user, pass },
    },
    from: env.MAIL_FROM || user,
  };
}

// Single-line values end up in headers (subject, reply-to) -> no CR/LF or other control characters.
function singleLine(value, max) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function multiLine(value) {
  return String(value == null ? "" : value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, "")
    .trim();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function isBot(body, now) {
  if (singleLine(body.website, 200)) return true; // honeypot
  const renderedAt = Number(body.ts);
  if (!Number.isFinite(renderedAt) || renderedAt <= 0) return true;
  return now - renderedAt < MIN_FILL_MS;
}

function validate(body) {
  const rawEmail = String(body.email == null ? "" : body.email).trim();
  const data = {
    name: singleLine(body.name, LIMITS.name + 1),
    company: singleLine(body.company, LIMITS.company + 1),
    email: singleLine(rawEmail, LIMITS.email + 1),
    phone: singleLine(body.phone, LIMITS.phone + 1),
    type: singleLine(body.type, 40),
    message: multiLine(body.message),
  };
  const errors = {};
  if (!data.name) errors.name = "성함을 입력해 주세요.";
  else if (data.name.length > LIMITS.name) errors.name = `성함은 ${LIMITS.name}자 이내로 입력해 주세요.`;
  if (data.company.length > LIMITS.company) errors.company = `회사명은 ${LIMITS.company}자 이내로 입력해 주세요.`;
  if (!data.email) errors.email = "이메일을 입력해 주세요.";
  else if (/[\r\n]/.test(rawEmail) || data.email.length > LIMITS.email || !EMAIL_RE.test(data.email) ||
    data.email.split("@")[0].length > 64) errors.email = "올바른 이메일 주소를 입력해 주세요.";
  if (data.phone.length > LIMITS.phone || !PHONE_RE.test(data.phone)) errors.phone = "연락처는 숫자와 - 기호로 입력해 주세요.";
  if (!INQUIRY_TYPES.includes(data.type)) errors.type = "문의 유형을 선택해 주세요.";
  if (data.message.length < LIMITS.messageMin) errors.message = `문의 내용을 ${LIMITS.messageMin}자 이상 입력해 주세요.`;
  else if (data.message.length > LIMITS.messageMax) errors.message = `문의 내용은 ${LIMITS.messageMax}자 이내로 입력해 주세요.`;
  if (body.consent !== true) errors.consent = "개인정보 수집·이용에 동의해 주세요.";
  return { data, errors };
}

function buildMail(data, submittedAt) {
  const submitted = submittedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const fields = [
    ["성함", data.name],
    ["회사명", data.company || "-"],
    ["이메일", data.email],
    ["연락처", data.phone || "-"],
    ["문의 유형", data.type],
    ["접수 시각", `${submitted} (KST)`],
    ["개인정보 수집·이용 동의", "Y"],
  ];
  const text = [
    "홈페이지 문의하기 양식으로 새 문의가 접수되었습니다.",
    "",
    ...fields.map(([label, value]) => `${label}: ${value}`),
    "",
    "[문의 내용]",
    data.message,
  ].join("\n");
  const rows = fields.map(([label, value]) =>
    `<tr><th align="left" style="padding:4px 12px 4px 0;color:#555;white-space:nowrap">${escapeHtml(label)}</th><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`
  ).join("");
  const html = `<div style="font-family:sans-serif;font-size:14px;color:#222">` +
    `<p>홈페이지 문의하기 양식으로 새 문의가 접수되었습니다.</p>` +
    `<table style="border-collapse:collapse">${rows}</table>` +
    `<p style="margin-top:16px;font-weight:bold">문의 내용</p>` +
    `<div style="white-space:pre-wrap;border-left:3px solid #2563eb;padding-left:12px">${escapeHtml(data.message).replace(/\n/g, "<br>")}</div></div>`;
  return {
    to: MAIL_TO,
    cc: MAIL_CC,
    replyTo: data.email,
    subject: `[홈페이지 문의] ${data.type} - ${data.name}`,
    text,
    html,
  };
}

function clientIp(req) {
  const forwarded = req.headers?.["x-vercel-forwarded-for"] || req.headers?.["x-forwarded-for"] || req.headers?.["x-real-ip"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return String(value || req.socket?.remoteAddress || "unknown").split(",")[0].trim().toLowerCase().replace(/^::ffff:/, "") || "unknown";
}

// Best-effort only: serverless instances do not share memory and are recycled, so this
// throttles bursts against one warm instance, not a determined sender. The honeypot,
// timing check and SMTP provider limits are the other layers.
function createRateLimiter({ limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS } = {}) {
  const hits = new Map();
  return function allow(key, now) {
    if (hits.size > 5000) {
      for (const [k, times] of hits) if (!times.some(t => now - t < windowMs)) hits.delete(k);
    }
    const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

async function readJsonBody(req) {
  if (!/^application\/json\b/i.test(String(req.headers?.["content-type"] || ""))) {
    throw new ContactError(415, "JSON_REQUIRED", "잘못된 요청 형식입니다.");
  }
  const length = req.headers?.["content-length"];
  if (length !== undefined && Number(length) > BODY_LIMIT) throw new ContactError(413, "BODY_TOO_LARGE", "문의 내용이 너무 깁니다.");
  let raw = req.body;
  if (raw === undefined && req[Symbol.asyncIterator]) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > BODY_LIMIT) throw new ContactError(413, "BODY_TOO_LARGE", "문의 내용이 너무 깁니다.");
      chunks.push(bytes);
    }
    raw = Buffer.concat(chunks);
  }
  if (Buffer.isBuffer(raw)) raw = raw.toString("utf8");
  if (typeof raw === "string") {
    if (Buffer.byteLength(raw) > BODY_LIMIT) throw new ContactError(413, "BODY_TOO_LARGE", "문의 내용이 너무 깁니다.");
    try { raw = JSON.parse(raw); } catch { throw new ContactError(400, "INVALID_JSON", "잘못된 요청 형식입니다."); }
  } else if (raw && Buffer.byteLength(JSON.stringify(raw)) > BODY_LIMIT) {
    throw new ContactError(413, "BODY_TOO_LARGE", "문의 내용이 너무 깁니다.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ContactError(400, "INVALID_BODY", "잘못된 요청 형식입니다.");
  return raw;
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function createContactHandler({
  env = process.env,
  createTransport = options => require("nodemailer").createTransport(options),
  now = () => Date.now(),
  allow = createRateLimiter(),
} = {}) {
  return async function contactHandler(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(res, 405, { success: false, code: "METHOD_NOT_ALLOWED", message: "허용되지 않는 요청입니다." });
    }
    try {
      const body = await readJsonBody(req);
      const current = now();
      // Bots get the normal success answer so they have nothing to tune against.
      if (isBot(body, current)) return send(res, 200, { success: true });

      const { data, errors } = validate(body);
      if (Object.keys(errors).length) {
        return send(res, 400, { success: false, code: "INVALID_FIELDS", message: Object.values(errors)[0], errors });
      }
      if (!allow(clientIp(req), current)) {
        res.setHeader("Retry-After", String(Math.ceil(RATE_WINDOW_MS / 1000)));
        return send(res, 429, { success: false, code: "RATE_LIMITED", message: `문의가 너무 많이 접수되었습니다. 잠시 후 다시 시도하시거나 ${FALLBACK}로 연락해 주세요.` });
      }
      const smtp = smtpConfigFromEnv(env);
      if (!smtp) {
        console.error("contact: SMTP environment is not configured");
        return send(res, 503, { success: false, code: "MAIL_UNAVAILABLE", message: `현재 온라인 문의를 접수할 수 없습니다. ${FALLBACK}로 연락해 주세요.` });
      }
      const mail = buildMail(data, new Date(current));
      await createTransport(smtp.transport).sendMail({ from: smtp.from, ...mail });
      return send(res, 200, { success: true });
    } catch (error) {
      if (error instanceof ContactError) return send(res, error.status, { success: false, code: error.code, message: error.message });
      console.error("contact: mail delivery failed:", error && (error.code || error.name || "error"));
      return send(res, 502, { success: false, code: "MAIL_FAILED", message: `문의 전송 중 오류가 발생했습니다. ${FALLBACK}로 연락해 주세요.` });
    }
  };
}

const defaultHandler = createContactHandler();
module.exports = function handler(req, res) {
  return defaultHandler(req, res);
};
module.exports.createContactHandler = createContactHandler;
module.exports.createRateLimiter = createRateLimiter;
module.exports.smtpConfigFromEnv = smtpConfigFromEnv;
module.exports.validate = validate;
module.exports.buildMail = buildMail;
module.exports.singleLine = singleLine;
module.exports.INQUIRY_TYPES = INQUIRY_TYPES;
