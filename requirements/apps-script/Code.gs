var SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
var LOGIN_FAILURE_WINDOW_MS = 10 * 60 * 1000;
var LOGIN_LOCK_SECONDS = 15 * 60;
var LOGIN_FAILURE_LIMIT = 5;
var USER_SHEET_NAME = "AIN_Users";
var CONFIGURABLE_SCRIPT_PROPERTY_NAMES = [
  "ACTIVE_SPREADSHEET_ID",
  "BACKUP_FOLDER_ID",
  "BACKUP_LOG_SPREADSHEET_ID",
  "FAILURE_NOTIFICATION_TO",
  "TOKEN_SIGNING_SECRET",
  "PASSWORD_PEPPER",
  "BACKUP_AGENT_SECRET",
  "LEGACY_PASSWORD_CUTOFF",
];

function invalidScriptProperties_() {
  throw new Error("Invalid Script Properties");
}

function validResourceId_(value) {
  return value.length <= 200 && /^[A-Za-z0-9_-]+$/.test(value);
}

function validGeneratedSecret_(value) {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function validLegacyCutoff_(value) {
  if (/^[0-9]{13}$/.test(value)) return Number(value) > 0;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  var parsed = Date.parse(value);
  return isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validateScriptProperties_(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalidScriptProperties_();
  var keys = Object.keys(input);
  if (keys.length !== CONFIGURABLE_SCRIPT_PROPERTY_NAMES.length) invalidScriptProperties_();

  var validated = {};
  for (var index = 0; index < CONFIGURABLE_SCRIPT_PROPERTY_NAMES.length; index += 1) {
    var name = CONFIGURABLE_SCRIPT_PROPERTY_NAMES[index];
    if (!Object.prototype.hasOwnProperty.call(input, name)) invalidScriptProperties_();
    var value = input[name];
    if (typeof value !== "string" || value === "" || value !== value.trim() ||
        value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) {
      invalidScriptProperties_();
    }
    validated[name] = value;
  }

  ["ACTIVE_SPREADSHEET_ID", "BACKUP_FOLDER_ID", "BACKUP_LOG_SPREADSHEET_ID"].forEach(function(name) {
    if (!validResourceId_(validated[name])) invalidScriptProperties_();
  });
  if (validated.FAILURE_NOTIFICATION_TO !== "jsh@aincustoms.com") invalidScriptProperties_();
  ["TOKEN_SIGNING_SECRET", "PASSWORD_PEPPER", "BACKUP_AGENT_SECRET"].forEach(function(name) {
    if (!validGeneratedSecret_(validated[name])) invalidScriptProperties_();
  });
  if (!validLegacyCutoff_(validated.LEGACY_PASSWORD_CUTOFF)) invalidScriptProperties_();
  return validated;
}

function configureScriptProperties(input) {
  var validated = validateScriptProperties_(input);
  PropertiesService.getScriptProperties().setProperties(validated, false);
  return { success: true, configured_keys: CONFIGURABLE_SCRIPT_PROPERTY_NAMES.slice() };
}

function installDailyBackupTrigger() {
  var handler = "runDailyBackup";
  var existing = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === handler;
  });
  var created = ScriptApp.newTrigger(handler)
    .timeBased()
    .atHour(2)
    .everyDays(1)
    .inTimezone("Asia/Seoul")
    .create();
  try {
    existing.forEach(function(trigger) {
      ScriptApp.deleteTrigger(trigger);
    });
  } catch (error) {
    try {
      ScriptApp.deleteTrigger(created);
    } catch (rollbackError) {
      // Preserve the original delete failure while making a best-effort rollback.
    }
    throw error;
  }
  return {
    success: true,
    handler: handler,
    installed_count: 1,
    duplicates_removed: existing.length,
  };
}

function requireScriptProperty(name) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  if (value === null || String(value).trim() === "") {
    throw new Error("Missing required Script Property: " + name);
  }
  return String(value);
}

function normalizeUsername_(username) {
  return String(username || "").trim().toLowerCase();
}

function unauthorized_() {
  return { ok: false, success: false, error_code: "UNAUTHORIZED" };
}

function rateLimited_() {
  return { ok: false, success: false, error_code: "RATE_LIMITED" };
}

function constantTimeEqualBytes_(left, right) {
  var leftBytes = left || [];
  var rightBytes = right || [];
  var length = Math.max(leftBytes.length, rightBytes.length);
  var difference = leftBytes.length ^ rightBytes.length;
  for (var index = 0; index < length; index += 1) {
    var leftByte = index < leftBytes.length ? (Number(leftBytes[index]) + 256) % 256 : 0;
    var rightByte = index < rightBytes.length ? (Number(rightBytes[index]) + 256) % 256 : 0;
    difference |= leftByte ^ rightByte;
  }
  return difference === 0;
}

function utf8BytesToString_(bytes) {
  var encoded = "";
  for (var index = 0; index < bytes.length; index += 1) {
    var byteValue = (Number(bytes[index]) + 256) % 256;
    encoded += "%" + ("0" + byteValue.toString(16)).slice(-2);
  }
  return decodeURIComponent(encoded);
}

