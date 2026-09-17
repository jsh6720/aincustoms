"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Y = require("yjs");
const {
  createInternalShareHandler, readConfig, issueSession, readSession, csrfToken, verifyPassword,
  COOKIE, SESSION_SECONDS, BODY_LIMIT, UPDATE_LIMIT, SYNC_PAGE,
} = require("../lib/internal-share-server");

const NOW = 1790000000000;
const PASSWORD = "test-only-shared-password";
const salt = Buffer.alloc(24, 17);
const key = crypto.scryptSync(PASSWORD, salt, 64, { N: 16384, r: 8, p: 1 });
const ENV = Object.freeze({
  INTERNAL_SHARE_PASSWORD_HASH: `scrypt:${salt.toString("base64url")}:${key.toString("base64url")}`,
  INTERNAL_SHARE_SESSION_SECRET: "test-only-internal-share-session-secret-32chars",
  SUPABASE_URL: "https://example-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-service-key",
});
const ID = "556bd708-f15f-43a1-a73b-f2ae3a624876";
const ATTEMPT = "bdb31e35-a0c3-4d76-8b93-5c750cfb4dab";

function update(text = "서로 같은 문장을 함께 편집합니다.") {
  const doc = new Y.Doc();
  doc.getText("document").insert(0, text);
  const encoded = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
  doc.destroy();
  return encoded;
}
const UPDATE = update();

