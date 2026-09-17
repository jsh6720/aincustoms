"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createInternalShareHandler, readConfig, withCredentialState, issueSession,
  csrfToken, verifyPassword, parsePasswordHash, COOKIE } = require("../lib/internal-share-server");

// Every credential and upstream response below is synthetic; no live service is used.
const NOW = 1790000000000;
const OLD = "synthetic-original-password", NEW = "synthetic-changed-password";
function fixtureHash(password, byte) {
  const salt = Buffer.alloc(24, byte);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt:${salt.toString("base64url")}:${key.toString("base64url")}`;
}
const OLD_HASH = fixtureHash(OLD, 21), NEW_HASH = fixtureHash(NEW, 22);
const ENV = Object.freeze({ INTERNAL_SHARE_PASSWORD_HASH: OLD_HASH,
  INTERNAL_SHARE_SESSION_SECRET: "synthetic-password-test-session-secret-at-least-32-characters",
  SUPABASE_URL: "https://password-test.example.com",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-password-test-service-key" });
function request(method = "GET", body, extra = {}) {
  return { method, body, query: extra.query || {}, headers: {
    host: "share.example.com", origin: "https://share.example.com",
    "content-type": "application/json", "x-forwarded-for": "203.0.113.65",
    ...(extra.headers || {}) }, socket: { remoteAddress: "203.0.113.65" } };
}
function response() {
  return { statusCode: null, body: null, headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; } };
}
function upstream(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}
function harness(options = {}) {
  const state = { revision: 0, password_hash: null, ...(options.state || {}) }, calls = [];
  let outage = false;
  const handler = createInternalShareHandler({ env: ENV, now: () => NOW,
    ...(options.passwordVerifier ? { passwordVerifier: options.passwordVerifier } : {}),
    fetch: async (url, init) => {
      const name = new URL(url).pathname.split("/").at(-1), body = JSON.parse(init.body);
      calls.push({ name, body });
      assert.equal(init.method, "POST");
      assert.equal(init.headers.apikey, ENV.SUPABASE_SERVICE_ROLE_KEY);
      assert.equal(init.headers.Authorization, `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
      if (name === "internal_share_auth_state") {
        if (outage) throw new Error("synthetic private upstream failure");
        return options.authResponse ? options.authResponse() : upstream({ ...state });
      }
      if (name === "internal_share_login_guard") return upstream(options.guardResponse === undefined
        ? { allowed: true, attempt_id: crypto.randomUUID() } : options.guardResponse);
      if (name === "internal_share_login_complete") return upstream(options.completeResponse ?? true);
      if (name === "internal_share_password_change") {
        if (options.beforeChange) await options.beforeChange();
        if (body.p_expected_revision !== state.revision) return upstream({ changed: false });
        state.password_hash = body.p_password_hash;
        state.revision++;
        if (options.loseChangeReply) throw new Error("synthetic committed response lost");
        return upstream({ changed: true, revision: state.revision });
      }
      assert.fail(`Unexpected database operation: ${name}`);
    } });
  return { state, calls,
    setOutage(value) { outage = value; },
    async run(req) { const res = response(); await handler(req, res); return res; },
    auth() {
      const config = withCredentialState(readConfig(ENV), state), issued = issueSession(config, NOW);
      return { cookie: `${COOKIE}=${issued.token}`, csrf: csrfToken(config, issued.data) };
    } };
}
function change(auth, patch = {}, extra = {}) {
  return request("POST", { action: "change_password", csrf: auth.csrf, currentPassword: OLD,
    newPassword: NEW, confirmPassword: NEW, ...patch },
  { ...extra, headers: { cookie: auth.cookie, ...(extra.headers || {}) } });
}
function called(h, name) { return h.calls.filter(call => call.name === `internal_share_${name}`); }

