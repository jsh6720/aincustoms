const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const dashboard = fs.readFileSync(path.join(__dirname, "..", "cargo-dashboard.html"), "utf8");
const mobile = fs.readFileSync(path.join(__dirname, "..", "cargo-docs-mobile.html"), "utf8");
const originalDocsApi = fs.readFileSync(path.join(__dirname, "..", "api", "cargo-original-docs.js"), "utf8");
const quotaApi = fs.readFileSync(path.join(__dirname, "..", "api", "cargo-quota.js"), "utf8");

function requestControlContext(role, cards, overrides = {}) {
  const start = dashboard.indexOf("function progressRequestToggle");
  const end = dashboard.indexOf("function renderProgressStatus", start);
  assert.ok(start >= 0 && end > start, "progress request helper source should exist");
  const context = {
    currentUserRole: role,
    currentCards: cards,
    displayDate: (value) => String(value || "-"),
    esc: (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[character])),
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(
    `${dashboard.slice(start, end)}
this.renderRequestControl = progressRequestToggle;
this.handleRequestAction = handleProgressRequestAction;`,
    context
  );
  return context;
}

function requestControlHarness(role, cards) {
  const context = requestControlContext(role, cards);
  return (card, type) => context.renderRequestControl(card, type);
}

function dashboardRuntimeContext(role, cards, overrides = {}) {
  const script = dashboard.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "dashboard inline script should exist");
  const withoutBoot = script.replace(
    /\s*bindProgressRequestControls\(\);\s*loadData\(\);\s*$/,
    ""
  );
  const context = {
    console,
    currentTestCalls: [],
    __testCards: cards,
  };
  vm.createContext(context);
  vm.runInContext(
    `${withoutBoot}
currentUserRole = ${JSON.stringify(role)};
currentCards = __testCards;
this.renderFullCard = cardHtml;
this.dispatchBoardClick = handleBoardCardClick;
this.dispatchBoardChange = handleBoardCardChange;
this.dispatchBoardInput = handleBoardCardInput;`,
    context
  );
  Object.assign(context, overrides);
  return context;
}

function progressCalendarHarness(cards, calendarPreferences = {}) {
  const start = dashboard.indexOf("function progressCalendarEvents()");
  const end = dashboard.indexOf("function renderProgressCalendar", start);
  assert.ok(start >= 0 && end > start, "progress calendar helper source should exist");
  const context = {
    cards,
    calendarPreferences: {
      import_request: true,
      warehouse_expected: true,
      ...calendarPreferences,
    },
    visibleCards: () => cards,
    calendarDate(value) {
      const text = String(value || "");
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
    },
    etaText: (card) => card.eta_date || "",
    koreaCalendarDate: () => "",
  };
  vm.createContext(context);
  vm.runInContext(
    `${dashboard.slice(start, end)}
this.events = progressCalendarEvents;`,
    context
  );
  return context.events();
}

test("progress transport editor renders role-specific save commands", () => {
  assert.match(dashboard, /id="progressWarehouseModalActions"/);
  const openStart = dashboard.indexOf("function openProgressWarehouseEditor");
  const openEnd = dashboard.indexOf("function closeProgressWarehouseEditor", openStart);
  const openBody = dashboard.slice(openStart, openEnd);
  assert.match(openBody, /currentUserRole === "admin"/);
  assert.match(openBody, /saveProgressWarehouseEditor\(false\)/);
  assert.match(openBody, /저장만/);
  assert.match(openBody, /saveProgressWarehouseEditor\(true\)/);
  assert.match(openBody, /저장\+메일/);

  const saveStart = dashboard.indexOf("async function saveProgressWarehouseEditor");
  const saveEnd = dashboard.indexOf("function openProgressStatus", saveStart);
  const saveBody = dashboard.slice(saveStart, saveEnd);
  assert.match(saveBody, /send_notification:\s*sendNotification === true/);
  assert.match(saveBody, /response\.status === 409/);
  assert.match(saveBody, /await loadData\(\)/);
  assert.match(saveBody, /메일 발송에 실패/);
  assert.match(saveBody, /저장되었습니다/);
  assert.match(saveBody, /메일로 발송되었습니다/);
});

