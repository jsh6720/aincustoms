const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dashboard = fs.readFileSync(path.join(__dirname, "..", "cargo-dashboard.html"), "utf8");
const mobile = fs.readFileSync(path.join(__dirname, "..", "cargo-docs-mobile.html"), "utf8");
const originalDocsApi = fs.readFileSync(path.join(__dirname, "..", "api", "cargo-original-docs.js"), "utf8");
const quotaApi = fs.readFileSync(path.join(__dirname, "..", "api", "cargo-quota.js"), "utf8");

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

test("progress view defaults after load and keeps explicit board navigation", () => {
  assert.match(dashboard, /let currentPrimaryView = "progress"/);
  assert.match(dashboard, /function showPrimaryView\(view\)/);
  assert.match(dashboard, /currentPrimaryView = view === "board" \? "board" : "progress"/);
  assert.match(dashboard, /showPrimaryView\(currentPrimaryView\)/);
  assert.match(dashboard, /function togglePrimaryView\(\)/);
  assert.match(dashboard, /보드 보기/);
  assert.match(dashboard, /BL별 진행현황/);
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
  assert.match(row, /<td class="[^"]*\bprogress-date\b[^"]*"><button[^>]*>[\s\S]*?displayDate\(etaText\(card\)\)/);
  assert.match(row, /<td class="[^"]*\bprogress-date\b[^"]*"><button[^>]*>[\s\S]*?displayDate\(card\.warehouse_expected_date/);
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
  assert.match(row, /<td class="[^"]*\bprogress-long\b[^"]*"><button[^>]*>[\s\S]*?yardText\(card\)/);
  assert.match(row, /<td class="[^"]*\bprogress-long\b[^"]*">\$\{esc\(progressStateText\(card\)\)\}<\/td>/);
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

test("progress receipt calendar uses the exact transfer suffix in its receipt event", () => {
  const start = dashboard.indexOf("function progressCalendarEvents()");
  const end = dashboard.indexOf("function renderProgressCalendar", start);
  const body = dashboard.slice(start, end);
  const receiptStart = body.indexOf("const effectiveActualDate");
  const receiptEnd = body.indexOf("const warehouseDate", receiptStart);
  const receiptEvent = body.slice(receiptStart, receiptEnd);

  assert.match(receiptEvent, /text:\s*`[^`]*\$\{label\}\$\{card\.doc_transfer_received \? " \(\uC591\uB3C4\uC99D\)" : ""\}`/);
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
