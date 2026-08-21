const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "..", "requirements", "js", "app.js"), "utf8");
const unifiedSource = fs.readFileSync(path.join(__dirname, "..", "requirements", "js", "unified-search.js"), "utf8");
const sections = ["unified", "overview", "chemical", "msds", "radio", "electrical", "medical", "non_target", "review_needed", "editRequests"];

function makeElement(id, dataset = {}) {
  const listeners = new Map();
  const values = new Set();
  return {
    id, dataset: { ...dataset }, innerHTML: "", textContent: "", value: "", style: {},
    classList: { add: (...names) => names.forEach((name) => values.add(name)), remove: (...names) => names.forEach((name) => values.delete(name)), has: (name) => values.has(name) },
    addEventListener: (type, listener) => listeners.set(type, listener),
    click: async () => listeners.get("click")?.({ currentTarget: this }),
    getAttribute(name) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return name.startsWith("data-") ? this.dataset[key] ?? null : null;
    },
    appendChild() {}, focus() {},
  };
}

function harness(fetchImpl) {
  const elements = new Map(), ready = [], windowListeners = new Map(), selectorCalls = [];
  const menus = sections.map((section) => makeElement(section + "Menu", { section }));
  const menuBySection = new Map(menus.map((item) => [item.dataset.section, item]));
  const content = sections.map((section) => makeElement(section + "Section"));
  for (const item of [...menus, ...content]) elements.set(item.id, item);
  elements.set("nonTargetSection", elements.get("non_targetSection"));
  for (const id of ["databaseRefreshBtn", "detailContent", "detailModalTitle", "detailModal", "detailDeleteButton", "unifiedSearch", "chemicalSearch", "msdsSearch", "radioSearch", "electricalSearch", "medicalSearch", "non_targetSearch", "reviewNeededSearch", "statChemical", "statMsds", "statRadio", "statElectrical", "statMedical", "statNonTarget"]) elements.set(id, makeElement(id));
  const document = {
    getElementById: (id) => elements.get(id) || null,
    createElement: (id) => makeElement(id),
    addEventListener: (type, listener) => { if (type === "DOMContentLoaded") ready.push(listener); },
    querySelectorAll: (selector) => selector === ".menu-item" ? menus : selector === ".content-section" ? content : [],
    querySelector: (selector) => {
      selectorCalls.push(selector);
      if (selector === "#detailModal .btn-danger") return elements.get("detailDeleteButton");
      const match = selector.match(/^\.menu-item\[data-section="([^"]+)"\]$/);
      return match ? menuBySection.get(match[1]) || null : null;
    },
  };
  const context = {
    document, console: { log() {}, warn() {}, error() {} }, alert() {}, confirm: () => false, prompt: () => null,
    fetch: fetchImpl || (async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })),
    isMasterUser: () => true, canAccessData: () => true, formatDate: (value) => value, isDateField: () => false,
    setTimeout: (callback) => { callback(); return 0; }, clearTimeout() {}, performance: { now: () => 0 },
  };
  context.window = context;
  context.addEventListener = (type, listener) => windowListeners.set(type, listener);
  context.dispatchEvent = (event) => windowListeners.get(event.type)?.(event);
  vm.createContext(context);
  vm.runInContext(appSource + "\nthis.__reliability = { loadCurrentSection, loadDashboard, viewDetail, deleteCurrentRecord, navigateToDashboardSection, setCurrentSection: (section) => { currentSection = section; }, getCurrentSection: () => currentSection, getCurrentDetailRecord: () => currentDetailRecord };", context);
  vm.runInContext(unifiedSource + "\nthis.__navigateToSection = navigateToSection;", context);
  ready.forEach((listener) => listener());
  return { context, elements, menuBySection, selectorCalls };
}

const loaderCases = [
  ["chemical", "loadChemicalData"], ["msds", "loadMsdsData"], ["radio", "loadRadioData"],
  ["electrical", "loadElectricalData"], ["medical", "loadMedicalData"], ["non_target", "loadNonTargetData"],
  ["review_needed", "loadReviewNeededData"],
];
for (const [section, loader] of loaderCases) {
  test("selecting " + section + " retries a previously failed list load", async () => {
    const { context, menuBySection } = harness();
    const calls = [];
    context[loader] = async () => {
      calls.push(section);
      if (calls.length === 1) throw new Error("initial preload failed");
    };
    context.__reliability.setCurrentSection(section);
    await assert.rejects(context.__reliability.loadCurrentSection(), /initial preload failed/);
    await menuBySection.get(section).click();
    assert.deepEqual(calls, [section, section]);
    assert.equal(context.__reliability.getCurrentSection(), section);
  });
}

test("dashboard statistics do not eagerly hydrate list DOM", async () => {
  const { context, elements } = harness(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: "one" }] }) }));
  const calls = [];
  for (const [, loader] of loaderCases.slice(0, 6)) context[loader] = async () => calls.push(loader);
  await context.__reliability.loadDashboard();
  assert.deepEqual(calls, []);
  assert.equal(elements.get("statRadio").textContent, 1);
});

