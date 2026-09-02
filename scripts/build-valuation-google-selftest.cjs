const fs = require('node:fs');
const path = require('node:path');

const CONSTANTS = [
  ['LOGIN_SHEET_ID', '1OEut3Bw81yWSXUXul3ydnTtHojE4FPkKLCMB0SXCT5I'],
  ['DUTY_SHEET_ID', '10YWsKFk74VCbdLr2vktbkCCw_Zp2K4xthsnHtDhZ7L8'],
];
const INHERITED_REPLACEMENT_COMMENT = '// AIN valuation API v2. Replace the old Code.gs, do not append to it.';
const SELFTEST_WARNING = '// [자가검증 전용] 새 Apps Script 프로젝트에서만 실행하십시오. 운영 프로젝트에는 붙여넣거나 실행하지 마십시오.';
const SELFTEST_COMMENT = '// AIN valuation API v2 self-test bundle. 이 파일은 운영 Code.gs 교체용이 아닙니다.';

function replaceProductionSheetConstant(source, name, id) {
  const expression = new RegExp("^const " + name + " = '" + id + "';\\r?$", 'gm');
  const matches = source.match(expression) || [];
  if (matches.length !== 1) throw new Error('expected exactly one production ' + name + ' constant');
  return source.replace(expression, "let " + name + " = '';" );
}

function buildValuationGoogleSelfTest({ source, runner }) {
  if (typeof source !== 'string' || typeof runner !== 'string') throw new TypeError('source and runner are required strings');
  let bundle = source;
  if ((bundle.match(new RegExp(INHERITED_REPLACEMENT_COMMENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length !== 1) {
    throw new Error('expected inherited valuation replacement comment');
  }
  bundle = bundle.replace(INHERITED_REPLACEMENT_COMMENT, SELFTEST_COMMENT);
  for (const [name, id] of CONSTANTS) bundle = replaceProductionSheetConstant(bundle, name, id);
  if (/const (LOGIN_SHEET_ID|DUTY_SHEET_ID) = /.test(bundle)) throw new Error('unexpected production sheet constant remains');
  return SELFTEST_WARNING + '\n' + bundle + '\n\n' + runner.trim() + '\n';
}

function main(argv) {
  const outputPath = argv[2];
  if (!outputPath) throw new Error('usage: node scripts/build-valuation-google-selftest.cjs <explicit-output-path>');
  const root = path.join(__dirname, '..');
  const output = buildValuationGoogleSelfTest({
    source: fs.readFileSync(path.join(root, 'apps-script', 'valuation', 'Code.gs'), 'utf8'),
    runner: fs.readFileSync(path.join(root, 'test', 'helpers', 'valuation-google-selftest.gs'), 'utf8'),
  });
  fs.writeFileSync(path.resolve(outputPath), output, 'utf8');
}

if (require.main === module) main(process.argv);
module.exports = { buildValuationGoogleSelfTest };
