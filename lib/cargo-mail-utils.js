const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRecipientList(value) {
  const seen = new Set();
  const recipients = [];
  String(value || "")
    .split(/[,;\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((email) => {
      if (!EMAIL_PATTERN.test(email)) {
        throw new Error(`올바르지 않은 이메일 주소입니다: ${email}`);
      }
      const key = email.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      recipients.push(email);
    });
  return recipients;
}

function mergeRecipients(base, extra) {
  const seen = new Set();
  return [...(base || []), ...(extra || [])].filter((email) => {
    const key = String(email || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function destinationName(value) {
  return String(value || "")
    .split(/[_*]/)[0]
    .trim() || "-";
}

function shortConsigneeName(value) {
  const text = String(value || "").trim();
  if (text.includes("현대코퍼")) return "현대코퍼";
  return text || "-";
}

function arrivalSubjectConsignee(value) {
  const text = String(value || "").trim();
  if (text.includes("현대코퍼")) return "현대";
  return text || "-";
}

function parseIsoDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMonthDay(value) {
  const date = value instanceof Date ? value : parseIsoDate(value);
  return date ? `${date.getUTCMonth() + 1}/${date.getUTCDate()}` : "-";
}

function arrivalExpiryDate(next) {
  const explicit = parseIsoDate(
    next?.free_time_expiry_override || next?.free_time_expiry_date
  );
  if (explicit) return explicit;
  const arrival = parseIsoDate(next?.eta_date);
  if (!arrival) return null;
  const days = Math.max(1, Number.parseInt(next?.free_time_days, 10) || 3);
  arrival.setUTCDate(arrival.getUTCDate() + days - 1);
  return arrival;
}

function buildArrivalScheduleChangeMail(card, next) {
  const blNumber = String(card?.bl_number || "-").trim() || "-";
  const consignee = String(card?.consignee || "-").trim() || "-";
  const subjectConsignee = arrivalSubjectConsignee(card?.consignee);
  const destination = destinationName(card?.destination);
  const arrival = formatMonthDay(next?.eta_date);
  const expiry = formatMonthDay(arrivalExpiryDate(next));
  return {
    subject: `[입항 스케줄 변경] ${subjectConsignee}_${blNumber} / ${destination}`,
    text: [
      "안녕하세요. 아인합동관세사입니다.",
      "",
      "해당 건 입항 스케줄이 변경되어, 아래와 같이 변경된 스케줄을 안내드립니다.",
      "",
      `화주: ${consignee}`,
      `납품처: ${destination}`,
      "",
      `B/L: ${blNumber}`,
      `입항: ${arrival}`,
      `만기(프리타임): ${expiry}`,
      "",
      "감사합니다.",
      "아인합동관세사무소",
    ].join("\n"),
  };
}

function cleanWarehouseValues(values) {
  return {
    storage_yard: String(values?.storage_yard || "").trim(),
    warehouse_expected_date: String(values?.warehouse_expected_date || "").trim(),
  };
}

function warehouseChanges(previous, next) {
  const before = cleanWarehouseValues(previous);
  const after = cleanWarehouseValues(next);
  return ["storage_yard", "warehouse_expected_date"].filter(
    (field) => before[field] !== after[field]
  );
}

const MANUAL_FIELD_NAMES = [
  "delivery_terms",
  "eta_date",
  "storage_yard",
  "free_time_days",
  "free_time_expiry_date",
  "free_time_expiry_override",
  "warehouse_expected_date",
];

const TRANSPORT_PROVENANCE_FIELD_NAMES = [
  "transport_updated_by_role",
  "transport_updated_by_login",
  "transport_updated_at",
];

const TRANSPORT_CONFIRMATION_FIELD_NAMES = [
  "eta_date_confirmed",
  "storage_yard_confirmed",
  "warehouse_expected_date_confirmed",
];

function mergeManualFields(previous, submitted) {
  const result = {};
  for (const field of MANUAL_FIELD_NAMES) {
    if (Object.prototype.hasOwnProperty.call(submitted || {}, field)) {
      result[field] = submitted[field];
    } else if (previous?.[field] !== undefined) {
      result[field] = previous[field];
    }
  }
  return result;
}

function buildTransportRollbackPayload(previous, savedPayload) {
  const savedTransportFields = MANUAL_FIELD_NAMES.filter((field) =>
    Object.prototype.hasOwnProperty.call(savedPayload || {}, field)
  );
  const savedConfirmationFields = TRANSPORT_CONFIRMATION_FIELD_NAMES.filter((field) =>
    Object.prototype.hasOwnProperty.call(savedPayload || {}, field)
  );
  const payload = Object.fromEntries(
    [
      ...savedTransportFields,
      ...savedConfirmationFields,
      ...TRANSPORT_PROVENANCE_FIELD_NAMES,
    ].map((field) => [
      field,
      previous?.[field] ?? null,
    ])
  );
  for (const field of savedConfirmationFields) {
    payload[field] = previous?.[field] === true;
  }
  return payload;
}

function displayValue(value) {
  return String(value || "").trim() || "미입력";
}

function buildWarehouseChangeMail(card, session, previous, next) {
  const before = cleanWarehouseValues(previous);
  const after = cleanWarehouseValues(next);
  const blNumber = card?.bl_number || "-";
  const consignee = card?.consignee || session?.display_name || "-";
  const requester = session?.display_name || session?.login_id || "화주";
  return {
    subject: `[반입예정정보 변경] ${consignee} / ${blNumber}`,
    text: [
      "화주가 반입예정정보를 변경했습니다.",
      "",
      `화주명: ${consignee}`,
      `B/L: ${blNumber}`,
      `변경자: ${requester} (${session?.login_id || "-"})`,
      `반입예정구역: ${displayValue(before.storage_yard)} -> ${displayValue(after.storage_yard)}`,
      `반입예정일: ${displayValue(before.warehouse_expected_date)} -> ${displayValue(after.warehouse_expected_date)}`,
    ].join("\n"),
  };
}

module.exports = {
  buildArrivalScheduleChangeMail,
  buildTransportRollbackPayload,
  buildWarehouseChangeMail,
  destinationName,
  mergeManualFields,
  mergeRecipients,
  parseRecipientList,
  warehouseChanges,
};
