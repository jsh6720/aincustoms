const assert = require("node:assert/strict");
const test = require("node:test");

const { mergeDuplicateCargoCards } = require("../lib/cargo-card-merge");

test("merges account-scoped duplicate cargo rows while preserving shipper requests", () => {
  const merged = mergeDuplicateCargoCards([
    {
      account_id: "hch-account",
      bl_number: "ONEYBNEG04197300",
      folder_name: "현대코퍼레이션H_ONEYBNEG04197300_CIF_캐틀팜_우육_호주",
      stage: "입항전",
      shed_name: "강동냉장(주)보세창고",
      obl_received: false,
      hc_received: false,
      synced_at: "2026-07-24T00:00:00.000Z",
    },
    {
      account_id: "ctf-account",
      bl_number: "oneybneg04197300",
      folder_name: "현대코퍼레이션H_ONEYBNEG04197300_CIF_캐틀팜_우육_호주",
      stage: "입항전",
      obl_received: true,
      hc_received: true,
      last_original_doc_request: {
        id: "request-1",
        requested_receipt_date: "2026-07-28",
        created_at: "2026-07-24T01:00:00.000Z",
      },
      last_original_doc_request_id: "request-1",
      last_original_doc_requested_receipt_date: "2026-07-28",
      last_original_doc_request_created_at: "2026-07-24T01:00:00.000Z",
      synced_at: "2026-07-24T00:00:00.000Z",
    },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].bl_number, "oneybneg04197300");
  assert.equal(merged[0].account_id, "ctf-account");
  assert.equal(merged[0].shed_name, "강동냉장(주)보세창고");
  assert.equal(merged[0].obl_received, true);
  assert.equal(merged[0].hc_received, true);
  assert.equal(merged[0].last_original_doc_request_id, "request-1");
  assert.equal(
    merged[0].last_original_doc_requested_receipt_date,
    "2026-07-28"
  );
});

test("keeps separate rows for different BL numbers", () => {
  const merged = mergeDuplicateCargoCards([
    { account_id: "a", bl_number: "BL001", synced_at: "2026-07-24T00:00:00Z" },
    { account_id: "b", bl_number: "BL002", synced_at: "2026-07-24T00:00:00Z" },
  ]);

  assert.deepEqual(merged.map((card) => card.bl_number), ["BL001", "BL002"]);
});
