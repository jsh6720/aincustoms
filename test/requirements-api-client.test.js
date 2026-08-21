const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "requirements", "js", "google-sheets-api.js"),
  "utf8"
);

function jsonResponse(body, { status = 200 } = {}) {
  const encoded = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => encoded,
    json: async () => JSON.parse(encoded),
  };
}

function deferredJson(body, { status = 200 } = {}) {
  let resolve;
  const settled = new Promise((done) => {
    resolve = done;
  });
  const encoded = typeof body === "string" ? body : JSON.stringify(body);
  return {
    response: {
      ok: status >= 200 && status < 300,
      status,
      text: async () => {
        await settled;
        return encoded;
      },
      json: async () => {
        await settled;
        return JSON.parse(encoded);
      },
    },
    resolve,
  };
}
function harness(apiResults, fetchImpl) {
  const calls = [];
  const events = [];
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
      if (fetchImpl) return fetchImpl(url, options);
      const next = results.shift();
      if (next instanceof Error) throw next;
      if (next?.text) return next;
      return next?.response || jsonResponse(next);
    },
    CustomEvent: class CustomEvent {
      constructor(type) {
        this.type = type;
      }
    },
    Response,
    setTimeout,
    clearTimeout,
  };
  context.window = context;
  context.dispatchEvent = (event) => events.push(event.type);
  context.AIN_REQUIREMENTS_CONFIG = {
    apiUrl: "https://script.google.com/macros/s/test/exec",
  };
  vm.createContext(context);
  vm.runInContext(
    `${source}; this.API = GoogleSheetsAPI; this.mapStatus = typeof mapApiErrorCodeToStatus === "function" ? mapApiErrorCodeToStatus : undefined;`,
    context
  );
  return { context, calls, storage, events };
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

test("missing session never serves cached table data", async () => {
  const { context, calls, storage } = harness([
    { success: true, data: [{ id: "prior-user-row" }] },
    { success: false, error_code: "UNAUTHORIZED", error: "Login required" },
  ]);

  await context.API.getData("msds");
  storage.delete("ainRequirementsSession");

  const response = await context.fetch("tables/msds");
  assert.equal(response.status, 401);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.token, "");
});

test("UNAUTHORIZED clears every cached table before a replacement session reads", async () => {
  const { context, calls, storage } = harness([
    { success: true, data: [{ id: "old-msds" }] },
    { success: true, data: [{ id: "old-radio" }] },
    { success: false, error_code: "UNAUTHORIZED", error: "Expired" },
    { success: true, data: [{ id: "new-msds" }] },
    { success: true, data: [{ id: "new-radio" }] },
  ]);

  await context.API.getData("msds");
  await context.API.getData("radio_law");
  await context.API.call("getData", { tableName: "electrical_law" });
  assert.equal(storage.has("ainRequirementsSession"), false);

  storage.set(
    "ainRequirementsSession",
    JSON.stringify({
      token: "replacement-token",
      user: { username: "other", role: "user", company_name: "OTHER" },
    })
  );

  const msds = await context.API.getData("msds");
  const radio = await context.API.getData("radio_law");
  assert.equal(msds.data[0].id, "new-msds");
  assert.equal(radio.data[0].id, "new-radio");
  assert.equal(calls.length, 5);
});

function concurrentHarness() {
  let active = 0;
  let maximum = 0;
  const { context, calls } = harness([], () => {
    active += 1;
    maximum = Math.max(maximum, active);
    return {
      ok: true,
      status: 200,
      text: async () => {
        active -= 1;
        return JSON.stringify({ success: true, data: [] });
      },
      json: async () => {
        active -= 1;
        return { success: true, data: [] };
      },
    };
  });
  return { context, calls, maxActive: () => maximum };
}
test("concurrent reads of one table share one wire request", async () => {
  const pending = deferredJson({ success: true, data: [{ id: "one" }] });
  const { context, calls } = harness([pending.response]);
  const first = context.API.getData("radio_law");
  const second = context.API.getData("radio_law");

  assert.equal(calls.length, 1);
  pending.resolve();
  assert.deepEqual(await first, await second);
});

test("cold reads never exceed two remote requests", async () => {
  const { context, maxActive } = concurrentHarness();
  await Promise.all(["chemical_confirmation", "msds", "radio_law", "electrical_law"].map(
    (table) => context.API.getData(table)
  ));

  assert.equal(maxActive(), 2);
});

test("reads retry transient backend failures at most twice", async () => {
  const retryableFailures = [
    { result: { success: false, error_code: "INTERNAL_ERROR" } },
    { result: new Error("network detail") },
    { result: { success: false, error_code: "RATE_LIMITED" }, status: 429 },
    { result: { success: false, error_code: "UPSTREAM_ERROR" }, status: 500 },
    { result: "not json", status: 503 },
  ];

  for (const { result, status } of retryableFailures) {
    const firstResponse = result instanceof Error ? result : jsonResponse(result, { status });
    const { context, calls } = harness([
      firstResponse,
      { success: true, data: [{ id: "recovered" }] },
    ]);
    const response = await context.API.getData("msds");

    assert.equal(response.data[0].id, "recovered");
    assert.equal(calls.length, 2);
  }
});

