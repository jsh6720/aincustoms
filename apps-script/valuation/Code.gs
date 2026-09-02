// AIN valuation API v2. Replace the old Code.gs, do not append to it.
// Existing spreadsheet contents and column layout are retained.
const LOGIN_SHEET_ID = '1OEut3Bw81yWSXUXul3ydnTtHojE4FPkKLCMB0SXCT5I';
const DUTY_SHEET_ID = '10YWsKFk74VCbdLr2vktbkCCw_Zp2K4xthsnHtDhZ7L8';
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const FAILURE_MESSAGES = Object.freeze({
  UNAUTHORIZED: '로그인이 만료되었거나 유효하지 않습니다. 다시 로그인해주세요.',
  FORBIDDEN: '이 작업을 수행할 권한이 없습니다.',
  BAD_REQUEST: '입력값을 확인해주세요.',
  CONFLICT: '목록이 변경되었습니다. 새로고침 후 다시 확인해주세요.',
  DUPLICATE: '동일한 계정 또는 화주·신고번호가 이미 존재합니다.',
  BUSY: '다른 요청을 처리 중입니다. 잠시 후 다시 시도해주세요.',
  NOT_CONFIGURED: '서버 초기 설정을 확인해주세요.',
  SERVER_ERROR: '요청 처리 결과를 확인할 수 없습니다. 새로고침 후 상태를 확인해주세요.',
});

function doPost(e) {
  try {
    const data = readRequest_(e);
    const action = data.action;
    let result;
    if (action === 'login') {
      result = withLock_(function () { return login_(data); });
    } else if (action === 'getDutyData' || action === 'getAccountData') {
      const auth = authorize_(data.token);
      result = action === 'getDutyData' ? dutyData_(auth) : accountData_(auth);
    } else if (['addDutyRecord', 'updateDutyRecord', 'deleteDutyRecord',
      'addAccount', 'updateAccount', 'deleteAccount'].indexOf(action) !== -1) {
      result = withLock_(function () {
        // Revalidate credentials and permissions INSIDE the mutation lock.
        const auth = authorize_(data.token);
        requireMaster_(auth);
        try {
          return action.indexOf('Account') !== -1
            ? mutateAccount_(action, data, auth)
            : mutateDuty_(action, data, auth);
        } finally {
          // Commit buffered updates AND deletions before releasing the lock.
          SpreadsheetApp.flush();
        }
      });
    } else {
      fail_('BAD_REQUEST');
    }
    return json_(Object.assign({ apiVersion: 2 }, result));
  } catch (error) {
    const code = error && Object.prototype.hasOwnProperty.call(FAILURE_MESSAGES, error.apiCode)
      ? error.apiCode : 'SERVER_ERROR';
    // No request/response/body/password/token/error-stack logging.
    return json_({ success: false, apiVersion: 2, code: code, message: FAILURE_MESSAGES[code] });
  }
}

function doGet() {
  return json_({ success: true, apiVersion: 2, message: 'AIN valuation API v2' });
}

function readRequest_(e) {
  if (!e) fail_('BAD_REQUEST');
  if (e.parameters && Object.keys(e.parameters).some(function (key) {
    return !Array.isArray(e.parameters[key]) || e.parameters[key].length !== 1;
  })) fail_('BAD_REQUEST');
  let data;
  if (e.parameter && Object.keys(e.parameter).length) data = e.parameter;
  else {
    try { data = JSON.parse(e.postData.contents); } catch (_) { fail_('BAD_REQUEST'); }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || typeof data.action !== 'string') fail_('BAD_REQUEST');
  return data;
}

function fail_(code) {
  const error = new Error(code);
  error.apiCode = code;
  throw error;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(operation) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY');
  try { return operation(); } finally { lock.releaseLock(); }
}

function secret_() {
  const value = PropertiesService.getScriptProperties().getProperty('VALUATION_SESSION_SECRET');
  if (!value || value.length < 64) fail_('NOT_CONFIGURED');
  return value;
}

function signature_(domain, value, secret) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(domain + '\n' + value, secret, Utilities.Charset.UTF_8)
  ).replace(/=+$/, '');
}

