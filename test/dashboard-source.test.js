const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const dashboard = fs.readFileSync(path.join(__dirname, "..", "cargo-dashboard.html"), "utf8");
const mobile = fs.readFileSync(path.join(__dirname, "..", "cargo-docs-mobile.html"), "utf8");
const originalDocsApi = fs.readFileSync(path.join(__dirname, "..", "api", "cargo-original-docs.js"), "utf8");
const quotaApi = fs.readFileSync(path.join(__dirname, "..", "api", "cargo-quota.js"), "utf8");
const visibilityApi = fs.readFileSync(path.join(__dirname, "..", "api", "cargo-card-visibility.js"), "utf8");

function requestControlContext(role, cards, overrides = {}) {
  const start = dashboard.indexOf("function canRequestOriginalDocuments");
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
this.handleRequestAction = handleProgressRequestAction;
this.canRequestOriginalDocuments = canRequestOriginalDocuments;`,
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
    effectiveOriginalReceiptDate: (card) => (
      card.actual_received_date || card.original_docs_updated_at || ""
    ),
  };
  vm.createContext(context);
  vm.runInContext(
    `${dashboard.slice(start, end)}
this.events = progressCalendarEvents;`,
    context
  );
  return context.events();
}

function mobileOriginalRequestHarness() {
  const start = mobile.indexOf("function hasMobileOriginalRequest");
  const end = mobile.indexOf("function render()", start);
  assert.ok(start >= 0 && end > start, "mobile request priority helpers should exist");
  const context = {
    shortDate: (value) => value ? String(value).slice(0, 10) : "",
    esc: (value) => String(value ?? ""),
  };
  vm.createContext(context);
  vm.runInContext(
    `${mobile.slice(start, end)}
this.requestRank = mobileOriginalRequestRank;
this.requestSort = mobileOriginalRequestSort;
this.requestBadge = mobileOriginalRequestBadge;`,
    context
  );
  return context;
}

test("dashboard arrival text prefers Customs entry date over a stale manual ETA", () => {
  const context = dashboardRuntimeContext("admin", [{
    stage: "반입",
    entry_date: "20260723",
    eta_date: "2026-07-24",
    first_arrival_date: "2026-07-24",
  }]);
  assert.equal(vm.runInContext("etaText(__testCards[0])", context), "2026-07-23");
});

test("dashboard arrival text prefers a saved user ETA without overwriting Customs entry date", () => {
  const context = dashboardRuntimeContext("admin", [{
    stage: "arrival",
    entry_date: "20260801",
    eta_date: "2026-07-31",
    eta_date_user_entered: true,
  }]);
  assert.equal(vm.runInContext("etaText(__testCards[0])", context), "2026-07-31");
  assert.equal(
    vm.runInContext(`
      applyManualFieldsToCard(__testCards[0], { eta_date: "2026-07-30" }, {
        eta_date: "2026-07-30"
      });
      etaText(__testCards[0]);
    `, context),
    "2026-07-30"
  );
  assert.equal(context.__testCards[0].entry_date, "20260801");
});

function calendarPreferenceHarness(overrides = {}) {
  const start = dashboard.indexOf("let calendarPreferences");
  const end = dashboard.indexOf("function showPrimaryView", start);
  assert.ok(start >= 0 && end > start, "calendar preference source should exist");
  const controls = [
    { dataset: { calendarPreference: "import_request" }, checked: true },
    { dataset: { calendarPreference: "warehouse_expected" }, checked: true },
  ];
  const context = {
    document: { querySelectorAll: () => controls },
    renderCount: 0,
    errors: [],
    renderProgressCalendar() {
      context.renderCount += 1;
    },
    ...overrides,
  };
  context.alert = (message) => context.errors.push(message);
  vm.createContext(context);
  vm.runInContext(
    `${dashboard.slice(start, end)}
this.saveCalendarPreferenceForTest = saveCalendarPreference;
this.calendarPreferencesForTest = () => ({ ...calendarPreferences });`,
    context
  );
  return { context, controls };
}

function currentCalendarPreferences(context) {
  return { ...context.calendarPreferencesForTest() };
}

test("dashboard exposes the new progress operations without another API function", () => {
  assert.match(dashboard, /만기\(프리타임\)/);
  assert.match(dashboard, /OBL 접수일/);
  assert.match(dashboard, /스티커요청/);
  assert.match(dashboard, /△/);
  assert.match(quotaApi, /sticker_requested/);
  assert.match(quotaApi, /obl_carrier_submitted/);
  assert.match(visibilityApi, /permanent_exclude/);
  assert.match(visibilityApi, /restore_exclusion/);
});

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
  assert.match(openBody, /confirmation_action/);
  assert.match(openBody, /확정취소/);
  assert.match(openBody, /확정/);

  const saveStart = dashboard.indexOf("async function saveProgressWarehouseEditor");
  const saveEnd = dashboard.indexOf("function openProgressStatus", saveStart);
  const saveBody = dashboard.slice(saveStart, saveEnd);
  assert.match(saveBody, /send_notification:\s*sendNotification === true/);
  assert.match(saveBody, /response\.status === 409/);
  assert.match(saveBody, /await loadData\(\)/);
  assert.match(saveBody, /메일 발송에 실패/);
  assert.match(saveBody, /저장되었습니다/);
  assert.match(saveBody, /메일로 발송되었습니다/);
  assert.match(saveBody, /confirm_field/);
  assert.match(saveBody, /confirmation_action/);
});

test("progress transport cells render administrator confirmation controls and persistent styling", () => {
  assert.match(dashboard, /function progressConfirmedClass\(card, field\)/);
  assert.match(dashboard, /\.progress-field-confirmed\s*\{[^}]*border:\s*1px solid #dc2626/);
  assert.match(dashboard, /\.progress-field-confirmed\s*\{[^}]*background:\s*#fff1f2/);
  assert.match(dashboard, /eta_date_confirmed/);
  assert.match(dashboard, /storage_yard_confirmed/);
  assert.match(dashboard, /warehouse_expected_date_confirmed/);

  const rowStart = dashboard.indexOf("document.getElementById(\"progressRows\").innerHTML");
  const rowEnd = dashboard.indexOf("`).join(\"\")", rowStart);
  const row = dashboard.slice(rowStart, rowEnd);
  assert.equal((row.match(/progressConfirmedClass\(card,\s*"(?:eta_date|storage_yard|warehouse_expected_date)"\)/g) || []).length, 3);
  assert.equal((row.match(/progressConfirmAttribute\(card,\s*"(?:eta_date|storage_yard|warehouse_expected_date)"\)/g) || []).length, 3);

  const adminContext = dashboardRuntimeContext("admin", [{
    eta_date_confirmed: true,
    storage_yard_confirmed: false,
  }]);
  assert.equal(
    vm.runInContext("progressConfirmedClass(__testCards[0], 'eta_date')", adminContext),
    " progress-field-confirmed"
  );
  assert.match(
    vm.runInContext("progressConfirmAttribute(__testCards[0], 'eta_date')", adminContext),
    /data-progress-confirm-field="eta_date"/
  );

  const shipperContext = dashboardRuntimeContext("shipper", [{
    eta_date_confirmed: true,
  }]);
  assert.equal(
    vm.runInContext("progressConfirmedClass(__testCards[0], 'eta_date')", shipperContext),
    " progress-field-confirmed"
  );
  assert.equal(
    vm.runInContext("progressConfirmAttribute(__testCards[0], 'eta_date')", shipperContext),
    ""
  );
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