test("read retry exhaustion returns a safe synthetic 503 result", async () => {
  const { context, calls } = harness([
    jsonResponse("upstream credential text", { status: 500 }),
    jsonResponse("upstream credential text", { status: 500 }),
    jsonResponse("upstream credential text", { status: 500 }),
  ]);

  const result = await context.API.getData("msds");
  assert.equal(result.success, false);
  assert.equal(result.error_code, "SERVICE_UNAVAILABLE");
  assert.equal(result.status, 503);
  assert.equal(calls.length, 3);
  assert.equal("error" in result, false);
});

test("authorization, validation, and write operations are never retried", async () => {
  const cases = [
    (api) => api.getData("msds"),
    (api) => api.getData("msds"),
    (api) => api.login("tester", "secret"),
    (api) => api.addData("msds", { value: "new" }),
    (api) => api.updateData("msds", "one", { value: "changed" }),
    (api) => api.deleteData("msds", "one"),
  ];
  const failures = ["UNAUTHORIZED", "VALIDATION_ERROR", "INTERNAL_ERROR", "INTERNAL_ERROR", "INTERNAL_ERROR", "INTERNAL_ERROR"];

  for (let index = 0; index < cases.length; index += 1) {
    const { context, calls } = harness({ success: false, error_code: failures[index] });
    await cases[index](context.API);
    assert.equal(calls.length, 1);
  }
});

test("old-token authorization failures leave a replacement session and cache intact", async () => {
  const pending = deferredJson({ success: false, error_code: "UNAUTHORIZED" });
  const { context, calls, storage } = harness([
    pending.response,
    { success: true, data: [{ id: "replacement-row" }] },
  ]);
  const oldRead = context.API.getData("msds");
  storage.set("ainRequirementsSession", JSON.stringify({ token: "replacement-token" }));
  pending.resolve();

  assert.equal((await oldRead).error_code, "STALE_SESSION");
  assert.equal(JSON.parse(storage.get("ainRequirementsSession")).token, "replacement-token");
  assert.equal((await context.API.getData("msds")).data[0].id, "replacement-row");
  assert.equal(calls.length, 2);
});

test("current-token authorization failure expires one visible session", async () => {
  const { context, events, storage } = harness({
    success: false,
    error_code: "UNAUTHORIZED",
  });

  await context.API.getData("msds");
  assert.equal(storage.has("ainRequirementsSession"), false);
  assert.deepEqual(events, ["ain-requirements-session-expired"]);
});

test("HTTP 401 and 403 responses canonicalize auth failures without upstream bodies", async () => {
  const cases = [
    [jsonResponse({ success: false, error: "upstream detail" }, { status: 401 }), "UNAUTHORIZED", 401, true],
    [jsonResponse("upstream detail", { status: 401 }), "UNAUTHORIZED", 401, true],
    [jsonResponse({ success: false, error: "upstream detail" }, { status: 403 }), "FORBIDDEN", 403, false],
    [jsonResponse("upstream detail", { status: 403 }), "FORBIDDEN", 403, false],
  ];

  for (const [upstream, errorCode, status, expires] of cases) {
    const { context, calls, events, storage } = harness(upstream);
    const response = await context.fetch("tables/msds");
    const result = await response.json();

    assert.equal(response.status, status);
    assert.equal(result.error_code, errorCode);
    assert.equal("error" in result, false);
    assert.equal(calls.length, 1);
    assert.equal(storage.has("ainRequirementsSession"), !expires);
    assert.equal(events.length, expires ? 1 : 0);
  }
});

test("clearAllCache starts a new read epoch and keeps old rows stale", async () => {
  const oldResponse = deferredJson({ success: true, data: [{ id: "old" }] });
  const { context, calls } = harness([
    oldResponse.response,
    { success: true, data: [{ id: "new" }] },
  ]);
  const oldRead = context.API.getData("msds");
  assert.equal(calls.length, 1);

  context.API.clearAllCache();
  const refreshed = context.API.getData("msds");
  const sameEpoch = context.API.getData("msds");
  assert.equal(calls.length, 2);
  oldResponse.resolve();

  assert.equal((await oldRead).error_code, "STALE_REFRESH");
  assert.equal((await refreshed).data[0].id, "new");
  assert.deepEqual(await refreshed, await sameEpoch);
  assert.equal((await context.API.getData("msds")).data[0].id, "new");
  assert.equal(calls.length, 2);
});

test("replacement sessions prevent queued and retrying old-token reads from reaching the wire", async () => {
  const oldSuccess = deferredJson({ success: true, data: [{ id: "old" }] });
  const oldRetryable = deferredJson({ success: false, error_code: "INTERNAL_ERROR" });
  const { context, calls, storage } = harness([
    oldSuccess.response,
    oldRetryable.response,
    { success: true, data: [{ id: "new" }] },
  ]);
  const oldActive = context.API.getData("msds");
  const oldRetry = context.API.getData("radio_law");
  const oldQueued = context.API.getData("chemical_confirmation");
  assert.equal(calls.length, 2);

  storage.set("ainRequirementsSession", JSON.stringify({ token: "replacement-token" }));
  const newRead = context.API.getData("electrical_law");
  oldRetryable.resolve();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.length, 3);
  assert.equal(calls.filter((call) => call.body.tableName === "radio_law").length, 1);
  assert.equal(calls.some((call) => call.body.tableName === "chemical_confirmation"), false);
  assert.equal(calls[2].body.token, "replacement-token");
  assert.equal((await oldRetry).error_code, "STALE_SESSION");
  assert.equal((await oldQueued).error_code, "STALE_SESSION");
  assert.equal((await newRead).data[0].id, "new");

  oldSuccess.resolve();
  assert.equal((await oldActive).error_code, "STALE_SESSION");
});
