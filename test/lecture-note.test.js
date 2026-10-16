"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createLectureNoteHandler } = require("../lib/lecture-note-server");

const env = { INTERNAL_SHARE_SESSION_SECRET: "x".repeat(40), SUPABASE_URL: "https://db.example.co", SUPABASE_SERVICE_ROLE_KEY: "service" };

function harness() {
  const objects = new Map();
  let bucket = false;
  const fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === "/storage/v1/bucket") { bucket = true; return new Response("{}", { status: 200 }); }
    const key = path.replace("/storage/v1/object/", "");
    if ((options.method || "GET") === "GET") {
      return objects.has(key) ? new Response(objects.get(key), { status: 200 }) : new Response("{}", { status: 400 });
    }
    if (!bucket) return new Response("{}", { status: 404 });
    objects.set(key, options.body);
    return new Response("{}", { status: 200 });
  };
  const handler = createLectureNoteHandler({ env, fetch });
  let cookie = "";
  async function call(method, body) {
    const res = { headers: {}, statusCode: 0, body: null,
      setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; } };
    await handler({ method, body, headers: { cookie, origin: "https://h", host: "h" } }, res);
    if (res.headers["Set-Cookie"]) cookie = res.headers["Set-Cookie"].split(";")[0];
    return res;
  }
  return { call, objects };
}

test("viewer can read but not save; editor saves", async () => {
  const { call } = harness();
  assert.equal((await call("GET")).body.authenticated, false);
  assert.equal((await call("POST", { action: "login", id: "customs", password: "nope" })).statusCode, 401);
  assert.equal((await call("POST", { action: "login", id: "customs", password: "customs" })).statusCode, 200);
  const viewer = (await call("GET")).body;
  assert.equal(viewer.role, "viewer");
  const denied = await call("POST", { action: "save", csrf: viewer.csrf, baseUpdatedAt: null, notes: [] });
  assert.equal(denied.statusCode, 403);

  assert.equal((await call("POST", { action: "login", id: "master", password: "qwer" })).statusCode, 200);
  const editor = (await call("GET")).body;
  assert.equal(editor.role, "editor");
  const notes = [{ id: "mcp", title: "MCP 노트", body: "# hi" }];
  assert.equal((await call("POST", { action: "save", csrf: "bad", baseUpdatedAt: null, notes })).statusCode, 403);
  const saved = await call("POST", { action: "save", csrf: editor.csrf, baseUpdatedAt: null, notes });
  assert.equal(saved.statusCode, 200);
  assert.equal((await call("POST", { action: "save", csrf: editor.csrf, baseUpdatedAt: null, notes })).statusCode, 409);
  const reread = (await call("GET")).body;
  assert.deepEqual(reread.notes, notes);
  assert.equal(reread.updatedAt, saved.body.updatedAt);
});
