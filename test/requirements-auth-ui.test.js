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
const duplicateSource = fs.readFileSync(
  path.join(root, "requirements", "js", "duplicate-checker.js"),
  "utf8"
);
const reviewSource = fs.readFileSync(
  path.join(root, "requirements", "js", "review-needed.js"),
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
  const dynamicModals = new Set();
  const companyCheckboxes = [{ value: "A-SELECTED-COMPANY", checked: true }];
  const ready = [];
  const windowListeners = new Map();
  let dynamicId = 0;
  let document;

  function registerEmbeddedIds(owner, html) {
    for (const match of String(html).matchAll(/id="([^"]+)"/g)) {
      if (!elements.has(match[1])) {
        const child = domElement(match[1]);
        child.ownerModal = owner;
        elements.set(match[1], child);
      }
    }
  }

  function domElement(id, dataset = {}) {
    const classes = new Set();
    const listeners = new Map();
    let html = "";
    let className = "";
    const node = {
      id, dataset, textContent: "", value: "", style: {}, disabled: false,
      checked: false, onchange: null, children: [], parentNode: null, ownerModal: null,
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        has: (name) => classes.has(name),
        contains: (name) => classes.has(name),
      },
      addEventListener: (type, listener) => listeners.set(type, listener),
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        if (document && this === document.body) {
          if (child.classList.has("modal") || child.className.split(/\s+/).includes("modal")) {
            dynamicModals.add(child);
          }
        } else {
          this.innerHTML += child.innerHTML || "";
        }
        return child;
      },
      remove() {
        dynamicModals.delete(this);
        if (this.parentNode) {
          this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
        }
        for (const [key, value] of elements) {
          if (value.ownerModal === this) elements.delete(key);
        }
        this.parentNode = null;
      },
      setAttribute() {},
      querySelectorAll: () => [],
      focus() {},
      click() { return listeners.get("click")?.({ currentTarget: this }); },
    };
    Object.defineProperty(node, "innerHTML", {
      get: () => html,
      set: (value) => {
        html = String(value);
        registerEmbeddedIds(node, html);
      },
    });
    Object.defineProperty(node, "className", {
      get: () => className,
      set: (value) => {
        className = String(value);
        className.split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
      },
    });
    return node;
  }

  const ids = [
    "loginScreen", "dashboardScreen", "loginForm", "logoutBtn", "username", "password", "loginError", "userInfo",
    "databaseRefreshBtn", "detailContent", "detailModalTitle", "detailModal", "detailDeleteButton",
    "inputModal", "modalTitle", "tableInput", "manualInputForm", "csvFileInput", "aiPromptBox", "aiPromptContent",
    "editModal", "editModalTitle", "editFormContainer", "modalContent",
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
  document = {
    body: domElement("body"),
    getElementById: (id) => elements.get(id) || null,
    createElement: (tag) => domElement(`${tag}-${++dynamicId}`),
    addEventListener: (type, listener) => { if (type === "DOMContentLoaded") ready.push(listener); },
    querySelectorAll: (selector) => ({
      ".screen": [elements.get("loginScreen"), elements.get("dashboardScreen")],
      ".menu-item": menus,
      ".content-section": sections,
      ".btn-master-only": [elements.get("detailDeleteButton")],
      ".company-checkbox:checked": companyCheckboxes.filter((checkbox) => checkbox.checked),
      "[data-requirements-session-modal]": [...dynamicModals].filter((modal) => modal.dataset.requirementsSessionModal),
      ".modal": [elements.get("inputModal"), elements.get("detailModal"), elements.get("editModal"), ...dynamicModals],
    }[selector] || []),
    querySelector: (selector) => {
      if (selector === "#detailModal .btn-danger") return elements.get("detailDeleteButton");
      if (selector === ".modal.show") {
        return [...dynamicModals].find((modal) => modal.classList.has("show")) || null;
      }
      return null;
    },
  };

  const defaultFetch = async (url) => {
    if (url.includes("/record-a")) {
      return { ok: true, status: 200, json: async () => ({ id: "record-a", spec_no: "A-DETAIL" }) };
    }
    if (/tables\/chemical_confirmation\/(?:edit-a|edit-current)/.test(url)) {
      return { ok: true, status: 200, json: async () => ({ id: url.split("/").pop(), spec_no: "CURRENT-EDIT" }) };
    }
    if (url.includes("tables/review_needed")) {
      return { ok: true, status: 200, json: async () => ({ data: [{ id: "review-a", importer: "CURRENT-COMPANY", spec_no: "R-1" }] }) };
    }
    return { ok: true, status: 200, json: async () => ({ data: [{ id: "row-a", spec_no: "A-ROW", created_at: 1 }] }) };
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
        user: { username, role: "master", company_name: username },
      }),
      clearAllCache() {},
    },
    fetchImpl: defaultFetch,
    fetch: (...args) => context.fetchImpl(...args),
    console: { log() {}, warn() {}, error() {} },
    alert() {}, confirm: () => true,
    promptImpl: () => null,
    prompt: (...args) => context.promptImpl(...args),
    showLoading() {}, hideLoading() {},
    formatDate: (value) => value, isDateField: () => false,
    performance: { now: () => 0 },
    delayImpl: (...args) => setTimeout(...args),
    setTimeout: (...args) => context.delayImpl(...args),
    clearTimeout,
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
  vm.runInContext(reviewSource, context);
  vm.runInContext(duplicateSource, context);
  vm.runInContext(`this.sessionUI = {
    login, logout, loadChemicalData, viewDetail, performUnifiedSearch, showInputModal,
    editRecord, showDuplicateCheckDialog, startDuplicateCheck, findDuplicates, confirmAndRemoveDuplicates,
    showCompanyDownloadDialog, loadCompanyList, downloadSelectedCompanies,
    detail: () => currentDetailRecord, edit: () => currentEditRecord,
    dataType: () => currentDataType
  };`, context);
  return { context, elements, storage, dynamicModals };
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
async function renderPriorUserModalState(harness) {
  const { context, elements, dynamicModals } = harness;
  await context.sessionUI.login("USER-A", "secret");

  context.sessionUI.showInputModal("chemical");
  elements.get("inputModal").style.display = "block";
  elements.get("tableInput").value = "A-ROW-BODY";
  elements.get("manualInputForm").innerHTML = "A-MANUAL-MUTATION-TARGET";
  elements.get("csvFileInput").value = "A-upload.csv";
  elements.get("csvFileInput").onchange = () => "A-UPLOAD-TARGET";

  await context.sessionUI.editRecord("chemical", "edit-a");
  elements.get("editModal").style.display = "block";
  elements.get("modalContent").innerHTML = "A-LEGACY-EDIT-DETAIL";

  context.sessionUI.showDuplicateCheckDialog();
  elements.get("duplicateCheckResult").innerHTML = "A-DUPLICATE-ROWS-AND-DELETE-TARGET";
  context.sessionUI.showCompanyDownloadDialog();
  await context.sessionUI.loadCompanyList();

  assert.equal(elements.get("inputModal").classList.has("show"), true);
  assert.equal(elements.get("editModal").classList.has("show"), true);
  assert.notEqual(context.sessionUI.edit(), null);
  assert.equal(context.sessionUI.dataType(), "chemical");
  assert.equal(dynamicModals.size, 2);
  assert.match(elements.get("companyListContainer").innerHTML, /CURRENT-COMPANY/);
}

