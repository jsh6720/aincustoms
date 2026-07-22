const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildWarehouseChangeMail,
  mergeRecipients,
  parseRecipientList,
  warehouseChanges,
} = require("../lib/cargo-mail-utils");

test("parses, validates, and de-duplicates recipient lists", () => {
  assert.deepEqual(
    parseRecipientList("a@example.com; B@example.com\na@example.com"),
    ["a@example.com", "B@example.com"]
  );
  assert.throws(() => parseRecipientList("not-an-email"), /올바르지 않은 이메일/);
});

test("merges fixed and additional recipients case-insensitively", () => {
  assert.deepEqual(
    mergeRecipients(["a@example.com", "b@example.com"], ["A@example.com", "c@example.com"]),
    ["a@example.com", "b@example.com", "c@example.com"]
  );
});

test("detects only effective warehouse value changes", () => {
  assert.deepEqual(
    warehouseChanges(
      { storage_yard: "부산신항", warehouse_expected_date: "2026-07-24" },
      { storage_yard: "부산신항", warehouse_expected_date: "2026-07-25" }
    ),
    ["warehouse_expected_date"]
  );
  assert.deepEqual(
    warehouseChanges(
      { storage_yard: "부산신항", warehouse_expected_date: "2026-07-24" },
      { storage_yard: "부산신항", warehouse_expected_date: "2026-07-24" }
    ),
    []
  );
});

test("builds a warehouse change email with before and after values", () => {
  const mail = buildWarehouseChangeMail(
    { bl_number: "ONEYBNEG04197300", consignee: "현대코퍼레이션H" },
    { login_id: "HCH", display_name: "현대코퍼레이션H" },
    { storage_yard: "미정", warehouse_expected_date: "" },
    { storage_yard: "강동냉장", warehouse_expected_date: "2026-07-24" }
  );
  assert.match(mail.subject, /반입예정정보 변경/);
  assert.match(mail.text, /ONEYBNEG04197300/);
  assert.match(mail.text, /미정 -> 강동냉장/);
  assert.match(mail.text, /미입력 -> 2026-07-24/);
});
