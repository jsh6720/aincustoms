const vm = require('node:vm');
const crypto = require('node:crypto');

const ORIGINAL_IDS = new Set(['1OEut3Bw81yWSXUXul3ydnTtHojE4FPkKLCMB0SXCT5I', '10YWsKFk74VCbdLr2vktbkCCw_Zp2K4xthsnHtDhZ7L8']);

function runSelfTestBundle(source, options = {}) {
  const logs = [], created = [], openedIds = [], propertyWrites = [];
  const books = new Map(), properties = new Map(Object.entries(options.properties || {}));
  let locked = false, sequence = 0;
  function createBook(name, id) {
    const rows = [[]], formats = new Map();
    const lastRow = () => rows.reduce((last, row, index) => row.some(value => value !== '') ? index + 1 : last, 0);
    function range(row, col, height = 1, width = 1) {
      function put(values) { values.forEach((line, y) => line.forEach((value, x) => { (rows[row + y - 1] ||= [])[col + x - 1] = value; })); }
      return {
        getValues: () => Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => rows[row + y - 1]?.[col + x - 1] ?? '')),
        getDisplayValues: () => Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => String(rows[row + y - 1]?.[col + x - 1] ?? ''))),
        getValue: () => rows[row - 1]?.[col - 1] ?? '', setValues: put,
        setRichTextValues: values => put(values.map(line => line.map(value => value.getText()))),
        setNumberFormat: value => { formats.set(row + ':' + col, value); },
        getNumberFormat: () => formats.get(row + ':' + col) || 'GENERAL',
      };
    }
    let maxRows = 1000;
    const sheet = { getSheetId: () => 0, getLastRow: lastRow, getMaxRows: () => maxRows,
      getRange: (row, col, height, width) => range(row, col, height, width),
      insertRowsAfter: (_, count) => { maxRows += count; }, deleteRow: row => rows.splice(row - 1, 1) };
    const book = { id, name, rows, getId: () => id, getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id,
      getActiveSheet: () => sheet, getSheetById: gid => gid === 0 ? sheet : null };
    sheet.getParent = () => book;
    books.set(id, book); return book;
  }
  const props = { getProperty: key => properties.get(key) ?? null,
    setProperty: (key, value) => { propertyWrites.push(key); properties.set(key, String(value)); return props; },
    setProperties: values => { Object.entries(values).forEach(([key, value]) => props.setProperty(key, value)); return props; } };
  const context = vm.createContext({
    Logger: { log: (...args) => logs.push(args.join(' ')) },
    ScriptApp: { getScriptId: () => options.scriptId || 'new-standalone-script' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: body => ({ setMimeType() { return this; }, getContent: () => body }) },
    SpreadsheetApp: { create: name => { const book = createBook(name, 'synthetic-' + (++sequence)); created.push(book); return book; },
      openById: id => { openedIds.push(id); if (!books.has(id)) throw new Error('Unexpected spreadsheet'); return books.get(id); }, flush() {},
      newRichTextValue: () => { let text = ''; return { setText(value) { text = value; return this; }, build: () => ({ getText: () => text }) }; } },
    Sheets: { Spreadsheets: {
      batchUpdate: (body, id) => {
        const request = body && body.requests && body.requests[0] && body.requests[0].updateCells;
        if (!request || request.fields !== 'userEnteredValue') throw new Error('Unexpected typed write');
        const book = books.get(id), target = book && book.getSheetById(request.start.sheetId);
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
        const filter = body && body.dataFilters && body.dataFilters[0] && body.dataFilters[0].gridRange;
        const book = books.get(id), target = book && filter && book.getSheetById(filter.sheetId);
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
    PropertiesService: { getScriptProperties: () => props },
    LockService: { getScriptLock: () => ({ tryLock: () => !locked && (locked = true), releaseLock: () => { locked = false; } }) },
    Utilities: { Charset: { UTF_8: 'utf8' }, getUuid: () => crypto.randomUUID(),
      computeHmacSha256Signature: (value, key) => [...crypto.createHmac('sha256', key).update(value).digest()],
      base64EncodeWebSafe: value => Buffer.from(value).toString('base64url'), base64DecodeWebSafe: value => [...Buffer.from(value, 'base64url')],
      newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }) },
  });
  vm.runInContext(source, context);
  const post = data => JSON.parse(context.doPost({ parameter: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)])) }).getContent());
  let returnValue, error;
  if (options.invoke !== false) { try { returnValue = context.runValuationGoogleSelfTest(); } catch (caught) { error = caught; } }
  const passwords = created[0] ? { masterPassword: created[0].rows[1][1], customerPassword: created[0].rows[2][1] } : {};
  return { returnValue, error, created, openedIds, openedOriginalIds: openedIds.filter(id => ORIGINAL_IDS.has(id)), propertyWrites, safeLog: logs.join('\n'), post, ...passwords };
}

module.exports = { runSelfTestBundle };