function assertModalUiScrubbed(harness) {
  const { context, elements, dynamicModals } = harness;
  for (const id of ["inputModal", "editModal"]) {
    assert.equal(elements.get(id).classList.has("show"), false, `${id} class`);
    assert.equal(elements.get(id).style.display, "none", `${id} display`);
  }
  assert.equal(elements.get("tableInput").value, "");
  assert.equal(elements.get("manualInputForm").innerHTML, "");
  assert.equal(elements.get("editFormContainer").innerHTML, "");
  assert.equal(elements.get("modalContent").innerHTML, "");
  assert.equal(elements.get("csvFileInput").value, "");
  assert.equal(elements.get("csvFileInput").onchange, null);
  assert.equal(context.sessionUI.edit(), null);
  assert.equal(context.sessionUI.dataType(), "");
  assert.equal(dynamicModals.size, 0);
  assert.equal(elements.has("duplicateCheckResult"), false);
  assert.equal(elements.has("companyListContainer"), false);
}

test("all mutation modals are scrubbed on logout, expiry, and replacement login", async () => {
  const harness = sessionDomHarness();

  await renderPriorUserModalState(harness);
  harness.context.sessionUI.logout();
  assertModalUiScrubbed(harness);

  await renderPriorUserModalState(harness);
  harness.context.dispatchEvent({ type: "ain-requirements-session-expired" });
  assertModalUiScrubbed(harness);

  await renderPriorUserModalState(harness);
  await harness.context.sessionUI.login("USER-B", "secret");
  assertModalUiScrubbed(harness);
});