test("shipper transport provenance is subtle and exposes identity only by tooltip", () => {
  assert.match(dashboard, /function transportProvenanceClass\(card\)/);
  assert.match(dashboard, /function transportProvenanceTitle\(card\)/);
  assert.match(dashboard, /transport_updated_by_role === "shipper"/);
  assert.match(dashboard, /\.progress-shipper-input\s*\{[^}]*background:\s*#eaf4ff/);
  const rowStart = dashboard.indexOf("document.getElementById(\"progressRows\").innerHTML");
  const rowEnd = dashboard.indexOf("`).join(\"\")", rowStart);
  const row = dashboard.slice(rowStart, rowEnd);
  assert.match(row, /transportProvenanceClass\(card\)/);
  assert.match(row, /title="\$\{esc\(transportProvenanceTitle\(card\)\)\}"/);
  assert.doesNotMatch(row, /transport_updated_by_login/);
  assert.doesNotMatch(row, /transport_updated_at/);
});

test("transport provenance shows the precise Korea-local input time", () => {
  const context = dashboardRuntimeContext("admin", [{
    bl_number: "BL-TIME",
    transport_updated_by_role: "shipper",
    transport_updated_by_login: "HCH",
    transport_updated_at: "2026-07-23T04:05:06.000Z",
  }]);
  assert.equal(
    vm.runInContext("displayDateTime(__testCards[0].transport_updated_at)", context),
    "2026-07-23 13:05"
  );
  const tooltip = vm.runInContext(
    "progressTransportTooltip(__testCards[0], 0, 'eta')",
    context
  );
  assert.match(tooltip, /2026-07-23 13:05/);
  assert.match(tooltip, /HCH/);
});

test("progress BL tooltip escapes every confirmation and has no mutation controls", () => {
  assert.match(dashboard, /function progressRevisionTooltip\(card\)/);
  const card = {
    bl_number: "BL-REV",
    revisions: [
      { text: `<img src=x onerror="globalThis.pwned=true">`, done: false, created_by: "shipper" },
      { text: "완료 항목", done: true, created_by: "admin" },
    ],
  };
  const context = dashboardRuntimeContext("shipper", [card]);
  const html = vm.runInContext("progressRevisionTooltip(__testCards[0])", context);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img\b/i);
  assert.match(html, /&lt;img/);
  assert.match(html, /아인/);
  assert.match(html, /화주/);
  assert.match(html, /progress-revision-done/);
  assert.doesNotMatch(html, /수정|삭제|button/i);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /role="tooltip"/);
});

test("admin request indicators stay inside the state cell and expose latest request details", () => {
  assert.match(dashboard, /function progressAdminRequestIndicators\(card\)/);
  const rowStart = dashboard.indexOf("document.getElementById(\"progressRows\").innerHTML");
  const rowEnd = dashboard.indexOf("`).join(\"\")", rowStart);
  const row = dashboard.slice(rowStart, rowEnd);
  assert.match(
    row,
    /<td class="progress-long progress-state-cell">[\s\S]*progressAdminRequestIndicators\(card\)[\s\S]*<\/td>/
  );
  const card = {
    stage: "반입",
    last_original_doc_request: {
      requester_name: "화주 담당",
      requester_email: "shipper@example.com",
      requested_receipt_date: "2026-07-24",
      memo: "원본 요청",
    },
    last_import_request: {
      requester_name: "화주 담당",
      requester_email: "shipper@example.com",
      requested_import_date: "2026-07-25",
      memo: "신고 요청",
    },
  };
  const context = dashboardRuntimeContext("admin", [card]);
  const html = vm.runInContext("progressAdminRequestIndicators(__testCards[0])", context);
  assert.equal((html.match(/화주요청/g) || []).length, 2);
  assert.match(html, /서류수령/);
  assert.match(html, /수입신고/);
  assert.match(html, /shipper@example\.com/);
  assert.doesNotMatch(html, /<td\b/i);
});