function equal_(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function idKey_(value) { return String(value == null ? '' : value).trim().toLowerCase(); }
function companyKey_(value) {
  return String(value == null ? '' : value).trim().toLowerCase().normalize('NFKC')
    .replace(/^(?:(?:주식회사|\(주\))\s*)+/u, '')
    .replace(/(?:\s*(?:주식회사|\(주\)))+$/u, '').replace(/\s+/gu, '');
}

function table_(kind) {
  const isAccount = kind === 'account';
  const id = isAccount ? LOGIN_SHEET_ID : DUTY_SHEET_ID;
  const prop = isAccount ? 'VALUATION_LOGIN_TAB_ID' : 'VALUATION_DUTY_TAB_ID';
  const tabId = PropertiesService.getScriptProperties().getProperty(prop);
  if (tabId === null || !/^\d+$/.test(tabId)) fail_('NOT_CONFIGURED');
  const sheet = SpreadsheetApp.openById(id).getSheetById(Number(tabId));
  if (!sheet || sheet.getLastRow() < 1) fail_('NOT_CONFIGURED');
  const range = sheet.getRange(1, 1, sheet.getLastRow(), isAccount ? 3 : 6);
  // Display text retains declaration leading zeroes; credentials retain exact stored values.
  const values = (isAccount ? range.getValues() : range.getDisplayValues()).map(function (row) {
    return row.map(function (value) { return String(value == null ? '' : value); });
  });
  return { sheet: sheet, values: values, tabId: tabId, kind: kind };
}

function accountFor_(username, values) {
  const matches = values.slice(1).filter(function (row) {
    return row[0].trim() && idKey_(row[0]) === idKey_(username);
  });
  // Never guess which duplicated legacy account should authenticate.
  if (matches.length !== 1) return null;
  const row = matches[0];
  if (!row[1] || !row[1].trim()) return null;
  if (idKey_(row[0]) !== 'aincustoms' && !companyKey_(row[2])) return null;
  return row;
}

function fingerprint_(row, key) {
  return signature_('valuation-account-v2', JSON.stringify(row), key);
}

function login_(data) {
  const key = secret_();
  const username = requiredText_(data.username, 128);
  const password = requiredText_(data.password, 256, true);
  const row = accountFor_(username, table_('account').values);
  if (!row || !equal_(signature_('password-compare', password, key),
    signature_('password-compare', row[1], key))) fail_('UNAUTHORIZED');
  const now = Date.now();
  const expiresAt = now + SESSION_LIFETIME_MS;
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({
    v: 2, sub: idKey_(row[0]), iat: now, exp: expiresAt, account: fingerprint_(row, key),
  }), Utilities.Charset.UTF_8).replace(/=+$/, '');
  return { success: true, user: {
    username: row[0].trim(), company: row[2].trim() || 'AIN',
    isMaster: idKey_(row[0]) === 'aincustoms',
    token: payload + '.' + signature_('valuation-session-v2', payload, key), expiresAt: expiresAt,
  } };
}

function authorize_(token) {
  if (typeof token !== 'string' || token.length > 2048 || !/^[\w-]+\.[\w-]+$/.test(token)) fail_('UNAUTHORIZED');
  const key = secret_();
  const parts = token.split('.');
  if (!equal_(signature_('valuation-session-v2', parts[0], key), parts[1])) fail_('UNAUTHORIZED');
  let payload;
  try { payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8')); }
  catch (_) { fail_('UNAUTHORIZED'); }
  const now = Date.now();
  if (!payload || payload.v !== 2 || typeof payload.sub !== 'string'
    || !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat)
    || payload.exp <= now || payload.iat > now + 60000
    || payload.exp - payload.iat !== SESSION_LIFETIME_MS) fail_('UNAUTHORIZED');
  const accounts = table_('account');
  const row = accountFor_(payload.sub, accounts.values);
  if (!row || !equal_(payload.account, fingerprint_(row, key))) fail_('UNAUTHORIZED');
  return { key: key, row: row, accounts: accounts, isMaster: idKey_(row[0]) === 'aincustoms' };
}

function requireMaster_(auth) {
  if (!auth.isMaster) fail_('FORBIDDEN');
}

function revision_(table, key) {
  return signature_('valuation-revision-v2-' + table.kind + '-' + table.tabId,
    JSON.stringify(table.values), key);
}

function checkRevision_(data, table, key) {
  if (!equal_(data.revision, revision_(table, key))) fail_('CONFLICT');
}

function accountData_(auth) {
  requireMaster_(auth);
  const rows = [];
  auth.accounts.values.slice(1).forEach(function (row, index) {
    if (row[0].trim()) rows.push({ id: row[0].trim(), company: row[2].trim(), rowIndex: index });
  });
  return { success: true, data: rows, revision: revision_(auth.accounts, auth.key) };
}

function dutyData_(auth) {
  const table = table_('duty');
  const rows = table.values.slice(1);
  return { success: true,
    data: auth.isMaster ? rows : rows.filter(function (row) {
      return companyKey_(row[0]) === companyKey_(auth.row[2]);
    }),
    revision: auth.isMaster ? revision_(table, auth.key) : '',
  };
}

