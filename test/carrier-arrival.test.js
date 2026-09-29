const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { effectiveArrivalDate, freeTimeExpiry } = require('../lib/cargo-progress-utils');
const { mergeDuplicateCargoCards } = require('../lib/cargo-card-merge');
const { buildArrivalScheduleChangeMail, buildWarehouseChangeMail, mailTextToHtml } = require('../lib/cargo-mail-utils');
const root = path.resolve(__dirname, '..');
const card = { bl_number: 'ONEYBNEG05714600', consignee: '현대코퍼레이션H', destination: '캐틀팜_우육_호주', entry_date: '20260929', eta_date: '2026-10-02', free_time_days: 3 };
const next = { eta_date: '2026-10-01', carrier_arrival_date: '2026-10-01', customs_arrival_date: '2026-09-29', arrival_confirmed_by_customs: true, free_time_days: 3 };

test('only explicit carrier date overrides Customs; old manual ETA does not', () => {
  assert.equal(effectiveArrivalDate(card), '2026-09-29');
  assert.equal(effectiveArrivalDate({ ...card, carrier_arrival_date: next.eta_date }), '2026-10-01');
  assert.equal(freeTimeExpiry({ ...card, carrier_arrival_date: next.eta_date }), '2026-10-03');
  assert.equal(card.entry_date, '20260929');
});

test('carrier notice shows two sources, inclusive expiry, and approved caveat', () => {
  const mail = buildArrivalScheduleChangeMail(card, {}, next);
  assert.match(mail.subject, /^\[입항 스케줄 변경\]/);
  assert.match(mail.text, /입항일: 2026-09-29 \(관세청 전산\)\n\*실제 입항일: 2026-10-01 \(선사 전산\)\n만기일: 2026-10-03/);
  assert.match(mail.text, /※ 관세청 입항일과 실제 선사 일정에 차이가 있어, 실입항일은 선사 확인 기준으로 확인 부탁드립니다\./);
  assert.doesNotMatch(mail.text, /관세청 전산에서 실제 입항이 확인되어/);
  for (const html of [mail.html, mailTextToHtml(mail.text, { highlightChanges: true })]) {
    assert.match(html, /color:#1d4ed8;font-weight:700;[^>]*>\*실제 입항일: 2026-10-01/);
    assert.doesNotMatch(html, /입항일: <strong[^>]*>2026-09-29/);
    assert.match(html, /font-size:9pt/);
  }
});

test('warehouse-only notice retains warehouse focus and both arrival sources', () => {
  const mail = buildWarehouseChangeMail(card, {}, next, { ...next, warehouse_expected_date: '2026-10-04' });
  assert.match(mail.text, /반입예정정보가 변경되어/);
  assert.match(mail.text, /선사 전산/);
  assert.doesNotMatch(mail.text, /선사 전산 기준 실제 입항일을 아래와 같이/);
});

test('matching sources do not produce a discrepancy warning', () => {
  const mail = buildArrivalScheduleChangeMail(card, {}, { ...next, customs_arrival_date: next.eta_date });
  assert.doesNotMatch(mail.text, /※/);
});

test('linked account merge honors newest explicit cancellation', () => {
  const merged = mergeDuplicateCargoCards([
    { ...card, carrier_arrival_date: '2026-10-01', transport_updated_at: '2026-09-29T01:00:00Z' },
    { ...card, carrier_arrival_date: '', transport_updated_at: '2026-09-29T02:00:00Z' },
  ]);
  assert.equal(merged[0].carrier_arrival_date, '');
  assert.equal(effectiveArrivalDate(merged[0]), '2026-09-29');
});

function runtime() {
  const html = fs.readFileSync(path.join(root, 'cargo-dashboard.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\s*bindProgressRequestControls\(\);\s*loadData\(\);\s*$/, '');
  const context = vm.createContext({ console });
  vm.runInContext(script, context);
  return context;
}

test('legacy transport business payload retains the exact existing dedupe shape', () => {
  const source = fs.readFileSync(path.join(root, 'api/cargo-quota.js'), 'utf8');
  const start = source.indexOf('function transportMailPayload(');
  const end = source.indexOf('async function sendWarehouseChangeMail', start);
  const ctx = vm.createContext({});
  vm.runInContext(source.slice(start, end), ctx);
  const old = { eta_date: '2026-10-01', arrival_confirmed_by_customs: false };
  const current = { ...old, carrier_arrival_date: '', customs_arrival_date: '' };
  const recipients = { to: ['test@example.com'], cc: [] };
  const mail = { subject: 'subject', text: 'body' };
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.transportMailPayload(current, current, recipients, mail))),
    { previous: old, next: old, recipients, subject: mail.subject, text: mail.text });
});

