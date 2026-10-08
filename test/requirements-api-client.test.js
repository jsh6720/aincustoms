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
    AbortController,
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

test("seven hanging reads including queue and body settle within one total budget", async () => {
  const { context, storage, calls } = harness([], async () => ({ ok: true, status: 200, text: () => new Promise(() => {}) }));
  let now = 0, nextId = 0;
  const timers = new Map();
  context.Date = { now: () => now };
  context.setTimeout = (fn, delay) => { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; };
  context.clearTimeout = id => timers.delete(id);
  let settled = false;
  const pending = Promise.all(['chemical_confirmation', 'msds', 'radio_law', 'electrical_law', 'medical_device', 'non_target', 'review_needed'].map(table => context.API.getData(table))).then(results => { settled = true; return results; });
  for (let step = 1; step <= 5; step++) {
    now = step * 20000;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now && timers.has(id)) { timers.delete(id); timer.fn(); }
    }
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(settled, true, 'must not leave queued or active reads pending');
  assert.ok((await pending).every(result => result.success === false));
  assert.equal(storage.has('ainRequirementsSession'), true);
  assert.ok(calls.length <= 6, 'bounded traffic even when abort is ignored');
  assert.equal(timers.size, 0);
});

for (const [count, responseMs] of [[1, 25000], [7, 16000]]) {
  test(`${count} healthy reads taking ${responseMs}ms complete without repeated premature aborts`, async () => {
    let now = 0, nextId = 0;
    const timers = new Map();
    const schedule = (fn, delay) => { const id = ++nextId; timers.set(id, {fn, at:now+delay}); return id; };
    const {context, calls} = harness([], () => new Promise(resolve => {
      schedule(() => resolve(jsonResponse({success:true,data:[{spec_no:'STD72110-01'}]})),responseMs);
    }));
    context.Date = {now:()=>now};
    context.setTimeout = schedule;
    context.clearTimeout = id => timers.delete(id);
    let results;
    const pending = Promise.all(Array.from({length:count},(_,i)=>context.API.getData(`table${i}`))).then(value=>{results=value;});
    for (let turn=0; turn<30 && !results; turn++) {
      await new Promise(resolve=>setImmediate(resolve));
      if (!timers.size) break;
      now = Math.min(...Array.from(timers.values(),timer=>timer.at));
      for (const [id,timer] of [...timers]) {
        if (timer.at<=now && timers.has(id)) {timers.delete(id);timer.fn();}
      }
    }
    await pending;
    assert.ok(results.every(result=>result.data?.[0]?.spec_no==='STD72110-01'));
    assert.equal(calls.length,count,'successful slow reads must not be duplicated');
  });
}

test("invalid successful JSON never becomes a cached empty table", async () => {
  const { context, calls } = harness([{}, { success: true, data: {} }, { success: true, data: [{ spec_no: 'STD72110-01' }] }]);
  const result = await context.API.getData('chemical_confirmation');
  assert.equal(result.data[0].spec_no, 'STD72110-01');
  assert.equal(calls.length, 3);
});

test('bodyless redirect response retries original authenticated read without logout', async () => {
  const {context,calls,storage,events}=harness([
    {success:false,error_code:'REQUEST_INCOMPLETE'},
    {success:true,data:[{spec_no:'STD72110-01'}]}
  ]);
  const result=await context.API.getData('chemical_confirmation');
  assert.equal(result.data?.[0]?.spec_no,'STD72110-01');
  assert.equal(calls.length,2);
  assert.ok(calls.every(call=>call.body.token==='signed-token'&&call.body.action==='getData'&&call.body.tableName==='chemical_confirmation'));
  assert.equal(storage.has('ainRequirementsSession'),true);
  assert.equal(events.length,0);
});

test('bodyless redirect on a write never duplicates a write or clears login', async () => {
  const {context,calls,storage}=harness({success:false,error_code:'REQUEST_INCOMPLETE'});
  const result=await context.API.addData('chemical_confirmation',{spec_no:'synthetic'});
  assert.equal(result.success,false);
  assert.equal(calls.length,1);
  assert.equal(storage.has('ainRequirementsSession'),true);
});

test("requests use the runtime-configured Apps Script endpoint", async () => {
  const { context, calls } = harness({ success: true, data: [] });
  await context.API.getData("msds");

  assert.equal(
    calls[0].url.split('?')[0],
    "https://script.google.com/macros/s/test/exec"
  );
});