function requiredText_(value, max, preserveWhitespace) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /\u0000/.test(value)) fail_('BAD_REQUEST');
  return preserveWhitespace ? value : value.trim();
}

function rowIndex_(value, table) {
  const encoded = String(value);
  if (!/^(0|[1-9]\d*)$/.test(encoded)) fail_('BAD_REQUEST');
  const index = Number(encoded);
  if (!Number.isSafeInteger(index) || index >= table.values.length - 1) fail_('BAD_REQUEST');
  return index;
}

function writeText_(sheet, row, col, values) {
  if (!Number.isSafeInteger(row) || row < 1 || !Number.isSafeInteger(col) || col < 1
    || !Array.isArray(values) || values.length === 0
    || values.some(function (value) { return typeof value !== 'string'; })) fail_('BAD_REQUEST');
  if (typeof Sheets === 'undefined' || !Sheets.Spreadsheets
    || typeof Sheets.Spreadsheets.batchUpdate !== 'function'
    || typeof Sheets.Spreadsheets.getByDataFilter !== 'function') fail_('NOT_CONFIGURED');
  const spreadsheetId = sheet.getParent().getId();
  const sheetId = sheet.getSheetId();
  const maxRows = sheet.getMaxRows();
  if (row > maxRows) sheet.insertRowsAfter(maxRows, row - maxRows);
  // Publish pending native work BEFORE the single typed-value write.
  SpreadsheetApp.flush();
  // Only userEnteredValue is written. No post-write native format restoration.
  const result = Sheets.Spreadsheets.batchUpdate({ requests: [{ updateCells: {
    start: { sheetId: sheetId, rowIndex: row - 1, columnIndex: col - 1 },
    rows: [{ values: values.map(function (value) { return { userEnteredValue: { stringValue: value } }; }) }],
    fields: 'userEnteredValue',
  } }] }, spreadsheetId);
  const replyOk = !!result && result.spreadsheetId === spreadsheetId && Array.isArray(result.replies)
    && result.replies.length === 1 && !!result.replies[0]
    && typeof result.replies[0] === 'object' && !Array.isArray(result.replies[0]);
  if (!replyOk) fail_('SERVER_ERROR');
  // A write may already have happened if this read fails: no automatic retry or rollback.
  const stored = Sheets.Spreadsheets.getByDataFilter({ dataFilters: [{ gridRange: {
    sheetId: sheetId, startRowIndex: row - 1, endRowIndex: row,
    startColumnIndex: col - 1, endColumnIndex: col - 1 + values.length,
  } }] }, spreadsheetId, {
    fields: 'spreadsheetId,sheets(properties(sheetId),data(startRow,startColumn,rowData(values(userEnteredValue))))',
  });
  const bookOk = !!stored && stored.spreadsheetId === spreadsheetId;
  const tabs = stored && stored.sheets;
  const tab = Array.isArray(tabs) && tabs.length === 1 ? tabs[0] : null;
  const tabOk = !!tab && !!tab.properties && tab.properties.sheetId === sheetId;
  const blocks = tab && tab.data;
  const grid = Array.isArray(blocks) && blocks.length === 1 ? blocks[0] : null;
  // The API may omit zero-valued offsets; do not coerce false/null/empty values.
  const gridOk = !!grid && (grid.startRow === undefined ? 0 : grid.startRow) === row - 1
    && (grid.startColumn === undefined ? 0 : grid.startColumn) === col - 1;
  const rows = grid && grid.rowData;
  const singleRow = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  const cells = singleRow && singleRow.values;
  const countOk = Array.isArray(cells) && cells.length === values.length;
  const stringsOk = countOk && cells.every(function (cell, index) {
    const entered = cell && cell.userEnteredValue;
    return !!entered && typeof entered === 'object' && !Array.isArray(entered)
      && Object.keys(entered).length === 1 && typeof entered.stringValue === 'string'
      && entered.stringValue === values[index];
  });
  if (!bookOk || !tabOk || !gridOk || !countOk || !stringsOk) fail_('SERVER_ERROR');
}