test('carrier save-and-send and send-after-save share the actual mail event key', () => {
  const { buildManualMailEventKey } = require('../lib/cargo-mail-dedupe');
  const source = fs.readFileSync(path.join(root, 'api/cargo-quota.js'), 'utf8');
  const start = source.indexOf('function transportMailPayload(');
  const end = source.indexOf('async function sendWarehouseChangeMail', start);
  const ctx = vm.createContext({});
  vm.runInContext(source.slice(start, end), ctx);
  const previous = { ...next, eta_date: '2026-09-29', carrier_arrival_date: '' };
  const recipients = { to: ['test@example.com'], cc: [] };
  const firstMail = buildArrivalScheduleChangeMail(card, previous, next);
  const repeatMail = buildArrivalScheduleChangeMail(card, next, next);
  assert.equal(firstMail.text, repeatMail.text);
  const key = (before, mail) => buildManualMailEventKey({ mailType: 'arrival_schedule_change', accountId: 'test', blNumber: card.bl_number, businessPayload: ctx.transportMailPayload(before, next, recipients, mail) });
  assert.equal(key(previous, firstMail), key(next, repeatMail));
});

test('dashboard refresh keeps carrier date blue with Customs hover and calendar date', () => {
  const ctx = runtime();
  ctx.card = { ...card, carrier_arrival_date: next.eta_date };
  assert.equal(vm.runInContext('etaText(card)', ctx), '2026-10-01');
  assert.equal(vm.runInContext('editableEtaText(card)', ctx), '2026-10-01');
  assert.equal(vm.runInContext('freeTimeExpiryText(card)', ctx), '2026-10-03');
  assert.equal(vm.runInContext('progressConfirmedClass(card,"eta_date")', ctx), ' progress-field-carrier');
  assert.match(vm.runInContext('etaDisplayTitle(card)', ctx), /선사 전산: 2026-10-01\n관세청 전산: 2026-09-29/);
  vm.runInContext('visibleCards = () => [card]', ctx);
  assert.equal(vm.runInContext('progressCalendarEvents().find(e => e.type === "eta").date', ctx), '2026-10-01');
});

test('partial UI save does not clear unrelated flags or dates', () => {
  const ctx = runtime();
  ctx.card = { ...card, carrier_arrival_date: next.eta_date, eta_date: next.eta_date, eta_date_confirmed: true, storage_yard: '강동', obl_received: true };
  vm.runInContext('applyManualFieldsToCard(card,{warehouse_expected_date:"2026-10-04"},null)', ctx);
  assert.equal(ctx.card.carrier_arrival_date, '2026-10-01');
  assert.equal(ctx.card.storage_yard, '강동');
  assert.equal(ctx.card.obl_received, true);
  vm.runInContext('applyManualFieldsToCard(card,{confirm_field:"eta_date",confirmation_action:"unconfirm"}, {eta_date_confirmed:false})', ctx);
  assert.equal(vm.runInContext('etaText(card)', ctx), '2026-09-29');
  assert.equal(vm.runInContext('progressConfirmedClass(card,"eta_date")', ctx), ' progress-field-confirmed');
});