test("progress calendar separates import, original, and transfer receipt events", () => {
  const events = progressCalendarHarness([
    {
      bl_number: "ONEYBNEG04197300",
      last_import_requested_import_date: "2026-07-23",
      last_original_doc_requested_receipt_date: "2026-07-22",
      actual_received_date: "2026-07-24",
      obl_received: true,
      hc_received: false,
      doc_transfer_received: true,
      warehouse_expected_date: "2026-07-25",
      eta_date: "2026-07-21",
    },
    {
      bl_number: "BL-HC",
      actual_received_date: "2026-07-26",
      obl_received: false,
      hc_received: true,
    },
    {
      bl_number: "BL-BOTH",
      actual_received_date: "2026-07-27",
      obl_received: true,
      hc_received: true,
    },
  ]);

  assert.ok(events.some((event) =>
    event.date === "2026-07-23" &&
    event.type === "import-request" &&
    event.text === "수입신고요청 ONEYBNEG04197300"
  ));
  assert.ok(events.some((event) => event.text === "서류수령 ONEYBNEG04197300 (OBL)"));
  assert.ok(events.some((event) => event.text === "서류수령 ONEYBNEG04197300 (양도증)"));
  assert.ok(events.some((event) => event.text === "서류수령 BL-HC (H/C)"));
  assert.ok(events.some((event) => event.text === "서류수령 BL-BOTH (OBL, H/C)"));
  assert.ok(events.some((event) => event.text === "입항 ONEYBNEG04197300"));
  assert.ok(events.some((event) => event.text === "서류요청 ONEYBNEG04197300"));
  assert.ok(events.some((event) => event.text === "반입예정 ONEYBNEG04197300"));
});

test("progress calendar keeps base events while filtering optional event groups", () => {
  const events = progressCalendarHarness([{
    bl_number: "BL-PREFERENCES",
    eta_date: "2026-07-21",
    last_original_doc_requested_receipt_date: "2026-07-22",
    last_import_requested_import_date: "2026-07-23",
    actual_received_date: "2026-07-24",
    obl_received: true,
    doc_transfer_received: true,
    warehouse_expected_date: "2026-07-25",
  }], {
    import_request: false,
    warehouse_expected: false,
  });

  assert.ok(events.some((event) => event.type === "eta"));
  assert.ok(events.some((event) => event.type === "request"));
  assert.ok(events.some((event) => event.type === "actual"));
  assert.ok(events.some((event) => event.type === "transfer"));
  assert.ok(!events.some((event) => event.type === "import-request"));
  assert.ok(!events.some((event) => event.type === "warehouse"));
});

test("progress page includes editable warehouse schedule and calendar event", () => {
  assert.match(dashboard, /openProgressWarehouseEditor/);
  assert.match(dashboard, /id="progressWarehouseEta" type="date"/);
  assert.match(dashboard, /warehouse_expected_date/);
  assert.match(dashboard, /type: "warehouse"/);
  const start = dashboard.indexOf("async function saveProgressWarehouseEditor");
  const end = dashboard.indexOf("function openProgressStatus", start);
  const body = dashboard.slice(start, end);
  assert.match(body, /payload\.eta_date = etaDate/);
  assert.doesNotMatch(body, /free_time_days:/);
});

test("compact cards and progress rows use concise one-line display values", () => {
  assert.match(dashboard, /grid-template-columns:minmax\(88px,max-content\)/);
  assert.match(dashboard, /function progressConsignee\(value\)/);
  assert.match(dashboard, /displayConsignee\(value\)\.slice\(0, 4\)/);
  assert.match(dashboard, /function progressDestination\(value\)/);
  assert.match(dashboard, /split\("_"\)\[0\]/);
  const rowStart = dashboard.indexOf("document.getElementById(\"progressRows\").innerHTML");
  const rowEnd = dashboard.indexOf("`).join(\"\")", rowStart);
  const row = dashboard.slice(rowStart, rowEnd);
  assert.match(row, /<span class="[^"]*\bprogress-shipper\b[^"]*">/);
  assert.match(row, /<span class="[^"]*\bprogress-destination\b[^"]*">/);
});

test("progress alignment classes define their required CSS semantics", () => {
  assert.match(dashboard, /\.progress-date\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(dashboard, /\.progress-long\s*\{[^}]*text-align:\s*left/);
  assert.match(dashboard, /\.progress-table\s+th\s*\{[^}]*text-align:\s*center/);
  assert.match(dashboard, /\.progress-table\s+td\.progress-date\s*\{[^}]*text-align:\s*center/);
  assert.match(dashboard, /\.progress-table\s+\.progress-date\s+\.progress-edit-btn\s*\{[^}]*width:\s*100%[^}]*text-align:\s*center/);
});

test("dashboard defaults every role to the board and exposes progress navigation", () => {
  assert.match(dashboard, /let currentPrimaryView = "board"/);
  assert.match(dashboard, /function showPrimaryView\(view\)/);
  assert.match(dashboard, /currentPrimaryView = view === "board" \? "board" : "progress"/);
  assert.doesNotMatch(dashboard, /currentUserRole === "viewer"\) currentPrimaryView = "progress"/);
  assert.doesNotMatch(dashboard, /body\.viewer-progress #boardWrap/);
  assert.match(dashboard, /showPrimaryView\(currentPrimaryView\)/);
  assert.match(dashboard, /function togglePrimaryView\(\)/);
  assert.match(dashboard, />BL 진행<\/button>/);
  assert.match(dashboard, />대시보드<\/button>/);
  assert.match(dashboard, /currentPrimaryView = "board";/);
});

