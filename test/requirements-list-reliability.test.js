const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "..", "requirements", "js", "app.js"), "utf8");
const unifiedSource = fs.readFileSync(path.join(__dirname, "..", "requirements", "js", "unified-search.js"), "utf8");
const reviewSource = fs.readFileSync(path.join(__dirname, "..", "requirements", "js", "review-needed.js"), "utf8");
const sections = ["unified", "overview", "chemical", "msds", "radio", "electrical", "medical", "non_target", "review_needed", "editRequests"];

function makeElement(id, dataset = {}) {
  const listeners = new Map();
  const values = new Set();
  return {
    id, dataset: { ...dataset }, innerHTML: "", textContent: "", value: "", style: {},
    classList: { add: (...names) => names.forEach((name) => values.add(name)), remove: (...names) => names.forEach((name) => values.delete(name)), has: (name) => values.has(name) },
    addEventListener: (type, listener) => listeners.set(type, listener),
    click() {
      listeners.get("click")?.({ type: "click", currentTarget: this, target: this });
      return undefined;
    },
    dispatchEvent(event) { return listeners.get(event.type)?.(event); },
    getAttribute(name) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return name.startsWith("data-") ? this.dataset[key] ?? null : null;
    },
    appendChild(child) { this.innerHTML += child.innerHTML || ""; }, focus() {},
  };
}