test("password change requires a valid cookie, matching HTTPS origin and session CSRF", async () => {
  const h = harness(), auth = h.auth();
  for (const [req, status] of [
    [change(auth, {}, { headers: { cookie: undefined } }), 401],
    [change(auth, {}, { headers: { origin: undefined } }), 403],
    [change(auth, {}, { headers: { origin: "https://other.example.com" } }), 403],
    [change(auth, {}, { headers: { origin: "http://share.example.com" } }), 403],
    [change(auth, { csrf: "forged" }), 403], [change(auth, { csrf: h.auth().csrf }), 403],
  ]) assert.equal((await h.run(req)).statusCode, status);
  assert.equal(called(h, "login_guard").length, 0);
  assert.equal(called(h, "password_change").length, 0);
  assert.deepEqual(h.state, { revision: 0, password_hash: null });
});

test("weak, mismatching, unchanged and malformed passwords never reach mutation or guard", async () => {
  const h = harness(), auth = h.auth();
  for (const patch of [
    { newPassword: "tiny5", confirmPassword: "tiny5" },
    { newPassword: "x".repeat(129), confirmPassword: "x".repeat(129) },
    { newPassword: "한".repeat(1025), confirmPassword: "한".repeat(1025) },
    { confirmPassword: NEW + "-different" }, { newPassword: OLD, confirmPassword: OLD },
    { currentPassword: "" }, { currentPassword: "한".repeat(342) },
    { currentPassword: null }, { newPassword: 12345678 }, { confirmPassword: null },
  ]) {
    const res = await h.run(change(auth, patch));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "INVALID_NEW_PASSWORD");
  }
  assert.equal(called(h, "login_guard").length, 0);
  assert.equal(called(h, "password_change").length, 0);
});

test("new passwords reject five characters and accept exactly six for change and login", async () => {
  const h = harness(), auth = h.auth(), five = "tiny5", six = "new6!?";
  const rejected = await h.run(change(auth, { newPassword: five, confirmPassword: five }));
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.body.error, "INVALID_NEW_PASSWORD");
  assert.equal(called(h, "login_guard").length, 0);
  assert.equal(called(h, "password_change").length, 0);
  assert.deepEqual(h.state, { revision: 0, password_hash: null });

  const changed = await h.run(change(auth, { newPassword: six, confirmPassword: six }));
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.body.passwordChanged, true);
  assert.equal(h.state.revision, 1);
  assert.equal(called(h, "password_change").length, 1);
  assert.equal(await verifyPassword(six, parsePasswordHash(h.state.password_hash)), true);
  const login = await h.run(request("POST", { action: "login", password: six }));
  assert.equal(login.statusCode, 200);
  assert.equal(login.body.authenticated, true);
});

test("existing five-character passwords remain valid for login and current-password confirmation", async () => {
  const existing = "old5!", six = "new6!?";
  const h = harness({ state: { revision: 1, password_hash: fixtureHash(existing, 23) } });
  const login = await h.run(request("POST", { action: "login", password: existing }));
  assert.equal(login.statusCode, 200);
  assert.equal(login.body.authenticated, true);
  const auth = { cookie: login.headers["set-cookie"].split(";")[0], csrf: login.body.csrf };
  const changed = await h.run(change(auth, {
    currentPassword: existing, newPassword: six, confirmPassword: six,
  }));
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.body.passwordChanged, true);
  assert.equal(h.state.revision, 2);
  assert.equal(called(h, "password_change").length, 1);
  assert.equal(await verifyPassword(six, parsePasswordHash(h.state.password_hash)), true);
});

test("wrong current password consumes one durable attempt without completing it", async () => {
  const h = harness(), res = await h.run(change(h.auth(), { currentPassword: "synthetic-wrong" }));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "INVALID_PASSWORD");
  assert.equal(called(h, "login_guard").length, 1);
  assert.equal(called(h, "login_complete").length, 0);
  assert.equal(called(h, "password_change").length, 0);
  assert.equal(h.state.revision, 0);
  assert.equal(res.headers["set-cookie"], undefined);
});

