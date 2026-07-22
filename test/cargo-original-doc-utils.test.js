const test = require("node:test");
const assert = require("node:assert/strict");

const {
  effectiveOriginalReceiptDate,
  isMissingTransferOverrideColumn,
  normalizeTransferOverride,
  receiptDateForSave,
} = require("../lib/cargo-original-doc-utils");

test("uses the actual receipt date when present", () => {
  assert.equal(
    effectiveOriginalReceiptDate({
      obl_received: true,
      actual_received_date: "2026-07-06",
      original_docs_updated_at: "2026-07-10T03:00:00Z",
    }),
    "2026-07-06"
  );
});

test("uses the status update date for existing O rows without a receipt date", () => {
  assert.equal(
    effectiveOriginalReceiptDate({
      obl_received: true,
      hc_received: false,
      actual_received_date: "",
      original_docs_updated_at: "2026-07-20T03:00:00Z",
    }),
    "2026-07-20"
  );
  assert.equal(
    effectiveOriginalReceiptDate({
      obl_received: true,
      original_docs_updated_at: "2026-07-19T23:30:00Z",
    }),
    "2026-07-20"
  );
  assert.equal(effectiveOriginalReceiptDate({ obl_received: false, hc_received: false }), "");
});

test("fills today's date only for a newly received document", () => {
  assert.equal(
    receiptDateForSave({
      obl_received: true,
      hc_received: false,
      previous_obl_received: false,
      previous_hc_received: false,
      submitted_date: "",
      today: "2026-07-22",
    }),
    "2026-07-22"
  );
  assert.equal(
    receiptDateForSave({
      obl_received: true,
      hc_received: false,
      previous_obl_received: true,
      previous_hc_received: false,
      previous_date: "",
      submitted_date: "",
      today: "2026-07-22",
    }),
    null
  );
  assert.equal(
    receiptDateForSave({ obl_received: false, hc_received: false, submitted_date: "", today: "2026-07-22" }),
    null
  );
  assert.equal(
    receiptDateForSave({ obl_received: false, hc_received: false, submitted_date: "2026-07-06", today: "2026-07-22" }),
    null
  );
});

test("recognizes a missing transfer override column error", () => {
  assert.equal(
    isMissingTransferOverrideColumn(new Error("PGRST204 column transfer_received_override missing from schema cache")),
    true
  );
  assert.equal(isMissingTransferOverrideColumn(new Error("network timeout")), false);
});

test("normalizes automatic and explicit transfer overrides", () => {
  assert.equal(normalizeTransferOverride("automatic"), null);
  assert.equal(normalizeTransferOverride("true"), true);
  assert.equal(normalizeTransferOverride("false"), false);
  assert.equal(normalizeTransferOverride(undefined), undefined);
});
