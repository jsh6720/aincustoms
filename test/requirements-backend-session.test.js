const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../requirements/apps-script/Code.gs'), 'utf8');
const NOW = 1780000000000;

test('ContentService redirect back to exec without POST body is transport failure, not rejected session', () => {
  const {context}=harness();
  const bounced=context.doGet({parameter:{_ainRequest:'synthetic-request-id'}});
  assert.equal(bounced.success,false);
  assert.equal(bounced.error_code,'REQUEST_INCOMPLETE');
  assert.equal('data' in bounced,false);
  const unauthorized=context.doPost({postData:{contents:JSON.stringify({action:'getData',tableName:'chemical_confirmation'})}});
  assert.equal(unauthorized.error_code,'UNAUTHORIZED','missing token on a complete request still grants no access');
});
function harness() {
  const context = {
    Date: {now: () => NOW + 1},
    Logger: {log() {}},
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'synthetic-unit-signing-key' }) },
    Utilities: {
      Charset: { UTF_8: 'utf8' },
      base64EncodeWebSafe: value => Buffer.from(value).toString('base64url'),
      base64DecodeWebSafe: value => Array.from(Buffer.from(value, 'base64url')),
      computeHmacSha256Signature: (value, key) => Array.from(crypto.createHmac('sha256',key).update(value).digest())
    },
    ContentService: { MimeType:{JSON:'application/json'}, createTextOutput: text => ({setMimeType: () => JSON.parse(text)}) }
  };
  vm.createContext(context);
  vm.runInContext(source,context);
  context.loadAuthoritativeUser = () => ({username:'qa',active:true,auth_version:1});
  const token = context.createSessionToken('qa',1,NOW);
  return {context,token};
}
test('valid token succeeds but expired, changed and revoked tokens remain rejected', () => {
  const {context,token} = harness();
  assert.equal(context.verifySessionToken(token,NOW+1).ok,true);
  assert.equal(context.verifySessionToken(token,NOW+8*60*60*1000).error_code,'UNAUTHORIZED');
  assert.equal(context.verifySessionToken(token+'.extra',NOW+1).error_code,'UNAUTHORIZED');
  assert.equal(context.verifySessionToken('A=.A=',NOW+1).error_code,'UNAUTHORIZED');
  assert.equal(context.verifySessionToken(token.slice(0,-2)+'XX',NOW+1).error_code,'UNAUTHORIZED');
  context.loadAuthoritativeUser = () => ({active:true,auth_version:2});
  assert.equal(context.verifySessionToken(token,NOW+1).error_code,'UNAUTHORIZED');
  context.loadAuthoritativeUser = () => ({active:false,auth_version:1});
  assert.equal(context.verifySessionToken(token,NOW+1).error_code,'UNAUTHORIZED');
});
for (const stage of ['property','signature','decode','user lookup']) {
  test(`temporary ${stage} service errors must not masquerade as invalid credentials`, () => {
    const {context,token} = harness();
    const unavailable = () => { throw new Error('temporary service outage'); };
    if (stage === 'property') context.PropertiesService.getScriptProperties = unavailable;
    if (stage === 'signature') context.Utilities.computeHmacSha256Signature = unavailable;
    if (stage === 'decode') context.Utilities.base64DecodeWebSafe = unavailable;
    if (stage === 'user lookup') context.loadAuthoritativeUser = unavailable;
    assert.throws(() => context.verifySessionToken(token,NOW+1), /temporary service outage/);
    const response = context.handleRequest({postData:{contents:JSON.stringify({action:'getData',tableName:'msds',token})}});
    assert.equal(response.error_code,'INTERNAL_ERROR');
    assert.equal(response.success,false);
  });
}

test('search returns only matching rows per table, authorized and normalized like the client', () => {
  const {context,token} = harness();
  const sheets = {
    AIN_Review_Needed: [['id','spec_no','description','importer'],['1','STD72110-01','SOLEIL STANDARD','영인에스티(주)'],['2','OTHER-1','x','영인에스티(주)'],['3','STD 72110-02','y','타사']],
    AIN_Chemical_Confirmation: [['id','spec_no','company'],['9','ABC','영인에스티(주)']],
  };
  const property = context.requireScriptProperty;
  context.requireScriptProperty = name => name === "ACTIVE_SPREADSHEET_ID" ? "sheet-id" : property(name);
  context.SpreadsheetApp = {openById: () => ({getSheetByName: name => {
    if (name === 'AIN_MSDS') throw new Error('quota');
    const values = sheets[name] || [['id','spec_no']];
    return {getDataRange: () => ({getValues: () => values})};
  }})};
  context.loadAuthoritativeUser = () => ({username:'qa',active:true,auth_version:1,role:'user',company_name:'영인에스티'});
  const response = context.handleRequest({postData:{contents:JSON.stringify({action:'search',query:'72110',token})}});
  assert.equal(response.success,true);
  assert.deepEqual(response.results.review_needed.map(r => r.spec_no),['STD72110-01']);
  assert.deepEqual(response.results.chemical_confirmation,[]);
  assert.deepEqual(Array.from(response.failed),['msds']);
  assert.equal(context.handleRequest({postData:{contents:JSON.stringify({action:'search',query:' - ',token})}}).error_code,'INVALID_QUERY');
  assert.equal(context.handleRequest({postData:{contents:JSON.stringify({action:'search',query:'72110'})}}).error_code,'UNAUTHORIZED');
});

test('rejected tokens log only which check failed, never the token', () => {
  const {context,token} = harness();
  const logs = [];
  context.Logger.log = line => logs.push(line);
  context.loadAuthoritativeUser = () => ({username:'qa',active:true,auth_version:2});
  assert.equal(context.verifySessionToken(token,NOW+1).error_code,'UNAUTHORIZED');
  assert.equal(context.verifySessionToken(token.slice(0,-2)+'XX',NOW+1).error_code,'UNAUTHORIZED');
  assert.deepEqual(logs,['UNAUTHORIZED auth_version','UNAUTHORIZED signature']);
  assert.ok(logs.every(line => !line.includes(token.split('.')[0])));
});

test('stats returns per-table authorized counts and isolates sheet failures', () => {
  const {context,token} = harness();
  const property = context.requireScriptProperty;
  context.requireScriptProperty = name => name === "ACTIVE_SPREADSHEET_ID" ? "sheet-id" : property(name);
  context.SpreadsheetApp = {openById: () => ({getSheetByName: name => {
    if (name === 'AIN_MSDS') throw new Error('quota');
    const values = name === 'AIN_Radio_Law'
      ? [['id','consignee'],['1','영인에스티(주)'],['2','타사'],['3','영인과학(주)']]
      : [['id','importer']];
    return {getDataRange: () => ({getValues: () => values})};
  }})};
  context.loadAuthoritativeUser = () => ({username:'qa',active:true,auth_version:1,role:'user',company_name:'영인에스티'});
  const response = context.handleRequest({postData:{contents:JSON.stringify({action:'stats',token})}});
  assert.equal(response.success,true);
  assert.equal(response.counts.radio_law,2);
  assert.equal(response.counts.msds,null);
  assert.equal(response.counts.chemical_confirmation,0);
  assert.equal('data' in response,false);
});
