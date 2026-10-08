"use strict";

// Read-only path for /requirements that reads Google Sheets directly.
// Apps Script web-app responses are delivered through an echo redirect that
// intermittently loses the result (REQUEST_INCOMPLETE / Drive "page not found"),
// so reads come here. Login and writes stay on Apps Script.
// Token, authorization and record shape mirror requirements/apps-script/Code.gs.

const crypto = require("node:crypto");

const TABLE_SHEET_NAME_MAP = {
  users: "AIN_Users",
  chemical_confirmation: "AIN_Chemical_Confirmation",
  msds: "AIN_MSDS",
  radio_law: "AIN_Radio_Law",
  electrical_law: "AIN_Electrical_Law",
  medical_device: "AIN_Medical_Device",
  non_target: "AIN_Non_Target",
  review_needed: "AIN_Review_Needed",
  radio_exemption: "AIN_Radio_Exemption",
  review_resolved: "AIN_Review_Resolved",
  edit_requests: "AIN_Edit_Requests",
};
const USER_SHEET_NAME = "AIN_Users";
const COMPANY_AUTHORITY_FIELDS = ["importer", "company", "consignee", "company_name", "requester_company"];
const PUBLIC_USER_FIELDS = ["id", "username", "role", "company_name", "active", "created_at", "updated_at"];
const YOUNGIN_GROUP_COMPANIES = [
  "영인과학", "영인모빌리티", "영인바이오젠", "영인에스엔", "영인에스앤",
  "영인에스티", "영인에이티", "영인엠텍", "영인크로매스", "영인랩플러스",
];
const UNIFIED_SEARCH_FIELDS = {
  chemical_confirmation: ["spec_no", "product_name", "model_spec", "company"],
  msds: ["spec_no", "substance", "importer"],
  radio_law: ["spec_no", "model_name", "derived_model_name", "certification_no", "consignee", "manufacturer", "item_name"],
  electrical_law: ["spec_no", "model_name", "derived_model_name", "certification_no", "consignee", "manufacturer", "item_name"],
  medical_device: ["spec_no", "importer", "model_name", "permit_no", "item_name_eng"],
  non_target: ["spec_no", "law", "importer", "exporter", "non_target_reason"],
  review_needed: ["spec_no", "description", "importer", "exporter"],
};
const DASHBOARD_STAT_TABLES = [
  "chemical_confirmation", "msds", "radio_law", "electrical_law", "medical_device", "non_target",
];

const unauthorized = () => ({ ok: false, success: false, error_code: "UNAUTHORIZED" });

// ---- token (same format and HMAC as createSessionToken in Code.gs) ----

function validTokenPayload(payload, nowMs) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const approved = ["v", "sub", "av", "iat", "exp"];
  const keys = Object.keys(payload);
  if (keys.length !== approved.length || approved.some(key => !Object.prototype.hasOwnProperty.call(payload, key))) return false;
  return payload.v === 1 &&
    typeof payload.sub === "string" && payload.sub !== "" &&
    typeof payload.av === "number" && Number.isFinite(payload.av) &&
    typeof payload.iat === "number" && Number.isFinite(payload.iat) &&
    typeof payload.exp === "number" && Number.isFinite(payload.exp) &&
    payload.iat <= payload.exp && Number(nowMs) < payload.exp;
}

// Returns the token payload when the signature and lifetime are valid, else null.
function verifyTokenSignature(token, secret, nowMs) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || parts.some(part => {
    const unpadded = part.replace(/=+$/, "");
    return !/^[A-Za-z0-9_-]+={0,2}$/.test(part) || unpadded.length % 4 === 1 ||
      (unpadded.length !== part.length && part.length % 4 !== 0);
  })) return null;
  const expected = crypto.createHmac("sha256", secret).update(parts[0]).digest();
  const supplied = Buffer.from(parts[1], "base64url");
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return validTokenPayload(payload, nowMs) ? payload : null;
  } catch (error) {
    return null;
  }
}

// ---- users / authorization (same as Code.gs) ----

const normalizeUsername = value => String(value || "").trim().toLowerCase();
const normalizeHeader = value => String(value || "").replace(/^﻿/, "").trim().toLowerCase();

function isActiveValue(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value || "").trim().toLowerCase();
  return ["true", "1", "active", "yes", "y"].includes(normalized);
}