function harness(fetchImpl) {
  const elements = new Map(), ready = [], windowListeners = new Map(), selectorCalls = [];
  const menus = sections.map((section) => makeElement(section + "Menu", { section }));
  const menuBySection = new Map(menus.map((item) => [item.dataset.section, item]));
  const content = sections.map((section) => makeElement(section + "Section"));
  const filterButtons = [makeElement("allFilter"), makeElement("radioFilter")];
  for (const item of [...menus, ...content]) elements.set(item.id, item);
  elements.set("nonTargetSection", elements.get("non_targetSection"));
  for (const id of ["databaseRefreshBtn", "detailContent", "detailModalTitle", "detailModal", "detailDeleteButton", "unifiedSearch", "unifiedSearchResult", "chemicalSearch", "msdsSearch", "radioSearch", "electricalSearch", "medicalSearch", "non_targetSearch", "reviewNeededSearch", "chemicalTableBody", "msdsTableBody", "radioTableBody", "electricalTableBody", "medicalTableBody", "nonTargetTableBody", "reviewNeededTableBody", "statChemical", "statMsds", "statRadio", "statElectrical", "statMedical", "statNonTarget"]) elements.set(id, makeElement(id));
  const document = {
    getElementById: (id) => elements.get(id) || null,
    createElement: (id) => makeElement(id),
    addEventListener: (type, listener) => { if (type === "DOMContentLoaded") ready.push(listener); },
    querySelectorAll: (selector) => selector === ".menu-item" ? menus : selector === ".content-section" ? content : selector === ".btn-filter" ? filterButtons : [],
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
  vm.runInContext(reviewSource, context);
  vm.runInContext(unifiedSource + "\nthis.__navigateToSection = navigateToSection; this.__performUnifiedSearch = performUnifiedSearch;", context);
  ready.forEach((listener) => listener());
  return { context, elements, menuBySection, selectorCalls, filterButtons };
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

for (const [section, loader, inputId] of [
  ["chemical", "loadChemicalData", "chemicalSearch"],
  ["msds", "loadMsdsData", "msdsSearch"],
  ["radio", "loadRadioData", "radioSearch"],
  ["electrical", "loadElectricalData", "electricalSearch"],
  ["medical", "loadMedicalData", "medicalSearch"],
  ["non_target", "loadNonTargetData", "non_targetSearch"],
  ["review_needed", "loadReviewNeededData", "reviewNeededSearch"],
]) {
  test("clicking a unified " + section + " result directly opens and searches its section", async () => {
    const { context, elements, menuBySection } = harness();
    const calls = [];
    context[loader] = async (query) => calls.push(query);
    menuBySection.get(section).click = () => {
      throw new Error("unified result navigation must not depend on HTMLElement.click()");
    };
    elements.get("unifiedSearch").value = "hmt130";
    const card = {
      dataset: { section },
      closest: (selector) => selector === ".result-item[data-section]" ? card : null,
    };

    await elements.get("unifiedSearchResult").dispatchEvent({ type: "click", target: card });

    assert.equal(menuBySection.get(section).classList.has("active"), true);
    assert.equal(elements.get(section + "Section").classList.has("active"), true);
    assert.equal(context.__reliability.getCurrentSection(), section);
    assert.equal(elements.get(inputId).value, "hmt130");
    assert.deepEqual(calls, ["hmt130"]);
  });
}



test("clicking a unified review_needed result resets its special filter before searching", async () => {
  const { context, elements, filterButtons } = harness();
  const calls = [];
  context.loadReviewNeededData = async (query) => calls.push(query);
  filterButtons[1].classList.add("active");
  elements.get("unifiedSearch").value = "review-query";
  const card = { dataset: { section: "review_needed" } };
  card.closest = () => card;

  await elements.get("unifiedSearchResult").dispatchEvent({ type: "click", target: card });

  assert.equal(filterButtons[0].classList.has("active"), true);
  assert.equal(filterButtons[1].classList.has("active"), false);
  assert.deepEqual(calls, ["review-query"]);
});

test("a unified result without data does not navigate", async () => {
  const { context, elements } = harness();
  const calls = [];
  for (const [, loader] of loaderCases) context[loader] = async () => calls.push(loader);
  await elements.get("unifiedSearchResult").dispatchEvent({
    type: "click",
    target: { closest: () => null },
  });
  assert.deepEqual(calls, []);
});

test("a late earlier result click cannot reactivate its section over the latest click", async () => {
  const { context, elements, menuBySection } = harness();
  let releaseRadio;
  context.loadRadioData = () => new Promise((resolve) => { releaseRadio = resolve; });
  context.loadReviewNeededData = async () => {};
  elements.get("unifiedSearch").value = "first";
  const radioCard = { dataset: { section: "radio" } };
  radioCard.closest = () => radioCard;
  const radioNavigation = elements.get("unifiedSearchResult").dispatchEvent({ type: "click", target: radioCard });

  elements.get("unifiedSearch").value = "latest";
  const reviewCard = { dataset: { section: "review_needed" } };
  reviewCard.closest = () => reviewCard;
  await elements.get("unifiedSearchResult").dispatchEvent({ type: "click", target: reviewCard });
  releaseRadio();
  await radioNavigation;

  assert.equal(menuBySection.get("review_needed").classList.has("active"), true);
  assert.equal(elements.get("review_neededSection").classList.has("active"), true);
  assert.equal(context.__reliability.getCurrentSection(), "review_needed");
  assert.equal(elements.get("reviewNeededSearch").value, "latest");
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
function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const staleLoaderCases = [
  ["chemical", "loadChemicalData", "chemicalTableBody"],
  ["msds", "loadMsdsData", "msdsTableBody"],
  ["radio", "loadRadioData", "radioTableBody"],
  ["electrical", "loadElectricalData", "electricalTableBody"],
  ["medical", "loadMedicalData", "medicalTableBody"],
  ["non_target", "loadNonTargetData", "nonTargetTableBody"],
  ["review_needed", "loadReviewNeededData", "reviewNeededTableBody"],
];

for (const [section, loader, bodyId] of staleLoaderCases) {
  test(`a stale ${section} 409 cannot overwrite the latest list`, async () => {
    const slow = deferred();
    let calls = 0;
    const { context, elements } = harness(async () => {
      calls += 1;
      return calls === 1
        ? slow.promise
        : response(200, { data: [{ id: "new", spec_no: "NEW-ROW", created_at: 2 }] });
    });
    const oldLoad = context[loader]();
    await context[loader]();
    const latestHtml = elements.get(bodyId).innerHTML;
    assert.match(latestHtml, /NEW-ROW/);

    slow.resolve(response(409, { success: false, error_code: "STALE_REFRESH" }));
    await oldLoad;
    assert.equal(elements.get(bodyId).innerHTML, latestHtml);
  });
}

for (const status of [403, 503]) {
  test(`a current chemical ${status} renders its safe error state`, async () => {
    const { context, elements } = harness(async () => response(status, { success: false }));
    await context.loadChemicalData();
    assert.match(elements.get("chemicalTableBody").innerHTML, /데이터를 불러올 수 없습니다/);
  });
}

test("a stale dashboard 409 cannot zero newer counts", async () => {
  const oldResponses = Array.from({ length: 6 }, () => deferred());
  let calls = 0;
  const { context, elements } = harness(async () => {
    calls += 1;
    if (calls <= oldResponses.length) return oldResponses[calls - 1].promise;
    return response(200, { data: [{ id: "new" }] });
  });

  const oldLoad = context.__reliability.loadDashboard();
  await context.__reliability.loadDashboard();
  assert.equal(elements.get("statRadio").textContent, 1);

  oldResponses.forEach((pending) => pending.resolve(response(409, { success: false, error_code: "STALE_REFRESH" })));
  await oldLoad;
  assert.equal(elements.get("statRadio").textContent, 1);
});

test("a stale unified-search 409 cannot replace newer results", async () => {
  const oldResponses = Array.from({ length: 7 }, () => deferred());
  let calls = 0;
  const { context, elements } = harness(async () => {
    calls += 1;
    if (calls <= oldResponses.length) return oldResponses[calls - 1].promise;
    return response(200, { data: [{ id: "new", spec_no: "NEW-QUERY" }] });
  });

  elements.get("unifiedSearch").value = "OLD-QUERY";
  const oldSearch = context.__performUnifiedSearch();
  elements.get("unifiedSearch").value = "NEW-QUERY";
  await context.__performUnifiedSearch();

  oldResponses.forEach((pending) => pending.resolve(response(409, { success: false, error_code: "STALE_REFRESH" })));
  await oldSearch;
  assert.match(elements.get("unifiedSearchResult").innerHTML, /NEW-QUERY/);
  assert.doesNotMatch(elements.get("unifiedSearchResult").innerHTML, /OLD-QUERY|검색 중 오류/);
});
