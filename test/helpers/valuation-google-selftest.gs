const VALUATION_SELFTEST_PRODUCTION_SCRIPT_ID = '1AUaVAdAHmDEZzE0PAne2AiGMZpa72e8kA6blCLZCm6ARdpFTwUctMZ4O';

function selfTestCheck_(label, condition) {
  if (!condition) throw new Error('VALUATION_SELFTEST_FAILED:' + label);
}

function selfTestPost_(data) {
  return JSON.parse(doPost({ parameter: data }).getContent());
}

function runValuationGoogleSelfTest() {
  // This check is intentionally the first Google service call in this entry point.
  if (ScriptApp.getScriptId() === VALUATION_SELFTEST_PRODUCTION_SCRIPT_ID) {
    throw new Error('VALUATION_SELFTEST_REFUSED');
  }
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('VALUATION_SESSION_SECRET') && props.getProperty('VALUATION_SELFTEST_OWNED') !== 'true') {
    throw new Error('VALUATION_SELFTEST_REFUSED');
  }

  const stamp = Utilities.getUuid().slice(0, 8);
  const accountsBook = SpreadsheetApp.create('AIN valuation self-test accounts ' + stamp);
  const dutyBook = SpreadsheetApp.create('AIN valuation self-test declarations ' + stamp);
  const accountsSheet = accountsBook.getActiveSheet();
  const dutySheet = dutyBook.getActiveSheet();
  const masterPassword = Utilities.getUuid() + Utilities.getUuid();
  const customerPassword = ' ' + Utilities.getUuid() + ' ';
  const signingSecret = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();

  LOGIN_SHEET_ID = accountsBook.getId();
  DUTY_SHEET_ID = dutyBook.getId();
  accountsSheet.getRange(1, 1, 3, 3).setValues([
    ['id', 'password', 'company'],
    ['aincustoms', masterPassword, 'AIN'],
    ['self-test-user', customerPassword, '테스트 화주'],
  ]);
  dutySheet.getRange(1, 1, 3, 7).setValues([
    ['company', 'supplier', 'payment', 'trade', 'delivery', 'declaration', 'extra'],
    ['테스트 화주', '초기 공급자', 'TT', '11', 'FOB', '000001', 'EXTRA_COLUMN'],
    ['다른 인공 화주', '격리 공급자', 'TT', '11', 'FOB', '900001', 'OTHER_COMPANY_ONLY'],
  ]);
  dutySheet.getRange(2, 6).setNumberFormat('@');
  props.setProperties({
    VALUATION_SELFTEST_OWNED: 'true',
    VALUATION_SESSION_SECRET: signingSecret,
    VALUATION_LOGIN_TAB_ID: String(accountsSheet.getSheetId()),
    VALUATION_DUTY_TAB_ID: String(dutySheet.getSheetId()),
  });

  let passed = 0;
  const check = function (label, condition) { selfTestCheck_(label, condition); passed++; };
  const unauth = selfTestPost_({ action: 'getDutyData' });
  check('VST_01', unauth.code === 'UNAUTHORIZED');
  const admin = selfTestPost_({ action: 'login', username: 'aincustoms', password: masterPassword });
  check('VST_02', admin.success === true && admin.user.isMaster === true && typeof admin.user.token === 'string');
  const accounts = selfTestPost_({ action: 'getAccountData', token: admin.user.token });
  check('VST_03', accounts.success === true && JSON.stringify(accounts).indexOf(masterPassword) === -1
    && JSON.stringify(accounts).indexOf(customerPassword) === -1);

  const customer = selfTestPost_({ action: 'login', username: 'self-test-user', password: customerPassword });
  const customerDuty = selfTestPost_({ action: 'getDutyData', token: customer.user.token });
  const customerAdmin = selfTestPost_({ action: 'getAccountData', token: customer.user.token });
  check('VST_04', customerDuty.success === true && customerDuty.data.length === 1
    && customerDuty.data[0][0] === '테스트 화주'
    && customerDuty.data.every(function (row) { return row[0] !== '다른 인공 화주'; })
    && customerAdmin.code === 'FORBIDDEN');
  const denied = selfTestPost_({ action: 'deleteDutyRecord', token: customer.user.token, revision: 'x', rowIndex: 0 });
  check('VST_05', denied.code === 'FORBIDDEN');

  const accountEdit = selfTestPost_({ action: 'updateAccount', token: admin.user.token, revision: accounts.revision,
    rowIndex: 1, id: 'self-test-user', company: '변경 회사' });
  check('VST_06', accountEdit.success === true && accountsSheet.getRange(3, 2).getValue() === customerPassword);
  const oldCustomer = selfTestPost_({ action: 'getDutyData', token: customer.user.token });
  check('VST_07', oldCustomer.code === 'UNAUTHORIZED');

  const initialDuty = selfTestPost_({ action: 'getDutyData', token: admin.user.token });
  const formatBefore = dutySheet.getRange(2, 6).getNumberFormat();
  const editedDuty = selfTestPost_({ action: 'updateDutyRecord', token: admin.user.token, revision: initialDuty.revision,
    rowIndex: 0, company: '테스트 화주', supplier: '한국 공급자', payment: 'TT', trade: '11', delivery: 'FOB', declaration: '000001' });
  check('VST_08', editedDuty.success === true && dutySheet.getRange(2, 7).getValue() === 'EXTRA_COLUMN'
    && dutySheet.getRange(2, 6).getNumberFormat() === formatBefore);
  const freshDuty = selfTestPost_({ action: 'getDutyData', token: admin.user.token });
  const literal = selfTestPost_({ action: 'addDutyRecord', token: admin.user.token, revision: freshDuty.revision,
    company: '테스트 화주', supplier: '=1+1', payment: 'TT', trade: '11', delivery: 'FOB', declaration: '000123' });
  const readback = selfTestPost_({ action: 'getDutyData', token: admin.user.token });
  const literalRow = readback.data.filter(function (row) { return row[5] === '000123'; })[0];
  check('VST_09', literal.success === true && literalRow && literalRow[0] === '테스트 화주' && literalRow[1] === '=1+1');
  const stale = selfTestPost_({ action: 'deleteDutyRecord', token: admin.user.token, revision: freshDuty.revision, rowIndex: 0 });
  check('VST_10', stale.code === 'CONFLICT');

  const links = [accountsBook.getUrl(), dutyBook.getUrl()];
  Logger.log('VALUATION_GOOGLE_SELFTEST_PASS count=' + passed + ' files=' + links.join(' ') + ' HTTP_NOT_TESTED');
  return { success: true, passed: passed, createdFiles: links, httpTested: false, marker: 'HTTP_NOT_TESTED' };
}
