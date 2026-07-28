const assert = require("node:assert/strict");
const test = require("node:test");

const {
  koreaDate,
  markLinkedOriginalDocsReceived,
} = require("../lib/cargo-original-doc-receipt");

test("Korea receipt date follows Asia/Seoul calendar day", () => {
  assert.equal(koreaDate(new Date("2026-07-27T15:30:00.000Z")), "2026-07-28");
});

test("receipt mail status propagates OBL and H/C receipt to every linked account", async () => {
  const writes = [];
  const sourceCard = {
    account_id: "admin-account",
    bl_number: "ONEYBNEG04197300",
    folder_name: "현대코퍼레이션H_ONEYBNEG04197300_CIF_캐틀팜_우육_호주",
  };
  const supabaseFetch = async (url, options = {}) => {
    if (url.includes("cargo_cards?select=account_id,bl_number,folder_name")) {
      return [
        sourceCard,
        { ...sourceCard, account_id: "hch-account" },
        { ...sourceCard, account_id: "ctf-account" },
        { ...sourceCard, account_id: "ctf-account" },
      ];
    }
    if (url.includes("cargo_original_docs?on_conflict=")) {
      const payload = JSON.parse(options.body);
      writes.push(payload);
      return [payload];
    }
    throw new Error(`Unexpected Supabase call: ${url}`);
  };

  const result = await markLinkedOriginalDocsReceived({
    supabaseFetch,
    card: sourceCard,
    receivedDate: "2026-07-28",
    updatedBy: "aincustoms",
  });

  assert.deepEqual(result.accountIds, [
    "admin-account",
    "ctf-account",
    "hch-account",
  ]);
  assert.equal(result.receivedDate, "2026-07-28");
  assert.equal(writes.length, 3);
  for (const payload of writes) {
    assert.equal(payload.bl_number, "ONEYBNEG04197300");
    assert.equal(payload.obl_received, true);
    assert.equal(payload.hc_received, true);
    assert.equal(payload.actual_received_date, "2026-07-28");
    assert.equal(payload.updated_by, "aincustoms");
  }
});
