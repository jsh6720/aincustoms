const test = require('node:test');
const assert = require('node:assert/strict');

async function setup() {
  const Y = await import('yjs');
  const { SharedDocumentSync } = await import('../internal/sync.mjs');
  const rows = [], operations = new Map();
  const api = async (action, value) => {
    if (action === 'sync') {
      const page = rows.filter(row => row.seq > value.after).slice(0, 2);
      return { updates: page, cursor: page.at(-1)?.seq || value.after, hasMore: rows.length > value.after + page.length };
    }
    if (operations.has(value.op_id)) return { seq: operations.get(value.op_id) };
    const seq = rows.length + 1;
    rows.push({ ...value, seq }); operations.set(value.op_id, seq);
    return { seq };
  };
  const make = (request = api) => {
    const doc = new Y.Doc(), statuses = [];
    const sync = new SharedDocumentSync({ doc, request, interval: 0, status: s => statuses.push(s) });
    return { doc, sync, text: doc.getText('body'), statuses };
  };
  return { api, rows, make };
}

test('same-position Korean edits merge on both clients without overwriting', async () => {
  const h = await setup(), a = h.make(), b = h.make();
  await a.sync.tick(); a.text.insert(0, '공유 문서'); await a.sync.tick(); await b.sync.tick();
  a.text.insert(3, '첫째 '); b.text.insert(3, '둘째 ');
  await Promise.all([a.sync.tick(), b.sync.tick()]); await a.sync.tick(); await b.sync.tick();
  assert.equal(a.text.toString(), b.text.toString());
  assert.match(a.text.toString(), /첫째/); assert.match(a.text.toString(), /둘째/);
  assert.equal(a.sync.unsaved, 0); assert.equal(b.sync.unsaved, 0);
});

test('response-loss retries retain the identical operation and do not duplicate text', async () => {
  const h = await setup(); let lost = false; const sent = [];
  const a = h.make(async (action, data) => {
    const result = await h.api(action, data);
    if (action === 'append') { sent.push({ ...data }); if (!lost) { lost = true; throw new Error('response lost'); } }
    return result;
  });
  await a.sync.tick(); a.text.insert(0, '한 번만');
  assert.equal(await a.sync.tick(), false); assert.equal(a.sync.unsaved, 1);
  assert.equal(a.statuses.at(-1).state, 'error');
  await a.sync.tick(); assert.deepEqual(sent[0], sent[1]); assert.equal(h.rows.length, 1);
  const b = h.make(); await b.sync.tick(); assert.equal(b.text.toString(), '한 번만');
});

test('append ACK does not skip an unread earlier remote update', async () => {
  const h = await setup(), a = h.make(), b = h.make();
  await a.sync.tick(); await b.sync.tick(); a.text.insert(0, 'A'); await a.sync.tick();
  b.text.insert(0, 'B'); await b.sync.tick();
  assert.equal(b.sync.cursor, 2); assert.equal(b.text.length, 2);
  await a.sync.tick(); assert.equal(a.text.toString(), b.text.toString());
});

test('remote updates never echo and initial documents remain empty', async () => {
  const h = await setup(), a = h.make(), b = h.make();
  await a.sync.tick(); await b.sync.tick(); assert.equal(h.rows.length, 0);
  a.text.insert(0, '원본'); await a.sync.tick(); await b.sync.tick(); await b.sync.tick();
  assert.equal(h.rows.length, 1); assert.equal(b.sync.unsaved, 0);
});

test('new input during append waits in a separate queue and survives', async () => {
  const h = await setup(); let release;
  const a = h.make(async (action, data) => {
    if (action === 'append' && !release) await new Promise(resolve => { release = resolve; });
    return h.api(action, data);
  });
  await a.sync.tick(); a.text.insert(0, '처음'); const work = a.sync.tick();
  await new Promise(resolve => setImmediate(resolve)); a.text.insert(2, ' 추가'); release(); await work;
  const b = h.make(); await b.sync.tick(); assert.equal(b.text.toString(), '처음 추가');
});

test('pagination applies every update before reporting ready', async () => {
  const h = await setup(), a = h.make(); await a.sync.tick();
  for (let i = 0; i < 7; i++) { a.text.insert(i, String(i)); await a.sync.tick(); }
  const b = h.make(); await b.sync.tick(); assert.equal(b.text.toString(), '0123456'); assert.equal(b.sync.cursor, 7);
});

test('session expiry preserves pending changes and resumes after login', async () => {
  const h = await setup(); let expired = false;
  const a = h.make(async (...args) => { if (expired) throw Object.assign(new Error('로그인 필요'), { status: 401 }); return h.api(...args); });
  await a.sync.tick(); expired = true; a.text.insert(0, '미저장'); await a.sync.tick();
  assert.equal(a.sync.paused, true); assert.equal(a.sync.unsaved, 1); assert.equal(a.statuses.at(-1).state, 'locked');
  expired = false; await a.sync.resume(); assert.equal(a.sync.unsaved, 0); assert.equal(a.text.toString(), '미저장');
});

test('a gap or invalid update cannot move the sync cursor or claim saved', async () => {
  const h = await setup(); const a = h.make(async () => ({ updates: [{ seq: 2, update: 'AA==' }], cursor: 2, hasMore: false }));
  assert.equal(await a.sync.tick(), false); assert.equal(a.sync.cursor, 0); assert.equal(a.sync.ready, false);
  assert.equal(a.statuses.at(-1).state, 'error');
});

test('simultaneous ticks share a request, and close removes the listener', async () => {
  const h = await setup(); let count = 0;
  const a = h.make(async (...args) => { count++; await new Promise(resolve => setImmediate(resolve)); return h.api(...args); });
  await Promise.all([a.sync.tick(), a.sync.tick(), a.sync.tick()]); assert.equal(count, 2);
  a.sync.close(); a.text.insert(0, 'closed'); assert.equal(a.sync.unsaved, 0); assert.equal(await a.sync.tick(), false);
});

test('undoing a large deletion saves the restored document and does not block later edits', async () => {
  const Y = await import('yjs');
  const h = await setup(), a = h.make(), b = h.make();
  const undo = new Y.UndoManager(a.text, { captureTimeout: 0 });
  await a.sync.tick();
  for (let i = 0; i < 4; i++) { a.text.insert(a.text.length, 'x'.repeat(30000)); await a.sync.tick(); }
  a.text.delete(0, a.text.length); await a.sync.tick();
  undo.undo();
  assert.ok(a.sync.queued[0].length > 120000);
  assert.equal(await a.sync.tick(), true); assert.equal(a.sync.unsaved, 0);
  a.text.insert(a.text.length, '완료'); await a.sync.tick(); await b.sync.tick();
  assert.equal(b.text.toString(), 'x'.repeat(120000) + '완료');
  undo.destroy();
});