test("progress BL tooltip escapes confirmations and lets writable users add one", () => {
  assert.match(dashboard, /function progressRevisionTooltip\(card\)/);
  const card = {
    account_id: "account-1",
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
  assert.match(html, /data-progress-revision-action="draft"/);
  assert.match(html, /data-progress-revision-action="add"/);
  assert.match(html, /확인사항 추가/);
  assert.doesNotMatch(html, /onclick=/i);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /role="tooltip"/);
});

test("progress BL tooltip keeps interactive focus and edits existing confirmations", () => {
  const card = {
    account_id: "account-1",
    bl_number: "BL-EDIT-1",
    revisions: [{
      id: "revision-1",
      text: "기존 확인사항",
      created_by_role: "admin",
    }],
  };
  const context = dashboardRuntimeContext("admin", [card]);
  const readHtml = vm.runInContext("progressRevisionTooltip(__testCards[0])", context);
  assert.match(readHtml, /data-progress-revision-action="edit"/);
  assert.match(readHtml, /data-revision-index="0"/);

  vm.runInContext(
    `revisionEditModes["revision-1"] = true;
revisionEditDrafts["revision-1"] = "수정 중인 확인사항";`,
    context
  );
  const editHtml = vm.runInContext("progressRevisionTooltip(__testCards[0])", context);
  assert.match(editHtml, /data-progress-revision-action="edit-draft"/);
  assert.match(editHtml, /data-progress-revision-action="save"/);
  assert.match(editHtml, /data-progress-revision-action="cancel"/);
  assert.match(editHtml, /수정 중인 확인사항/);

  assert.match(dashboard, /\.progress-request-wrap\.progress-tooltip-open \.progress-request-detail/);
  assert.match(dashboard, /function closeProgressRequestTooltip/);
  assert.match(dashboard, /setTimeout\([^]*progressTooltipCloseDelay/);
  assert.match(dashboard, /document\.addEventListener\("pointerdown", handleProgressTooltipOutsidePointer\)/);
  assert.match(dashboard, /event\.key === "Escape"/);
});

test("progress BL tooltip remains read-only for viewer accounts", () => {
  const card = {
    account_id: "account-1",
    bl_number: "BL-READ-ONLY",
    revisions: [{ text: "읽기 전용", done: false, created_by: "shipper" }],
  };
  const context = dashboardRuntimeContext("viewer", [card]);
  const html = vm.runInContext("progressRevisionTooltip(__testCards[0])", context);

  assert.match(html, /읽기 전용/);
  assert.doesNotMatch(html, /data-progress-revision-action/);
  assert.doesNotMatch(html, /확인사항 추가/);
});

test("progress confirmation entry uses delegated live-card controls", () => {
  assert.match(dashboard, /function handleProgressRevisionClick\(event\)/);
  assert.match(dashboard, /function handleProgressRevisionInput\(event\)/);
  assert.match(dashboard, /function handleProgressRevisionKeydown\(event\)/);
  assert.match(dashboard, /progressRows\.addEventListener\("click", handleProgressRevisionClick\)/);
  assert.match(dashboard, /progressRows\.addEventListener\("input", handleProgressRevisionInput\)/);
  assert.match(dashboard, /progressRows\.addEventListener\("keydown", handleProgressRevisionKeydown\)/);
  assert.match(dashboard, /addRevision\(card\.bl_number, card\.account_id/);
  assert.match(dashboard, /\.progress-revision-detail\s*\{[^}]*pointer-events:\s*auto/);
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
    obl_received: false,
    prgs_stts: "수입신고전",
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
  assert.doesNotMatch(html, /요청\/수령O/);
  assert.doesNotMatch(html, /요청\/진행O/);
  assert.doesNotMatch(html, /progress-admin-request-badge completed/);
  assert.doesNotMatch(html, /<td\b/i);
});

test("admin request indicators turn green when documents are received and import declaration is underway", () => {
  const card = {
    stage: "수입신고",
    obl_received: true,
    prgs_stts: "수입(사용소비) 심사진행",
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

  assert.match(html, /서류수령 요청\/수령O/);
  assert.match(html, /수입신고 요청\/진행O/);
  assert.equal((html.match(/progress-admin-request-badge completed/g) || []).length, 2);
});

test("progress calendar keeps import and original receipt events without transfer events", () => {
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
      eta_date: "2026-07-22",
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
  assert.ok(events.some((event) => event.text === "서류수령 BL-HC (H/C)"));
  assert.ok(events.some((event) => event.text === "서류수령 BL-BOTH (OBL, H/C)"));
  assert.ok(!events.some((event) => event.type === "transfer"));
  assert.ok(!events.some((event) => event.text.includes("양도증")));
  assert.ok(events.some((event) => event.text === "입항 ONEYBNEG04197300 (OBL O)"));
  assert.ok(events.some((event) => event.text === "입항 BL-HC (OBL X)"));
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
  assert.ok(!events.some((event) => event.type === "transfer"));
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
  assert.match(body, /eta_date:\s*document\.getElementById\("progressWarehouseEta"\)\.value/);
  assert.match(body, /if \(value !== previousValues\[field\]\) payload\[field\] = value/);
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

test("dashboard defaults every role to BL progress and exposes board navigation", () => {
  assert.match(dashboard, /let currentPrimaryView = "progress"/);
  assert.match(dashboard, /function showPrimaryView\(view\)/);
  assert.match(dashboard, /currentPrimaryView = view === "board" \? "board" : "progress"/);
  assert.doesNotMatch(dashboard, /currentUserRole === "viewer"\) currentPrimaryView = "progress"/);
  assert.doesNotMatch(dashboard, /body\.viewer-progress #boardWrap/);
  assert.match(dashboard, /showPrimaryView\(currentPrimaryView\)/);
  assert.match(dashboard, /function togglePrimaryView\(\)/);
  assert.match(dashboard, />BL 진행<\/button>/);
  assert.match(dashboard, />대시보드<\/button>/);
  assert.match(dashboard, /currentPrimaryView = "progress";/);
  assert.doesNotMatch(dashboard, /currentUserRole === "viewer"\s*\?\s*"none"\s*:\s*""/);
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
  assert.match(
    dashboard,
    /<div class="calendar-legend" role="group" aria-label="캘린더 일정 범례">/
  );
  assert.match(dashboard, /data-calendar-preference="import_request"/);
  assert.match(dashboard, /data-calendar-preference="warehouse_expected"/);
  assert.match(dashboard, /let calendarPreferences = \{\s*import_request: true,\s*warehouse_expected: true,\s*\}/);
  assert.match(dashboard, /result\.user\.calendar_preferences/);
  assert.match(dashboard, /async function saveCalendarPreference\(key, checked\)/);
  assert.match(dashboard, /fetch\("\/api\/cargo-data"/);
  assert.match(dashboard, /let calendarPreferenceSaveQueue = Promise\.resolve\(\)/);
  assert.match(dashboard, /const preferencesToSave = \{ \.\.\.calendarPreferences \}/);
  assert.match(dashboard, /calendarPreferenceSaveQueue = calendarPreferenceSaveQueue\.then/);
  assert.match(dashboard, /renderProgressCalendar\(\)/);
});

test("calendar preference saves serialize rapid toggles and keep the latest value", async () => {
  const requests = [];
  const { context } = calendarPreferenceHarness({
    fetch: (...args) => new Promise((resolve) => requests.push({ args, resolve })),
  });

  const first = context.saveCalendarPreferenceForTest("import_request", false);
  const second = context.saveCalendarPreferenceForTest("import_request", true);
  await Promise.resolve();
  assert.equal(requests.length, 1);
  assert.equal(JSON.parse(requests[0].args[1].body).import_request, false);

  requests[0].resolve({
    ok: true,
    json: async () => ({ success: true, calendar_preferences: { import_request: false, warehouse_expected: true } }),
  });
  await first;
  await Promise.resolve();
  assert.equal(requests.length, 2);
  assert.equal(JSON.parse(requests[1].args[1].body).import_request, true);

  requests[1].resolve({
    ok: true,
    json: async () => ({ success: true, calendar_preferences: { import_request: true, warehouse_expected: true } }),
  });
  await second;
  assert.deepEqual(currentCalendarPreferences(context), {
    import_request: true,
    warehouse_expected: true,
  });
  assert.deepEqual(context.errors, []);
});

test("calendar preference failures do not roll back newer choices", async () => {
  const requests = [];
  const { context } = calendarPreferenceHarness({
    fetch: (...args) => new Promise((resolve) => requests.push({ args, resolve })),
  });

  const first = context.saveCalendarPreferenceForTest("import_request", false);
  const second = context.saveCalendarPreferenceForTest("warehouse_expected", false);
  await Promise.resolve();
  requests[0].resolve({
    ok: false,
    json: async () => ({ success: false, message: "first save failed" }),
  });
  await first;
  await Promise.resolve();
  assert.deepEqual(currentCalendarPreferences(context), {
    import_request: false,
    warehouse_expected: false,
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[1].args[1].body), {
    import_request: false,
    warehouse_expected: false,
  });

  requests[1].resolve({
    ok: true,
    json: async () => ({ success: true, calendar_preferences: { import_request: false, warehouse_expected: false } }),
  });
  await second;
  assert.deepEqual(currentCalendarPreferences(context), {
    import_request: false,
    warehouse_expected: false,
  });
  assert.deepEqual(context.errors, []);
});

test("latest calendar preference failure restores the last saved value", async () => {
  const requests = [];
  const { context } = calendarPreferenceHarness({
    fetch: (...args) => new Promise((resolve) => requests.push({ args, resolve })),
  });

  const first = context.saveCalendarPreferenceForTest("import_request", false);
  const second = context.saveCalendarPreferenceForTest("warehouse_expected", false);
  await Promise.resolve();
  requests[0].resolve({
    ok: true,
    json: async () => ({ success: true, calendar_preferences: { import_request: false, warehouse_expected: true } }),
  });
  await first;
  await Promise.resolve();
  requests[1].resolve({
    ok: false,
    json: async () => ({ success: false, message: "latest save failed" }),
  });
  await second;

  assert.deepEqual(currentCalendarPreferences(context), {
    import_request: false,
    warehouse_expected: true,
  });
  assert.deepEqual(context.errors, ["latest save failed"]);
});

test("progress table keeps role-specific request and operations columns aligned", () => {
  const tableStart = dashboard.indexOf('<table class="progress-table">');
  const tableEnd = dashboard.indexOf("</table>", tableStart);
  const table = dashboard.slice(tableStart, tableEnd);
  const header = table.slice(table.indexOf("<thead>"), table.indexOf("</thead>"));
  const rowStart = dashboard.indexOf("document.getElementById(\"progressRows\").innerHTML");
  const rowEnd = dashboard.indexOf("`).join(\"\")", rowStart);
  const row = dashboard.slice(rowStart, rowEnd);

  assert.equal((header.match(/<th\b/g) || []).length, 30);
  assert.equal((row.match(/<td\b/g) || []).length, 27);
  assert.equal((row.match(/\$\{progressRequestToggle\(card, "(?:docs|import)"\)\}/g) || []).length, 2);
  assert.equal((row.match(/\$\{progressDeliveryStatus\(card\)\}/g) || []).length, 1);
  assert.match(dashboard, /if \(currentUserRole === "admin"\) return ""/);
  assert.match(dashboard, /body:not\(\.shipper-progress\) \.progress-shipper-only\s*\{\s*display:none/);
  assert.match(dashboard, /colspan="\$\{currentUserRole === "admin" \? 28 : 25\}"/);
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

  assert.equal(headerClasses.filter((classes) => classes.includes("progress-date")).length, 4);
  assert.equal(rowClasses.filter((classes) => classes.includes("progress-date")).length, 4);
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
  assert.equal(headerClasses.filter((classes) => classes.includes("progress-short")).length, 20);
  assert.equal(rowClasses.filter((classes) => classes.includes("progress-short")).length, 18);
  assert.equal(headerClasses.filter((classes) => hasTokens(classes, "progress-short", "center")).length, 20);
  assert.equal(rowClasses.filter((classes) => hasTokens(classes, "progress-short", "center")).length, 18);
  assert.match(header, /<th class="[^"]*\bprogress-long\b[^"]*">\uBC18\uC785\(\uC608\uC815\)\uAD6C\uC5ED<\/th>/);
  assert.match(header, /<th class="[^"]*\bprogress-long\b[^"]*">\uC9C4\uD589\uC0C1\uD0DC<\/th>/);
  assert.match(header, /<th class="[^"]*\bprogress-short\b[^"]*">\uC721\uC885<\/th>/);
  assert.match(header, /<th class="[^"]*\bprogress-short\b[^"]*">\uC778\uB3C4\uC870\uAC74<\/th>/);
  assert.match(header, /<th class="[^"]*\bprogress-short\b[^"]*">\uB9C8\uC77C\uC2A4\uD1A4<\/th>/);
  assert.match(row, /<td class="[^"]*\bprogress-long\b[^"]*">[\s\S]*?<button[^>]*>[\s\S]*?yardText\(card\)/);
  assert.match(row, /<td class="progress-long progress-state-cell"><span>\$\{esc\(progressStateText\(card\)\)\}<\/span>\$\{progressAdminRequestIndicators\(card\)\}<\/td>/);
});

test("shipper progress request controls use exact stages and latest request details", () => {
  const start = dashboard.indexOf("function canRequestOriginalDocuments");
  const end = dashboard.indexOf("function renderProgressStatus", start);
  const helper = dashboard.slice(start, end);

  assert.match(dashboard, /서류수령요청/);
  assert.match(dashboard, /수입신고요청/);
  assert.match(helper, /요청 O/);
  assert.match(helper, /요청 X/);
  assert.match(helper, /progress-shipper-only/);
  assert.match(helper, /canRequestOriginalDocuments/);
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
  const card = {
    bl_number: "BL-2",
    stage: "반입",
    obl_received: true,
    hc_received: true,
  };
  const html = requestControlHarness("shipper", [card])(card, "docs");
  const descriptionId = html.match(/aria-describedby="([^"]+)"/)?.[1];

  assert.match(html, /aria-disabled="true"/);
  assert.doesNotMatch(html, /\sdisabled(?:\s|>|=)/);
  assert.ok(descriptionId);
  assert.match(html, new RegExp(`id="${descriptionId}"`));
  assert.match(html, /OBL.*H\/C/);
});

test("missing OBL or H/C keeps original document requests enabled after inbound", () => {
  const afterInbound = {
    bl_number: "BL-AFTER-INBOUND",
    stage: "수입신고",
    obl_received: false,
    hc_received: true,
  };
  const afterRelease = {
    bl_number: "BL-AFTER-RELEASE",
    stage: "반출",
    obl_received: true,
    hc_received: false,
  };
  const complete = {
    bl_number: "BL-COMPLETE",
    stage: "반입",
    obl_received: true,
    hc_received: true,
  };
  const context = requestControlContext("shipper", [afterInbound, afterRelease, complete]);

  assert.equal(context.canRequestOriginalDocuments(afterInbound), true);
  assert.equal(context.canRequestOriginalDocuments(afterRelease), true);
  assert.equal(context.canRequestOriginalDocuments(complete), false);
  assert.match(context.renderRequestControl(afterInbound, "docs"), /aria-disabled="false"/);
  assert.match(context.renderRequestControl(afterRelease, "docs"), /aria-disabled="false"/);
  assert.match(context.renderRequestControl(complete, "docs"), /aria-disabled="true"/);
});

test("existing original document request preloads editable request values", () => {
  const start = dashboard.indexOf("async function openOriginalDocModal");
  const end = dashboard.indexOf("function closeReleaseModal", start);
  const body = dashboard.slice(start, end);

  assert.match(body, /last_original_doc_requester_name/);
  assert.match(body, /last_original_doc_requester_email/);
  assert.match(body, /last_original_doc_requested_receipt_date/);
  assert.match(body, /last_original_doc_request\?\.memo/);
  assert.match(body, /toRequestMonthDay/);
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
    {
      bl_number: "BL-LOCKED",
      stage: "반입",
      obl_received: true,
      hc_received: true,
    },
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

test("progress receipt calendar omits transfer receipt event construction", () => {
  const start = dashboard.indexOf("function progressCalendarEvents()");
  const end = dashboard.indexOf("function renderProgressCalendar", start);
  const body = dashboard.slice(start, end);

  assert.doesNotMatch(body, /type:\s*"transfer"/);
  assert.doesNotMatch(body, /서류수령 \$\{label\} \(양도증\)/);
});

test("distribution number popover omits separator-only values", () => {
  const context = dashboardRuntimeContext("admin", []);
  const html = vm.runInContext("distributionNumberPopover(' / ')", context);
  assert.equal(html, "");
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

test("mobile original document manager prioritizes requests then received OBL awaiting carrier submission", () => {
  const context = mobileOriginalRequestHarness();
  const cards = [
    {
      bl_number: "BL-NORMAL",
      stage: "입항전",
      obl_received: false,
      hc_received: false,
    },
    {
      bl_number: "BL-COMPLETE",
      stage: "반입",
      obl_received: true,
      hc_received: true,
      obl_carrier_submitted: true,
      obl_carrier_submitted_date: "2026-07-28",
      last_original_doc_request_id: "request-complete",
      last_original_doc_request_created_at: "2026-07-26T01:00:00Z",
    },
    {
      bl_number: "BL-ARRIVED-MISSING-HC",
      stage: "입항",
      obl_received: true,
      hc_received: false,
    },
    {
      bl_number: "BL-INBOUND-MISSING-OBL",
      stage: "반입",
      obl_received: false,
      hc_received: true,
    },
    {
      bl_number: "BL-INBOUND-COMPLETE-DOCS",
      stage: "반입",
      obl_received: true,
      hc_received: true,
    },
    {
      bl_number: "BL-RECEIVED-NOT-SUBMITTED",
      stage: "수입신고",
      obl_received: true,
      hc_received: true,
    },
    {
      bl_number: "BL-PENDING-OLD",
      stage: "입항",
      obl_received: false,
      hc_received: false,
      last_original_doc_request_id: "request-pending-old",
      last_original_doc_request_created_at: "2026-07-25T01:00:00Z",
    },
    {
      bl_number: "BL-PENDING-NEW",
      stage: "반입",
      obl_received: false,
      hc_received: false,
      last_original_doc_request: { id: "request-pending-new" },
      last_original_doc_request_created_at: "2026-07-27T01:00:00Z",
    },
  ];

  const sorted = cards.sort(context.requestSort);
  assert.deepEqual(
    Array.from(sorted, (card) => card.bl_number),
    [
      "BL-PENDING-NEW",
      "BL-PENDING-OLD",
      "BL-ARRIVED-MISSING-HC",
      "BL-INBOUND-COMPLETE-DOCS",
      "BL-RECEIVED-NOT-SUBMITTED",
      "BL-INBOUND-MISSING-OBL",
      "BL-NORMAL",
      "BL-COMPLETE",
    ]
  );
  assert.equal(context.requestRank(sorted[0]), 0);
  assert.equal(context.requestRank(sorted[2]), 1);
  assert.equal(context.requestRank(sorted[5]), 2);
  assert.equal(context.requestRank(sorted[6]), 3);
  assert.equal(context.requestRank(sorted[7]), 4);
});

test("mobile original document cards label pending and completed shipper requests", () => {
  const context = mobileOriginalRequestHarness();
  const pending = context.requestBadge({
    obl_received: false,
    last_original_doc_request_id: "request-1",
    last_original_doc_requested_receipt_date: "2026-07-30",
  });
  const complete = context.requestBadge({
    obl_received: true,
    last_original_doc_request_id: "request-2",
    last_original_doc_requested_receipt_date: "2026-07-29",
  });

  assert.match(pending, /화주 수령요청/);
  assert.match(pending, /희망 2026-07-30/);
  assert.match(pending, /request-pending/);
  assert.match(complete, /요청\/수령O/);
  assert.match(complete, /request-complete/);
});

test("legacy original receipt fallback uses Korea-local update date", () => {
  assert.match(dashboard, /function koreaCalendarDate/);
  assert.match(dashboard, /koreaCalendarDate\(card\.original_docs_updated_at\)/);
  const start = dashboard.indexOf("function progressCalendarEvents()");
  const end = dashboard.indexOf("function renderProgressCalendar", start);
  assert.match(dashboard.slice(start, end), /effectiveOriginalReceiptDate\(card\)/);
  assert.match(dashboard, /koreaToday\(\)/);
});

test("receipt mail modals accept optional additional recipients", () => {
  assert.match(dashboard, /receiptMailAdditionalRecipients/);
  assert.match(mobile, /receiptMailAdditionalRecipients/);
  assert.match(dashboard, /additional_recipients/);
  assert.match(mobile, /additional_recipients/);
});

test("mobile original document view shows only the destination name", () => {
  assert.match(mobile, /function mobileDestinationName\(value\)/);
  assert.match(mobile, /split\(\/\[_\*\]\/\)/);
  assert.match(mobile, /mobileDestinationName\(card\.destination\)/);
  assert.match(mobile, /mobileDestinationName\(receiptMailCard\.destination\)/);
  assert.match(mobile, /mobileDestinationName\(oblCarrierMailCard\.destination\)/);
});

test("receipt mail success refreshes dashboard and mobile original document state", () => {
  const dashboardStart = dashboard.indexOf("async function submitReceiptMail");
  const dashboardEnd = dashboard.indexOf("async function loadAdmin", dashboardStart);
  const dashboardHandler = dashboard.slice(dashboardStart, dashboardEnd);
  const mobileStart = mobile.indexOf("async function submitReceiptMail");
  const mobileEnd = mobile.indexOf("\n    load();", mobileStart);
  const mobileHandler = mobile.slice(mobileStart, mobileEnd);

  assert.match(dashboardHandler, /result\.received_date/);
  assert.match(dashboardHandler, /await loadData\(\)/);
  assert.match(mobileHandler, /result\.received_date/);
  assert.match(mobileHandler, /await load\(\)/);
  assert.match(dashboardHandler, /메일은 발송됐지만/);
  assert.match(mobileHandler, /메일은 발송됐지만/);
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
test("saved distribution history numbers render in a selectable popover", () => {
  const context = dashboardRuntimeContext("admin", []);
  const html = vm.runInContext(
    `progressManualStatusToggle({
      bl_number: "BL001",
      distribution_history_override: "O",
      distribution_history_number: "\uBCF8\uC778:OWN-123 / \uBCF8\uB808\uC2A4:BONE-456"
    }, "distribution")`,
    context
  );
  assert.match(html, /distribution-number-wrap/);
  assert.match(html, /distribution-number-popover/);
  assert.match(html, /\uBCF8\uC778/);
  assert.match(html, /OWN-123/);
  assert.match(html, /\uBCF8\uB808\uC2A4/);
  assert.match(html, /BONE-456/);
  assert.doesNotMatch(html, /distribution-number-wrap" tabindex=/);
  assert.match(html, /aria-describedby="progress-distribution-number--1"/);
  assert.match(html, /id="progress-distribution-number--1"[^>]*role="tooltip"/);
  assert.match(html, /class="doc-toggle doc-o progress-tooltip-control"/);
  assert.match(dashboard, /user-select:\s*text/);
  assert.match(dashboard, /\.progress-table-wrap\s*\{[^}]*overflow:auto/);
  assert.match(dashboard, /\.progress-table th\s*\{[^}]*position:sticky/);
  assert.match(dashboard, /\.distribution-number-popover\s*\{[\s\S]*position:fixed/);
  assert.match(dashboard, /\.distribution-number-wrap:hover \.distribution-number-popover,[\s\S]*\.distribution-number-wrap:focus-within \.distribution-number-popover/);
  assert.match(dashboard, /const gap = detail\.classList\?\.contains\?\.\("distribution-number-popover"\) \? 0 : 6/);
  assert.match(dashboard, /alert\("\\uC720\\uD1B5\\uC774\\uB825 \\uC2E0\\uACE0\\uBC88\\uD638\\uB97C \\uD558\\uB098 \\uC774\\uC0C1 \\uC785\\uB825\\uD574 \\uC8FC\\uC138\\uC694\./);
});

test("separator-only distribution values have no dangling tooltip relationship", () => {
  const context = dashboardRuntimeContext("admin", []);
  const html = vm.runInContext(
    `progressManualStatusToggle({
      bl_number: "BL-EMPTY",
      distribution_history_override: "O",
      distribution_history_number: " / "
    }, "distribution")`,
    context
  );
  assert.match(html, /class="doc-toggle doc-o progress-tooltip-control"/);
  assert.doesNotMatch(html, /distribution-number-popover/);
  assert.doesNotMatch(html, /aria-describedby=/);
  assert.doesNotMatch(html, /distribution-number-wrap" tabindex=/);
});

test("board admin status editor rejects distribution O without a number", () => {
  const start = dashboard.indexOf("async function saveAdminStatus");
  const end = dashboard.indexOf("async function saveQuotaInput", start);
  const body = dashboard.slice(start, end);

  assert.match(body, /distributionStatus === "O" && distributionNumbers\.length === 0/);
  assert.match(body, /유통이력 신고번호를 하나 이상 입력해 주세요\./);
  assert.match(body, /return;/);
});

test("mobile original document manager supports OBL carrier submission and mail", () => {
  assert.match(mobile, /OBL 선사 접수/);
  assert.match(mobile, /obl_carrier_submitted_date/);
  assert.match(mobile, /action:\s*"obl_carrier_submission"/);
  assert.match(mobile, /action:\s*"obl_carrier_submission"/);
  assert.match(mobile, /\/api\/cargo-original-doc-receipt-mail/);
});

test("dashboard exposes lifecycle exclusion and three-day free-time operations", () => {
  assert.match(dashboard, /만기\(프리타임\)/);
  assert.match(dashboard, /스티커요청/);
  assert.match(dashboard, /OBL 접수일/);
  assert.match(dashboard, /permanent_exclude/);
  assert.match(dashboard, /restore_exclusion/);
  assert.match(visibilityApi, /action === "permanent_exclude"/);
  assert.match(visibilityApi, /action === "restore_exclusion"/);
});

test("OBL carrier submission date remains visible to shipper and destination accounts", () => {
  assert.match(
    dashboard,
    /<th class="progress-date">OBL 접수일<\/th>/
  );
  assert.match(
    dashboard,
    /<td class="progress-date">\$\{progressOblCarrierToggle\(card\)\}<\/td>/
  );
  assert.doesNotMatch(
    dashboard,
    /progress-date progress-admin-only">OBL 접수일/
  );
});
