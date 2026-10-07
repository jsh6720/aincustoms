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
