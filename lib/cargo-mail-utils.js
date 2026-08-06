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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapMailHtml(content) {
  return `<div style="font-family:'Malgun Gothic','맑은 고딕',sans-serif;font-size:9pt;line-height:1.55;color:#111;">${content}</div>`;
}

const CHANGE_HIGHLIGHT_STYLE = "color:#b42318;font-weight:700;";

function highlightedTransportLine(line) {
  const raw = String(line || "");
  const changed = raw.match(/^(.*?)(?:\s*(?:->|→)\s*)(.+)$/);
  if (changed) {
    return `${escapeHtml(changed[1].trimEnd())} <strong style="${CHANGE_HIGHLIGHT_STYLE}">→ ${escapeHtml(changed[2].trim())}</strong>`;
  }
  const newlyExpected = raw.match(/^(반입예정일:\s*)(.+\(예정\))$/);
  if (newlyExpected) {
    return `${escapeHtml(newlyExpected[1])}<strong style="${CHANGE_HIGHLIGHT_STYLE}">${escapeHtml(newlyExpected[2])}</strong>`;
  }
  return escapeHtml(raw);
}

function mailTextToHtml(text, options = {}) {
  const content = String(text || "")
    .split("\n")
    .map((line) => options.highlightChanges ? highlightedTransportLine(line) : escapeHtml(line))
    .join("<br>");
  return wrapMailHtml(content);
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

function isoDateText(value) {
  const date = value instanceof Date ? value : parseIsoDate(value);
  return date ? date.toISOString().slice(0, 10) : "";
}

function isExplicitlyMissing(value) {
  return value === false || value === 0 || String(value).toLowerCase() === "false";
}

function isPoultryCargo(card) {
  const text = [
    card?.destination,
    card?.product_name,
    card?.product,
    card?.cargo_type,
    card?.species,
    card?.folder_name,
  ].join(" ").toUpperCase();
  return text.includes("계육") || text.includes("CHICKEN") || text.includes("POULTRY");
}

function cargoSpeciesName(card) {
  const text = [
    card?.destination,
    card?.product_name,
    card?.product,
    card?.cargo_type,
    card?.species,
    card?.folder_name,
  ].join(" ").toUpperCase();
  if (/우육|BEEF/.test(text)) return "우육";
  if (/돈육|PORK/.test(text)) return "돈육";
  if (/계육|CHICKEN|POULTRY/.test(text)) return "계육";
  return String(card?.product_name || "-").trim() || "-";
}

function missingDocumentNotes(card, next) {
  const notes = [];
  const addIfMissing = (field, label) => {
    if (isExplicitlyMissing(card?.[field])) notes.push(label);
  };

  addIfMissing("obl_received", "OBL 원본 미수령");
  addIfMissing("hc_received", "H/C 원본 미수령");
  addIfMissing("doc_iv_received", "IV 미수취");
  addIfMissing("doc_pl_received", "PL 미수취");
  addIfMissing("doc_hc_received", "H/C 미수취");
  if (!isPoultryCargo(card)) addIfMissing("doc_co_received", "C/O 미수취");

  const terms = String(next?.delivery_terms || card?.delivery_terms || "")
    .trim()
    .toUpperCase();
  if (/^[EF]/.test(terms)) {
    addIfMissing("doc_freight_invoice_received", "운임인보이스 미수취");
  }
  if (terms && !/^(CIF|CIP)/.test(terms)) {
    addIfMissing("doc_insurance_received", "보험서류 미수취");
  }
  return notes;
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

function buildChangeLine(label, previousValue, nextValue) {
  const before = displayValue(previousValue);
  const after = displayValue(nextValue);
  return before === after
    ? `${label}: ${after}`
    : `${label}: ${before} -> ${after}`;
}

function buildChangeHtmlLine(label, previousValue, nextValue) {
  const before = displayValue(previousValue);
  const after = displayValue(nextValue);
  if (before === after) {
    return `${escapeHtml(label)}: ${escapeHtml(after)}`;
  }
  return `${escapeHtml(label)}: ${escapeHtml(before)} <strong style="${CHANGE_HIGHLIGHT_STYLE}">→ ${escapeHtml(after)}</strong>`;
}

function buildExpectedDateLine(label, previousValue, nextValue) {
  const before = String(previousValue || "").trim();
  const after = String(nextValue || "").trim();
  if (!after) return `${label}: 미정`;
  if (!before && after) return `${label}: ${after}(예정)`;
  return buildChangeLine(label, before, after);
}

function buildExpectedDateHtmlLine(label, previousValue, nextValue) {
  const before = String(previousValue || "").trim();
  const after = String(nextValue || "").trim();
  if (!after) return `${escapeHtml(label)}: 미정`;
  if (!before && after) {
    return `${escapeHtml(label)}: <strong style="${CHANGE_HIGHLIGHT_STYLE}">${escapeHtml(after)}(예정)</strong>`;
  }
  return buildChangeHtmlLine(label, before, after);
}

function buildDetailedTransportMail(card, previous, next, subject) {
  const blNumber = String(card?.bl_number || "-").trim() || "-";
  const consignee = String(card?.consignee || "-").trim() || "-";
  const destination = destinationName(card?.destination);
  const species = cargoSpeciesName(card);
  const previousEta = isoDateText(previous?.eta_date);
  const nextEta = isoDateText(next?.eta_date);
  const expiry = isoDateText(arrivalExpiryDate(next));
  const previousYard = String(previous?.storage_yard || "").trim();
  const nextYard = String(next?.storage_yard || "").trim();
  const previousWarehouseDate = isoDateText(previous?.warehouse_expected_date);
  const nextWarehouseDate = isoDateText(next?.warehouse_expected_date);
  const notes = missingDocumentNotes(card, next);
  const noteText = notes.length ? notes.join(", ") : "특이사항 없음";
  const footer =
    "관련하여 수정 및 문의사항이 있으신 경우 아인합동관세사(jsh@aincustoms.com)로 말씀 부탁드리겠습니다.";

  const textLines = [
    "안녕하세요 아인합동관세사입니다.",
    "반입예정정보가 변경되어 아래와 같이 안내드립니다.",
    "",
    `화주명: ${consignee}`,
    `B/L: ${blNumber}`,
    `육종: ${species}`,
    `납품처: ${destination}`,
    buildChangeLine("입항예정일", previousEta, nextEta),
    `만기일: ${expiry || "미입력"}`,
    "",
    buildChangeLine("반입예정구역", previousYard, nextYard),
    buildExpectedDateLine("반입예정일", previousWarehouseDate, nextWarehouseDate),
    `비고: ${noteText}`,
    "",
    footer,
    "",
    "아인합동관세사무소 | 조재호, 정석현 대표 관세사",
    "TEL: 02-518-5434",
  ];
  const htmlLines = [
    escapeHtml(textLines[0]),
    escapeHtml(textLines[1]),
    "",
    escapeHtml(textLines[3]),
    escapeHtml(textLines[4]),
    escapeHtml(textLines[5]),
    escapeHtml(textLines[6]),
    buildChangeHtmlLine("입항예정일", previousEta, nextEta),
    `${escapeHtml("만기일")}: ${escapeHtml(expiry || "미입력")}`,
    "",
    buildChangeHtmlLine("반입예정구역", previousYard, nextYard),
    buildExpectedDateHtmlLine(
      "반입예정일",
      previousWarehouseDate,
      nextWarehouseDate
    ),
    `${escapeHtml("비고")}: ${escapeHtml(noteText)}`,
    "",
    escapeHtml(footer),
    "",
    escapeHtml("아인합동관세사무소 | 조재호, 정석현 대표 관세사"),
    escapeHtml("TEL: 02-518-5434"),
  ];
  return {
    subject,
    text: textLines.join("\n"),
    html: wrapMailHtml(htmlLines.join("<br>")),
  };
}

function buildArrivalScheduleChangeMail(card, previous, next) {
  const blNumber = String(card?.bl_number || "-").trim() || "-";
  const subjectConsignee = arrivalSubjectConsignee(card?.consignee);
  const destination = destinationName(card?.destination);
  return buildDetailedTransportMail(
    card,
    previous,
    next,
    `[입항 스케줄 변경] ${subjectConsignee}_${blNumber} / ${destination}`
  );
}

function buildWarehouseChangeMail(card, session, previous, next) {
  const blNumber = card?.bl_number || "-";
  const consignee = card?.consignee || session?.display_name || "-";
  return buildDetailedTransportMail(
    card,
    previous,
    next,
    `[반입예정정보 변경] ${consignee} / ${blNumber}`
  );
}

module.exports = {
  buildArrivalScheduleChangeMail,
  buildTransportRollbackPayload,
  buildWarehouseChangeMail,
  destinationName,
  mergeManualFields,
  mergeRecipients,
  mailTextToHtml,
  parseRecipientList,
  warehouseChanges,
};
