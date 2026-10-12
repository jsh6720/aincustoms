const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const contact = require("../lib/contact-handler");
const { createContactHandler, createRateLimiter, validate, singleLine, smtpConfigFromEnv } = contact;

const SMTP_ENV = { SMTP_HOST: "smtp.example.com", SMTP_USER: "bot@example.com", SMTP_PASS: "x", MAIL_FROM: "AIN <bot@example.com>" };
const NOW = Date.UTC(2026, 9, 12, 1, 30, 0); // 2026-10-12 10:30 KST

function validBody(overrides = {}) {
  return {
    name: "홍길동",
    company: "아인상사",
    email: "hong@example.co.kr",
    phone: "010-1234-5678",
    type: "품목분류",
    message: "HS 코드 분류 문의드립니다. 회신 부탁드립니다.",
    consent: true,
    website: "",
    ts: NOW - 60000,
    ...overrides,
  };
}

function request(body, { method = "POST", ip = "203.0.113.7", headers = {} } = {}) {
  return {
    method,
    query: { workspace: "contact" },
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers },
    body,
  };
}

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(chunk) { this.body = chunk || ""; },
    get json() { return JSON.parse(this.body); },
  };
}

function harness({ env = SMTP_ENV, allow, fail = false } = {}) {
  const sent = [];
  const transports = [];
  const handler = createContactHandler({
    env,
    now: () => NOW,
    allow: allow || createRateLimiter(),
    createTransport(options) {
      transports.push(options);
      return { async sendMail(mail) { if (fail) throw Object.assign(new Error("boom"), { code: "ECONNECTION" }); sent.push(mail); return { messageId: "1" }; } };
    },
  });
  return {
    sent,
    transports,
    async call(body, opts) {
      const res = fakeRes();
      await handler(request(body, opts), res);
      return res;
    },
  };
}

test("rejects non-POST with 405 and Allow header", async () => {
  const h = harness();
  const res = await h.call(undefined, { method: "GET" });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, "POST");
  assert.equal(h.sent.length, 0);
});

