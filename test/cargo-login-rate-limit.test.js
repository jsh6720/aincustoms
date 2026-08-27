const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const handlerPath = path.join(root, "api/cargo-login.js");
const migrationPath = path.join(
  root,
  "supabase/migrations/20260828090000_add_operational_hardening.sql"
);

function createResponse() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function loadLoginHandler({ rows, onFetch }) {
  const originalLoad = Module._load;
  delete require.cache[handlerPath];
  Module._load = function mockedLoad(request, parent, isMain) {
    if (parent?.filename === handlerPath && request === "../lib/cargo-auth") {
      return {
        createSession: () => "signed-session",
        deriveLoginClientKey: () => "a".repeat(64),
        supabaseFetch: async (url, options) => {
          if (onFetch) onFetch(url, options);
          return rows;
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(handlerPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[handlerPath];
  }
}

test("login throttle key is HMAC-derived from normalized IP and lowercase login", () => {
  process.env.CARGO_SESSION_SECRET = "test-rate-limit-secret";
  const { deriveLoginClientKey } = require("../lib/cargo-auth");
  const first = deriveLoginClientKey({
    headers: { "x-forwarded-for": "203.0.113.10" },
  }, " HCH ");
  const second = deriveLoginClientKey({
    headers: { "x-forwarded-for": "203.0.113.10" },
  }, "hch");
  const otherIp = deriveLoginClientKey({
    headers: { "x-forwarded-for": "203.0.113.11" },
  }, "hch");

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
  assert.notEqual(first, otherIp);
  assert.doesNotMatch(first, /HCH|203\.0\.113/);
  delete process.env.CARGO_SESSION_SECRET;
});

test("login uses the guarded RPC and passes only one opaque throttle key", async () => {
  let call;
  const handler = loadLoginHandler({
    rows: [{
      id: "account-1",
      login_id: "HCH",
      display_name: "현대코퍼레이션H",
      consignee_filter: "현대코",
      role: "shipper",
      account_category: "shipper",
      calendar_preferences: {},
      login_allowed: true,
    }],
    onFetch: (url, options) => { call = { url, body: JSON.parse(options.body) }; },
  });
  const response = createResponse();

  await handler({
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.10" },
    body: { login_id: "hch", password: "not-recorded-in-test" },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(call.url, "/rest/v1/rpc/verify_shipper_login_guarded");
  assert.equal(call.body.p_client_key, "a".repeat(64));
  assert.equal(Object.hasOwn(call.body, "p_client_ip"), false);
  assert.match(response.headers["Set-Cookie"], /^cargo_session=signed-session/);
});

test("nonexistent, wrong-password, and locked login outcomes share one response", async () => {
  const outcomes = [
    [],
    [{ login_allowed: false, id: null }],
    [{ login_allowed: false, id: null, locked_until: "ignored" }],
  ];
  const responses = [];

  for (const rows of outcomes) {
    const handler = loadLoginHandler({ rows });
    const response = createResponse();
    await handler({
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.10" },
      body: { login_id: "unknown", password: "wrong" },
    }, response);
    responses.push({ statusCode: response.statusCode, body: response.body });
  }

  assert.deepEqual(responses[0], responses[1]);
  assert.deepEqual(responses[1], responses[2]);
  assert.deepEqual(responses[0], {
    statusCode: 401,
    body: { success: false, message: "로그인 정보가 일치하지 않습니다." },
  });
});

test("migration stores only the opaque key and enforces five failures in fifteen minutes", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  const tableBlock = sql.match(
    /create table if not exists public\.cargo_login_rate_limits[\s\S]*?;/
  )?.[0] || "";
  const functionBlock = sql.match(
    /create function public\.verify_shipper_login_guarded[\s\S]*?\$\$;/
  )?.[0] || "";

  assert.match(tableBlock, /client_key text primary key/i);
  assert.match(tableBlock, /failure_count integer/i);
  assert.match(tableBlock, /window_started_at timestamptz/i);
  assert.match(tableBlock, /locked_until timestamptz/i);
  assert.doesNotMatch(tableBlock, /ip_address|login_id|raw_/i);
  assert.match(functionBlock, /failure_count[\s\S]*>=\s*5/i);
  assert.match(functionBlock, /interval '15 minutes'/i);
  assert.match(functionBlock, /for update/i);
  assert.match(functionBlock, /lower\(.*login_id/i);
  assert.match(functionBlock, /login_allowed boolean/i);
  assert.match(functionBlock, /security definer[\s\S]*set search_path = ''/i);
  assert.match(
    sql,
    /revoke all on function public\.verify_shipper_login_guarded\(text, text, text\)[\s\S]*from public, anon, authenticated/i
  );
  assert.match(
    sql,
    /grant execute on function public\.verify_shipper_login_guarded\(text, text, text\)[\s\S]*to service_role/i
  );
});
