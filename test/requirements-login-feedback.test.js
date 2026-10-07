const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../requirements/js/auth.js'), 'utf8');

function harness(reply) {
  const nodes = new Map();
  const storage = new Map();
  let calls = 0;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', disabled: false,
      classList: { add() {}, remove() {} },
      addEventListener(type, callback) { this[type] = callback; },
      querySelector() { return node('submit'); }
    });
    return nodes.get(id);
  };
  const context = {
    console: { error() {}, log() {} },
    window: { addEventListener() {} },
    document: { getElementById: node, addEventListener() {} },
    GoogleSheetsAPI: { login: async () => { calls++; return await reply(); }, clearAllCache() {} },
    sessionStorage: { setItem: (k,v) => storage.set(k,v) },
  };
  vm.createContext(context);
  vm.runInContext(source + ';this.invokeLogin = login;', context);
  return { context, node, storage, calls: () => calls };
}

for (const [code, pattern] of [
  ['UNAUTHORIZED', /아이디 또는 비밀번호/],
  ['RATE_LIMITED', /15분/],
  ['NETWORK_ERROR', /네트워크/],
  ['INTERNAL_ERROR', /서버/],
  ['UPSTREAM_ERROR', /서버/],
  ['FORBIDDEN', /권한/],
]) test(`login feedback distinguishes ${code} without exposing server details`, async () => {
  const h = harness(() => ({ success: false, error_code: code, error: 'PRIVATE_SERVER_DETAIL' }));
  const result = await h.context.invokeLogin('synthetic-user', 'synthetic-password');
  assert.equal(result.success, false);
  assert.match(result.message, pattern);
  assert.doesNotMatch(result.message, /PRIVATE_SERVER_DETAIL/);
  assert.equal(h.storage.size, 0);
});

test('malformed success cannot create a session', async () => {
  const h = harness(() => ({ success: true, user: { username: 'synthetic-user' } }));
  const result = await h.context.invokeLogin('synthetic-user', 'synthetic-password');
  assert.equal(result.success, false);
  assert.equal(h.storage.size, 0);
});

test('login form allows only one pending request and is usable after failure', { timeout: 1000 }, async () => {
  let settle;
  const h = harness(() => new Promise(resolve => { settle = resolve; }));
  const event = { preventDefault() {} };
  const first = h.node('loginForm').submit(event);
  const second = h.node('loginForm').submit(event);
  assert.equal(h.calls(), 1);
  assert.equal(h.node('submit').disabled, true);
  settle({ success: false, error_code: 'UNAUTHORIZED' });
  await Promise.all([first, second]);
  assert.equal(h.node('submit').disabled, false);
  assert.match(h.node('loginError').textContent, /아이디 또는 비밀번호/);
});