function deferredResponse() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("late prior-session edit and company reads cannot restore modal data or targets", async () => {
  const harness = sessionDomHarness();
  const editResponse = deferredResponse();
  const companyResponse = deferredResponse();
  harness.context.fetchImpl = (url) => {
    if (url.includes("/edit-a")) return editResponse.promise;
    if (url.includes("tables/review_needed")) return companyResponse.promise;
    throw new Error(`unexpected URL: ${url}`);
  };

  await harness.context.sessionUI.login("USER-A", "secret");
  const editLoad = harness.context.sessionUI.editRecord("chemical", "edit-a");
  harness.context.sessionUI.showCompanyDownloadDialog();
  const companyLoad = harness.context.sessionUI.loadCompanyList();

  await harness.context.sessionUI.login("USER-B", "secret");
  editResponse.resolve({
    ok: true,
    status: 200,
    json: async () => ({ id: "edit-a", spec_no: "A-LATE-EDIT" }),
  });
  companyResponse.resolve({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ importer: "A-LATE-COMPANY" }] }),
  });
  await Promise.allSettled([editLoad, companyLoad]);
  await new Promise((resolve) => setImmediate(resolve));

  assertModalUiScrubbed(harness);
  assert.doesNotMatch(harness.elements.get("editFormContainer").innerHTML, /A-LATE-EDIT/);
});

test("current-session edit and dynamic modal loaders still render normally", async () => {
  const harness = sessionDomHarness();
  await harness.context.sessionUI.login("USER-B", "secret");

  await harness.context.sessionUI.editRecord("chemical", "edit-current");
  assert.equal(harness.elements.get("editModal").classList.has("show"), true);
  assert.match(harness.elements.get("editFormContainer").innerHTML, /CURRENT-EDIT/);
  assert.equal(harness.context.sessionUI.edit().recordId, "edit-current");

  harness.context.sessionUI.showCompanyDownloadDialog();
  await harness.context.sessionUI.loadCompanyList();
  assert.match(harness.elements.get("companyListContainer").innerHTML, /CURRENT-COMPANY/);

  harness.context.sessionUI.showDuplicateCheckDialog();
  assert.equal(harness.dynamicModals.size, 2);
  assert.notEqual(harness.elements.get("duplicateCheckResult"), undefined);
});
test("a company export read cannot continue with prior-session selections after reset", async () => {
  const harness = sessionDomHarness();
  const companyResponse = deferredResponse();
  let downloads = 0;
  harness.context.fetchImpl = (url) => {
    if (url.includes("tables/review_needed")) return companyResponse.promise;
    throw new Error(`unexpected URL: ${url}`);
  };
  harness.context.downloadCompanyReviewNeeded = async () => { downloads += 1; };

  await harness.context.sessionUI.login("USER-A", "secret");
  const exportLoad = harness.context.sessionUI.downloadSelectedCompanies();
  await harness.context.sessionUI.login("USER-B", "secret");
  companyResponse.resolve({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ importer: "A-SELECTED-COMPANY" }] }),
  });
  await exportLoad;

  assert.equal(downloads, 0);
});
function duplicateDeleteResults(ids) {
  return {
    chemical: {
      totalRecords: ids.length + 1,
      totalDuplicates: ids.length,
      duplicateGroups: [{
        key: "A-DUPLICATE-KEY",
        count: ids.length + 1,
        keepRecord: { id: "A-KEEP" },
        deleteRecords: ids.map((id) => ({ id })),
      }],
    },
  };
}