function createSessionToken(username, authVersion, nowMs) {
  var issuedAt = Number(nowMs || Date.now());
  var payload = {
    v: 1,
    sub: normalizeUsername_(username),
    av: Number(authVersion || 1),
    iat: issuedAt,
    exp: issuedAt + SESSION_DURATION_MS,
  };
  var encoded = Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8);
  var secret = requireScriptProperty("TOKEN_SIGNING_SECRET");
  var signature = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(encoded, secret)
  );
  return encoded + "." + signature;
}

function validTokenPayload_(payload, nowMs) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  var keys = Object.keys(payload);
  var approved = ["v", "sub", "av", "iat", "exp"];
  if (keys.length !== approved.length) return false;
  for (var index = 0; index < approved.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(payload, approved[index])) return false;
  }
  return payload.v === 1 &&
    typeof payload.sub === "string" && payload.sub !== "" &&
    typeof payload.av === "number" && isFinite(payload.av) &&
    typeof payload.iat === "number" && isFinite(payload.iat) &&
    typeof payload.exp === "number" && isFinite(payload.exp) &&
    payload.iat <= payload.exp && Number(nowMs) < payload.exp;
}

function verifySessionToken(token, nowMs) {
  var payload;
  try {
    var parts = String(token || "").split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return unauthorized_();

    var secret = requireScriptProperty("TOKEN_SIGNING_SECRET");
    var expectedSignature = Utilities.computeHmacSha256Signature(parts[0], secret);
    var suppliedSignature = Utilities.base64DecodeWebSafe(parts[1]);
    if (!constantTimeEqualBytes_(expectedSignature, suppliedSignature)) return unauthorized_();

    var payloadBytes = Utilities.base64DecodeWebSafe(parts[0]);
    payload = JSON.parse(utf8BytesToString_(payloadBytes));
    var checkedAt = Number(nowMs || Date.now());
    if (!validTokenPayload_(payload, checkedAt)) return unauthorized_();
  } catch (error) {
    return unauthorized_();
  }

  var user = loadAuthoritativeUser(payload.sub);
  if (!user || !user.active || Number(user.auth_version) !== payload.av) return unauthorized_();
  return { ok: true, username: user.username, user: user };
}

function authenticateRequest(requestData, nowMs) {
  if (!requestData || typeof requestData.token !== "string") return unauthorized_();
  return verifySessionToken(requestData.token, nowMs);
}

function normalizeHeader_(header) {
  return String(header || "").replace(/^\uFEFF/, "").trim().toLowerCase();
}

function isActiveValue_(value) {
  if (value === true || value === 1) return true;
  var normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "active" ||
    normalized === "yes" || normalized === "y";
}

function loadAuthoritativeUserRecord_(username) {
  var spreadsheetId = requireScriptProperty("ACTIVE_SPREADSHEET_ID");
  var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(USER_SHEET_NAME);
  if (!sheet) throw new Error("Required user sheet is missing");

  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return null;
  var columnByName = {};
  for (var column = 0; column < values[0].length; column += 1) {
    columnByName[normalizeHeader_(values[0][column])] = column;
  }
  if (columnByName.username === undefined) throw new Error("AIN_Users username column is missing");

  var normalizedUsername = normalizeUsername_(username);
  for (var row = 1; row < values.length; row += 1) {
    if (normalizeUsername_(values[row][columnByName.username]) !== normalizedUsername) continue;
    function valueFor(name) {
      return columnByName[name] === undefined ? "" : values[row][columnByName[name]];
    }
    return {
      sheet: sheet,
      rowNumber: row + 1,
      columnByName: columnByName,
      user: {
        username: normalizeUsername_(valueFor("username")),
        password: String(valueFor("password") || ""),
        password_hash: String(valueFor("password_hash") || ""),
        password_salt: String(valueFor("password_salt") || ""),
        auth_version: Number(valueFor("auth_version") || 1),
        role: String(valueFor("role") || ""),
        company_name: String(valueFor("company_name") || ""),
        active: isActiveValue_(valueFor("active")),
      },
    };
  }
  return null;
}

function publicUser_(user) {
  return {
    username: user.username,
    role: user.role,
    company_name: user.company_name,
    active: user.active,
    auth_version: Number(user.auth_version),
  };
}

function loadAuthoritativeUser(username) {
  var record = loadAuthoritativeUserRecord_(username);
  return record ? publicUser_(record.user) : null;
}

function writeUserField_(record, fieldName, value) {
  var column = record.columnByName[fieldName];
  if (column === undefined) throw new Error("AIN_Users " + fieldName + " column is missing");
  record.sheet.getRange(record.rowNumber, column + 1).setValue(value);
  record.user[fieldName] = value;
}

function computePasswordHash_(password, salt) {
  var pepper = requireScriptProperty("PASSWORD_PEPPER");
  var bytes = Utilities.computeHmacSha256Signature(String(salt) + String(password), pepper);
  return Utilities.base64EncodeWebSafe(bytes);
}

function legacyPasswordMatches_(inputPassword, storedPassword) {
  var pepper = requireScriptProperty("PASSWORD_PEPPER");
  var inputProof = Utilities.computeHmacSha256Signature("legacy:" + String(inputPassword), pepper);
  var storedProof = Utilities.computeHmacSha256Signature("legacy:" + String(storedPassword), pepper);
  return constantTimeEqualBytes_(inputProof, storedProof);
}

