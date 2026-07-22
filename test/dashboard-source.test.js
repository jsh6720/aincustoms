const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dashboard = fs.readFileSync(path.join(__dirname, "..", "cargo-dashboard.html"), "utf8");
const mobile = fs.readFileSync(path.join(__dirname, "..", "cargo-docs-mobile.html"), "utf8");

test("progress page includes editable warehouse schedule and calendar event", () => {
  assert.match(dashboard, /<th>반입예정일<\/th>/);
  assert.match(dashboard, /openProgressWarehouseEditor/);
  assert.match(dashboard, /warehouse_expected_date/);
  assert.match(dashboard, /type: "warehouse"/);
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