test("every API attempt has a fresh URL and disables redirect response caching", async () => {
  const { context, calls } = harness([
    {success:false,error_code:'INTERNAL_ERROR'}, {success:true,data:[]},
    {success:true,token:'new',user:{username:'tester'}}
  ]);
  await context.API.getData('msds');
  await context.API.login('tester','secret');
  assert.equal(new Set(calls.map(call => call.url)).size, 3);
  for (const call of calls) {
    assert.match(call.url, /\/exec\?_ainRequest=[a-z0-9-]+$/);
    assert.equal(call.options.cache, 'no-store');
    assert.equal(call.url.includes('signed-token'), false);
  }
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

test("only explicit application auth rejection expires a session, not upstream HTTP errors", async () => {
  const cases = [
    [jsonResponse({ success: false, error_code: "UNAUTHORIZED" }, { status: 401 }), "UNAUTHORIZED", 401, true],
    [jsonResponse("upstream detail", { status: 401 }), "SERVICE_UNAVAILABLE", 503, false],
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

test("stale fetch responses are non-auth cancellations that preserve replacement sessions", async () => {
  const delayed = deferredJson({ success: true, data: [{ id: "old-row" }] });
  const { context, events, storage } = harness([delayed.response]);
  const oldFetch = context.fetch("tables/msds");

  storage.set("ainRequirementsSession", JSON.stringify({ token: "replacement-token" }));
  delayed.resolve();
  const response = await oldFetch;
  const result = await response.json();

  assert.equal(response.status, 409);
  assert.equal(result.error_code, "STALE_SESSION");
  assert.equal("data" in result, false);
  assert.equal(events.length, 0);
  assert.equal(JSON.parse(storage.get("ainRequirementsSession")).token, "replacement-token");
});
test("clearAllCache aborts active old reads and skips queued and retry wire calls", async () => {
  const retryable = deferredJson({ success: false, error_code: "INTERNAL_ERROR" });
  const hanging = new Map();
  function hangingResponse(table, options) {
    return new Promise((resolve, reject) => {
      const release = () => resolve(jsonResponse({ success: true, data: [{ id: `released-${table}` }] }));
      hanging.set(table, release);
      options.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
  }

  let radioCalls = 0;
  const { context, calls } = harness([], async (_url, options) => {
    const { tableName } = JSON.parse(options.body);
    if (tableName === "msds" || tableName === "chemical_confirmation") {
      return hangingResponse(tableName, options);
    }
    if (tableName === "radio_law" && radioCalls++ === 0) return retryable.response;
    return jsonResponse({ success: true, data: [{ id: `fresh-${tableName}` }] });
  });

  const oldActive = context.API.getData("msds");
  const oldRetry = context.API.getData("radio_law");
  const oldQueued = context.API.getData("chemical_confirmation");
  retryable.resolve();
  for (let turn = 0; turn < 10 && !calls.some((call) => call.body.tableName === "chemical_confirmation"); turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const oldNeverStarted = context.API.getData("electrical_law");
  assert.equal(calls.filter((call) => call.body.tableName === "radio_law").length, 1);
  assert.equal(calls.some((call) => call.body.tableName === "chemical_confirmation"), true);

  context.API.clearAllCache();
  const callsAtClear = calls.length;
  const freshRead = context.API.getData("medical_device");
  const admittedPromptly = await Promise.race([
    freshRead.then(() => true),
    new Promise((resolve) => setImmediate(() => resolve(false))),
  ]);

  if (!admittedPromptly) {
    hanging.forEach((release) => release());
  }
  const [activeResult, retryResult, queuedResult, neverStartedResult, freshResult] = await Promise.all([
    oldActive, oldRetry, oldQueued, oldNeverStarted, freshRead,
  ]);

  assert.equal(admittedPromptly, true);
  for (const result of [activeResult, retryResult, queuedResult, neverStartedResult]) {
    assert.equal(result.error_code, "STALE_REFRESH");
  }
  assert.equal(freshResult.data[0].id, "fresh-medical_device");
  assert.deepEqual(
    calls.slice(callsAtClear).map((call) => call.body.tableName),
    ["medical_device"]
  );
  assert.equal(calls.filter((call) => call.body.tableName === "radio_law").length, 1);
  assert.equal(calls.some((call) => call.body.tableName === "electrical_law"), false);
});

test("search sends one authenticated search request and retries transient read failures", async () => {
  const { context, calls } = harness([
    { success: false, error_code: "REQUEST_INCOMPLETE" },
    { success: true, results: { review_needed: [{ spec_no: "STD72110-01" }] }, failed: [] },
  ]);
  const result = await context.API.search("72110");
  assert.equal(result.success, true);
  assert.equal(result.results.review_needed[0].spec_no, "STD72110-01");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.action, "search");
  assert.equal(calls[1].body.query, "72110");
  assert.equal(calls[1].body.token, "signed-token");
});

test("search on an old backend reports UNKNOWN_ACTION without retrying", async () => {
  const { context, calls } = harness([{ success: false, error_code: "UNKNOWN_ACTION" }]);
  const result = await context.API.search("72110");
  assert.equal(result.error_code, "UNKNOWN_ACTION");
  assert.equal(calls.length, 1);
});