function findUser(userValues, username) {
  if (!userValues || userValues.length < 2) return null;
  const column = {};
  userValues[0].forEach((header, index) => { column[normalizeHeader(header)] = index; });
  if (column.username === undefined) throw new Error("AIN_Users username column is missing");
  const wanted = normalizeUsername(username);
  for (let row = 1; row < userValues.length; row += 1) {
    const values = userValues[row];
    if (normalizeUsername(values[column.username]) !== wanted) continue;
    const valueFor = name => (column[name] === undefined ? "" : values[column[name]]);
    return {
      username: normalizeUsername(valueFor("username")),
      role: String(valueFor("role") || ""),
      company_name: String(valueFor("company_name") || ""),
      active: isActiveValue(valueFor("active")),
      auth_version: Number(valueFor("auth_version") || 1),
    };
  }
  return null;
}

function normalizeCompanyScope(companyName) {
  return String(companyName || "")
    .trim()
    .toLowerCase()
    .replace(/주식회사/g, "")
    .replace(/유한회사/g, "")
    .replace(/\(주\)|（주）|㈜|\(유\)|（유）/g, "")
    .replace(/[\s._-]+/g, "");
}

const NORMALIZED_YOUNGIN_GROUP = YOUNGIN_GROUP_COMPANIES.map(normalizeCompanyScope);

function authorizeRecord(user, record) {
  if (!user || !record) return false;
  if (String(user.role || "").trim().toLowerCase() === "master") return true;
  const scopes = [];
  for (const field of COMPANY_AUTHORITY_FIELDS) {
    const normalized = normalizeCompanyScope(record[field]);
    if (normalized && !scopes.includes(normalized)) scopes.push(normalized);
  }
  const userScope = normalizeCompanyScope(user.company_name);
  if (NORMALIZED_YOUNGIN_GROUP.includes(userScope)) {
    return scopes.some(scope => NORMALIZED_YOUNGIN_GROUP.includes(scope));
  }
  return Boolean(userScope) && scopes.includes(userScope);
}

// ---- sheet values -> Apps Script getValues() equivalent ----

// Sheets serial date (days since 1899-12-30, in the spreadsheet time zone) -> ISO string,
// which is what JSON.stringify gives for the Date that Apps Script getValues() returns.
function serialToIso(serial, timeZone) {
  const wallClockMs = Math.round((serial - 25569) * 86400000);
  let instant = wallClockMs;
  for (let pass = 0; pass < 2; pass += 1) {
    instant = wallClockMs - timeZoneOffsetMs(instant, timeZone);
  }
  return new Date(instant).toISOString();
}