test("late prior-session duplicate scan stops before another read or stale render", async () => {
  const harness = sessionDomHarness();
  const firstPage = deferredResponse();
  const calls = [];
  harness.context.fetchImpl = (url, options = {}) => {
    const session = JSON.parse(harness.storage.get("ainRequirementsSession") || "null");
    calls.push({ url, method: options.method || "GET", token: session?.token || null });
    if (calls.length === 1) return firstPage.promise;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: [] }) });
  };

  await harness.context.sessionUI.login("USER-A", "secret");
  harness.context.sessionUI.showDuplicateCheckDialog();
  harness.elements.get("check_chemical").checked = true;
  const priorResult = harness.elements.get("duplicateCheckResult");
  const scan = harness.context.sessionUI.startDuplicateCheck();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);

  await harness.context.sessionUI.login("USER-B", "secret");
  const removedHtml = priorResult.innerHTML;
  firstPage.resolve({
    ok: true,
    status: 200,
    json: async () => ({
      data: [
        { id: "A-KEEP", spec_no: "S-1", receipt_number: "R-1", product_name: "P-1", created_at: 1 },
        { id: "A-DELETE", spec_no: "S-1", receipt_number: "R-1", product_name: "P-1", created_at: 2 },
      ],
    }),
  });
  await scan;

  assert.equal(calls.length, 1);
  assert.deepEqual(calls.map((call) => call.token), ["USER-A-token"]);
  assert.equal(priorResult.innerHTML, removedHtml);
  assert.equal(harness.elements.has("duplicateCheckResult"), false);
});

test("reset during a duplicate delete batch cancels later batches and stale progress", async () => {
  const harness = sessionDomHarness();
  const firstBatch = deferredResponse();
  const calls = [];
  harness.context.promptImpl = () => "삭제확인";
  harness.context.delayImpl = (callback) => { callback(); return 1; };
  harness.context.fetchImpl = (url, options = {}) => {
    const session = JSON.parse(harness.storage.get("ainRequirementsSession") || "null");
    calls.push({ url, method: options.method || "GET", token: session?.token || null });
    if (calls.length <= 10) return firstBatch.promise;
    return Promise.resolve({ ok: true, status: 204 });
  };

  await harness.context.sessionUI.login("USER-A", "secret");
  harness.context.sessionUI.showDuplicateCheckDialog();
  const priorResult = harness.elements.get("duplicateCheckResult");
  const deletion = harness.context.sessionUI.confirmAndRemoveDuplicates(
    duplicateDeleteResults(Array.from({ length: 12 }, (_, index) => `A-${index + 1}`))
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 10);
  const priorProgress = harness.elements.get("deleteProgress");

  await harness.context.sessionUI.login("USER-B", "secret");
  const removedHtml = priorResult.innerHTML;
  const removedProgress = priorProgress.textContent;
  firstBatch.resolve({ ok: true, status: 204 });
  await deletion;

  assert.equal(calls.length, 10);
  assert.equal(calls.some((call) => call.token === "USER-B-token"), false);
  assert.equal(calls.every((call) => /\/A-(?:[1-9]|10)$/.test(call.url)), true);
  assert.equal(priorResult.innerHTML, removedHtml);
  assert.equal(priorProgress.textContent, removedProgress);
  assert.equal(harness.elements.has("duplicateCheckResult"), false);
});

test("current-session duplicate scan and multiple delete batches complete normally", async () => {
  const harness = sessionDomHarness();
  const calls = [];
  let page = 0;
  harness.context.promptImpl = () => "삭제확인";
  harness.context.delayImpl = (callback) => { callback(); return 1; };
  harness.context.fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    if (options.method === "DELETE") return { ok: true, status: 204 };
    page += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: page === 1 ? [
        { id: "KEEP", spec_no: "S-1", receipt_number: "R-1", product_name: "P-1", created_at: 1 },
        { id: "DELETE", spec_no: "S-1", receipt_number: "R-1", product_name: "P-1", created_at: 2 },
      ] : [] }),
    };
  };

  await harness.context.sessionUI.login("USER-B", "secret");
  harness.context.sessionUI.showDuplicateCheckDialog();
  harness.elements.get("check_chemical").checked = true;
  await harness.context.sessionUI.startDuplicateCheck();
  assert.match(harness.elements.get("duplicateCheckResult").innerHTML, /confirmAndRemoveDuplicates/);

  await harness.context.sessionUI.confirmAndRemoveDuplicates(
    duplicateDeleteResults(Array.from({ length: 12 }, (_, index) => `B-${index + 1}`))
  );

  assert.equal(calls.filter((call) => call.method === "GET").length, 2);
  assert.equal(calls.filter((call) => call.method === "DELETE").length, 12);
  assert.match(harness.elements.get("duplicateCheckResult").innerHTML, /12/);
});