function mutateAccount_(action, data, auth) {
  const table = auth.accounts;
  checkRevision_(data, table, auth.key);
  const id = requiredText_(data.id, 128);
  if (action === 'addAccount') {
    if (idKey_(id) === 'aincustoms') fail_('FORBIDDEN');
    if (table.values.slice(1).some(function (row) { return idKey_(row[0]) === idKey_(id); })) fail_('DUPLICATE');
    writeText_(table.sheet, table.values.length + 1, 1, [
      id, requiredText_(data.password, 256, true), requiredText_(data.company, 500),
    ]);
  } else {
    const index = rowIndex_(data.rowIndex, table);
    const existing = table.values[index + 1];
    if (existing[0].trim() !== id) fail_('CONFLICT');
    if (idKey_(existing[0]) === 'aincustoms') fail_('FORBIDDEN');
    if (action === 'deleteAccount') table.sheet.deleteRow(index + 2);
    else {
      const company = requiredText_(data.company, 500);
      if (Object.prototype.hasOwnProperty.call(data, 'password') && data.password !== '') {
        writeText_(table.sheet, index + 2, 2, [requiredText_(data.password, 256, true), company]);
      } else {
        // Password omitted: never rewrite the existing credential cell.
        writeText_(table.sheet, index + 2, 3, [company]);
      }
    }
  }
  return { success: true };
}

function mutateDuty_(action, data, auth) {
  const table = table_('duty');
  checkRevision_(data, table, auth.key);
  const index = action === 'addDutyRecord' ? -1 : rowIndex_(data.rowIndex, table);
  if (action === 'deleteDutyRecord') table.sheet.deleteRow(index + 2);
  else {
    const row = ['company', 'supplier', 'payment', 'trade', 'delivery', 'declaration'].map(function (field) {
      return requiredText_(data[field], 1000);
    });
    if (table.values.slice(1).some(function (existing, position) {
      return position !== index && companyKey_(existing[0]) === companyKey_(row[0])
        && existing[5].trim().toLowerCase() === row[5].toLowerCase();
    })) fail_('DUPLICATE');
    writeText_(table.sheet, index < 0 ? table.values.length + 1 : index + 2, 1, row);
  }
  return { success: true };
}

// Editor-only setup. Not reachable through doPost's action allowlist.
function initializeValuationSecurity() {
  return withLock_(function () {
    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty('VALUATION_SESSION_SECRET')) {
      props.setProperty('VALUATION_SESSION_SECRET', Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid());
    }
    [[LOGIN_SHEET_ID, 'VALUATION_LOGIN_TAB_ID'], [DUTY_SHEET_ID, 'VALUATION_DUTY_TAB_ID']]
      .forEach(function (entry) {
        if (props.getProperty(entry[1]) === null) {
          props.setProperty(entry[1], String(SpreadsheetApp.openById(entry[0]).getActiveSheet().getSheetId()));
        }
      });
    secret_();
    table_('account');
    table_('duty');
    return { success: true, message: '설정 완료. 기존 key와 탭 ID는 유지됩니다.' };
  });
}

// Editor-only read preflight. Not reachable through doPost's action allowlist.
function verifyValuationSheetsService() {
  if (typeof Sheets === 'undefined' || !Sheets.Spreadsheets
    || typeof Sheets.Spreadsheets.getByDataFilter !== 'function') fail_('NOT_CONFIGURED');
  let checked = 0;
  ['account', 'duty'].forEach(function (kind) {
    const table = table_(kind);
    const spreadsheetId = table.sheet.getParent().getId();
    const sheetId = table.sheet.getSheetId();
    const result = Sheets.Spreadsheets.getByDataFilter({ dataFilters: [{ gridRange: {
      sheetId: sheetId,
      startRowIndex: 0,
      endRowIndex: 1,
      startColumnIndex: 0,
      endColumnIndex: 1,
    } }] }, spreadsheetId, {
      fields: 'spreadsheetId,sheets(properties(sheetId))',
    });
    const tabs = result && result.sheets;
    if (!result || result.spreadsheetId !== spreadsheetId
      || !Array.isArray(tabs) || tabs.length !== 1
      || !tabs[0].properties || tabs[0].properties.sheetId !== sheetId) fail_('NOT_CONFIGURED');
    checked += 1;
  });
  return { success: true, checked: checked };
}

// Manual full-file rollback snapshot. Never runs automatically from a web request.
function backupValuationSheets() {
  return withLock_(function () {
    const suffix = new Date(Date.now()).toISOString().replace(/[:.]/g, '-');
    const results = [];
    [[LOGIN_SHEET_ID, '계정'], [DUTY_SHEET_ID, '신고내역']].forEach(function (entry) {
      const source = SpreadsheetApp.openById(entry[0]);
      const copy = source.copy('AIN_과세가격_' + entry[1] + '_백업_' + suffix);
      if (!copy || copy.getId() === source.getId()
        || copy.getSheets().length !== source.getSheets().length) throw new Error('백업 사본 확인 실패');
      const result = { sourceId: source.getId(), backupId: copy.getId(), url: copy.getUrl() };
      results.push(result);
      // Backup location only: no spreadsheet contents or credentials.
      Logger.log(JSON.stringify(result));
    });
    return { success: true, backups: results };
  });
}
