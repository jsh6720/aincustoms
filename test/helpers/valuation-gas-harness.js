const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const LOGIN = "1OEut3Bw81yWSXUXul3ydnTtHojE4FPkKLCMB0SXCT5I";
const DUTY = "10YWsKFk74VCbdLr2vktbkCCw_Zp2K4xthsnHtDhZ7L8";
const clone = value => JSON.parse(JSON.stringify(value));
function createGas(options = {}) {
  const logs = [], writes = [], copies = [], events = [];
  const accounts = clone(options.accounts || [
    ["id", "password", "company"],
    ["aincustoms", "test-master-password", "AIN"],
    ["youngin", "test-client-password", "영인에스티(주)"],
    ["other", "test-other-password", "다른회사"],
  ]);
  const duties = clone(options.duties || [
    ["company", "supplier", "payment", "trade", "delivery", "declaration"],
    ["영인에스티", "ACME", "TT", "11", "FOB", "00123"],
    ["(주) 영인 에스티", "BETA", "CD", "11", "CIF", "00456"],
    ["영인에스티파트너", "OTHER", "TT", "11", "FOB", "00789"],
  ]);
  const properties = new Map(Object.entries(options.properties || {
    VALUATION_SESSION_SECRET: "test-only-signing-key-".repeat(4),
    VALUATION_LOGIN_TAB_ID: "0", VALUATION_DUTY_TAB_ID: "0",
  }));
  let clock = Date.parse("2026-08-31T00:00:00Z"), locked = false;
  const cache = new Map();
  function range(rows, id, row, col, height = 1, width = 1) {
    const read = () => Array.from({ length: height }, (_, r) =>
      Array.from({ length: width }, (_, c) => rows[row - 1 + r]?.[col - 1 + c] ?? ""));
    const put = (values, rich) => {
      const plain = values.map(cells => cells.map(value => rich ? value.getText() : value));
      writes.push({ id, row, col, values: clone(plain) });
      plain.forEach((cells, r) => cells.forEach((value, c) => {
        rows[row - 1 + r] ||= [];
        rows[row - 1 + r][col - 1 + c] = value;
      }));
    };
    return {
      getValues: () => clone(read()), getDisplayValues: () => read().map(r => r.map(String)),
      getFormulas: () => read().map(r => r.map(() => "")),
      setValues: v => put(v, false), setValue: v => put([[v]], false),
      setRichTextValues: v => put(v, true), setRichTextValue: v => put([[v]], true),
    };
  }
  function spreadsheet(rows, id) {
    let maxRows = options.maxRows || Math.max(1000, rows.length);
    const sheet = {
      getMaxRows: () => maxRows,
      insertRowsAfter: (after, count) => {
        if (after !== maxRows || count < 1) throw new Error('invalid insert');
        maxRows += count; events.push('insertRowsAfter');
      },
      getSheetId: () => 0, getName: () => "data", getLastRow: () => rows.length,
      getDataRange: () => ({ getValues: () => clone(rows), getDisplayValues: () => rows.map(r => r.map(String)) }),
      getRange: (...args) => {
        if (args[0] + (args[2] || 1) - 1 > maxRows) throw new Error('Range exceeds grid limits');
        return range(rows, id, ...args);
      },
      appendRow: row => { writes.push({ id, append: clone(row) }); rows.push(clone(row)); },
      deleteRow: row => { writes.push({ id, delete: row }); events.push('deleteRow'); rows.splice(row - 1, 1); maxRows--; },
    };
    const book = {
      getId: () => id, getName: () => id, getUrl: () => "https://docs.google.com/spreadsheets/d/" + id,
      getActiveSheet: () => sheet, getSheetById: value => value === 0 ? sheet : null, getSheets: () => [sheet],
      copy: name => {
        const newId = "backup-" + copies.length;
        copies.push({ id, name, rows: clone(rows), newId });
        return spreadsheet(clone(rows), newId);
      },
    };
    sheet.getParent = () => book;
    return book;
  }
  const sheets = { [LOGIN]: spreadsheet(accounts, LOGIN), [DUTY]: spreadsheet(duties, DUTY) };
  const propsApi = {
    getProperty: key => properties.get(key) ?? null,
    setProperty: (key, value) => { properties.set(key, String(value)); return propsApi; },
    setProperties: values => { Object.entries(values).forEach(([k, v]) => properties.set(k, String(v))); return propsApi; },
  };
  const context = vm.createContext({
    Date: class extends Date { static now() { return clock; } },
    console: { log: (...a) => logs.push(a), error: (...a) => logs.push(a) }, Logger: { log: (...a) => logs.push(a) },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: body => ({ body, setMimeType() { return this; }, getContent() { return body; } }),
    },
    SpreadsheetApp: {
      openById: id => { if (!sheets[id]) throw new Error("Unexpected spreadsheet"); return sheets[id]; },
      flush: () => events.push('flush'),
      newRichTextValue: () => {
        let text = "";
        return { setText(value) { text = value; return this; }, build: () => ({ getText: () => text }) };
      },
    },
    Sheets: { Spreadsheets: {
      batchUpdate: (body, id) => {
        const request = body && body.requests && body.requests[0] && body.requests[0].updateCells;
        if (!request || request.fields !== 'userEnteredValue') throw new Error('Unexpected typed write');
        const book = sheets[id], target = book && book.getSheetById(request.start.sheetId);
        if (!target) throw new Error('Unexpected spreadsheet');
        const values = request.rows[0].values.map(cell => cell.userEnteredValue.stringValue);
        target.getRange(
          request.start.rowIndex + 1,
          request.start.columnIndex + 1,
          1,
          values.length,
        ).setValues([values]);
        return { spreadsheetId: id, replies: [{}] };
      },
      getByDataFilter: (body, id) => {
        events.push('typedRead');
        const filter = body && body.dataFilters && body.dataFilters[0] && body.dataFilters[0].gridRange;
        const book = sheets[id], target = book && filter && book.getSheetById(filter.sheetId);
        if (!target) throw new Error('Unexpected spreadsheet');
        const row = filter.startRowIndex + 1;
        const col = filter.startColumnIndex + 1;
        const width = filter.endColumnIndex - filter.startColumnIndex;
        const values = target.getRange(row, col, 1, width).getValues()[0];
        return {
          spreadsheetId: id,
          sheets: [{
            properties: { sheetId: filter.sheetId },
            data: [{
              startRow: filter.startRowIndex,
              startColumn: filter.startColumnIndex,
              rowData: [{ values: values.map(value => ({
                userEnteredValue: { stringValue: value },
              })) }],
            }],
          }],
        };
      },
    } },
    PropertiesService: { getScriptProperties: () => propsApi },
    LockService: { getScriptLock: () => ({
      tryLock: () => { if (locked || options.lockFails) return false; locked = true; return true; },
      releaseLock: () => { events.push('releaseLock'); locked = false; },
    }) },
    CacheService: { getScriptCache: () => ({
      get: key => { const x = cache.get(key); return x && x.exp > clock ? x.value : null; },
      put: (key, value, seconds) => cache.set(key, { value, exp: clock + seconds * 1000 }),
      remove: key => cache.delete(key),
    }) },
    Utilities: {
      Charset: { UTF_8: "utf8" }, getUuid: () => crypto.randomUUID(),
      computeHmacSha256Signature: (value, key) => [...crypto.createHmac("sha256", key).update(value).digest()],
      base64EncodeWebSafe: value => Buffer.from(value).toString("base64url"),
      base64DecodeWebSafe: value => [...Buffer.from(value, "base64url")],
      newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString("utf8") }),
    },
  });
  const sourcePath = options.sourcePath || process.env.VALUATION_TEST_SOURCE ||
    path.join(__dirname, "..", "..", "apps-script", "valuation", "Code.gs");
  vm.runInContext(fs.readFileSync(sourcePath, "utf8"), context);
  const post = (data, json = false) => JSON.parse(context.doPost(json ? {
    postData: { contents: JSON.stringify(data) },
  } : {
    parameter: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
  }).getContent());
  return { context, accounts, duties, properties, writes, logs, copies, events, post,
    advance: ms => { clock += ms; },
    login: (username = "aincustoms", password = "test-master-password") => post({ action: "login", username, password }),
  };
}
module.exports = { createGas };
