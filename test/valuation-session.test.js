const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ui = require('../lib/valuation-ui');
const { createGas } = require('./helpers/valuation-gas-harness');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];

function createPage(gas = createGas()) {
  const elements = new Map();
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const classes = new Set();
    const item = { value: '', innerHTML: '', textContent: '', disabled: false,
      style: { display: 'none' }, classList: {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name)
      },
      setAttribute() {}, removeAttribute() {}, addEventListener() {},
      focus() {}, querySelectorAll: () => [], contains: () => false,
      reset() {
        const fields = id === 'accountEditForm' ? ['editAccountId','editAccountCompany','editAccountPassword']
          : ['username','password'];
        fields.forEach(field => { element(field).value = ''; });
      }
    };
    elements.set(id,item); return item;
  }
  const requests = [], timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    ValuationUI: ui, FormData, AbortController, Date: gas.context.Date,
    setTimeout: (callback, delay) => { timers.set(++timerId, {callback,delay}); return timerId; },
    clearTimeout: id => timers.delete(id), console: { error() {}, log() {} },
    confirm: () => true, navigator: {}, window: { addEventListener() {} },
    document: {
      getElementById: element, addEventListener() {}, contains: () => true,
      querySelector: selector => element(selector), querySelectorAll: () => []
    },
    fetch: async (_, options) => {
      const data = Object.fromEntries(options.body.entries());
      requests.push(data);
      return { status: 200, text: async () => JSON.stringify(gas.post(data)) };
    }
  });
  vm.runInContext(script, context);
  const run = code => vm.runInContext(code,context);
  function login(username = 'aincustoms', password = 'test-master-password') {
    context.testUser = gas.login(username,password).user;
    run("currentUserData = ValuationUI.normalizeUser(testUser); document.getElementById('dutyModal').style.display = 'flex';");
  }
  return { gas, context, run, element, requests, login, timers };
}

test('user contract requires a bounded session and strips all password/extra fields', () => {
  const user = { username: 'aincustoms', company: 'AIN', isMaster: true, token: 'signed.token', expiresAt: 12345 };
  assert.deepEqual(ui.normalizeUser({ ...user,password:'secret' }),user);
  assert.equal(ui.normalizeUser({ ...user,token:undefined }),null);
  assert.equal(ui.normalizeUser({ ...user,expiresAt:'bad' }),null);
  assert.equal(ui.normalizeUser({ ...user,token:'x'.repeat(3000) }),null);
});

test('only known error codes are preserved, never arbitrary upstream messages', () => {
  const conflict = ui.parseApiResponse(200,JSON.stringify({success:false,code:'CONFLICT',message:'secret'}),'updateAccount');
  assert.equal(conflict.code,'CONFLICT');
  assert.match(conflict.message,/새로고침/);
  assert.doesNotMatch(conflict.message,/secret/);
  assert.equal(ui.parseApiResponse(200,'{"success":false,"code":"secret"}').code,undefined);
});

test('frontend and real backend read and edit account without supplying any client master authority', async () => {
  const page = createPage(); page.login();
  await page.context.loadAccountData();
  assert.equal(page.run('allAccountData.length'),3);
  assert.ok(page.run('accountRevision'));
  assert.equal(page.requests[0].token,page.context.testUser.token);
  assert.equal(page.requests[0].isMaster,undefined);
  page.context.editAccount(1);
  page.element('editAccountCompany').value = '변경화주';
  await page.context.saveAccountEdit({preventDefault() {}});
  assert.equal(page.gas.accounts[2][2],'변경화주');
  assert.equal(page.gas.accounts[2][1],'test-client-password');
  const request = page.requests.find(item=>item.action==='updateAccount');
  assert.ok(request.revision); assert.equal(request.password,undefined);
  assert.equal(page.element('editAccountPassword').value,'');
});

test('exact new password is preserved through frontend create and backend login', async () => {
  const page = createPage(); page.login(); await page.context.loadAccountData();
  page.element('newAccountId').value = 'new-client';
  page.element('newAccountCompany').value = '새화주';
  page.element('newAccountPw').value = '  =literal-secret  ';
  await page.context.addNewAccount();
  assert.equal(page.gas.login('new-client','  =literal-secret  ').success,true);
  assert.equal(page.element('newAccountPw').value,'');
});

test('duty read revision is sent on mutation and authoritative reload keeps new data', async () => {
  const page = createPage(); page.login(); await page.context.loadDutyData();
  assert.equal(page.run('allDutyData.length'),3);
  for (const [id,value] of Object.entries({
    newCompany:'새화주',newSupplier:'C',newPayment:'TT',newTrade:'11',newDelivery:'FOB',newDeclaration:'00999'
  })) page.element(id).value=value;
  await page.context.addNewDutyRecord();
  assert.equal(page.gas.duties.length,5);
  assert.equal(page.run('allDutyData.length'),4);
  assert.ok(page.requests.find(item=>item.action==='addDutyRecord').revision);
});

