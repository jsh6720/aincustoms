"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");
const { createInternalShareHandler, readConfig, issueSession, csrfToken, COOKIE, BODY_LIMIT, UPDATE_LIMIT } = require("../lib/internal-share-server");
const { validatePng, parseImage, crc32, IMAGE_LIMIT, IMAGE_BODY_LIMIT } = require("../lib/internal-share-images");

const NOW = 1790000000000;
const ENV = {
  INTERNAL_SHARE_PASSWORD_HASH: `scrypt:${Buffer.alloc(24, 21).toString("base64url")}:${Buffer.alloc(64, 31).toString("base64url")}`,
  INTERNAL_SHARE_SESSION_SECRET: "image-unit-tests-only-session-secret-32-characters",
  SUPABASE_URL: "https://image-test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-only-service-role",
};
function fail(status, code) { throw Object.assign(new Error(code), { status, code }); }
function chunk(kind, data) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length); bytes.write(kind, 4, 4, "ascii"); data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, bytes.length - 4)), bytes.length - 4);
  return bytes;
}
function png(width = 2, height = 2, options = {}) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = options.color || 6; ihdr[12] = options.interlace || 0;
  const row = width * (ihdr[9] === 2 ? 3 : 4) + 1;
  const raw = options.raw || Buffer.alloc(row * height, 0);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    ...(options.extra || []), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PNG = png(), DATA = PNG.toString("base64"), META = validatePng(PNG, fail), ID = META.id;