for (const withPatch of [true, false]) {
  test(`arrival edit preserves scanned CIF and other fields with full nullable response (patch=${withPatch})`, () => {
    const ctx = runtime();
    ctx.card = { ...card, delivery_terms: 'CIF', storage_yard: 'Existing yard', warehouse_expected_date: '2026-10-04',
      free_time_days: 7, free_time_expiry_override: '2026-10-08', storage_yard_confirmed: true, obl_received: true };
    ctx.payload = { eta_date: '2026-10-01' };
    ctx.patch = { eta_date: '2026-10-01', eta_date_confirmed: true, free_time_expiry_date: null, free_time_expiry_override: null };
    ctx.saved = { ...ctx.patch, delivery_terms: null, storage_yard: null, warehouse_expected_date: null, free_time_days: 3,
      storage_yard_confirmed: false, obl_received: false };
    vm.runInContext(`applyManualFieldsToCard(card,payload,saved,${withPatch ? 'patch' : 'undefined'})`, ctx);
    assert.equal(ctx.card.delivery_terms, 'CIF');
    assert.equal(ctx.card.storage_yard, 'Existing yard');
    assert.equal(ctx.card.warehouse_expected_date, '2026-10-04');
    assert.equal(ctx.card.free_time_days, 7);
    assert.equal(ctx.card.storage_yard_confirmed, true);
    assert.equal(ctx.card.obl_received, true);
    assert.equal(ctx.card.free_time_expiry_override, '');
    assert.equal(ctx.card.carrier_arrival_date, '2026-10-01');
    assert.equal(ctx.card.entry_date, '20260929');
  });

  test(`warehouse edit preserves carrier date, expiry and CIF (patch=${withPatch})`, () => {
    const ctx = runtime();
    ctx.card = { ...card, delivery_terms: 'CIF', carrier_arrival_date: next.eta_date, eta_date: next.eta_date,
      eta_date_confirmed: true, free_time_expiry_override: '2026-10-09', storage_yard: 'Existing yard' };
    ctx.payload = { warehouse_expected_date: '2026-10-04' };
    ctx.patch = { ...ctx.payload, warehouse_expected_date_confirmed: false };
    ctx.saved = { ...ctx.patch, delivery_terms: null, eta_date: null, eta_date_confirmed: false,
      storage_yard: null, free_time_expiry_override: null };
    vm.runInContext(`applyManualFieldsToCard(card,payload,saved,${withPatch ? 'patch' : 'undefined'})`, ctx);
    assert.equal(ctx.card.warehouse_expected_date, '2026-10-04');
    assert.equal(ctx.card.warehouse_expected_date_confirmed, false);
    assert.equal(ctx.card.delivery_terms, 'CIF');
    assert.equal(ctx.card.carrier_arrival_date, '2026-10-01');
    assert.equal(ctx.card.eta_date, '2026-10-01');
    assert.equal(ctx.card.eta_date_confirmed, true);
    assert.equal(ctx.card.free_time_expiry_override, '2026-10-09');
    assert.equal(ctx.card.storage_yard, 'Existing yard');
  });
}

test('send-only response cannot overwrite effective card fields', () => {
  const ctx = runtime();
  ctx.card = { ...card, delivery_terms: 'CIF', carrier_arrival_date: next.eta_date, storage_yard: 'Existing yard' };
  const before = { ...ctx.card };
  vm.runInContext('applyManualFieldsToCard(card,{send_notification:true},{delivery_terms:null,eta_date:null,eta_date_confirmed:false,storage_yard:null},{})', ctx);
  assert.deepEqual(ctx.card, before);
});

test('explicit edits and clears still apply without altering unrelated fields', () => {
  const ctx = runtime();
  ctx.card = { ...card, delivery_terms: 'CIF', warehouse_expected_date: '2026-10-04' };
  vm.runInContext('applyManualFieldsToCard(card,{delivery_terms:"FOB"},{delivery_terms:"FOB"},{delivery_terms:"FOB"})', ctx);
  assert.equal(ctx.card.delivery_terms, 'FOB');
  vm.runInContext('applyManualFieldsToCard(card,{warehouse_expected_date:""},{warehouse_expected_date:null},{warehouse_expected_date:null,warehouse_expected_date_confirmed:false})', ctx);
  assert.equal(ctx.card.warehouse_expected_date, '');
  assert.equal(ctx.card.delivery_terms, 'FOB');
});
