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