function storedPasswordHashMatches_(password, salt, storedHash) {
  if (!salt || !storedHash) return false;
  try {
    var calculated = Utilities.base64DecodeWebSafe(computePasswordHash_(password, salt));
    var authoritative = Utilities.base64DecodeWebSafe(storedHash);
    return constantTimeEqualBytes_(calculated, authoritative);
  } catch (error) {
    return false;
  }
}

function legacyCutoffMs_() {
  var raw = requireScriptProperty("LEGACY_PASSWORD_CUTOFF");
  var numeric = Number(raw);
  if (isFinite(numeric)) return numeric;
  var parsed = Date.parse(raw);
  if (!isFinite(parsed)) throw new Error("LEGACY_PASSWORD_CUTOFF is invalid");
  return parsed;
}

function failureCacheKey_(normalizedUsername) {
  return "login-fail:" + normalizedUsername;
}

function lockCacheKey_(normalizedUsername) {
  return "login-lock:" + normalizedUsername;
}

function registerLoginFailure_(normalizedUsername, nowMs) {
  var cache = CacheService.getScriptCache();
  var key = failureCacheKey_(normalizedUsername);
  var state = null;
  try {
    state = JSON.parse(cache.get(key) || "null");
  } catch (error) {
    state = null;
  }
  if (!state || !isFinite(Number(state.firstAt)) || Number(nowMs) - Number(state.firstAt) >= LOGIN_FAILURE_WINDOW_MS) {
    state = { count: 0, firstAt: Number(nowMs) };
  }
  state.count = Number(state.count || 0) + 1;
  if (state.count >= LOGIN_FAILURE_LIMIT) {
    cache.put(lockCacheKey_(normalizedUsername), "1", LOGIN_LOCK_SECONDS);
    cache.remove(key);
    return rateLimited_();
  }
  var remainingSeconds = Math.max(1, Math.ceil((state.firstAt + LOGIN_FAILURE_WINDOW_MS - Number(nowMs)) / 1000));
  cache.put(key, JSON.stringify(state), remainingSeconds);
  return unauthorized_();
}

function handleLogin(username, password) {
  var normalizedUsername = normalizeUsername_(username);
  var nowMs = Date.now();
  var cache = CacheService.getScriptCache();
  if (cache.get(lockCacheKey_(normalizedUsername))) return rateLimited_();

  var record = loadAuthoritativeUserRecord_(normalizedUsername);
  if (!record || !record.user.active) return registerLoginFailure_(normalizedUsername, nowMs);

  var user = record.user;
  var authenticated = false;
  if (user.password_hash) {
    authenticated = storedPasswordHashMatches_(password, user.password_salt, user.password_hash);
  } else {
    authenticated = legacyPasswordMatches_(password, user.password);
    if (authenticated) {
      var salt = Utilities.getUuid();
      var hash = computePasswordHash_(password, salt);
      var authVersion = isFinite(Number(user.auth_version)) && Number(user.auth_version) > 0 ? Number(user.auth_version) : 1;
      writeUserField_(record, "password_salt", salt);
      writeUserField_(record, "auth_version", authVersion);
      writeUserField_(record, "password_hash", hash);
    }
  }

  if (!authenticated) return registerLoginFailure_(normalizedUsername, nowMs);
  if (nowMs >= legacyCutoffMs_() && user.password) writeUserField_(record, "password", "");
  cache.remove(failureCacheKey_(normalizedUsername));

  var currentUser = loadAuthoritativeUser(normalizedUsername);
  return {
    ok: true,
    success: true,
    token: createSessionToken(currentUser.username, currentUser.auth_version, nowMs),
    user: {
      username: currentUser.username,
      role: currentUser.role,
      company_name: currentUser.company_name,
    },
  };
}

