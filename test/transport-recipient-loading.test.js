const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../cargo-dashboard.html'), 'utf8');

function harness() {
  const elements = new Map();
  const requests = [];
  const alerts = [];
  const context = vm.createContext({
    console, alerts,
    alert: message => alerts.push(message),
    document: {
      body: { style: {} },
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { value: '', style: { display: 'none' }, focus() {} });
        return elements.get(id);
      },
    },
    currentUserRole: 'admin',
    currentCards: [
      { account_id: 'a', bl_number: 'BL1' },
      { account_id: 'b', bl_number: 'BL1' },
    ],
    progressWarehouseCard: null, progressWarehouseFocusField: '', progressWarehouseSaving: false,
    progressWarehouseOpenSequence: 0,
    adminMailSettingsLoaded: true,
    adminMailSettings: { shipper_default: { to: ['first@example.com', 'second@example.com'] } },
    esc: x => x, displayConsignee: x => x, editableEtaText: () => '2026-09-17',
    calendarDate: x => x || '', freeTimeExpiryText: () => '', progressFieldConfirmed: () => false,
    addDaysInclusive: () => '',
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({
      payload: JSON.parse(options.body), reject,
      resolve: preview => resolve({ json: async () => ({ success: true, preview }) }),
    })),
  });
  const start = source.indexOf('    function toggleProgressWarehouseGroups(');
  const end = source.indexOf('    async function saveProgressWarehouseEditor(', start);
  vm.runInContext(source.slice(start, end), context);
  return { context, requests, alerts, el: id => context.document.getElementById(id) };
}
const complete = { to: ['first@example.com', 'second@example.com', 'third@example.com', 'fourth@example.com'], cc: ['team@example.com'] };

for (const field of ['eta_date', 'warehouse_expected_date', 'storage_yard']) {
  test(`${field}: first visible editor has complete server recipients`, async () => {
    const h = harness();
    const opening = h.context.openProgressWarehouseEditor(0, field);
    await Promise.resolve();
    assert.equal(h.el('progressWarehouseModalBg').style.display, 'none');
    assert.equal(h.el('progressArrivalMailTo').value, '');
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].payload.mail_type, field === 'eta_date' ? 'arrival' : 'warehouse');
    h.requests[0].resolve(complete);
    await opening;
    assert.equal(h.el('progressWarehouseModalBg').style.display, 'flex');
    assert.equal(h.el('progressArrivalMailTo').value, complete.to.join(','));
    assert.equal(h.el('progressArrivalMailCc').value, complete.cc.join(','));
  });
}

test('failed recipient lookup does not expose partial recipients', async () => {
  const h = harness();
  const opening = h.context.openProgressWarehouseEditor(0, 'eta_date');
  await Promise.resolve();
  h.requests[0].reject(new Error('offline'));
  await opening;
  assert.equal(h.el('progressWarehouseModalBg').style.display, 'none');
  assert.equal(h.el('progressArrivalMailTo').value, '');
  assert.equal(h.alerts.length, 1);
});

test('late response from another account with same BL cannot replace latest recipients', async () => {
  const h = harness();
  const first = h.context.openProgressWarehouseEditor(0, 'eta_date');
  await Promise.resolve();
  const second = h.context.openProgressWarehouseEditor(1, 'warehouse_expected_date');
  await Promise.resolve();
  h.requests[1].resolve(complete);
  await second;
  h.el('progressArrivalMailTo').value = 'edited@example.com';
  h.requests[0].resolve({ to: ['stale@example.com'], cc: [] });
  await first;
  await new Promise(setImmediate);
  assert.equal(h.el('progressArrivalMailTo').value, 'edited@example.com');
});

test('closing during lookup prevents delayed reopening', async () => {
  const h = harness();
  const opening = h.context.openProgressWarehouseEditor(0, 'eta_date');
  await Promise.resolve();
  h.context.closeProgressWarehouseEditor();
  h.requests[0].resolve(complete);
  await opening;
  assert.equal(h.el('progressWarehouseModalBg').style.display, 'none');
});

test('same card reopened for another field ignores the earlier response', async () => {
  const h = harness();
  const first = h.context.openProgressWarehouseEditor(0, 'eta_date');
  const second = h.context.openProgressWarehouseEditor(0, 'warehouse_expected_date');
  h.requests[1].resolve(complete);
  await second;
  h.requests[0].resolve({ to: ['stale@example.com'], cc: [] });
  await first;
  assert.equal(h.el('progressArrivalMailTo').value, complete.to.join(','));
});

test('shipper editing does not depend on administrator recipient lookup', async () => {
  const h = harness();
  h.context.currentUserRole = 'shipper';
  await h.context.openProgressWarehouseEditor(0, 'eta_date');
  assert.equal(h.requests.length, 0);
  assert.equal(h.el('progressWarehouseModalBg').style.display, 'flex');
  assert.equal(h.el('progressArrivalMailRecipientsGroup').style.display, 'none');
});
