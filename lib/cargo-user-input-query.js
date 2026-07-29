const CARGO_USER_INPUT_COLUMNS = Object.freeze([
  "account_id",
  "bl_number",
  "is_quota",
  "quota_permit_date",
  "is_hidden",
  "hidden_at",
  "hidden_by",
  "delivery_terms",
  "eta_date",
  "storage_yard",
  "free_time_days",
  "free_time_expiry_date",
  "free_time_expiry_override",
  "warehouse_expected_date",
  "eta_date_confirmed",
  "storage_yard_confirmed",
  "warehouse_expected_date_confirmed",
  "animal_quarantine_override",
  "food_quarantine_override",
  "import_declaration_override",
  "distribution_history_override",
  "distribution_history_number",
  "sticker_requested",
  "obl_carrier_submitted",
  "obl_carrier_submitted_date",
  "obl_carrier_submitted_by",
  "obl_carrier_submitted_at",
  "docs_delivered_samhyeon",
  "docs_delivered_warehouse",
  "transport_updated_by_role",
  "transport_updated_by_login",
  "transport_updated_at",
  "updated_at",
]);

const TRANSPORT_CONFIRMATION_COLUMNS = Object.freeze([
  "eta_date_confirmed",
  "storage_yard_confirmed",
  "warehouse_expected_date_confirmed",
]);

function cargoUserInputsQuery(accountId, options = {}) {
  const omitted = options.omitTransportConfirmation
    ? new Set(TRANSPORT_CONFIRMATION_COLUMNS)
    : new Set();
  const columns = CARGO_USER_INPUT_COLUMNS.filter((column) => !omitted.has(column));
  const accountFilter = accountId
    ? `&account_id=eq.${encodeURIComponent(String(accountId))}`
    : "";
  return `/rest/v1/cargo_card_user_inputs?select=${columns.join(",")}${accountFilter}`;
}

module.exports = {
  CARGO_USER_INPUT_COLUMNS,
  TRANSPORT_CONFIRMATION_COLUMNS,
  cargoUserInputsQuery,
};
