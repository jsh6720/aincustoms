const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(
  path.join(__dirname, '..', 'apps-script', 'valuation', 'Code.gs'),
  'utf8',
);
const helperStart = code.indexOf('function writeText_(sheet, row, col, values) {');
const helperEnd = code.indexOf('function mutateAccount_', helperStart);
const helper = helperStart >= 0 && helperEnd > helperStart
  ? code.slice(helperStart, helperEnd)
  : '';

test('production candidate uses one typed Sheets write and verifies exact strings', () => {
  assert.ok(helper, 'writeText_ helper must exist');
  assert.ok(helper.includes('Sheets.Spreadsheets.batchUpdate'));
  assert.ok(helper.includes('userEnteredValue: { stringValue: value }'));
  assert.ok(helper.includes('Sheets.Spreadsheets.getByDataFilter'));
  assert.ok(helper.includes('entered.stringValue === values[index]'));
  assert.equal(helper.includes('setRichTextValues'), false);
  assert.equal(helper.includes('setValues('), false);
  assert.equal(helper.includes('setValue('), false);
});