test("routes through cargo-admin workspace=contact and keeps 12 api functions", async () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.ok(config.rewrites.some(r => r.source === "/api/contact" && r.destination === "/api/cargo-admin?workspace=contact"));
  assert.equal(fs.readdirSync(path.join(root, "api")).filter(f => f.endsWith(".js")).length, 12);
  const admin = require("../api/cargo-admin");
  const res = fakeRes();
  await admin({ method: "GET", query: { workspace: "contact" }, headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

test("validates required fields, email, type, consent and lengths", () => {
  assert.deepEqual(validate(validBody()).errors, {});
  const missing = validate({}).errors;
  for (const key of ["name", "email", "type", "message", "consent"]) assert.ok(missing[key], key);
  assert.equal(missing.company, undefined);
  assert.equal(missing.phone, undefined);

  for (const email of ["no-at", "a@b", "a@@b.com", "a b@c.com", "a@-b.com", ".a@b.com", "a..b@c.com", "a@b.c", "x".repeat(65) + "@b.com", "a@b.com\r\nBcc: x@y.com"]) {
    assert.ok(validate(validBody({ email })).errors.email, email);
  }
  assert.ok(validate(validBody({ type: "광고" })).errors.type);
  assert.ok(validate(validBody({ consent: "true" })).errors.consent, "consent must be boolean true");
  assert.ok(validate(validBody({ message: "짧은 문의" })).errors.message);
  assert.ok(validate(validBody({ message: "가".repeat(3001) })).errors.message);
  assert.deepEqual(validate(validBody({ message: "가".repeat(3000) })).errors, {});
  assert.ok(validate(validBody({ name: "가".repeat(51) })).errors.name);
  assert.ok(validate(validBody({ company: "가".repeat(101) })).errors.company);
  assert.ok(validate(validBody({ phone: "010-1234-5678<script>" })).errors.phone);
  assert.equal(validate(validBody({ name: "  홍길동  ", message: "  내용입니다 열 글자 이상  " })).data.name, "홍길동");
});

test("strips CR/LF and control characters from header-bound fields", () => {
  assert.equal(singleLine("홍길동\r\nBcc: evil@example.com", 100), "홍길동 Bcc: evil@example.com");
  assert.equal(singleLine("a\u0000b\u2028c", 100), "a b c");
  const { data } = validate(validBody({ name: "홍길동\r\nBcc: evil@example.com", type: "기타" }));
  assert.doesNotMatch(data.name, /[\r\n]/);
});

test("400 with field errors and no send for invalid input", async () => {
  const h = harness();
  const res = await h.call(validBody({ email: "bad" }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.json.success, false);
  assert.ok(res.json.errors.email);
  assert.equal(h.sent.length, 0);
});

test("honeypot or too-fast submissions get 200 success without sending", async () => {
  const h = harness();
  for (const body of [validBody({ website: "http://spam.example" }), validBody({ ts: NOW - 1000 }), validBody({ ts: undefined }), validBody({ ts: "abc" })]) {
    const res = await h.call(body);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json, { success: true });
  }
  assert.equal(h.sent.length, 0);
  assert.equal(h.transports.length, 0);
});

test("rejects non-JSON, malformed and oversized bodies", async () => {
  const h = harness();
  assert.equal((await h.call("name=x", { headers: { "content-type": "application/x-www-form-urlencoded" } })).statusCode, 415);
  assert.equal((await h.call("{not json")).statusCode, 400);
  assert.equal((await h.call(JSON.stringify(validBody({ message: "가".repeat(8000) })))).statusCode, 413);
  assert.equal((await h.call(validBody(), { headers: { "content-length": String(21 * 1024) } })).statusCode, 413);
  assert.equal(h.sent.length, 0);
});

test("rate limits a single IP to 5 submissions per 10 minutes", async () => {
  const h = harness();
  for (let i = 0; i < 5; i++) assert.equal((await h.call(validBody())).statusCode, 200);
  const limited = await h.call(validBody());
  assert.equal(limited.statusCode, 429);
  assert.match(limited.json.message, /jsh@aincustoms\.com/);
  assert.equal((await h.call(validBody(), { ip: "198.51.100.1" })).statusCode, 200);
  assert.equal(h.sent.length, 6);

  const allow = createRateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(allow("k", 0), true);
  assert.equal(allow("k", 500), false);
  assert.equal(allow("k", 1500), true);
});

test("missing SMTP env returns 503 with a generic message", async () => {
  const h = harness({ env: { SMTP_HOST: "smtp.example.com" } });
  const res = await h.call(validBody());
  assert.equal(res.statusCode, 503);
  assert.doesNotMatch(res.body, /SMTP|env/i);
  assert.equal(h.transports.length, 0);
});

test("SMTP config mirrors the existing cargo mail env contract", () => {
  assert.equal(smtpConfigFromEnv({}), null);
  const defaults = smtpConfigFromEnv({ SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p" });
  assert.deepEqual(defaults, { transport: { host: "h", port: 465, secure: true, auth: { user: "u", pass: "p" } }, from: "u" });
  const custom = smtpConfigFromEnv({ SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p", SMTP_PORT: "587", SMTP_SECURE: "FALSE", MAIL_FROM: "f" });
  assert.equal(custom.transport.port, 587);
  assert.equal(custom.transport.secure, false);
  assert.equal(custom.from, "f");
});

test("sends the inquiry mail with escaped HTML and header-safe subject", async () => {
  const h = harness();
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  let res;
  try {
    res = await h.call(validBody({
      name: "홍<b>길동</b>\r\nBcc: evil@example.com",
      company: "A&B \"상사\"",
      type: "FTA·원산지",
      message: "<script>alert(1)</script>\n둘째 줄 & 'quote' 입니다.",
    }));
  } finally {
    console.error = originalError;
  }
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json, { success: true });
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.transports[0], { host: "smtp.example.com", port: 465, secure: true, auth: { user: "bot@example.com", pass: "x" } });
  const mail = h.sent[0];
  assert.equal(mail.from, "AIN <bot@example.com>");
  assert.equal(mail.to, "jsh@aincustoms.com");
  assert.equal(mail.cc, "jhcho@aincustoms.com");
  assert.equal(mail.replyTo, "hong@example.co.kr");
  assert.equal(mail.subject, "[홈페이지 문의] FTA·원산지 - 홍<b>길동</b> Bcc: evil@example.com");
  assert.doesNotMatch(mail.subject, /[\r\n]/);
  assert.match(mail.text, /성함: 홍<b>길동<\/b> Bcc: evil@example.com/);
  assert.match(mail.text, /회사명: A&B "상사"/);
  assert.match(mail.text, /연락처: 010-1234-5678/);
  assert.match(mail.text, /접수 시각: 2026\. 10\. 12\. 오전 10:30:00 \(KST\)/);
  assert.match(mail.text, /개인정보 수집·이용 동의: Y/);
  assert.match(mail.text, /<script>alert\(1\)<\/script>\n둘째 줄/);
  assert.doesNotMatch(mail.html, /<script>|<b>길동/);
  assert.match(mail.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;<br>둘째 줄 &amp; &#39;quote&#39;/);
  assert.match(mail.html, /A&amp;B &quot;상사&quot;/);
  assert.equal(errors.length, 0, "successful sends log nothing");
});

test("delivery failure returns 502 and logs no personal data", async () => {
  const h = harness({ fail: true });
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  let res;
  try { res = await h.call(validBody()); } finally { console.error = originalError; }
  assert.equal(res.statusCode, 502);
  assert.match(res.json.message, /02-518-5435/);
  const logged = errors.join("\n");
  assert.match(logged, /ECONNECTION/);
  for (const secret of ["홍길동", "hong@example.co.kr", "010-1234-5678", "HS 코드"]) assert.ok(!logged.includes(secret), secret);
});

test("homepage #contact contains the inquiry form posting to /api/contact", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const start = html.indexOf('<section id="contact"');
  const end = html.indexOf("</section>", start);
  assert.ok(start > 0 && end > start);
  const section = html.slice(start, end);
  assert.ok(section.indexOf("전문 상담 신청") < section.indexOf('id="contactForm"'), "form sits after the consultation card");
  const form = section.slice(section.indexOf("<form id=\"contactForm\""), section.indexOf("</form>"));
  assert.match(form, /data-endpoint="\/api\/contact"/);
  assert.match(form, /<input type="checkbox" id="contactConsent" name="consent"[^>]*\brequired\b/);
  assert.match(form, /id="contactName" name="name" required/);
  assert.match(form, /type="email" id="contactEmail" name="email" required/);
  assert.match(form, /name="message" required minlength="10" maxlength="3000"/);
  assert.match(form, /name="website" tabindex="-1"/);
  assert.match(form, /id="contactTs" name="ts"/);
  for (const option of contact.INQUIRY_TYPES) assert.ok(form.includes(`<option>${option}</option>`), option);
  for (const notice of ["성함, 회사명, 이메일, 연락처, 문의 내용", "문의 답변", "문의 처리 후 1년", "거부 시 문의 접수가 불가"]) assert.ok(form.includes(notice), notice);
  assert.match(section, /<noscript>[^]*jsh@aincustoms\.com[^]*02-518-5435[^]*<\/noscript>/);
  assert.match(section, /fetch\(form\.getAttribute\('data-endpoint'\)[^]*method: 'POST'[^]*application\/json/);
  assert.match(section, /문의가 접수되었습니다\. 영업일 기준 1~2일 내 회신드리겠습니다\./);
  assert.match(section, /id="contactSubmit" disabled/, "submit is enabled only once the script runs");
});