function mockStore(options = {}) {
  const calls = [], entries = new Map(), objects = new Map();
  let revision = 0, passwordHash = null;
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  return { calls, entries, objects,
    rotate() { revision++; passwordHash = `scrypt:${Buffer.alloc(24, 11).toString("base64url")}:${Buffer.alloc(64, 51).toString("base64url")}`; },
    async fetch(url, init) {
      calls.push({ url, init });
      assert.equal(init.headers.Authorization, `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
      if (url.endsWith("/internal_share_auth_state")) return options.authFail ? json({}, 500) : json({ revision, password_hash: passwordHash });
      if (url.includes("/rest/v1/rpc/")) {
        const body = JSON.parse(init.body);
        if (url.endsWith("/internal_share_image_reserve")) {
          if (options.quota) return json({ code: "PT413", message: "secret upstream message" }, 413);
          if (!entries.has(body.p_id)) entries.set(body.p_id, { id: body.p_id, bytes: body.p_bytes, width: body.p_width, height: body.p_height, mime: "image/png", ready: false });
          return json(entries.get(body.p_id));
        }
        if (url.endsWith("/internal_share_image_complete")) {
          if (options.completeFail) return json({}, 500);
          entries.get(body.p_id).ready = true; return json(entries.get(body.p_id));
        }
        if (url.endsWith("/internal_share_image_read")) return json(entries.get(body.p_id)?.ready ? entries.get(body.p_id) : null);
        assert.fail(`Unexpected RPC ${url}`);
      }
      assert.match(url, /\/storage\/v1\/object\/(?:authenticated\/)?internal-note-images\/[a-f0-9]{64}\.png$/);
      assert.equal(init.redirect, "error");
      const id = url.match(/([a-f0-9]{64})\.png$/)[1];
      if (init.method === "POST") {
        assert.doesNotMatch(url, /\/authenticated\//);
        assert.equal(init.headers["x-upsert"], "false"); assert.equal(init.headers["Content-Type"], "image/png");
        if (options.uploadFail) return json({}, 500);
        if (objects.has(id)) return json({ error: "Duplicate" }, 409);
        objects.set(id, Buffer.from(init.body));
        if (options.lostAck) throw new Error("server wrote but response was dropped");
        return json({ Key: id });
      }
      assert.match(url, /\/object\/authenticated\//);
      if (!objects.has(id)) return json({}, 404);
      return new Response(objects.get(id), { headers: { "Content-Type": "image/png", ...(options.contentLength ? { "Content-Length": options.contentLength } : {}) } });
    },
  };
}
function auth() {
  const config = readConfig(ENV), issued = issueSession(config, NOW);
  return { cookie: `${COOKIE}=${issued.token}`, csrf: csrfToken(config, issued.data) };
}
function req(action = "image_upload", extra = {}) {
  const authenticated = auth();
  return { method: "POST", query: {}, body: { action, csrf: authenticated.csrf, data: DATA, ...(extra.body || {}) },
    headers: { host: "notes.example.test", origin: "https://notes.example.test", "content-type": "application/json",
      cookie: authenticated.cookie, ...(extra.headers || {}) }, ...Object.fromEntries(Object.entries(extra).filter(([key]) => !["body", "headers"].includes(key))) };
}
function readReq(id = ID, extra = {}) { return req("unused", { method: "GET", query: { action: "image", id }, ...extra }); }
async function run(request, store = mockStore()) {
  const res = { statusCode: 0, headers: {}, body: null,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    status(status) { this.statusCode = status; return this; },
    json(body) { this.body = body; return this; }, end(body) { this.body = body; return this; } };
  await createInternalShareHandler({ env: ENV, now: () => NOW, fetch: store.fetch })(request, res);
  return res;
}

test("ordinary normalized RGBA/RGB PNG and ancillary density validate exactly", () => {
  assert.deepEqual(parseImage(DATA, fail).metadata, META);
  assert.equal(validatePng(png(2, 2, { color: 2 }), fail).mime, "image/png");
  assert.equal(validatePng(png(2, 2, { extra: [chunk("pHYs", Buffer.alloc(9))] }), fail).width, 2);
});

test("PNG rejects corrupt chunks, decompression bombs, filters, metadata, animation and trailing bytes", () => {
  const corrupt = Buffer.from(PNG); corrupt[corrupt.length - 1] ^= 1;
  const highBit = Buffer.from(PNG); highBit[12] |= 128;
  highBit.writeUInt32BE(crc32(highBit.subarray(12, 29)), 29);
  const cases = [Buffer.from("<svg>bad</svg>"), Buffer.from("GIF89a"), corrupt, highBit, Buffer.concat([PNG, Buffer.from("tail")]),
    PNG.subarray(0, PNG.length - 1), png(2, 2, { interlace: 1 }), png(2, 2, { color: 3 }),
    png(2, 2, { extra: [chunk("acTL", Buffer.alloc(8))] }), png(2, 2, { extra: [chunk("tEXt", Buffer.from("secret"))] }),
    png(2, 2, { raw: Buffer.alloc(10000) }), png(2, 2, { raw: Buffer.alloc(18, 9) }), png(2, 2, { raw: Buffer.alloc(3) })];
  for (const value of cases) assert.throws(() => validatePng(value, fail), { status: 400, code: "INVALID_IMAGE" });
});

test("PNG dimensions/raw byte limits and canonical base64 are enforced", () => {
  assert.throws(() => validatePng(png(2561, 1), fail), { status: 413 });
  assert.throws(() => validatePng(png(1, 2561), fail), { status: 413 });
  assert.throws(() => validatePng(Buffer.alloc(IMAGE_LIMIT + 1), fail), { status: 413 });
  for (const value of [null, "", "data:image/png;base64," + DATA, DATA + "\n", "https://host/image.png", "a==", 123]) {
    assert.throws(() => parseImage(value, fail), { status: 400 });
  }
  assert.throws(() => parseImage("a".repeat(Math.ceil(IMAGE_LIMIT / 3) * 4 + 1), fail), { status: 413 });
});

test("successful upload stores raw immutable PNG outside the CRDT and repeats idempotently", async () => {
  const store = mockStore(), response = await run(req(), store);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { id: ID, url: `/api/internal-share?action=image&id=${ID}`, mime: "image/png" });
  assert.deepEqual(store.objects.get(ID), PNG); assert.equal(store.entries.get(ID).ready, true);
  assert.equal((await run(req(), store)).statusCode, 200);
  assert.equal(store.calls.filter(call => call.url.includes("/storage/") && call.init.method === "POST").length, 1);
  assert.equal(store.calls.filter(call => call.url.includes("internal_share_append")).length, 0);
  assert.doesNotMatch(JSON.stringify(response.body), /service-role|supabase|base64/);
});

test("unknown acknowledgement verifies existing bytes before completing and retry never overwrites", async () => {
  const store = mockStore({ lostAck: true });
  assert.equal((await run(req(), store)).statusCode, 200);
  assert.ok(store.calls.some(call => call.url.includes("/object/authenticated/")));
  const retry = mockStore(); retry.entries.set(ID, { ...META, ready: false }); retry.objects.set(ID, PNG);
  assert.equal((await run(req(), retry)).statusCode, 200);
  assert.equal(retry.entries.get(ID).ready, true);
});

test("hash mismatch on an existing reserved object cannot mark it ready", async () => {
  const store = mockStore(); store.entries.set(ID, { ...META, ready: false }); store.objects.set(ID, png(3, 3));
  const response = await run(req(), store);
  assert.equal(response.statusCode, 503); assert.equal(store.entries.get(ID).ready, false);
  assert.equal(store.calls.some(call => call.url.endsWith("/internal_share_image_complete")), false);
});

test("failed uploads keep reservation without exposing image; missing private object fails closed", async () => {
  const store = mockStore({ uploadFail: true });
  assert.equal((await run(req(), store)).statusCode, 503);
  assert.equal(store.entries.get(ID).ready, false);
  assert.equal((await run(readReq(), store)).statusCode, 404);
});

test("quota and completion errors have fixed safe messages", async () => {
  const quota = mockStore({ quota: true }), response = await run(req(), quota);
  assert.equal(response.statusCode, 413); assert.equal(response.body.error, "IMAGE_LIMIT");
  assert.doesNotMatch(JSON.stringify(response.body), /secret|upstream|test-only/);
  assert.equal(quota.calls.some(call => call.url.includes("/storage/")), false);
  const completion = mockStore({ completeFail: true });
  assert.equal((await run(req(), completion)).statusCode, 503);
  assert.equal(completion.entries.get(ID).ready, false);
});

test("unauthenticated and revoked reads/uploads do not disclose existence or access Storage", async () => {
  for (const make of [() => req(undefined, { headers: { cookie: "" } }), () => readReq(ID, { headers: { cookie: "" } }),
    () => readReq("invalid", { headers: { cookie: "" } })]) {
    const store = mockStore(); assert.equal((await run(make(), store)).statusCode, 401);
    assert.equal(store.calls.length, 1); assert.ok(store.calls[0].url.endsWith("internal_share_auth_state"));
  }
  const store = mockStore(), oldUpload = req(), oldRead = readReq(); store.rotate();
  assert.equal((await run(oldUpload, store)).statusCode, 401);
  assert.equal((await run(oldRead, store)).statusCode, 401);
  assert.equal(store.calls.length, 2);
});

test("upload requires fresh credential state, same origin and valid CSRF", async () => {
  assert.equal((await run(req(), mockStore({ authFail: true }))).statusCode, 503);
  for (const changes of [{ body: { csrf: "bad" } }, { headers: { origin: "https://other.test" } },
    { headers: { "sec-fetch-site": "cross-site" } }]) {
    const store = mockStore(); assert.equal((await run(req(undefined, changes), store)).statusCode, 403);
    assert.equal(store.calls.some(call => !call.url.endsWith("internal_share_auth_state")), false);
  }
});

test("authenticated read returns exact PNG with private no-store, nosniff and same-origin policy", async () => {
  const store = mockStore(); await run(req(), store);
  const response = await run(readReq(), store);
  assert.equal(response.statusCode, 200); assert.deepEqual(response.body, PNG);
  assert.equal(response.headers["content-type"], "image/png");
  assert.equal(response.headers["content-length"], String(PNG.length));
  assert.equal(response.headers["cross-origin-resource-policy"], "same-origin");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.match(response.headers["cache-control"], /private, no-store/);
  assert.equal((await run(readReq("../else"), store)).statusCode, 400);
  assert.equal((await run(readReq("f".repeat(64)), store)).statusCode, 404);
});

test("corrupt or oversized stored responses never reach the browser", async () => {
  for (const value of [Buffer.from("<html>secret</html>"), png(4, 4), Buffer.alloc(IMAGE_LIMIT + 1)]) {
    const store = mockStore(); store.entries.set(ID, { ...META, ready: true }); store.objects.set(ID, value);
    const response = await run(readReq(), store); assert.equal(response.statusCode, 503);
    assert.doesNotMatch(JSON.stringify(response.body), /secret|html|supabase/);
  }
  const store = mockStore({ contentLength: String(IMAGE_LIMIT + 1) });
  store.entries.set(ID, { ...META, ready: true }); store.objects.set(ID, PNG);
  assert.equal((await run(readReq(), store)).statusCode, 503);
});

test("image-only body budget expands safely, while existing append cap remains unchanged", async () => {
  const raw = crypto.randomBytes(513 * (513 * 4 + 1));
  for (let row = 0; row < 513; row++) raw[row * (513 * 4 + 1)] = 0;
  const large = png(513, 513, { raw }).toString("base64");
  assert.ok(large.length > BODY_LIMIT && large.length < IMAGE_BODY_LIMIT);
  assert.equal((await run(req(undefined, { body: { data: large } }))).statusCode, 200);
  const store = mockStore();
  assert.equal((await run(req(undefined, { body: { data: "a".repeat(IMAGE_BODY_LIMIT) } }), store)).statusCode, 413);
  assert.equal(store.calls.length, 0);
  assert.equal((await run(req("append", { body: { update: "a".repeat(BODY_LIMIT) } }))).statusCode, 413);
  assert.equal(UPDATE_LIMIT, 512 * 1024);
});

test("migration restricts both object and bucket access and quotas all immutable reservations", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20260922090000_internal_share_images.sql"), "utf8");
  assert.match(sql, /values \('internal-note-images', 'internal-note-images', false, 2097152, array\['image\/png'\]\)/);
  assert.match(sql, /on storage\.objects as restrictive for all to anon, authenticated/);
  assert.match(sql, /on storage\.buckets as restrictive for all to anon, authenticated/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /select count\(\*\), coalesce\(sum\(bytes\), 0\).*from public\.internal_share_images;/);
  assert.match(sql, /v_count >= 1000 or v_bytes \+ p_bytes > 104857600/);
  assert.match(sql, /before update or delete/);
  assert.match(sql, /where id = p_id and ready/);
  for (const rpc of ["reserve", "complete", "read"]) {
    assert.match(sql, new RegExp(`revoke all on function public.internal_share_image_${rpc}\\([^;]+from public, anon, authenticated, service_role;`));
    assert.match(sql, new RegExp(`grant execute on function public.internal_share_image_${rpc}\\([^;]+to service_role;`));
  }
  assert.doesNotMatch(sql, /update storage\.|delete from storage\.|drop policy|grant.*to anon|grant.*to authenticated/i);
});
