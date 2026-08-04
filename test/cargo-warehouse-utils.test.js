const test = require("node:test");
const assert = require("node:assert/strict");

const {
  effectiveStorageYard,
  isCustomsWarehouse,
} = require("../lib/cargo-warehouse-utils");

test("keeps a manual expected warehouse while Customs only reports a terminal", () => {
  assert.equal(
    effectiveStorageYard("강동창고", "부산신항국제터미널(주) (03077013)"),
    "강동창고"
  );
});

test("uses a Customs bonded warehouse over a manual expected warehouse", () => {
  assert.equal(isCustomsWarehouse("강동냉장(주)보세창고 (02111182)"), true);
  assert.equal(
    effectiveStorageYard("강동창고", "강동냉장(주)보세창고 (02111182)"),
    "강동냉장(주)보세창고 (02111182)"
  );
});

test("shows a terminal when no manual expected warehouse exists", () => {
  assert.equal(
    effectiveStorageYard("", "부산신항국제터미널(주) (03077013)"),
    "부산신항국제터미널(주) (03077013)"
  );
});