test('an editor opened before a refresh retains its old revision and cannot overwrite a shifted row', async () => {
  const page = createPage(); page.login(); await page.context.loadAccountData();
  page.context.editAccount(1);
  page.gas.accounts.splice(2,1);
  await page.context.loadAccountData();
  page.element('editAccountCompany').value='wrong-target';
  await page.context.saveAccountEdit({preventDefault() {}});
  assert.equal(page.gas.accounts[2][2],'다른회사');
  assert.equal(page.gas.writes.length,0);
  assert.match(page.element('toast').textContent,/새로고침/);
});

test('expired session clears sensitive DOM, caches and forms then shows login without any API call', async () => {
  const page = createPage(); page.login(); await page.context.loadAccountData();
  page.element('newAccountPw').value='unsaved-secret';
  page.element('dutyResultsBody').innerHTML='private duties';
  page.element('accountResultsBody').innerHTML='private accounts';
  page.run("autocompleteCache.companies=['private'];");
  const count = page.requests.length; page.gas.advance(9*60*60*1000);
  const result=await page.context.callAPI('getDutyData');
  assert.equal(result.success,false); assert.equal(page.requests.length,count);
  assert.equal(page.run('currentUserData'),null);
  assert.equal(page.element('newAccountPw').value,'');
  assert.equal(page.element('dutyResultsBody').innerHTML,'');
  assert.equal(page.element('accountResultsBody').innerHTML,'');
  assert.equal(page.run('autocompleteCache.companies.length'),0);
  assert.equal(page.element('loginModal').style.display,'flex');
});

test('server-side account revocation invalidates only the current session', async () => {
  const page=createPage(); page.login();
  page.gas.accounts[1][1]='changed';
  const response=await page.context.callAPI('getDutyData');
  assert.equal(response.code,'UNAUTHORIZED');
  assert.equal(page.run('currentUserData'),null);
});

test('late unauthorized response from previous login cannot log out a new user', async () => {
  const page=createPage(); page.login();
  let release;
  page.context.fetch=async()=>new Promise(resolve=>{ release=()=>resolve({
    status:200,text:async()=>JSON.stringify({success:false,code:'UNAUTHORIZED'})
  }); });
  const pending=page.context.callAPI('getDutyData');
  page.context.closeModal('dutyModal');
  page.login('youngin','test-client-password');
  release(); await pending;
  assert.equal(page.run('currentUserData.username'),'youngin');
});

test('login sends no session token or client authority and logout clears identity', async () => {
  const page=createPage(); page.login();
  const result=await page.context.callAPI('login',{
    username:'youngin',password:'test-client-password',token:'forged',isMaster:true,action:'deleteAccount'
  });
  assert.equal(result.success,true);
  assert.deepEqual(Object.keys(page.requests[0]).sort(),['action','password','username']);
  page.context.logout();
  assert.equal(page.element('currentUser').textContent,'');
  assert.equal(page.element('currentCompany').textContent,'');
});

test('blank legacy company is visible to administrator for correction without exposing credentials', () => {
  assert.deepEqual(ui.sanitizeAccountRows([{id:'legacy',company:'',rowIndex:3}]),[
    {id:'legacy',company:'',originalIndex:3}
  ]);
});

test('idle login expires and clears visible private content without another API request', async () => {
  const page=createPage();
  page.element('loginModal').style.display='flex';
  page.element('username').value='aincustoms';
  page.element('password').value='test-master-password';
  await page.context.handleLogin({preventDefault() {}});
  await new Promise(resolve=>setImmediate(resolve));
  const expiry=[...page.timers.values()].find(timer=>timer.delay===8*60*60*1000);
  assert.ok(expiry,'login must schedule expiry, even when idle');
  const count=page.requests.length;
  page.gas.advance(8*60*60*1000);
  expiry.callback();
  assert.equal(page.run('currentUserData'),null);
  assert.equal(page.element('dutyResultsBody').innerHTML,'');
  assert.equal(page.element('accountResultsBody').innerHTML,'');
  assert.equal(page.requests.length,count);
});

test('filtering or reloading a duty table ends the replaced edit state instead of blocking future edits', async () => {
  const page=createPage(); page.login(); await page.context.loadDutyData();
  page.run("editingRowIndex=1; editingOriginalData=['old']; editingDutyRevision=dutyRevision;");
  page.context.applyFilters();
  assert.equal(page.run('editingRowIndex'),-1);
  assert.equal(page.run('editingDutyRevision'),'');
  page.run("editingRowIndex=1; editingOriginalData=['old']; editingDutyRevision=dutyRevision;");
  await page.context.loadDutyData();
  assert.equal(page.run('editingRowIndex'),-1);
  assert.equal(page.run('editingOriginalData'),null);
});