var TABLE_SHEET_NAME_MAP = {
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

var COMPANY_AUTHORITY_FIELDS = [
  "importer", "company", "consignee", "company_name", "requester_company",
];
var CREATOR_AUTHORITY_FIELDS = ["created_by", "requester_username"];
var CLIENT_AUTHORITY_FIELDS = ["role", "companyName", "company_name", "username"];
var SECRET_USER_FIELDS = ["password", "password_hash", "password_salt"];
var PUBLIC_USER_FIELDS = [
  "id", "username", "role", "company_name", "active", "created_at", "updated_at",
];
var YOUNGIN_GROUP_COMPANIES = [
  "영인과학", "영인모빌리티", "영인바이오젠", "영인에스엔", "영인에스앤",
  "영인에스티", "영인에이티", "영인엠텍", "영인크로매스", "영인랩플러스",
];

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function parseRequest(e) {
  if (e && e.postData && typeof e.postData.contents === "string") {
    return JSON.parse(e.postData.contents);
  }
  return e && e.parameter ? e.parameter : {};
}

function createResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleRequest(e) {
  if (e && e.parameter && e.parameter.route === "weekly_backup_heartbeat") {
    try {
      return createResponse(recordWeeklyBackup(parseRequest(e)));
    } catch (error) {
      return createResponse({ success: false, error: "Heartbeat rejected" });
    }
  }
  try {
    var requestData = parseRequest(e);
    if (requestData.action === "login") {
      return createResponse(handleLogin(requestData.username, requestData.password));
    }

    var auth = authenticateRequest(requestData, Date.now());
    if (!auth.ok) return createResponse(auth);
    var user = auth.user;

    switch (requestData.action) {
      case "getData":
        return createResponse(handleGetData(user, requestData.tableName));
      case "addData":
        return createResponse(handleAddData(user, requestData.tableName, requestData.data));
      case "updateData":
        return createResponse(handleUpdateData(user, requestData.tableName, requestData.id, requestData.data));
      case "deleteData":
        return createResponse(handleDeleteData(user, requestData.tableName, requestData.id));
      default:
        return createResponse({
          success: false,
          error_code: "UNKNOWN_ACTION",
          error: "Unknown action",
        });
    }
  } catch (error) {
    Logger.log("Request failed: " + String(error && error.message ? error.message : error));
    return createResponse({
      success: false,
      error_code: "INTERNAL_ERROR",
      error: "Internal error",
    });
  }
}

function forbidden_() {
  return { success: false, error_code: "FORBIDDEN", error: "Forbidden" };
}

function invalidTable_() {
  return { success: false, error_code: "INVALID_TABLE", error: "Invalid table" };
}

function normalizeCompanyScope_(companyName) {
  return String(companyName || "")
    .trim()
    .toLowerCase()
    .replace(/주식회사/g, "")
    .replace(/유한회사/g, "")
    .replace(/\(주\)|（주）|㈜|\(유\)|（유）/g, "")
    .replace(/[\s._-]+/g, "");
}

function younginGroupScope_(companyName) {
  var normalized = normalizeCompanyScope_(companyName);
  var normalizedGroup = YOUNGIN_GROUP_COMPANIES.map(normalizeCompanyScope_);
  return normalizedGroup.indexOf(normalized) === -1 ? null : normalizedGroup;
}

function recordCompanyScopes_(record) {
  var scopes = [];
  for (var index = 0; index < COMPANY_AUTHORITY_FIELDS.length; index += 1) {
    var value = record[COMPANY_AUTHORITY_FIELDS[index]];
    var normalized = normalizeCompanyScope_(value);
    if (normalized && scopes.indexOf(normalized) === -1) scopes.push(normalized);
  }
  return scopes;
}

function authorizeRecord(user, record) {
  if (!user || !record) return false;
  if (String(user.role || "").trim().toLowerCase() === "master") return true;

  var recordScopes = recordCompanyScopes_(record);
  var groupScope = younginGroupScope_(user.company_name);
  if (groupScope) {
    return recordScopes.some(function(scope) {
      return groupScope.indexOf(scope) !== -1;
    });
  }

  var userScope = normalizeCompanyScope_(user.company_name);
  return Boolean(userScope) && recordScopes.indexOf(userScope) !== -1;
}

function tableState_(tableName) {
  if (!Object.prototype.hasOwnProperty.call(TABLE_SHEET_NAME_MAP, tableName)) {
    return { error: invalidTable_() };
  }
  var spreadsheetId = requireScriptProperty("ACTIVE_SPREADSHEET_ID");
  var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(TABLE_SHEET_NAME_MAP[tableName]);
  if (!sheet) {
    return {
      error: { success: false, error_code: "SHEET_NOT_FOUND", error: "Required sheet is missing" },
    };
  }
  var values = sheet.getDataRange().getValues();
  var headers = values && values.length ? values[0].map(function(header) {
    return String(header || "").replace(/^\uFEFF/, "").trim();
  }) : [];
  return { sheet: sheet, headers: headers, values: values || [] };
}

function rowRecord_(headers, row) {
  var record = {};
  for (var index = 0; index < headers.length; index += 1) {
    record[headers[index]] = row[index];
  }
  return record;
}

function sanitizePublicUserRecord(record) {
  var sanitized = {};
  PUBLIC_USER_FIELDS.forEach(function(field) {
    if (Object.prototype.hasOwnProperty.call(record, field)) sanitized[field] = record[field];
  });
  return sanitized;
}

function handleGetData(user, tableName) {
  var table = tableState_(tableName);
  if (table.error) return table.error;
  var records = [];
  for (var row = 1; row < table.values.length; row += 1) {
    var record = rowRecord_(table.headers, table.values[row]);
    if (!authorizeRecord(user, record)) continue;
    records.push(tableName === "users" ? sanitizePublicUserRecord(record) : record);
  }
  return { success: true, data: records, total: records.length };
}

function cloneAllowedData_(data) {
  var cloned = {};
  if (!data || typeof data !== "object" || Array.isArray(data)) return cloned;
  Object.keys(data).forEach(function(field) {
    if (CLIENT_AUTHORITY_FIELDS.indexOf(field) === -1 &&
        SECRET_USER_FIELDS.indexOf(field) === -1) {
      cloned[field] = data[field];
    }
  });
  return cloned;
}

function setAddAuthority_(user, headers, record) {
  for (var index = 0; index < CREATOR_AUTHORITY_FIELDS.length; index += 1) {
    var creatorField = CREATOR_AUTHORITY_FIELDS[index];
    if (headers.indexOf(creatorField) !== -1) record[creatorField] = user.username;
  }
  if (String(user.role || "").trim().toLowerCase() === "master") return;
  for (var companyIndex = 0; companyIndex < COMPANY_AUTHORITY_FIELDS.length; companyIndex += 1) {
    var companyField = COMPANY_AUTHORITY_FIELDS[companyIndex];
    if (headers.indexOf(companyField) !== -1) record[companyField] = user.company_name;
  }
}

function handleAddData(user, tableName, data) {
  if (tableName === "users" && String(user.role || "").trim().toLowerCase() !== "master") {
    return forbidden_();
  }
  var table = tableState_(tableName);
  if (table.error) return table.error;
  var record = cloneAllowedData_(data);
  setAddAuthority_(user, table.headers, record);
  if (table.headers.indexOf("id") !== -1 && !record.id) record.id = Utilities.getUuid();
  var nowMs = Date.now();
  if (table.headers.indexOf("created_at") !== -1) record.created_at = nowMs;
  if (table.headers.indexOf("updated_at") !== -1) record.updated_at = nowMs;

  var row = table.headers.map(function(header) {
    return record[header] === undefined || record[header] === null ? "" : record[header];
  });
  table.sheet.appendRow(row);
  var addedRecord = rowRecord_(table.headers, row);
  return {
    success: true,
    data: tableName === "users" ? sanitizePublicUserRecord(addedRecord) : addedRecord,
  };
}

function findStoredRecord_(table, id) {
  var idIndex = table.headers.indexOf("id");
  if (idIndex === -1) return null;
  for (var row = 1; row < table.values.length; row += 1) {
    if (String(table.values[row][idIndex]) === String(id)) {
      return { rowNumber: row + 1, record: rowRecord_(table.headers, table.values[row]) };
    }
  }
  return null;
}

function handleUpdateData(user, tableName, id, data) {
  if (tableName === "users" && String(user.role || "").trim().toLowerCase() !== "master") {
    return forbidden_();
  }
  var table = tableState_(tableName);
  if (table.error) return table.error;
  var stored = findStoredRecord_(table, id);
  if (!stored) return { success: false, error_code: "NOT_FOUND", error: "Record not found" };
  if (!authorizeRecord(user, stored.record)) return forbidden_();

  var updates = cloneAllowedData_(data);
  var isMaster = String(user.role || "").trim().toLowerCase() === "master";
  var immutable = ["id", "created_at"].concat(CREATOR_AUTHORITY_FIELDS);
  if (!isMaster) immutable = immutable.concat(COMPANY_AUTHORITY_FIELDS);
  if (table.headers.indexOf("updated_at") !== -1) updates.updated_at = Date.now();

  Object.keys(updates).forEach(function(field) {
    var column = table.headers.indexOf(field);
    if (column === -1 || immutable.indexOf(field) !== -1) return;
    table.sheet.getRange(stored.rowNumber, column + 1).setValue(updates[field]);
    stored.record[field] = updates[field];
  });
  return {
    success: true,
    data: tableName === "users" ? sanitizePublicUserRecord(stored.record) : stored.record,
  };
}

function handleDeleteData(user, tableName, id) {
  if (tableName === "users" && String(user.role || "").trim().toLowerCase() !== "master") {
    return forbidden_();
  }
  var table = tableState_(tableName);
  if (table.error) return table.error;
  var stored = findStoredRecord_(table, id);
  if (!stored) return { success: false, error_code: "NOT_FOUND", error: "Record not found" };
  if (!authorizeRecord(user, stored.record)) return forbidden_();
  table.sheet.deleteRow(stored.rowNumber);
  return { success: true, message: "Data deleted successfully" };
}

// 이 목록은 백업 검증에서 "워크북의 시트 이름이 정확히 이것과 같아야 한다"로 쓰인다.
// 시트를 새로 만들면 반드시 여기에도 추가해야 하며, 빠뜨리면 매일 백업이
// "Workbook sheet names do not exactly match" 로 실패하고 실패 메일이 나간다.
var BACKUP_REQUIRED_SHEET_NAMES = [
  "AIN_Users", "AIN_Chemical_Confirmation", "AIN_MSDS", "AIN_Radio_Law",
  "AIN_Electrical_Law", "AIN_Medical_Device", "AIN_Non_Target",
  "AIN_Review_Needed", "AIN_Review_Resolved", "AIN_Radio_Exemption",
  "AIN_Edit_Requests",
];
var BACKUP_LOG_SHEET_NAME = "AIN_Backup_Log";
var BACKUP_LOG_HEADERS = ["STARTED_AT", "ENDED_AT", "BACKUP_TYPE", "FILE_ID_OR_PATH", "TAB_MANIFEST_JSON", "RESULT", "ERROR_SUMMARY"];
var BACKUP_FAILURE_SUBJECT = "[AIN DB 백업 실패]";
var HEARTBEAT_FRESHNESS_MS = 15 * 60 * 1000;

function backupIsoString_(value) { return new Date(Number(value)).toISOString(); }

function backupWorkbookManifest_(workbook) {
  if (!workbook || typeof workbook.getSheets !== "function") throw new Error("Workbook cannot be inspected");
  var names = workbook.getSheets().map(function(sheet) { return sheet.getName(); }).sort();
  if (JSON.stringify(names) !== JSON.stringify(BACKUP_REQUIRED_SHEET_NAMES.slice().sort())) {
    throw new Error("Workbook sheet names do not exactly match the required " +
      BACKUP_REQUIRED_SHEET_NAMES.length + " sheets");
  }
  return BACKUP_REQUIRED_SHEET_NAMES.map(function(name) {
    var sheet = workbook.getSheetByName(name);
    var lastRow = Number(sheet.getLastRow());
    var lastColumn = Number(sheet.getLastColumn());
    if (!isFinite(lastRow) || !isFinite(lastColumn) || lastRow < 1 || lastColumn < 1) {
      throw new Error(name + " has no verifiable first-row header");
    }
    var values = sheet.getRange(1, 1, 1, lastColumn).getValues();
    var headers = values && values.length === 1 ? values[0] : null;
    if (!headers || headers.length !== lastColumn) throw new Error(name + " header array cannot be verified");
    return { name: name, headers: headers.slice(), last_row: lastRow, last_column: lastColumn };
  });
}

function manifestMismatch_(expected, actual) {
  for (var index = 0; index < expected.length; index += 1) {
    var left = expected[index];
    var right = actual[index];
    if (!right || left.name !== right.name || left.last_row !== right.last_row ||
        left.last_column !== right.last_column || JSON.stringify(left.headers) !== JSON.stringify(right.headers)) return left.name;
  }
  return "";
}

function verifyBackupCopy(source, copy) {
  try {
    var sourceManifest = backupWorkbookManifest_(source);
    var mismatch = manifestMismatch_(sourceManifest, backupWorkbookManifest_(copy));
    return mismatch ? { success: false, error: mismatch + " backup manifest mismatch" } : { success: true, manifest: sourceManifest };
  } catch (error) {
    return { success: false, error: String(error && error.message ? error.message : error) };
  }
}

function sanitizeBackupText_(value, limit) {
  var text = String(value === undefined || value === null ? "" : value);
  var properties = PropertiesService.getScriptProperties();
  ["BACKUP_AGENT_SECRET", "TOKEN_SIGNING_SECRET", "PASSWORD_PEPPER"].forEach(function(name) {
    var secret = properties.getProperty(name);
    if (secret) text = text.split(String(secret)).join("[REDACTED]");
  });
  text = text.replace(/(password|token|credential|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
  return text.slice(0, limit || 500);
}

function appendBackupLog_(entry) {
  var sheet = SpreadsheetApp.openById(requireScriptProperty("BACKUP_LOG_SPREADSHEET_ID")).getSheetByName(BACKUP_LOG_SHEET_NAME);
  if (!sheet) throw new Error("Required backup log sheet is missing");
  if (Number(sheet.getLastRow()) === 0) sheet.appendRow(BACKUP_LOG_HEADERS.slice());
  sheet.appendRow([
    sanitizeBackupText_(entry.started_at, 40), sanitizeBackupText_(entry.ended_at, 40),
    sanitizeBackupText_(entry.backup_type, 40), sanitizeBackupText_(entry.file_id_or_path, 1024),
    JSON.stringify(entry.manifest || []), entry.result === "SUCCESS" ? "SUCCESS" : "FAILURE",
    sanitizeBackupText_(entry.error_summary, 500),
  ]);
}

function notifyBackupFailure_(summary) {
  try {
    MailApp.sendEmail(requireScriptProperty("FAILURE_NOTIFICATION_TO"), BACKUP_FAILURE_SUBJECT, sanitizeBackupText_(summary, 500));
  } catch (error) {
    Logger.log("Backup notification failed: " + sanitizeBackupText_(error && error.message ? error.message : error, 500));
  }
}

function backupFolderFiles_(folder) {
  var files = [];
  var fileIterator = folder.getFiles();
  while (fileIterator.hasNext()) files.push(fileIterator.next());
  return files;
}

function fileBelongsToFolder_(file, folderId) {
  if (!file || typeof file.getParents !== "function") return false;
  var parents = file.getParents();
  while (parents.hasNext()) if (String(parents.next().getId()) === String(folderId)) return true;
  return false;
}

function monthlyRetentionCutoff_(nowMs) {
  var cutoff = new Date(Number(nowMs));
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  return Number(cutoff);
}

function pruneBackupFiles(files, now, approvedFolderId) {
  var checkedAt = Number(now === undefined || now === null ? Date.now() : now);
  var folderId = String(approvedFolderId || requireScriptProperty("BACKUP_FOLDER_ID"));
  var activeId = requireScriptProperty("ACTIVE_SPREADSHEET_ID");
  var dailyCutoff = checkedAt - 30 * 24 * 60 * 60 * 1000;
  var monthlyCutoff = monthlyRetentionCutoff_(checkedAt);
  var deleted = 0;
  (files || []).forEach(function(file) {
    var name = String(file.getName());
    if (String(file.getId()) === activeId || !fileBelongsToFolder_(file, folderId)) return;
    var createdAt = Number(file.getDateCreated());
    var daily = /^Ain_compliance_db_DAILY_\d{8}_\d{4}$/.test(name) && createdAt < dailyCutoff;
    var monthly = /^Ain_compliance_db_MONTHLY_\d{6}$/.test(name) && createdAt < monthlyCutoff;
    if (daily || monthly) { file.setTrashed(true); deleted += 1; }
  });
  return { deleted: deleted };
}

function runDailyBackup(now) {
  var startedMs = Date.now();
  var suppliedMs = now instanceof Date ? Number(now) :
    (typeof now === "number" ? now : NaN);
  var checkedAt = isFinite(suppliedMs) ? suppliedMs : startedMs;
  var currentType = "DAILY";
  var currentFileId = "";
  var failureLogged = false;
  try {
    var activeId = requireScriptProperty("ACTIVE_SPREADSHEET_ID");
    var folderId = requireScriptProperty("BACKUP_FOLDER_ID");
    requireScriptProperty("BACKUP_LOG_SPREADSHEET_ID");
    var source = SpreadsheetApp.openById(activeId);
    var sourceFile = DriveApp.getFileById(activeId);
    var folder = DriveApp.getFolderById(folderId);
    var at = new Date(checkedAt);
    var copies = [{ type: "DAILY", name: "Ain_compliance_db_DAILY_" + Utilities.formatDate(at, "Asia/Seoul", "yyyyMMdd_HHmm") }];
    if (Utilities.formatDate(at, "Asia/Seoul", "dd") === "01") {
      copies.push({ type: "MONTHLY", name: "Ain_compliance_db_MONTHLY_" + Utilities.formatDate(at, "Asia/Seoul", "yyyyMM") });
    }
    var results = [];
    for (var index = 0; index < copies.length; index += 1) {
      currentType = copies[index].type;
      currentFileId = "";
      var copyFile = sourceFile.makeCopy(copies[index].name, folder);
      currentFileId = String(copyFile.getId());
      var verification = verifyBackupCopy(source, SpreadsheetApp.openById(currentFileId));
      if (!verification.success) {
        var verificationError = sanitizeBackupText_(verification.error, 500);
        appendBackupLog_({ started_at: backupIsoString_(startedMs), ended_at: backupIsoString_(Date.now()), backup_type: currentType,
          file_id_or_path: currentFileId, manifest: [], result: "FAILURE", error_summary: verificationError });
        failureLogged = true;
        throw new Error(verificationError);
      }
      appendBackupLog_({ started_at: backupIsoString_(startedMs), ended_at: backupIsoString_(Date.now()), backup_type: currentType,
        file_id_or_path: currentFileId, manifest: verification.manifest, result: "SUCCESS", error_summary: "" });
      results.push({ type: currentType, file_id: currentFileId, name: copies[index].name });
    }
    pruneBackupFiles(backupFolderFiles_(folder), checkedAt, folderId);
    return { success: true, copies: results };
  } catch (error) {
    var summary = sanitizeBackupText_(error && error.message ? error.message : error, 500);
    if (!failureLogged) {
      try {
        appendBackupLog_({ started_at: backupIsoString_(startedMs), ended_at: backupIsoString_(Date.now()), backup_type: currentType,
          file_id_or_path: currentFileId, manifest: [], result: "FAILURE", error_summary: summary });
      } catch (logError) {
        Logger.log("Backup failure log unavailable: " + sanitizeBackupText_(logError && logError.message ? logError.message : logError, 500));
      }
    }
    notifyBackupFailure_(summary);
    return { success: false, error: summary };
  }
}

function heartbeatCanonicalPayload_(requestData) {
  return JSON.stringify([requestData.version, requestData.backup_type, requestData.result, requestData.source_spreadsheet_id,
    requestData.started_at, requestData.ended_at, requestData.file_path, requestData.byte_count, requestData.sha256, requestData.error_summary]);
}

function validateHeartbeat_(requestData, nowMs) {
  if (!requestData || typeof requestData !== "object" || Array.isArray(requestData)) throw new Error("Heartbeat payload is malformed");
  var keys = ["version", "backup_type", "result", "source_spreadsheet_id", "started_at", "ended_at", "file_path",
    "byte_count", "sha256", "error_summary", "signature"].sort();
  if (JSON.stringify(Object.keys(requestData).sort()) !== JSON.stringify(keys)) throw new Error("Heartbeat fields are malformed");
  if (requestData.version !== 1 || requestData.backup_type !== "weekly_xlsx" ||
      (requestData.result !== "success" && requestData.result !== "failure")) throw new Error("Heartbeat contract is invalid");
  if (typeof requestData.source_spreadsheet_id !== "string" || requestData.source_spreadsheet_id.length < 1 ||
      requestData.source_spreadsheet_id.length > 200 || requestData.source_spreadsheet_id !== requireScriptProperty("ACTIVE_SPREADSHEET_ID")) {
    throw new Error("Heartbeat source spreadsheet is invalid");
  }
  if (typeof requestData.started_at !== "string" || requestData.started_at.length > 40 ||
      typeof requestData.ended_at !== "string" || requestData.ended_at.length > 40 ||
      !/(Z|[+-]\d{2}:\d{2})$/.test(requestData.started_at) || !/(Z|[+-]\d{2}:\d{2})$/.test(requestData.ended_at)) {
    throw new Error("Heartbeat timestamps are invalid");
  }
  var startedAt = Date.parse(requestData.started_at);
  var endedAt = Date.parse(requestData.ended_at);
  if (!isFinite(startedAt) || !isFinite(endedAt) || startedAt > endedAt || Math.abs(endedAt - Number(nowMs)) > HEARTBEAT_FRESHNESS_MS) {
    throw new Error("Heartbeat timestamps are stale or out of order");
  }
  if (typeof requestData.file_path !== "string" || requestData.file_path.length > 1024 ||
      typeof requestData.error_summary !== "string" || requestData.error_summary.length > 500 ||
      typeof requestData.sha256 !== "string" || typeof requestData.byte_count !== "number" || !isFinite(requestData.byte_count) ||
      Math.floor(requestData.byte_count) !== requestData.byte_count || requestData.byte_count < 0) throw new Error("Heartbeat metadata is invalid");
  if (requestData.result === "success" && (!requestData.file_path || !/^[0-9a-f]{64}$/.test(requestData.sha256))) {
    throw new Error("Successful heartbeat artifact metadata is invalid");
  }
  if (requestData.result === "failure" && !requestData.error_summary) throw new Error("Failed heartbeat requires an error summary");
  if (typeof requestData.signature !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(requestData.signature)) {
    throw new Error("Heartbeat signature is malformed");
  }
}

function recordWeeklyBackup(requestData) {
  var processedAt = Date.now();
  try {
    validateHeartbeat_(requestData, processedAt);
    var expected = Utilities.computeHmacSha256Signature(heartbeatCanonicalPayload_(requestData), requireScriptProperty("BACKUP_AGENT_SECRET"));
    var supplied = Utilities.base64DecodeWebSafe(requestData.signature);
    if (!constantTimeEqualBytes_(expected, supplied)) throw new Error("Heartbeat signature verification failed");
    var failed = requestData.result === "failure";
    var safeError = failed ? sanitizeBackupText_(requestData.error_summary, 500) : "";
    appendBackupLog_({ started_at: requestData.started_at, ended_at: requestData.ended_at, backup_type: "WEEKLY_XLSX",
      file_id_or_path: requestData.file_path, manifest: [], result: failed ? "FAILURE" : "SUCCESS", error_summary: safeError });
    if (failed) notifyBackupFailure_(safeError);
    return { success: true, result: requestData.result };
  } catch (error) {
    return { success: false, error: "Heartbeat rejected" };
  }
}

function normalizeRecordedManifest_(manifest) {
  if (!Array.isArray(manifest) || manifest.length !== BACKUP_REQUIRED_SHEET_NAMES.length) {
    throw new Error("Restore manifest must contain exactly " +
      BACKUP_REQUIRED_SHEET_NAMES.length + " sheets");
  }
  var byName = {};
  manifest.forEach(function(tab) {
    if (!tab || typeof tab !== "object" || Array.isArray(tab) ||
        Object.keys(tab).sort().join(",") !== "headers,last_column,last_row,name" || typeof tab.name !== "string" ||
        !Array.isArray(tab.headers) || typeof tab.last_row !== "number" || !isFinite(tab.last_row) ||
        Math.floor(tab.last_row) !== tab.last_row || tab.last_row < 1 || typeof tab.last_column !== "number" ||
        !isFinite(tab.last_column) || Math.floor(tab.last_column) !== tab.last_column || tab.last_column < 1 ||
        tab.headers.length !== tab.last_column || byName[tab.name]) throw new Error("Restore manifest is malformed");
    byName[tab.name] = { name: tab.name, headers: tab.headers.slice(), last_row: tab.last_row, last_column: tab.last_column };
  });
  return BACKUP_REQUIRED_SHEET_NAMES.map(function(name) {
    if (!byName[name]) throw new Error("Restore manifest is missing " + name);
    return byName[name];
  });
}

function findRecordedManifest_(fileId) {
  var sheet = SpreadsheetApp.openById(requireScriptProperty("BACKUP_LOG_SPREADSHEET_ID")).getSheetByName(BACKUP_LOG_SHEET_NAME);
  if (!sheet) throw new Error("Required backup log sheet is missing");
  var rows = sheet.getDataRange().getValues();
  for (var index = rows.length - 1; index >= 1; index -= 1) {
    if (String(rows[index][3]) === String(fileId) && rows[index][5] === "SUCCESS") {
      try { return normalizeRecordedManifest_(JSON.parse(rows[index][4])); }
      catch (error) { throw new Error("Recorded restore manifest is invalid"); }
    }
  }
  throw new Error("No successful recorded manifest for restore candidate");
}

function setActiveSpreadsheetIdForRestore(id, suppliedManifest) {
  var candidateId = String(id || "").trim();
  if (!candidateId || candidateId.length > 200) throw new Error("Restore candidate ID is invalid");
  var expected = suppliedManifest === undefined || suppliedManifest === null ? findRecordedManifest_(candidateId) :
    normalizeRecordedManifest_(suppliedManifest);
  var actual = backupWorkbookManifest_(SpreadsheetApp.openById(candidateId));
  var mismatch = manifestMismatch_(expected, actual);
  if (mismatch) throw new Error(mismatch + " restore manifest mismatch");
  var properties = PropertiesService.getScriptProperties();
  var previousId = requireScriptProperty("ACTIVE_SPREADSHEET_ID");
  properties.setProperty("ACTIVE_SPREADSHEET_ID", candidateId);
  return { success: true, previousActiveSpreadsheetId: previousId, newActiveSpreadsheetId: candidateId };
}