function request(method = "GET", body, extra = {}) {
  return { method, headers: { host: "share.example.com", origin: "https://share.example.com",
    "content-type": "application/json", "x-forwarded-for": "203.0.113.42", ...(extra.headers || {}) },
    query: extra.query || {}, body, socket: { remoteAddress: "203.0.113.42" } };
}
function response() {
  return { headers: {}, statusCode: null, body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}
async function run(req, options = {}) {
  const res = response();
  const handler = createInternalShareHandler({ env: ENV, now: () => NOW, ...options,
    fetch: (url, init) => url.endsWith('/rpc/internal_share_auth_state')
      ? Promise.resolve(upstream({ revision: 0, password_hash: null }))
      : options.fetch(url, init) });
  await handler(req, res);
  return res;
}
function authenticated(extra = {}, config = readConfig(ENV), time = NOW) {
  const issued = issueSession(config, time);
  return { cookie: `${COOKIE}=${issued.token}`, csrf: csrfToken(config, issued.data), ...extra };
}
function authedRequest(body = {}, extra = {}) {
  const auth = authenticated();
  return request("POST", { action: "append", csrf: auth.csrf, op_id: ID, update: UPDATE, ...body },
    { ...extra, headers: { cookie: auth.cookie, ...(extra.headers || {}) } });
}
function upstream(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

test("missing or malformed configuration fails closed without exposing values", async () => {
  for (const patch of [
    { INTERNAL_SHARE_PASSWORD_HASH: "" }, { INTERNAL_SHARE_SESSION_SECRET: "short" },
    { INTERNAL_SHARE_PASSWORD_HASH: "scrypt:invalid:invalid" }, { SUPABASE_SERVICE_ROLE_KEY: "" },
    { SUPABASE_URL: "http://bad.local" }, { SUPABASE_URL: "https://user:password@example.com" },
  ]) {
    const res = await run(request(), { env: { ...ENV, ...patch }, fetch: () => assert.fail("no storage call") });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(Object.keys(res.body).sort(), ["error", "message"]);
    assert.doesNotMatch(JSON.stringify(res.body), /test-only|SUPABASE|scrypt|password@example/);
  }
});

test("scrypt verifies the configured password and rejects a different password", async () => {
  assert.equal(await verifyPassword(PASSWORD, readConfig(ENV)), true);
  assert.equal(await verifyPassword(`${PASSWORD}-wrong`, readConfig(ENV)), false);
});

test("session requires its own cookie, audience, version, lifetime, and intact signature", async () => {
  const config = readConfig(ENV);
  const valid = issueSession(config, NOW);
  const forged = `${valid.token.slice(0, -1)}${valid.token.endsWith("A") ? "B" : "A"}`;
  const signData = data => {
    const part = Buffer.from(JSON.stringify(data)).toString("base64url");
    const signingKey = crypto.createHmac("sha256", config.secret)
      .update(`internal-share-auth-v1:${config.salt.toString("base64url")}:${config.key.toString("base64url")}`).digest();
    return `${part}.${crypto.createHmac("sha256", signingKey).update(part).digest("base64url")}`;
  };
  for (const cookie of [undefined, "cargo_session=existing-cargo-session", `${COOKIE}=${forged}`,
    `${COOKIE}=${issueSession(config, NOW - SESSION_SECONDS * 1000).token}`,
    `${COOKIE}=${issueSession(config, NOW + 120000).token}`,
    `${COOKIE}=${signData({ ...valid.data, aud: "cargo" })}`,
    `${COOKIE}=${signData({ ...valid.data, v: 2 })}`,
    `${COOKIE}=${signData({ ...valid.data, exp: valid.data.exp + 1 })}`,
    `${COOKIE}=${valid.token}; ${COOKIE}=${valid.token}`]) {
    const res = await run(request("GET", undefined, { headers: { cookie } }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { authenticated: false });
  }
  const res = await run(request("GET", undefined, { headers: { cookie: `${COOKIE}=${valid.token}` } }));
  assert.deepEqual(res.body, { authenticated: true, csrf: csrfToken(config, valid.data) });
  assert.equal(readSession(request("GET", undefined, { headers: { cookie: `${COOKIE}=${valid.token}` } }),
    { ...config, secret: `${config.secret}-rotated` }, NOW), null);
  assert.equal(readSession(request("GET", undefined, { headers: { cookie: `${COOKIE}=${valid.token}` } }),
    { ...config, key: Buffer.alloc(64, 3) }, NOW), null);
  assert.equal(readSession(request("GET", undefined, { headers: { cookie: `${COOKIE}=${valid.token}` } }),
    { ...config, salt: Buffer.alloc(24, 4) }, NOW), null);
});

test("successful login checks durable reservation before scrypt and releases it before setting cookie", async () => {
  const calls = [];
  let reservedKey;
  const res = await run(request("POST", { action: "login", password: PASSWORD }), {
    passwordVerifier: async () => { calls.push("verify"); return true; },
    fetch: async (url, options) => {
      assert.equal(options.headers.apikey, ENV.SUPABASE_SERVICE_ROLE_KEY);
      assert.equal(options.headers.Authorization, `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
      const payload = JSON.parse(options.body);
      if (url.endsWith("/rpc/internal_share_login_guard")) {
        calls.push("guard");
        assert.match(payload.p_client_key, /^[0-9a-f]{64}$/);
        assert.doesNotMatch(payload.p_client_key, /203\.0\.113/);
        reservedKey = payload.p_client_key;
        return upstream({ allowed: true, attempt_id: ATTEMPT });
      }
      assert.ok(url.endsWith("/rpc/internal_share_login_complete"));
      calls.push("complete");
      assert.deepEqual(payload, { p_client_key: reservedKey, p_attempt_id: ATTEMPT });
      return upstream(true);
    },
  });
  assert.deepEqual(calls, ["guard", "verify", "complete"]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.authenticated, true);
  assert.match(res.headers["set-cookie"], new RegExp(`^${COOKIE}=`));
  assert.match(res.headers["set-cookie"], /; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800$/);
  assert.match(res.headers["cache-control"], /no-store/);
  const session = await run(request("GET", undefined, { headers: { cookie: res.headers["set-cookie"].split(";")[0] } }));
  assert.equal(session.body.csrf, res.body.csrf);
  assert.doesNotMatch(JSON.stringify(res.body), /test-only|203\.0\.113/);
});

test("bad password consumes the reservation and never completes it", async () => {
  let storageCalls = 0;
  const res = await run(request("POST", { action: "login", password: "wrong" }), {
    passwordVerifier: async () => false,
    fetch: async url => { storageCalls++; assert.ok(url.endsWith("login_guard"));
      return upstream({ allowed: true, attempt_id: ATTEMPT }); },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(storageCalls, 1);
  assert.equal(res.headers["set-cookie"], undefined);
});

test("rate guard refusal or outage prevents scrypt and never grants a session", async () => {
  for (const [reply, status] of [[{ allowed: false, retry_after: 321 }, 429], [null, 503],
    [{ allowed: true }, 503], [{ allowed: "true" }, 503]]) {
    const res = await run(request("POST", { action: "login", password: PASSWORD }), {
      passwordVerifier: () => assert.fail("password work must follow valid durable guard"),
      fetch: async () => upstream(reply),
    });
    assert.equal(res.statusCode, status);
    assert.equal(res.headers["set-cookie"], undefined);
    if (status === 429) assert.equal(res.headers["retry-after"], "321");
  }
  const res = await run(request("POST", { action: "login", password: PASSWORD }), {
    passwordVerifier: () => assert.fail("guard outage must fail closed"),
    fetch: async () => { throw new Error("raw SQL and service-key secret"); },
  });
  assert.equal(res.statusCode, 503);
  assert.doesNotMatch(JSON.stringify(res.body), /SQL|service-key|secret/);
});

test("successful password with failed durable completion does not grant a session", async () => {
  const res = await run(request("POST", { action: "login", password: PASSWORD }), {
    passwordVerifier: async () => true,
    fetch: async url => upstream(url.endsWith("login_guard") ? { allowed: true, attempt_id: ATTEMPT } : false),
  });
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers["set-cookie"], undefined);
});

test("all mutations require the same HTTPS origin and JSON content type", async () => {
  for (const headers of [{ origin: undefined }, { origin: "https://attacker.example" },
    { origin: "http://share.example.com" }, { "sec-fetch-site": "cross-site" },
    { host: "share.example.com.attacker.example" }]) {
    const res = await run(request("POST", { action: "login", password: PASSWORD }, { headers }), {
      fetch: () => assert.fail("no storage call for rejected origin"),
    });
    assert.equal(res.statusCode, 403);
  }
  for (const value of ["text/plain", "application/x-www-form-urlencoded", undefined]) {
    const res = await run(authedRequest({}, { headers: { "content-type": value } }));
    assert.equal(res.statusCode, 415);
  }
});

test("sync and append require independent authentication; CSRF protects append and logout", async () => {
  const read = await run(request("GET", undefined, { query: { action: "sync", after: "0" } }));
  assert.equal(read.statusCode, 401);
  const write = await run(request("POST", { action: "append", op_id: ID, update: UPDATE }));
  assert.equal(write.statusCode, 401);
  for (const action of ["append", "logout"]) {
    for (const csrf of [undefined, "forged", authenticated().csrf]) {
      const res = await run(authedRequest({ action, csrf }), { fetch: () => assert.fail("no database mutation") });
      assert.equal(res.statusCode, 403);
    }
  }
  const logout = await run(authedRequest({ action: "logout" }));
  assert.equal(logout.statusCode, 200);
  assert.deepEqual(logout.body, { authenticated: false });
  assert.match(logout.headers["set-cookie"], /Max-Age=0$/);
});

test("append forwards only validated update fields and recognizes idempotent sequence or conflict", async () => {
  const seen = [];
  const fetch = async (url, options) => {
    assert.ok(url.endsWith("/rpc/internal_share_append"));
    seen.push(JSON.parse(options.body));
    return upstream({ seq: 47 });
  };
  for (let index = 0; index < 2; index++) {
    const res = await run(authedRequest({ author: "검토자", ignored: "not forwarded" }), { fetch });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { seq: 47 });
  }
  assert.deepEqual(seen[0], seen[1]);
  assert.deepEqual(seen[0], { p_op_id: ID, p_update_base64: UPDATE, p_author: "검토자" });
  const conflict = await run(authedRequest(), {
    fetch: async () => upstream({ code: "PT409", message: "upstream SQL secret" }, 409),
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.error, "OPERATION_CONFLICT");
  assert.doesNotMatch(JSON.stringify(conflict.body), /upstream|SQL|secret/);
  const capped = await run(authedRequest(), {
    fetch: async () => upstream({ code: "PT413", message: "upstream SQL secret" }, 413),
  });
  assert.equal(capped.statusCode, 413);
  assert.equal(capped.body.error, "DOCUMENT_LIMIT");
});

test("body, base64, Yjs bytes, operation IDs and display-name bounds are enforced", async () => {
  const cases = [
    [{ op_id: "not-a-uuid" }, 400], [{ update: "!invalid" }, 400], [{ update: "AQ==" }, 400],
    [{ update: `${UPDATE}\n` }, 400], [{ update: "" }, 400], [{ update: 123 }, 400],
    [{ update: Buffer.concat([Buffer.from(UPDATE, "base64"), Buffer.from([255])]).toString("base64") }, 400],
    [{ update: Buffer.alloc(UPDATE_LIMIT + 1).toString("base64") }, 413],
    [{ author: "a".repeat(81) }, 400], [{ author: "line\nbreak" }, 400], [{ author: 42 }, 400],
    [{ ignored: "x".repeat(BODY_LIMIT) }, 413],
  ];
  for (const [body, status] of cases) {
    const res = await run(authedRequest(body), { fetch: () => assert.fail("invalid input reached storage") });
    assert.equal(res.statusCode, status, JSON.stringify(body).slice(0, 100));
  }
  const oversized = await run(authedRequest({}, { headers: { "content-length": String(BODY_LIMIT + 1) } }));
  assert.equal(oversized.statusCode, 413);
  const malformed = await run(request("POST", "{bad json"));
  assert.equal(malformed.statusCode, 400);
  const array = await run(request("POST", []));
  assert.equal(array.statusCode, 400);
});

test("a valid 120KB Yjs Undo update can be appended and synchronized", async () => {
  const doc = new Y.Doc();
  const text = doc.getText("document");
  text.insert(0, "a".repeat(120000));
  const undo = new Y.UndoManager(text);
  text.delete(0, text.length);
  let restoredUpdate;
  doc.on("update", value => { restoredUpdate = value; });
  undo.undo();
  assert.equal(text.length, 120000);
  assert.ok(restoredUpdate.byteLength > 120000);
  assert.ok(restoredUpdate.byteLength <= UPDATE_LIMIT);
  const encoded = Buffer.from(restoredUpdate).toString("base64");
  const appended = await run(authedRequest({ update: encoded }), {
    fetch: async (url, options) => {
      assert.ok(url.endsWith("/rpc/internal_share_append"));
      assert.equal(JSON.parse(options.body).p_update_base64, encoded);
      return upstream({ seq: 1 });
    },
  });
  assert.equal(appended.statusCode, 200);
  assert.deepEqual(appended.body, { seq: 1 });
  const auth = authenticated();
  const synced = await run(request("GET", undefined, {
    headers: { cookie: auth.cookie }, query: { action: "sync", after: "0" },
  }), {
    fetch: async () => upstream([{ seq: 1, op_id: ID, update_base64: encoded }]),
  });
  assert.equal(synced.statusCode, 200);
  assert.equal(synced.body.updates[0].update, encoded);
  undo.destroy();
  doc.destroy();
});

test("raw streamed bodies are bounded before JSON decoding", async () => {
  const req = request("POST");
  req[Symbol.asyncIterator] = async function* () { yield Buffer.alloc(BODY_LIMIT); yield Buffer.alloc(1); };
  const res = await run(req, { fetch: () => assert.fail("oversized body reached storage") });
  assert.equal(res.statusCode, 413);
});

test("sync query orders committed rows and returns bounded contiguous pages", async () => {
  const auth = authenticated();
  let requested;
  const res = await run(request("GET", undefined, { headers: { cookie: auth.cookie }, query: { action: "sync", after: "12" } }), {
    fetch: async (url, options) => {
      requested = new URL(url);
      assert.equal(options.method, undefined);
      return upstream(Array.from({ length: SYNC_PAGE + 1 }, (_, index) => ({
        seq: 13 + index, op_id: ID, update_base64: UPDATE,
      })));
    },
  });
  assert.equal(requested.pathname, "/rest/v1/internal_share_updates");
  assert.equal(requested.searchParams.get("document_id"), "eq.team");
  assert.equal(requested.searchParams.get("seq"), "gt.12");
  assert.equal(requested.searchParams.get("order"), "seq.asc");
  assert.equal(requested.searchParams.get("limit"), String(SYNC_PAGE + 1));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.updates.length, SYNC_PAGE);
  assert.deepEqual(res.body.updates[0], { seq: 13, op_id: ID, update: UPDATE });
  assert.equal(res.body.cursor, 12 + SYNC_PAGE);
  assert.equal(res.body.hasMore, true);
  const empty = await run(request("GET", undefined, { headers: { cookie: auth.cookie }, query: { action: "sync", after: "12" } }), {
    fetch: async () => upstream([]),
  });
  assert.deepEqual(empty.body, { updates: [], cursor: 12, hasMore: false });
});

test("sync refuses invalid cursors, missing sequences and malformed upstream updates", async () => {
  const auth = authenticated();
  for (const after of ["-1", "1.5", "1&order=seq.desc", "9007199254740992", ["0", "1"], "01"]) {
    const res = await run(request("GET", undefined, { headers: { cookie: auth.cookie }, query: { action: "sync", after } }), {
      fetch: () => assert.fail("invalid cursor reached storage"),
    });
    assert.equal(res.statusCode, 400);
  }
  for (const rows of [{ secret: "internal" }, [{ seq: 2, op_id: ID, update_base64: UPDATE }],
    [{ seq: 1, op_id: ID, update_base64: "AQ==" }], [{ seq: "1", op_id: ID, update_base64: UPDATE }]]) {
    const res = await run(request("GET", undefined, { headers: { cookie: auth.cookie }, query: { action: "sync", after: "0" } }), {
      fetch: async () => upstream(rows),
    });
    assert.equal(res.statusCode, 503);
    assert.doesNotMatch(JSON.stringify(res.body), /internal|secret/);
  }
});

test("method restrictions and arbitrary upstream errors have fixed public messages", async () => {
  const method = await run(request("DELETE"));
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.allow, "GET, POST");
  const bad = await run(authedRequest(), {
    fetch: async () => upstream({ code: "P0001", message: "SQL query secret credential" }, 500),
  });
  assert.equal(bad.statusCode, 503);
  assert.doesNotMatch(JSON.stringify(bad.body), /SQL|query|secret|credential/);
});

test("migration isolates permissions, reserves attempts durably, and locks sequence until commit", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20260916090000_internal_share.sql"), "utf8");
  assert.doesNotMatch(sql, /(?:alter|insert into|update|delete from)\s+(?:table\s+)?public\.cargo_/i);
  for (const table of ["heads", "updates", "login_attempts"]) {
    assert.match(sql, new RegExp(`alter table public\\.internal_share_${table} enable row level security`, "i"));
  }
  assert.match(sql, /from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant select on table public\.internal_share_updates to service_role/i);
  assert.doesNotMatch(sql, /grant\s+(?:all|insert|update|delete)\s+on\s+table/i);
  assert.match(sql, /before update or delete on public\.internal_share_updates/i);
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*v_count >= 8[\s\S]*insert into public\.internal_share_login_attempts/i);
  assert.match(sql, /a\.succeeded = false[\s\S]*interval '15 minutes'/i);
  assert.match(sql, /set succeeded = true[\s\S]*a\.attempt_id = p_attempt_id and a\.client_key = p_client_key/i);
  const append = sql.slice(sql.indexOf("create function public.internal_share_append"));
  const lockAt = append.indexOf("for update");
  const existingAt = append.indexOf("select * into v_existing");
  const insertAt = append.indexOf("insert into public.internal_share_updates");
  const advanceAt = append.indexOf("update public.internal_share_heads");
  assert.ok(lockAt > 0 && lockAt < existingAt && existingAt < insertAt && insertAt < advanceAt);
  assert.match(append, /v_existing\.update_base64 <> v_canonical[\s\S]*PT409[\s\S]*v_existing\.seq/);
  assert.match(append, /67108864[\s\S]*PT413/);
  assert.match(sql, /update_bytes between 1 and 524288/);
  assert.match(append, /char_length\(p_update_base64\) > 699052/);
  assert.match(append, /v_size > 524288/);
  assert.doesNotMatch(append, /nextval\s*\(|delete\s+from|truncate\s+|update\s+public\.internal_share_updates/i);
  for (const signature of ["internal_share_login_guard\\(text\\)", "internal_share_login_complete\\(text, uuid\\)",
    "internal_share_append\\(uuid, text, text\\)"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${signature} from public, anon, authenticated`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${signature} to service_role`, "i"));
  }
});