test("guard refusal or malformed response prevents current-password verification", async () => {
  for (const [guardResponse, status] of [[{ allowed: false, retry_after: 67 }, 429],
    [null, 503], [{ allowed: true }, 503], [{ allowed: "true" }, 503]]) {
    const h = harness({ guardResponse,
      passwordVerifier: () => assert.fail("durable guard must precede verification") });
    const res = await h.run(change(h.auth()));
    assert.equal(res.statusCode, status);
    assert.equal(h.state.revision, 0);
    assert.equal(called(h, "password_change").length, 0);
    if (status === 429) assert.equal(res.headers["retry-after"], "67");
  }
});

test("durable completion failure prevents password replacement", async () => {
  const h = harness({ completeResponse: false }), res = await h.run(change(h.auth()));
  assert.equal(res.statusCode, 503);
  assert.equal(called(h, "login_complete").length, 1);
  assert.equal(called(h, "password_change").length, 0);
  assert.equal(h.state.revision, 0);
});

test("rotation clears cookie, invalidates all old sessions and password, and permits new login", async () => {
  const h = harness(), first = h.auth(), second = h.auth(), res = await h.run(change(first));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { authenticated: false, passwordChanged: true });
  assert.match(res.headers["set-cookie"], new RegExp(`^${COOKIE}=;`));
  assert.match(res.headers["set-cookie"], /; HttpOnly; Secure; SameSite=Strict; Max-Age=0$/);
  assert.match(res.headers["cache-control"], /no-store/);
  assert.equal(h.state.revision, 1);
  assert.notEqual(h.state.password_hash, OLD_HASH);
  assert.notDeepEqual(parsePasswordHash(h.state.password_hash).salt, parsePasswordHash(OLD_HASH).salt);
  assert.equal(await verifyPassword(NEW, parsePasswordHash(h.state.password_hash)), true);
  assert.deepEqual(called(h, "password_change")[0].body,
    { p_expected_revision: 0, p_password_hash: h.state.password_hash });
  assert.doesNotMatch(JSON.stringify(res.body), /synthetic|scrypt|password_hash|revision/);
  for (const auth of [first, second]) {
    const session = await h.run(request("GET", undefined, { headers: { cookie: auth.cookie } }));
    assert.deepEqual(session.body, { authenticated: false });
    assert.equal((await h.run(change(auth))).statusCode, 401);
  }
  assert.equal((await h.run(request("POST", { action: "login", password: OLD }))).statusCode, 401);
  const login = await h.run(request("POST", { action: "login", password: NEW }));
  assert.equal(login.statusCode, 200);
  assert.equal(login.body.authenticated, true);
  const session = await h.run(request("GET", undefined,
    { headers: { cookie: login.headers["set-cookie"].split(";")[0] } }));
  assert.deepEqual(session.body, { authenticated: true, csrf: login.body.csrf });
});

test("DB credentials override a still-valid old environment hash and its sessions", async () => {
  const h = harness({ state: { revision: 9, password_hash: NEW_HASH } });
  const issued = issueSession(readConfig(ENV), NOW);
  const session = await h.run(request("GET", undefined, { headers: { cookie: `${COOKIE}=${issued.token}` } }));
  assert.deepEqual(session.body, { authenticated: false });
  assert.equal((await h.run(request("POST", { action: "login", password: OLD }))).statusCode, 401);
  const login = await h.run(request("POST", { action: "login", password: NEW }));
  assert.equal(login.statusCode, 200);
  assert.equal(login.body.authenticated, true);
});

test("each request loads fresh credentials even when the handler instance is reused", async () => {
  const h = harness(), auth = h.auth(), req = request("GET", undefined, { headers: { cookie: auth.cookie } });
  assert.equal((await h.run(req)).body.authenticated, true);
  h.state.password_hash = NEW_HASH;
  h.state.revision = 1;
  assert.equal((await h.run(req)).body.authenticated, false);
  assert.equal(called(h, "auth_state").length, 2);
});

