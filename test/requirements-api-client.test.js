const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "requirements", "js", "google-sheets-api.js"),
  "utf8"
);

function harness(apiResults) {
  const calls = [];
  const storage = new Map([
    [
      "ainRequirementsSession",
      JSON.stringify({
        token: "signed-token",
        user: { username: "tester", role: "master", company_name: "AIN" },
      }),
    ],
  ]);
  const results = Array.isArray(apiResults) ? [...apiResults] : [apiResults];
  const context = {
    console: { log() {}, warn() {}, error() {} },
    window: {},
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    fetch: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return { json: async () => results.shift() };
    },
    Response,
    setTimeout,
    clearTimeout,
  };
  context.window = context;
  context.AIN_REQUIREMENTS_CONFIG = {
    apiUrl: "https://script.google.com/macros/s/test/exec",
  };
  vm.createContext(context);
  vm.runInContext(
    `${source}; this.API = GoogleSheetsAPI; this.mapStatus = typeof mapApiErrorCodeToStatus === "function" ? mapApiErrorCodeToStatus : undefined;`,
    context
  );
  return { context, calls, storage };
}

test("authenticated requests send token but not client authority", async () => {
  const { context, calls } = harness({ success: true, data: [] });
  await context.API.getData("msds");

  assert.equal(calls[0].body.token, "signed-token");
  assert.equal("role" in calls[0].body, false);
  assert.equal("companyName" in calls[0].body, false);
  assert.equal("username" in calls[0].body, false);
});

test("requests use the runtime-configured Apps Script endpoint", async () => {
  const { context, calls } = harness({ success: true, data: [] });
  await context.API.getData("msds");

  assert.equal(
    calls[0].url,
    "https://script.google.com/macros/s/test/exec"
  );
});

test("login is anonymous and sends only the entered credentials", async () => {
  const { context, calls } = harness({
    success: true,
    token: "new-token",
    user: { username: "tester" },
  });
  await context.API.login("tester", "secret");

  assert.deepEqual(calls[0].body, {
    action: "login",
    username: "tester",
    password: "secret",
  });
});

test("Apps Script error codes map to browser status", () => {
  const { context } = harness({ success: false });
  assert.equal(context.mapStatus("UNAUTHORIZED"), 401);
  assert.equal(context.mapStatus("FORBIDDEN"), 403);
  assert.equal(context.mapStatus("VALIDATION_ERROR"), 400);
});

test("table fetch maps auth errors to a Response status and expires unauthorized sessions", async () => {
  const unauthorized = harness({
    success: false,
    error_code: "UNAUTHORIZED",
    error: "Session expired",
  });
  const unauthorizedResponse = await unauthorized.context.fetch("tables/msds");
  assert.equal(unauthorizedResponse.status, 401);
  assert.equal(unauthorized.storage.has("ainRequirementsSession"), false);

  const forbidden = harness({
    success: false,
    error_code: "FORBIDDEN",
    error: "Denied",
  });
  const forbiddenResponse = await forbidden.context.fetch("tables/msds");
  assert.equal(forbiddenResponse.status, 403);
});

test("successful writes invalidate the affected table cache", async () => {
  const { context, calls } = harness([
    { success: true, data: [{ id: "before" }] },
    { success: true, data: { id: "before", value: "updated" } },
    { success: true, data: [{ id: "after" }] },
  ]);

  await context.API.getData("msds");
  await context.API.getData("msds");
  assert.equal(calls.length, 1);

  await context.API.updateData("msds", "before", { value: "updated" });
  await context.API.getData("msds");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].body, {
    action: "updateData",
    tableName: "msds",
    id: "before",
    data: { value: "updated" },
    token: "signed-token",
  });
});

test("clearAllCache forces the next read to call the API", async () => {
  const { context, calls } = harness([
    { success: true, data: [{ id: "cached" }] },
    { success: true, data: [{ id: "reloaded" }] },
  ]);

  await context.API.getData("msds");
  await context.API.getData("msds");
  assert.equal(calls.length, 1);

  context.API.clearAllCache();
  await context.API.getData("msds");
  assert.equal(calls.length, 2);
});
