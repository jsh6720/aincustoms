const assert = require("node:assert/strict");
const test = require("node:test");

const {
  cargoSourceKey,
  linkedAccountIds,
  mergeLinkedOriginalDocs,
  latestLinkedRequest,
} = require("../lib/cargo-linked-records");

const cards = [
  {
    account_id: "hch",
    bl_number: "MAEU721416461",
    folder_name: "HCH_MAEU721416461_CIF_CTF",
  },
  {
    account_id: "ctf",
    bl_number: "maeu721416461",
    folder_name: "HCH_MAEU721416461_CIF_CTF",
  },
];

test("links filtered account rows only when BL and source folder match", () => {
  assert.equal(cargoSourceKey(cards[0]), cargoSourceKey(cards[1]));
  assert.deepEqual(linkedAccountIds(cards[0], cards), ["hch", "ctf"]);
  assert.notEqual(
    cargoSourceKey(cards[0]),
    cargoSourceKey({ ...cards[1], folder_name: "OTHER_SOURCE" })
  );
});

test("repairs existing receipt disagreement by preserving received status", () => {
  const merged = mergeLinkedOriginalDocs(cards[1], cards, [
    {
      account_id: "hch",
      bl_number: "MAEU721416461",
      obl_received: true,
      hc_received: true,
      actual_received_date: "2026-07-06",
      updated_at: "2026-07-06T01:00:00Z",
    },
    {
      account_id: "ctf",
      bl_number: "MAEU721416461",
      obl_received: false,
      hc_received: false,
      updated_at: "2026-07-05T01:00:00Z",
    },
  ]);

  assert.equal(merged.obl_received, true);
  assert.equal(merged.hc_received, true);
  assert.equal(merged.actual_received_date, "2026-07-06");
});

test("uses the latest request across linked filter accounts", () => {
  const request = latestLinkedRequest(cards[0], cards, [
    {
      account_id: "hch",
      bl_number: "MAEU721416461",
      requested_receipt_date: "2026-07-25",
      created_at: "2026-07-24T01:00:00Z",
    },
    {
      account_id: "ctf",
      bl_number: "MAEU721416461",
      requested_receipt_date: "2026-07-26",
      created_at: "2026-07-24T02:00:00Z",
    },
  ]);

  assert.equal(request.requested_receipt_date, "2026-07-26");
});