test("concurrent requests using one revision commit only one new password", { timeout: 10000 }, async () => {
  let arrived = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const h = harness({ beforeChange: async () => { if (++arrived === 2) release(); await barrier; } });
  const auth = h.auth(), other = "synthetic-concurrent-password";
  const results = await Promise.all([h.run(change(auth)),
    h.run(change(auth, { newPassword: other, confirmPassword: other }))]);
  assert.deepEqual(results.map(res => res.statusCode).sort(), [200, 409]);
  assert.equal(results.find(res => res.statusCode === 409).body.error, "PASSWORD_CHANGED");
  assert.equal(h.state.revision, 1);
  assert.equal(called(h, "password_change").length, 2);
  assert.ok(called(h, "password_change").every(call => call.body.p_expected_revision === 0));
  const winner = results[0].statusCode === 200 ? NEW : other, loser = results[0].statusCode === 200 ? other : NEW;
  assert.equal(await verifyPassword(winner, parsePasswordHash(h.state.password_hash)), true);
  assert.equal(await verifyPassword(loser, parsePasswordHash(h.state.password_hash)), false);
});

test("lost reply after commit cannot reactivate an old password or old session", async () => {
  const h = harness({ loseChangeReply: true }), auth = h.auth(), res = await h.run(change(auth));
  assert.equal(res.statusCode, 503);
  assert.equal(h.state.revision, 1);
  assert.doesNotMatch(JSON.stringify(res.body), /committed|synthetic|private|scrypt/);
  const session = await h.run(request("GET", undefined, { headers: { cookie: auth.cookie } }));
  assert.equal(session.body.authenticated, false);
  assert.equal((await h.run(change(auth))).statusCode, 401);
  assert.equal(called(h, "password_change").length, 1);
  const login = await h.run(request("POST", { action: "login", password: NEW }));
  assert.equal(login.statusCode, 200);
  assert.equal(login.body.authenticated, true);
});

test("auth-state outages fail closed without any bootstrap fallback", async () => {
  const h = harness(), auth = h.auth();
  h.setOutage(true);
  for (const req of [request("GET", undefined, { headers: { cookie: auth.cookie } }),
    request("GET", undefined, { headers: { cookie: auth.cookie }, query: { action: "sync", after: "0" } }),
    request("POST", { action: "login", password: OLD }), change(auth)]) {
    const res = await h.run(req);
    assert.equal(res.statusCode, 503);
    assert.equal(res.headers["set-cookie"], undefined);
    assert.doesNotMatch(JSON.stringify(res.body), /synthetic|private|scrypt/);
  }
  assert.ok(h.calls.every(call => call.name === "internal_share_auth_state"));
  assert.equal(h.state.revision, 0);
});

test("missing, inconsistent, malformed or unavailable auth state never falls back", async () => {
  for (const value of [null, {}, [], { revision: "0", password_hash: null },
    { revision: -1, password_hash: null }, { revision: Number.MAX_SAFE_INTEGER + 1, password_hash: NEW_HASH },
    { revision: 0, password_hash: NEW_HASH }, { revision: 1, password_hash: null },
    { revision: 1, password_hash: "scrypt:malformed:malformed" },
    { revision: 1, password_hash: OLD_HASH + "=" }]) {
    const h = harness({ authResponse: () => upstream(value) });
    const res = await h.run(request("POST", { action: "login", password: OLD }));
    assert.equal(res.statusCode, 503);
    assert.equal(res.headers["set-cookie"], undefined);
    assert.equal(called(h, "login_guard").length, 0);
  }
  for (const authResponse of [
    () => upstream({ code: "PGRST202", message: "synthetic missing function" }, 404),
    () => ({ ok: true, json: async () => { throw new Error("synthetic invalid JSON"); } }),
  ]) {
    const h = harness({ authResponse });
    assert.equal((await h.run(request("POST", { action: "login", password: OLD }))).statusCode, 503);
    assert.equal(called(h, "login_guard").length, 0);
  }
});
