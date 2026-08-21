const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const authSource = fs.readFileSync(
  path.join(root, "requirements", "js", "auth.js"),
  "utf8"
);
const appSource = fs.readFileSync(
  path.join(root, "requirements", "js", "app.js"),
  "utf8"
);

function element() {
  return {
    addEventListener() {},
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    dataset: {},
    value: "",
    textContent: "",
  };
}

function authHarness(loginResult) {
  const storage = new Map();
  const events = [];
  const listeners = new Map();
  const loginScreen = element();
  loginScreen.classList = {
    add: (name) => events.push(`login-screen:${name}`),
    remove() {},
  };
  const context = {
    console: { log() {}, warn() {}, error() {} },
    confirm: () => true,
    loadDashboard() {},
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => {
        events.push("session-write:" + key);
        storage.set(key, value);
      },
      removeItem: (key) => storage.delete(key),
    },
    GoogleSheetsAPI: {
      login: async () => loginResult,
      clearAllCache: () => events.push("cache-clear"),
    },
    document: {
      body: { classList: { add() {}, remove() {} } },
      addEventListener() {},
      getElementById: (id) => (id === "loginScreen" ? loginScreen : element()),
      querySelectorAll: () => [],
    },
    window: {
      location: { pathname: "/requirements/" },
      addEventListener: (type, listener) => listeners.set(type, listener),
      dispatchEvent: (event) => listeners.get(event.type)?.(event),
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${authSource}; this.loginForTest = login; this.logoutForTest = logout; this.sessionForTest = checkSession; this.userForTest = () => currentUser;`,
    context
  );
  return { context, storage, events };
}

test("login stores only the sanitized requirements session", async () => {
  const user = {
    username: "tester",
    role: "master",
    company_name: "AIN",
    password_hash: "must-not-persist",
    password_salt: "must-not-persist",
  };
  const sanitizedUser = { username: "tester", role: "master", company_name: "AIN" };
  const { context, storage } = authHarness({
    success: true,
    token: "signed-token",
    user,
  });

  const result = await context.loginForTest("tester", "secret");

  assert.equal(result.success, true);
  assert.deepEqual([...storage.keys()], ["ainRequirementsSession"]);
  assert.deepEqual(JSON.parse(storage.get("ainRequirementsSession")), {
    token: "signed-token",
    user: sanitizedUser,
  });
  assert.equal(JSON.stringify(result.user), JSON.stringify(sanitizedUser));
});

test("session restore and logout use the sanitized requirements session", async () => {
  const user = { username: "tester", role: "user", company_name: "AIN" };
  const { context, storage } = authHarness({
    success: true,
    token: "signed-token",
    user,
  });
  await context.loginForTest("tester", "secret");

  assert.equal(context.sessionForTest(), true);
  assert.equal(JSON.stringify(context.userForTest()), JSON.stringify(user));

  context.logoutForTest();
  assert.equal(storage.has("ainRequirementsSession"), false);
});

test("explicit database refresh clears cache before reloading both views", async () => {
  const events = [];
  const context = {
    console: { log() {}, warn() {}, error() {} },
    GoogleSheetsAPI: { clearAllCache: () => events.push("clear") },
    fetch: async () => new Response(JSON.stringify({ data: [] })),
    Response,
    alert() {},
    confirm: () => true,
    setTimeout,
    clearTimeout,
    document: {
      addEventListener() {},
      getElementById: () => element(),
      querySelector: () => element(),
      querySelectorAll: () => [],
      createElement: () => element(),
      body: element(),
    },
    window: { addEventListener() {} },
  };
  vm.createContext(context);
  vm.runInContext(
    `${appSource}; this.reloadForTest = typeof clearAndReloadFromDatabase === "function" ? clearAndReloadFromDatabase : undefined;`,
    context
  );
  context.loadDashboard = async () => events.push("dashboard");
  context.loadCurrentSection = async () => events.push("section");

  await context.reloadForTest();
  assert.deepEqual(events, ["clear", "dashboard", "section"]);
});

test("auth and production scripts do not log credentials or contain Genspark runtime references", () => {
  assert.doesNotMatch(
    authSource,
    /console\.(log|debug)\([^\n]*(password|token|hash|salt|pepper)/i
  );

  const jsRoot = path.join(root, "requirements", "js");
  for (const name of fs.readdirSync(jsRoot)) {
    const text = fs.readFileSync(path.join(jsRoot, name), "utf8");
    assert.doesNotMatch(text, /gensparkspace|genspark\.ai|page_private|zxjqwehj/i, name);
  }
});

test("successful login clears prior-user cache before replacing the session", async () => {
  const { context, storage, events } = authHarness({
    success: true,
    token: "new-user-token",
    user: { username: "new-user", role: "user", company_name: "NEW" },
  });
  storage.set(
    "ainRequirementsSession",
    JSON.stringify({
      token: "old-user-token",
      user: { username: "old-user", role: "user", company_name: "OLD" },
    })
  );

  await context.loginForTest("new-user", "secret");

  assert.deepEqual(events, [
    "cache-clear",
    "session-write:ainRequirementsSession",
  ]);
});

test("session-expiry event returns the requirements UI to login", async () => {
  const { context, storage, events } = authHarness({
    success: true,
    token: "signed-token",
    user: { username: "tester", role: "user", company_name: "AIN" },
  });
  await context.loginForTest("tester", "secret");

  context.window.dispatchEvent({ type: "ain-requirements-session-expired" });
  assert.equal(context.userForTest(), null);
  assert.equal(storage.has("ainRequirementsSession"), false);
  assert.equal(events.includes("login-screen:active"), true);
});
function sessionDomHarness() {
  const elements = new Map();
  const ready = [];
  const windowListeners = new Map();
  function domElement(id, dataset = {}) {
    const classes = new Set();
    const listeners = new Map();
    return {
      id, dataset, innerHTML: "", textContent: "", value: "", style: {}, disabled: false,
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        has: (name) => classes.has(name),
      },
      addEventListener: (type, listener) => listeners.set(type, listener),
      appendChild(child) { this.innerHTML += child.innerHTML || ""; },
      focus() {},
      click: () => listeners.get("click")?.({ currentTarget: this }),
    };
  }
  const ids = [
    "loginScreen", "dashboardScreen", "loginForm", "logoutBtn", "username", "password", "loginError", "userInfo",
    "databaseRefreshBtn", "detailContent", "detailModalTitle", "detailModal", "detailDeleteButton",
    "unifiedSearch", "unifiedSearchResult", "chemicalSearch", "msdsSearch", "radioSearch", "electricalSearch", "medicalSearch", "non_targetSearch", "reviewNeededSearch",
    "chemicalTableBody", "msdsTableBody", "radioTableBody", "electricalTableBody", "medicalTableBody", "nonTargetTableBody", "reviewNeededTableBody", "editRequestsTableBody",
    "statChemical", "statMsds", "statRadio", "statElectrical", "statMedical", "statNonTarget",
  ];
  ids.forEach((id) => elements.set(id, domElement(id)));
  const menus = ["overview", "chemical", "msds", "radio", "electrical", "medical", "non_target", "review_needed"]
    .map((section) => domElement(`${section}Menu`, { section }));
  const sections = ["overview", "chemical", "msds", "radio", "electrical", "medical", "non_target", "review_needed"]
    .map((section) => domElement(`${section}Section`));
  const storage = new Map();
  const document = {
    body: domElement("body"),
    getElementById: (id) => elements.get(id) || null,
    createElement: (tag) => domElement(tag),
    addEventListener: (type, listener) => { if (type === "DOMContentLoaded") ready.push(listener); },
    querySelectorAll: (selector) => ({
      ".screen": [elements.get("loginScreen"), elements.get("dashboardScreen")],
      ".menu-item": menus,
      ".content-section": sections,
      ".btn-master-only": [elements.get("detailDeleteButton")],
    }[selector] || []),
    querySelector: (selector) => selector === "#detailModal .btn-danger" ? elements.get("detailDeleteButton") : null,
  };
  const context = {
    document,
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    GoogleSheetsAPI: {
      login: async (username) => ({
        success: true,
        token: `${username}-token`,
        user: { username, role: "user", company_name: username },
      }),
      clearAllCache() {},
    },
    fetch: async (url) => url.includes("/record-a")
      ? { ok: true, status: 200, json: async () => ({ id: "record-a", spec_no: "A-DETAIL" }) }
      : { ok: true, status: 200, json: async () => ({ data: [{ id: "row-a", spec_no: "A-ROW", created_at: 1 }] }) },
    console: { log() {}, warn() {}, error() {} },
    alert() {}, confirm: () => true, prompt: () => null,
    formatDate: (value) => value, isDateField: () => false,
    performance: { now: () => 0 }, setTimeout, clearTimeout,
  };
  context.window = context;
  context.location = { pathname: "/requirements/" };
  context.addEventListener = (type, listener) => {
    const listeners = windowListeners.get(type) || [];
    listeners.push(listener);
    windowListeners.set(type, listeners);
  };
  context.dispatchEvent = (event) => (windowListeners.get(event.type) || []).forEach((listener) => listener(event));
  vm.createContext(context);
  vm.runInContext(authSource, context);
  vm.runInContext(appSource, context);
  vm.runInContext(fs.readFileSync(path.join(root, "requirements", "js", "unified-search.js"), "utf8"), context);
  vm.runInContext(`this.sessionUI = { login, logout, loadChemicalData, viewDetail, performUnifiedSearch, detail: () => currentDetailRecord };`, context);
  return { context, elements, storage };
}

async function renderPriorUserData(harness) {
  const { context, elements } = harness;
  await context.sessionUI.login("USER-A", "secret");
  await context.sessionUI.loadChemicalData();
  elements.get("unifiedSearch").value = "A-ROW";
  await context.sessionUI.performUnifiedSearch();
  await context.sessionUI.viewDetail("chemical", "record-a");
  elements.get("reviewNeededTableBody").innerHTML = "A-REVIEW";
  elements.get("statChemical").textContent = "1";
  assert.match(elements.get("chemicalTableBody").innerHTML, /A-ROW/);
  assert.match(elements.get("unifiedSearchResult").innerHTML, /A-ROW/);
  assert.equal(elements.get("detailModal").classList.has("show"), true);
}

function assertSessionUiScrubbed(harness) {
  const { context, elements } = harness;
  for (const id of ["chemicalTableBody", "msdsTableBody", "radioTableBody", "electricalTableBody", "medicalTableBody", "nonTargetTableBody", "reviewNeededTableBody", "editRequestsTableBody", "unifiedSearchResult", "detailContent"]) {
    assert.equal(elements.get(id).innerHTML, "", id);
  }
  for (const id of ["unifiedSearch", "chemicalSearch", "msdsSearch", "radioSearch", "electricalSearch", "medicalSearch", "non_targetSearch", "reviewNeededSearch"]) {
    assert.equal(elements.get(id).value, "", id);
  }
  assert.equal(elements.get("statChemical").textContent, "");
  assert.equal(elements.get("detailModal").classList.has("show"), false);
  assert.equal(elements.get("detailDeleteButton").disabled, true);
  assert.equal(elements.get("detailDeleteButton").style.display, "none");
  assert.equal(context.sessionUI.detail(), null);
  assert.equal(elements.get("loginScreen").classList.has("active"), true);
}

test("logout, expiry, and replacement login scrub all prior-user UI", async () => {
  const harness = sessionDomHarness();
  await renderPriorUserData(harness);
  harness.context.sessionUI.logout();
  assertSessionUiScrubbed(harness);

  await renderPriorUserData(harness);
  harness.context.dispatchEvent({ type: "ain-requirements-session-expired" });
  assertSessionUiScrubbed(harness);

  harness.elements.get("chemicalTableBody").innerHTML = "HIDDEN-A-ROW";
  await harness.context.sessionUI.login("USER-B", "secret");
  assert.equal(harness.elements.get("chemicalTableBody").innerHTML, "");
  assert.equal(harness.context.sessionUI.detail(), null);
});