test("a unified radio result activates and reloads the filtered radio tab once", async () => {
  const { context, elements, menuBySection, selectorCalls } = harness();
  const calls = [];
  context.loadRadioData = async (query) => calls.push(query);
  elements.get("unifiedSearch").value = "hmt130";
  await context.__navigateToSection("radio");
  assert.equal(menuBySection.get("radio").classList.has("active"), true);
  assert.equal(elements.get("radioSection").classList.has("active"), true);
  assert.equal(context.__reliability.getCurrentSection(), "radio");
  assert.equal(elements.get("radioSearch").value, "hmt130");
  assert.deepEqual(calls, ["hmt130"]);
  assert.ok(selectorCalls.includes('.menu-item[data-section="radio"]'));
});

async function detail(status, body) {
  let loginShown = false, result;
  result = harness(async () => {
    if (status === 401) result.context.dispatchEvent({ type: "ain-requirements-session-expired" });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
  if (status === 409) result.elements.get("detailContent").innerHTML = "previous record";
  result.context.addEventListener("ain-requirements-session-expired", () => { loginShown = true; });
  await result.context.__reliability.viewDetail("radio", "record-1");
  return { ...result, loginShown };
}

test("detail 401 leaves rendering to the existing session-expiry login lifecycle", async () => {
  const result = await detail(401, { success: false, error_code: "UNAUTHORIZED" });
  assert.equal(result.loginShown, true);
  assert.doesNotMatch(result.elements.get("detailContent").innerHTML, /UNAUTHORIZED/);
  assert.equal(result.elements.get("detailModal").classList.has("show"), false);
});
for (const [status, code, message] of [[403, "FORBIDDEN", "접근 권한"], [404, "NOT_FOUND", "찾을 수 없습니다"], [503, "SERVICE_UNAVAILABLE", "잠시 후 다시 시도"]]) {
  test("detail " + status + " shows a safe error instead of rendering the error response", async () => {
    const result = await detail(status, { success: false, error_code: code });
    assert.match(result.elements.get("detailContent").innerHTML, new RegExp(message));
    assert.doesNotMatch(result.elements.get("detailContent").innerHTML, new RegExp(code));
    assert.equal(result.elements.get("detailModal").classList.has("show"), true);
  });
}
test("a stale detail response is a non-auth cancellation", async () => {
  const result = await detail(409, { success: false, error_code: "STALE_SESSION" });
  assert.equal(result.loginShown, false);
  assert.doesNotMatch(result.elements.get("detailContent").innerHTML, /STALE_SESSION/);
  assert.equal(result.elements.get("detailContent").innerHTML, "");
  assert.equal(result.elements.get("detailModal").classList.has("show"), false);
});
test("a successful detail response still renders record fields", async () => {
  const result = await detail(200, { id: "record-1", spec_no: "READY-1", model_name: "Example" });
  assert.match(result.elements.get("detailContent").innerHTML, /READY-1/);
  assert.match(result.elements.get("detailContent").innerHTML, /Example/);
  assert.equal(result.elements.get("detailModal").classList.has("show"), true);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("a stale detail completion cannot clear a newer detail or retarget delete", async () => {
  const first = deferred();
  let requestCount = 0;
  const { context, elements } = harness(async () => {
    requestCount += 1;
    if (requestCount === 1) return first.promise;
    return { ok: true, status: 200, json: async () => ({ id: "new", spec_no: "NEW-RECORD" }) };
  });
  let deleteTarget = null;
  context.deleteRecord = async (type, id) => { deleteTarget = { type, id }; };

  const oldRequest = context.__reliability.viewDetail("radio", "old");
  const newRequest = context.__reliability.viewDetail("radio", "new");
  await newRequest;
  first.resolve({ ok: false, status: 409, json: async () => ({ success: false, error_code: "STALE_SESSION" }) });
  await oldRequest;

  assert.match(elements.get("detailContent").innerHTML, /NEW-RECORD/);
  assert.equal(context.__reliability.getCurrentDetailRecord().type, "radio");
  assert.equal(context.__reliability.getCurrentDetailRecord().id, "new");
  assert.equal(elements.get("detailDeleteButton").disabled, false);
  context.__reliability.deleteCurrentRecord();
  assert.deepEqual(deleteTarget, { type: "radio", id: "new" });
});

const dashboardTargets = [
  ["chemicalSection", "chemical", "loadChemicalData"],
  ["msdsSection", "msds", "loadMsdsData"],
  ["radioSection", "radio", "loadRadioData"],
  ["electricalSection", "electrical", "loadElectricalData"],
  ["medicalSection", "medical", "loadMedicalData"],
  ["nonTargetSection", "non_target", "loadNonTargetData"],
];
for (const [sectionId, menuSection, loader] of dashboardTargets) {
  test("dashboard " + sectionId + " activates " + menuSection + " through one menu load", async () => {
    const { context, elements, menuBySection } = harness();
    const calls = [];
    context[loader] = async () => calls.push(menuSection);

    await context.__reliability.navigateToDashboardSection(sectionId);

    assert.equal(menuBySection.get(menuSection).classList.has("active"), true);
    assert.equal(elements.get(sectionId).classList.has("active"), true);
    assert.equal(context.__reliability.getCurrentSection(), menuSection);
    assert.deepEqual(calls, [menuSection]);
  });
}