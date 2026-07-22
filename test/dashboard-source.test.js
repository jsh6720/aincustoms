const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dashboard = fs.readFileSync(path.join(__dirname, "..", "cargo-dashboard.html"), "utf8");
const mobile = fs.readFileSync(path.join(__dirname, "..", "cargo-docs-mobile.html"), "utf8");
const originalDocsApi = fs.readFileSync(path.join(__dirname, "..", "api", "cargo-original-docs.js"), "utf8");
const quotaApi = fs.readFileSync(path.join(__dirname, "..", "api", "cargo-quota.js"), "utf8");

test("progress page includes editable warehouse schedule and calendar event", () => {
  assert.match(dashboard, /<th>반입예정일<\/th>/);
  assert.match(dashboard, /openProgressWarehouseEditor/);
  assert.match(dashboard, /warehouse_expected_date/);
  assert.match(dashboard, /type: "warehouse"/);
  const start = dashboard.indexOf("async function saveProgressWarehouseEditor");
  const end = dashboard.indexOf("function openProgressStatus", start);
  const body = dashboard.slice(start, end);
  assert.doesNotMatch(body, /eta_date:/);
  assert.doesNotMatch(body, /free_time_days:/);
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