test("viewer board cards remain read-only", () => {
  const context = dashboardRuntimeContext("viewer", [{
    bl_number: "BL-VIEWER",
    account_id: "viewer-account",
    stage: "반입",
    is_quota: true,
    quota_permit_date: "2026-07-24",
    revisions: [{ id: "revision-1", text: "Read only", done: false, created_by: "shipper" }],
  }]);
  const html = context.renderFullCard(context.__testCards[0], 0);

  assert.doesNotMatch(html, /data-card-action="(?:quota|manual|revision)/);
  assert.doesNotMatch(html, /<button\b/);
});

test("calendar legend initializes and saves optional visibility preferences", () => {
  assert.match(dashboard, /data-calendar-preference="import_request"/);
  assert.match(dashboard, /data-calendar-preference="warehouse_expected"/);
  assert.match(dashboard, /let calendarPreferences = \{\s*import_request: true,\s*warehouse_expected: true,\s*\}/);
  assert.match(dashboard, /result\.user\.calendar_preferences/);
  assert.match(dashboard, /async function saveCalendarPreference\(key, checked\)/);
  assert.match(dashboard, /fetch\("\/api\/cargo-calendar-preferences"/);
  assert.match(dashboard, /calendarPreferences\[key\] = previousValue/);
  assert.match(dashboard, /renderProgressCalendar\(\)/);
});

test("progress table adds two complete shipper request columns to the 24 admin columns", () => {
  const tableStart = dashboard.indexOf('<table class="progress-table">');
  const tableEnd = dashboard.indexOf("</table>", tableStart);
  const table = dashboard.slice(tableStart, tableEnd);
  const header = table.slice(table.indexOf("<thead>"), table.indexOf("</thead>"));
  const rowStart = dashboard.indexOf("document.getElementById(\"progressRows\").innerHTML");
  const rowEnd = dashboard.indexOf("`).join(\"\")", rowStart);
  const row = dashboard.slice(rowStart, rowEnd);

  assert.equal((header.match(/<th\b/g) || []).length, 26);
  assert.equal((row.match(/<td\b/g) || []).length, 24);
  assert.equal((row.match(/\$\{progressRequestToggle\(card, "(?:docs|import)"\)\}/g) || []).length, 2);
  assert.match(dashboard, /if \(currentUserRole === "admin"\) return ""/);
  assert.match(dashboard, /body:not\(\.shipper-progress\) \.progress-shipper-only\s*\{\s*display:none/);
  assert.match(dashboard, /colspan="\$\{currentUserRole === "admin" \? 24 : 26\}"/);
});

test("progress table binds date classes to ETA and warehouse date columns", () => {
  const rowStart = dashboard.indexOf("document.getElementById(\"progressRows\").innerHTML");
  const rowEnd = dashboard.indexOf("`).join(\"\")", rowStart);
  const row = dashboard.slice(rowStart, rowEnd);
  const headerStart = dashboard.indexOf("<thead>", dashboard.indexOf('<table class="progress-table">'));
  const headerEnd = dashboard.indexOf("</thead>", headerStart);
  const header = dashboard.slice(headerStart, headerEnd);
  const headerClasses = [...header.matchAll(/<th\b[^>]*class="([^"]*)"/g)].map((match) => match[1].split(/\s+/));
  const rowClasses = [...row.matchAll(/<td\b[^>]*class="([^"]*)"/g)].map((match) => match[1].split(/\s+/));

  assert.equal(headerClasses.filter((classes) => classes.includes("progress-date")).length, 2);
  assert.equal(rowClasses.filter((classes) => classes.includes("progress-date")).length, 2);
  assert.match(header, /<th class="[^"]*\bprogress-date\b[^"]*">\uC785\uD56D\uC608\uC815<\/th>/);
  assert.match(header, /<th class="[^"]*\bprogress-date\b[^"]*">\uBC18\uC785\uC608\uC815\uC77C<\/th>/);
  assert.match(row, /<td class="[^"]*\bprogress-date\b[^"]*">[\s\S]*?<button[^>]*>[\s\S]*?displayDate\(etaText\(card\)\)/);
  assert.match(row, /<td class="[^"]*\bprogress-date\b[^"]*">[\s\S]*?<button[^>]*>[\s\S]*?displayDate\(card\.warehouse_expected_date/);
});

test("progress table binds long and centered short classes to intended columns", () => {
  const rowStart = dashboard.indexOf("document.getElementById(\"progressRows\").innerHTML");
  const rowEnd = dashboard.indexOf("`).join(\"\")", rowStart);
  const row = dashboard.slice(rowStart, rowEnd);
  const headerStart = dashboard.indexOf("<thead>", dashboard.indexOf('<table class="progress-table">'));
  const headerEnd = dashboard.indexOf("</thead>", headerStart);
  const header = dashboard.slice(headerStart, headerEnd);
  const headerClasses = [...header.matchAll(/<th\b[^>]*class="([^"]*)"/g)].map((match) => match[1].split(/\s+/));
  const rowClasses = [...row.matchAll(/<td\b[^>]*class="([^"]*)"/g)].map((match) => match[1].split(/\s+/));
  const hasTokens = (classes, ...tokens) => tokens.every((token) => classes.includes(token));

  assert.equal(headerClasses.filter((classes) => classes.includes("progress-long")).length, 5);
  assert.equal(rowClasses.filter((classes) => classes.includes("progress-long")).length, 5);
  assert.equal(headerClasses.filter((classes) => classes.includes("progress-short")).length, 19);
  assert.equal(rowClasses.filter((classes) => classes.includes("progress-short")).length, 17);
  assert.equal(headerClasses.filter((classes) => hasTokens(classes, "progress-short", "center")).length, 19);
  assert.equal(rowClasses.filter((classes) => hasTokens(classes, "progress-short", "center")).length, 17);
  assert.match(header, /<th class="[^"]*\bprogress-long\b[^"]*">\uBC18\uC785\(\uC608\uC815\)\uAD6C\uC5ED<\/th>/);
  assert.match(header, /<th class="[^"]*\bprogress-long\b[^"]*">\uC9C4\uD589\uC0C1\uD0DC<\/th>/);
  assert.match(header, /<th class="[^"]*\bprogress-short\b[^"]*">\uC721\uC885<\/th>/);
  assert.match(header, /<th class="[^"]*\bprogress-short\b[^"]*">\uC778\uB3C4\uC870\uAC74<\/th>/);
  assert.match(header, /<th class="[^"]*\bprogress-short\b[^"]*">\uB9C8\uC77C\uC2A4\uD1A4<\/th>/);
  assert.match(row, /<td class="[^"]*\bprogress-long\b[^"]*">[\s\S]*?<button[^>]*>[\s\S]*?yardText\(card\)/);
  assert.match(row, /<td class="progress-long progress-state-cell"><span>\$\{esc\(progressStateText\(card\)\)\}<\/span>\$\{progressAdminRequestIndicators\(card\)\}<\/td>/);
});

test("shipper progress request controls use exact stages and latest request details", () => {
  const start = dashboard.indexOf("function progressRequestToggle");
  const end = dashboard.indexOf("function renderProgressStatus", start);
  const helper = dashboard.slice(start, end);

  assert.match(dashboard, /서류수령요청/);
  assert.match(dashboard, /수입신고요청/);
  assert.match(helper, /요청 O/);
  assert.match(helper, /요청 X/);
  assert.match(helper, /progress-shipper-only/);
  assert.match(helper, /\["입항전", "입항", "반입"\]/);
  assert.match(helper, /\["입항", "반입"\]/);
  assert.match(helper, /last_original_doc_request/);
  assert.match(helper, /last_import_request/);
  assert.match(helper, /openOriginalDocModal/);
  assert.match(helper, /openImportModal/);
  assert.match(helper, /progress-request-detail/);
  assert.match(helper, /disabled/);
});

test("progress request helper renders complete cells only for shippers", () => {
  const card = { bl_number: "BL-1", stage: "입항" };
  assert.equal(requestControlHarness("admin", [card])(card, "docs"), "");

  const html = requestControlHarness("shipper", [card])(card, "docs");
  assert.equal((html.match(/<td\b/g) || []).length, 1);
  assert.equal((html.match(/<button\b/g) || []).length, 1);
  assert.match(html, /data-progress-request-type="docs"/);
  assert.match(html, /data-card-index="0"/);
  assert.doesNotMatch(html, /\sonclick=/i);
});

test("progress request helper never interpolates a hostile BL into event attributes", () => {
  const hostileBl = `BL'"><img src=x onerror="globalThis.pwned=true">&`;
  const card = { bl_number: hostileBl, stage: "입항" };
  const html = requestControlHarness("shipper", [card])(card, "import");

  assert.doesNotMatch(html, /\sonclick=/i);
  assert.doesNotMatch(html, /onerror=/i);
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /globalThis\.pwned/);
});

test("restricted request controls stay focusable and describe their restriction", () => {
  const card = { bl_number: "BL-2", stage: "수입신고" };
  const html = requestControlHarness("shipper", [card])(card, "docs");
  const descriptionId = html.match(/aria-describedby="([^"]+)"/)?.[1];

  assert.match(html, /aria-disabled="true"/);
  assert.doesNotMatch(html, /\sdisabled(?:\s|>|=)/);
  assert.ok(descriptionId);
  assert.match(html, new RegExp(`id="${descriptionId}"`));
  assert.match(html, /입항전\/입항\/반입 단계에서만 서류수령 요청할 수 있습니다/);
});

test("latest request details are associated with the focusable control", () => {
  const card = {
    bl_number: "BL-3",
    stage: "반입",
    last_import_request: {
      requester_name: "담당자",
      requester_email: "owner@example.com",
      requested_import_date: "2026-07-23",
      created_at: "2026-07-22T15:00:00Z",
      memo: "검토 요청",
    },
  };
  const html = requestControlHarness("shipper", [card])(card, "import");
  const descriptionId = html.match(/aria-describedby="([^"]+)"/)?.[1];

  assert.match(html, /aria-disabled="false"/);
  assert.ok(descriptionId);
  assert.match(html, new RegExp(`id="${descriptionId}"`));
  assert.match(html, /담당자/);
  assert.match(html, /owner@example\.com/);
  assert.match(html, /검토 요청/);
});

test("progress request tooltip uses fixed viewport placement above and below controls", () => {
  assert.match(dashboard, /\.progress-request-detail\s*\{[^}]*position:\s*fixed/);
  const start = dashboard.indexOf("function positionProgressRequestTooltip");
  const end = dashboard.indexOf("function scheduleProgressRequestTooltip", start);
  assert.ok(start >= 0 && end > start, "tooltip positioning function should exist");

  const detail = {
    dataset: {},
    style: {},
    getBoundingClientRect: () => ({ width: 230, height: 120 }),
  };
  let controlRect = { left: 740, right: 794, top: 550, bottom: 572, width: 54, height: 22 };
  const button = {
    getAttribute: () => "request-detail-0-docs",
    getBoundingClientRect: () => controlRect,
  };
  const context = {
    document: { getElementById: () => detail },
    window: { innerWidth: 800, innerHeight: 600 },
  };
  vm.createContext(context);
  vm.runInContext(`${dashboard.slice(start, end)}\nthis.positionTooltip = positionProgressRequestTooltip;`, context);

  context.positionTooltip(button);
  assert.equal(detail.dataset.placement, "above");
  assert.equal(detail.style.left, "562px");
  assert.equal(detail.style.top, "424px");

  controlRect = { left: 0, right: 54, top: 8, bottom: 30, width: 54, height: 22 };
  context.positionTooltip(button);
  assert.equal(detail.dataset.placement, "below");
  assert.equal(detail.style.left, "8px");
  assert.equal(detail.style.top, "36px");
});

test("progress request actions use one delegated guarded handler", () => {
  assert.match(dashboard, /function handleProgressRequestAction\(event\)/);
  assert.match(dashboard, /progressRows\.addEventListener\("click", handleProgressRequestAction\)/);
  assert.match(dashboard, /button\.getAttribute\("aria-disabled"\) === "true"/);
  assert.match(dashboard, /card\.bl_number/);
});

test("delegated request action resolves the live card and guards restricted stages", () => {
  const hostileBl = `BL'"><svg onload="globalThis.pwned=true">`;
  const cards = [
    { bl_number: hostileBl, stage: "입항" },
    { bl_number: "BL-LOCKED", stage: "수입신고" },
  ];
  const calls = [];
  const rows = { contains: () => true };
  const context = requestControlContext("shipper", cards, {
    document: {
      getElementById: (id) => id === "progressRows" ? rows : null,
    },
    requestAnimationFrame: () => {},
    openOriginalDocModal: (blNumber) => calls.push(["docs", blNumber]),
    openImportModal: (blNumber) => calls.push(["import", blNumber]),
  });
  const buttonFor = (cardIndex, type, ariaDisabled) => ({
    dataset: { cardIndex: String(cardIndex), progressRequestType: type },
    getAttribute: () => ariaDisabled,
    closest: () => ({ contains: () => true }),
  });

  context.handleRequestAction({
    target: { closest: () => buttonFor(0, "import", "false") },
  });
  assert.deepEqual(calls, [["import", hostileBl]]);

  context.handleRequestAction({
    target: { closest: () => buttonFor(1, "docs", "true") },
  });
  assert.deepEqual(calls, [["import", hostileBl]]);
});

test("no request modal opener interpolates BL values into inline handlers", () => {
  assert.doesNotMatch(
    dashboard,
    /onclick="open(?:Release|Import|OriginalDoc)Modal\('\$\{jsStr\(card\.bl_number\)\}'\)"/
  );
  assert.match(dashboard, /data-cargo-request-type="release"/);
  assert.match(dashboard, /data-cargo-request-type="import"/);
  assert.match(dashboard, /data-cargo-request-type="docs"/);
  assert.match(dashboard, /board\.addEventListener\("click", handleCardRequestAction\)/);
});

test("full board card rendering keeps hostile identifiers inert", () => {
  const hostileBl = `BL'\" data-injected=\"yes\"><img src=x onerror=\"globalThis.pwned=true\">&`;
  const hostileAccount = `account'\" onpointerenter=\"globalThis.pwned=true`;
  const hostileRevisionId = `revision'\" autofocus onfocus=\"globalThis.pwned=true`;
  const card = {
    account_id: hostileAccount,
    bl_number: hostileBl,
    consignee: "Runtime shipper",
    stage: "반입",
    is_quota: true,
    quota_permit_date: "2026-07-23",
    revisions: [{
      id: hostileRevisionId,
      text: `Review <svg onload=\"globalThis.pwned=true\">`,
      created_by: "shipper",
      done: false,
    }],
  };
  const context = dashboardRuntimeContext("admin", [card]);
  const html = context.renderFullCard(card, 0);

  assert.match(html, /BL&#39;&quot; data-injected=&quot;yes&quot;&gt;&lt;img/);
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /<svg\b/i);
  assert.doesNotMatch(html, /\sdata-injected="yes"/i);
  assert.doesNotMatch(html, /\sonpointerenter="globalThis\.pwned=true/i);
  assert.doesNotMatch(html, /\sonfocus="globalThis\.pwned=true/i);
  assert.doesNotMatch(html, /\sonerror="globalThis\.pwned=true/i);
  for (const [, handler] of html.matchAll(/\son(?:click|change|input|keydown|toggle)="([^"]*)"/gi)) {
    assert.doesNotMatch(handler, /data-injected|globalThis|<img|<svg/i);
  }
});

test("board data controls dispatch hostile identifiers from live card state", () => {
  const hostileBl = `BL'"><img src=x onerror="globalThis.pwned=true">`;
  const hostileAccount = `account'\" data-injected=\"yes`;
  const hostileRevisionId = `revision'\" onfocus=\"globalThis.pwned=true`;
  const card = {
    account_id: hostileAccount,
    bl_number: hostileBl,
    stage: "반입",
    revisions: [{ id: hostileRevisionId, text: "Check", done: false }],
  };
  const calls = [];
  const board = { contains: () => true };
  const context = dashboardRuntimeContext("admin", [card], {
    document: {
      getElementById: (id) => id === "board" ? board : null,
    },
    setCardHidden: (...args) => calls.push(["hide", ...args]),
    toggleRevisionDone: (...args) => calls.push(["done", ...args]),
  });
  const control = (action, extra = {}) => {
    const element = {
      dataset: { cardAction: action, cardIndex: "0", ...extra },
    };
    element.closest = () => element;
    return element;
  };

  context.dispatchBoardClick({
    target: { closest: () => control("card-visibility", { hidden: "true" }) },
    preventDefault() {},
    stopPropagation() {},
  });
  const doneControl = control("revision-done", { revisionIndex: "0" });
  doneControl.checked = true;
  context.dispatchBoardChange({ target: doneControl });

  assert.deepEqual(calls, [
    ["hide", hostileAccount, hostileBl, true],
    ["done", hostileBl, hostileAccount, hostileRevisionId, true],
  ]);
});

test("board data-bearing controls use delegation instead of jsStr inline handlers", () => {
  assert.doesNotMatch(dashboard, /function jsStr\(/);
  assert.doesNotMatch(dashboard, /\$\{jsStr\(/);
  const allowedIndexExpressions = new Set([
    "index",
    "idx",
    "sourceIndex",
    "currentCards.indexOf(card)",
  ]);
  for (const [, handler] of dashboard.matchAll(/\son(?:click|change|input|keydown|toggle)="([^"]*)"/gi)) {
    for (const [, expression] of handler.matchAll(/\$\{([^}]+)\}/g)) {
      assert.ok(
        allowedIndexExpressions.has(expression.trim()),
        `inline handler interpolation must be index-only: ${expression}`
      );
    }
  }
  assert.match(dashboard, /board\.addEventListener\("click", handleBoardCardClick\)/);
  assert.match(dashboard, /board\.addEventListener\("change", handleBoardCardChange\)/);
  assert.match(dashboard, /board\.addEventListener\("input", handleBoardCardInput\)/);
  assert.match(dashboard, /board\.addEventListener\("keydown", handleBoardCardKeydown\)/);
  assert.match(dashboard, /board\.addEventListener\("toggle", handleBoardCardToggle, true\)/);
  assert.match(dashboard, /adminRows\.addEventListener\("click", handleAdminAccountAction\)/);
});

test("progress receipt calendar keeps transfer receipt as an independent event", () => {
  const start = dashboard.indexOf("function progressCalendarEvents()");
  const end = dashboard.indexOf("function renderProgressCalendar", start);
  const body = dashboard.slice(start, end);
  const receiptStart = body.indexOf("const originalReceiptTypes");
  const receiptEnd = body.indexOf("const warehouseDate", receiptStart);
  const receiptEvent = body.slice(receiptStart, receiptEnd);

  assert.match(receiptEvent, /originalReceiptTypes\.join\(", "\)/);
  assert.match(receiptEvent, /text:\s*`서류수령 \$\{label\} \(양도증\)`/);
});

test("progress original O path confirms removal without prompting for a date", () => {
  const start = dashboard.indexOf("async function saveProgressOriginalDoc");
  const end = dashboard.indexOf("async function approvePendingOriginalDoc", start);
  const body = dashboard.slice(start, end);
  assert.match(body, /if \(received\)/);
  assert.match(body, /confirm\(/);
  assert.match(body, /actual_received_date: otherReceived \? card\.actual_received_date : ""/);
});

test("mobile original document manager supports transfer override", () => {
  assert.match(mobile, /양도증/);
  assert.match(mobile, /transfer_received_override/);
  assert.match(mobile, /automatic/);
  assert.match(mobile, /result\.warning/);
});

test("legacy original receipt fallback uses Korea-local update date", () => {
  assert.match(dashboard, /function koreaCalendarDate/);
  assert.match(dashboard, /koreaCalendarDate\(card\.original_docs_updated_at\)/);
  assert.match(dashboard, /koreaToday\(\)/);
});

test("receipt mail modals accept optional additional recipients", () => {
  assert.match(dashboard, /receiptMailAdditionalRecipients/);
  assert.match(mobile, /receiptMailAdditionalRecipients/);
  assert.match(dashboard, /additional_recipients/);
  assert.match(mobile, /additional_recipients/);
});

test("legacy original document status toolbar button is removed", () => {
  assert.doesNotMatch(dashboard, /id="docsStatusBtn"/);
});

test("pre-migration original document saves fall back without transfer override", () => {
  assert.match(originalDocsApi, /isMissingTransferOverrideColumn/);
  assert.match(originalDocsApi, /delete fallbackPayload\.transfer_received_override/);
  assert.match(originalDocsApi, /transfer_override_saved/);
});

test("shipper warehouse save precedes mail and includes an optimistic rollback", () => {
  const blockAt = quotaApi.indexOf('if (action === "manual_fields")');
  const mailAt = quotaApi.indexOf("await sendWarehouseChangeMail");
  const saveAt = quotaApi.indexOf("const rows = await supabaseFetch", blockAt);
  assert.ok(saveAt >= 0 && mailAt > saveAt);
  assert.match(quotaApi, /updated_at=eq\.\$\{updated\}/);
  assert.match(quotaApi, /변경을 취소했습니다/);
});
