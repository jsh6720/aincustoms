const TRUE_WINS_FIELDS = [
  "doc_bl_received",
  "doc_iv_received",
  "doc_pl_received",
  "doc_hc_received",
  "doc_co_received",
  "doc_freight_invoice_received",
  "doc_insurance_received",
  "doc_transfer_received",
  "obl_received",
  "hc_received",
];

const ORIGINAL_REQUEST_FIELDS = [
  "last_original_doc_request",
  "last_original_doc_request_id",
  "last_original_doc_requester_name",
  "last_original_doc_requester_email",
  "last_original_doc_requested_receipt_date",
  "last_original_doc_request_created_at",
];

const IMPORT_REQUEST_FIELDS = [
  "last_import_request",
  "last_import_requester_name",
  "last_import_requester_email",
  "last_import_delivery_address",
  "last_import_requested_release_date",
  "last_import_requested_import_date",
  "last_import_request_created_at",
];

const TRANSPORT_FIELDS = [
  "delivery_terms",
  "eta_date",
  "storage_yard",
  "free_time_days",
  "free_time_expiry_date",
  "free_time_expiry_override",
  "warehouse_expected_date",
  "sticker_requested",
  "obl_carrier_submitted",
  "obl_carrier_submitted_date",
  "obl_carrier_submitted_by",
  "obl_carrier_submitted_at",
  "transport_updated_by_role",
  "transport_updated_by_login",
  "transport_updated_at",
  "quota_input_updated_at",
];

function normalizedBl(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function isBlank(value) {
  return value === null || value === undefined || value === "";
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isNaN(parsed) ? 0 : parsed;
}

function requestScore(card) {
  let score = 0;
  if (card.last_original_doc_request || card.last_original_doc_request_id) score += 1000;
  if (card.last_import_request || card.last_import_request_created_at) score += 1000;
  if (card.actual_received_date) score += 100;
  TRUE_WINS_FIELDS.forEach((field) => {
    if (card[field] === true) score += 1;
  });
  return score;
}

function newerRequestCard(cards, dateField, objectField) {
  return cards.reduce((latest, card) => {
    if (!card[objectField] && !card[dateField]) return latest;
    if (!latest) return card;
    return timestamp(card[dateField]) >= timestamp(latest[dateField]) ? card : latest;
  }, null);
}

function copyFields(target, source, fields) {
  if (!source) return;
  fields.forEach((field) => {
    if (!isBlank(source[field])) target[field] = source[field];
  });
}

function copyPresentFields(target, source, fields) {
  if (!source) return;
  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      target[field] = source[field];
    }
  });
}

function mergeGroup(cards) {
  const representative = [...cards].sort((left, right) => {
    const scoreDifference = requestScore(right) - requestScore(left);
    if (scoreDifference) return scoreDifference;
    return timestamp(right.synced_at) - timestamp(left.synced_at);
  })[0];
  const merged = { ...representative };

  cards.forEach((card) => {
    Object.entries(card).forEach(([field, value]) => {
      if (isBlank(merged[field]) && !isBlank(value)) merged[field] = value;
    });
  });

  const newestTransportCard = cards.reduce((latest, card) => {
    if (!card.transport_updated_at) return latest;
    if (!latest) return card;
    return timestamp(card.transport_updated_at) >= timestamp(latest.transport_updated_at)
      ? card
      : latest;
  }, null);
  copyPresentFields(merged, newestTransportCard, TRANSPORT_FIELDS);

  TRUE_WINS_FIELDS.forEach((field) => {
    if (cards.some((card) => card[field] === true)) merged[field] = true;
  });

  copyFields(
    merged,
    newerRequestCard(
      cards,
      "last_original_doc_request_created_at",
      "last_original_doc_request"
    ),
    ORIGINAL_REQUEST_FIELDS
  );
  copyFields(
    merged,
    newerRequestCard(cards, "last_import_request_created_at", "last_import_request"),
    IMPORT_REQUEST_FIELDS
  );

  return merged;
}

function mergeDuplicateCargoCards(cards) {
  const groups = new Map();
  (cards || []).forEach((card, index) => {
    const bl = normalizedBl(card.bl_number);
    const key = bl || `__missing_bl_${index}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  });
  return [...groups.values()].map(mergeGroup);
}

module.exports = {
  mergeDuplicateCargoCards,
};
