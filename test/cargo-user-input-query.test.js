const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CARGO_USER_INPUT_COLUMNS,
  DOCUMENT_DELIVERY_DATE_COLUMNS,
  TRANSPORT_CONFIRMATION_COLUMNS,
  cargoUserInputsQuery,
} = require("../lib/cargo-user-input-query");

function selectedColumns(query) {
  const match = String(query).match(/[?&]select=([^&]+)/);
  return match ? match[1].split(",") : [];
}

test("legacy input query omits only unavailable confirmation columns", () => {
  const current = selectedColumns(cargoUserInputsQuery("account-1"));
  const legacy = selectedColumns(cargoUserInputsQuery("account-1", {
    omitTransportConfirmation: true,
  }));

  assert.deepEqual(current, CARGO_USER_INPUT_COLUMNS);
  assert.deepEqual(
    current.filter((column) => !legacy.includes(column)),
    TRANSPORT_CONFIRMATION_COLUMNS
  );
});

test("every input query preserves established check and manual fields", () => {
  const required = [
    "is_quota",
    "quota_permit_date",
    "delivery_terms",
    "eta_date",
    "storage_yard",
    "warehouse_expected_date",
    "animal_quarantine_override",
    "food_quarantine_override",
    "import_declaration_override",
    "distribution_history_override",
    "distribution_history_number",
    "sticker_requested",
    "obl_carrier_submitted",
    "docs_delivered_samhyeon",
    "docs_delivered_warehouse",
  ];

  for (const options of [{}, { omitTransportConfirmation: true }]) {
    const selected = selectedColumns(cargoUserInputsQuery("", options));
    for (const column of required) {
      assert.ok(selected.includes(column), `${column} must be preserved`);
    }
  }
});

test("account filter is encoded without changing the selected fields", () => {
  const query = cargoUserInputsQuery("account id/1");
  assert.match(query, /&account_id=eq\.account%20id%2F1$/);
  assert.deepEqual(selectedColumns(query), CARGO_USER_INPUT_COLUMNS);
});

test("legacy input query can omit only unavailable document delivery date columns", () => {
  const selected = selectedColumns(cargoUserInputsQuery("account-1", {
    omitDocumentDeliveryDates: true,
  }));

  assert.deepEqual(
    CARGO_USER_INPUT_COLUMNS.filter((column) => !selected.includes(column)),
    DOCUMENT_DELIVERY_DATE_COLUMNS
  );
  assert.ok(selected.includes("docs_delivered_samhyeon"));
  assert.ok(selected.includes("docs_delivered_warehouse"));
});