function timeZoneOffsetMs(instantMs, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instantMs)).map(part => [part.type, part.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

const SHEET_ERROR = /^(#N\/A|#REF!|#VALUE!|#DIV\/0!|#NAME\?|#NUM!|#NULL!|#ERROR!) \(.*\)$/s;

// serialRows: UNFORMATTED_VALUE + SERIAL_NUMBER; formattedRows: UNFORMATTED_VALUE + FORMATTED_STRING.
// A cell is a date exactly when it is a number in the first and a string in the second.
function sheetValues(serialRows, formattedRows, timeZone) {
  const rows = serialRows || [];
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row, rowIndex) => {
    const formattedRow = (formattedRows || [])[rowIndex] || [];
    const out = new Array(width);
    for (let column = 0; column < width; column += 1) {
      const value = row[column];
      if (value === undefined || value === null) out[column] = "";
      else if (typeof value === "number" && typeof formattedRow[column] === "string") out[column] = serialToIso(value, timeZone);
      // Error cells come back as "#N/A (detail)"; getValues() gives the bare "#N/A".
      else if (typeof value === "string" && SHEET_ERROR.test(value)) out[column] = value.replace(SHEET_ERROR, "$1");
      else out[column] = value;
    }
    return out;
  });
}

function tableFromValues(values) {
  const headers = values.length ? values[0].map(header => String(header || "").replace(/^﻿/, "").trim()) : [];
  return { headers, values };
}

function rowRecord(headers, row) {
  const record = {};
  headers.forEach((header, index) => { record[header] = row[index]; });
  return record;
}

const normalizeSearchText = value => String(value == null ? "" : value)
  .toLowerCase()
  .replace(/　/g, "")
  .replace(/[\s\-_/.,()·・~]/g, "");

// ---- actions (same results as handleGetData / handleSearch / handleStats) ----

function getData(user, tableName, table) {
  const records = [];
  for (let row = 1; row < table.values.length; row += 1) {
    const record = rowRecord(table.headers, table.values[row]);
    if (!authorizeRecord(user, record)) continue;
    if (tableName === "users") {
      const sanitized = {};
      PUBLIC_USER_FIELDS.forEach(field => { if (Object.prototype.hasOwnProperty.call(record, field)) sanitized[field] = record[field]; });
      records.push(sanitized);
    } else {
      records.push(record);
    }
  }
  return { success: true, data: records, total: records.length };
}

function search(user, query, tables) {
  const needle = normalizeSearchText(query);
  const results = {};
  const failed = [];
  for (const tableName of Object.keys(UNIFIED_SEARCH_FIELDS)) {
    const table = tables[tableName];
    if (!table) { failed.push(tableName); continue; }
    const columns = UNIFIED_SEARCH_FIELDS[tableName].map(field => table.headers.indexOf(field)).filter(index => index !== -1);
    const matches = [];
    for (let row = 1; row < table.values.length; row += 1) {
      const values = table.values[row];
      if (!columns.some(index => normalizeSearchText(values[index]).includes(needle))) continue;
      const record = rowRecord(table.headers, values);
      if (authorizeRecord(user, record)) matches.push(record);
    }
    results[tableName] = matches;
  }
  return { success: true, results, failed };
}

function stats(user, tables) {
  const counts = {};
  for (const tableName of DASHBOARD_STAT_TABLES) {
    const table = tables[tableName];
    if (!table) { counts[tableName] = null; continue; }
    let count = 0;
    for (let row = 1; row < table.values.length; row += 1) {
      if (authorizeRecord(user, rowRecord(table.headers, table.values[row]))) count += 1;
    }
    counts[tableName] = count;
  }
  return { success: true, counts };
}

// Which tables an action needs, or an error result for an invalid request.
function tablesForRequest(request) {
  const action = request && request.action;
  if (action === "getData") {
    if (!Object.prototype.hasOwnProperty.call(TABLE_SHEET_NAME_MAP, request.tableName)) {
      return { error: { success: false, error_code: "INVALID_TABLE", error: "Invalid table" } };
    }
    return { tables: [request.tableName] };
  }
  if (action === "search") {
    const query = request.query;
    if (typeof query !== "string" || query.length > 100 || !normalizeSearchText(query)) {
      return { error: { success: false, error_code: "INVALID_QUERY", error: "Invalid query" } };
    }
    return { tables: Object.keys(UNIFIED_SEARCH_FIELDS) };
  }
  if (action === "stats") return { tables: DASHBOARD_STAT_TABLES.slice() };
  return { error: { success: false, error_code: "UNKNOWN_ACTION", error: "Unknown action" } };
}

// readSheets(sheetNames) -> { timeZone, sheets: { [sheetName]: { serial, formatted } } }
async function handleReadRequest(request, { secret, readSheets, nowMs = Date.now() }) {
  // Same order as handleRequest in Code.gs: authenticate first, then validate the action.
  const payload = verifyTokenSignature(request && request.token, secret, nowMs);
  if (!payload) return unauthorized();
  const plan = tablesForRequest(request);

  const sheetNames = [USER_SHEET_NAME, ...(plan.tables || []).map(name => TABLE_SHEET_NAME_MAP[name])]
    .filter((name, index, all) => all.indexOf(name) === index);
  const read = await readSheets(sheetNames);
  const tableFor = sheetName => {
    const sheet = read.sheets[sheetName];
    return sheet ? tableFromValues(sheetValues(sheet.serial, sheet.formatted, read.timeZone)) : null;
  };

  const users = tableFor(USER_SHEET_NAME);
  if (!users) throw new Error("Required user sheet is missing");
  const user = findUser(users.values, payload.sub);
  if (!user || !user.active || Number(user.auth_version) !== payload.av) return unauthorized();
  if (plan.error) return plan.error;

  const tables = {};
  for (const name of plan.tables) tables[name] = name === "users" ? users : tableFor(TABLE_SHEET_NAME_MAP[name]);
  if (request.action === "getData") {
    if (!tables[request.tableName]) return { success: false, error_code: "SHEET_NOT_FOUND", error: "Required sheet is missing" };
    return getData(user, request.tableName, tables[request.tableName]);
  }
  if (request.action === "search") return search(user, request.query, tables);
  return stats(user, tables);
}

module.exports = {
  handleReadRequest,
  getData,
  tableFromValues,
  verifyTokenSignature,
  authorizeRecord,
  sheetValues,
  serialToIso,
  normalizeSearchText,
  TABLE_SHEET_NAME_MAP,
};
