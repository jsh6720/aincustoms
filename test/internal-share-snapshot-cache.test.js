const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const KEY = Buffer.alloc(32, 7).toString('base64url');
const WRONG_KEY = Buffer.alloc(32, 8).toString('base64url');
const ORIGIN = 'https://note.example.test';

async function setup(options = {}) {
  const Y = await import('yjs');
  const { createSnapshotCache, SNAPSHOT_STORAGE_KEY } = await import('../internal/snapshot-cache.mjs');
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const snapshot = (text = '비공개 최근 저장 내용', cursor = 12) => {
    const doc = new Y.Doc(); doc.getText('body').insert(0, text);
    const update = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'); doc.destroy();
    return { cursor, update, activeNoteId: 'team' };
  };
  const cache = createSnapshotCache({ storage, crypto: webcrypto, origin: ORIGIN, ...options });
  return { Y, createSnapshotCache, cache, storage, values, snapshot, name: SNAPSHOT_STORAGE_KEY };
}
function gatedCrypto(operation) {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let count = 0;
  const subtle = new Proxy(webcrypto.subtle, {
    get(target, property) {
      if (property === operation) return async (...args) => {
        if (++count === 1) { entered(); await gate; }
        return target[property](...args);
      };
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { crypto: { subtle, getRandomValues: values => webcrypto.getRandomValues(values) }, started, release };
}

test('cache stores only ciphertext and restores a complete Yjs snapshot with fresh IVs', async () => {
  const h = await setup(), saved = h.snapshot();
  assert.equal(await h.cache.save(KEY, saved), true);
  const stored = h.values.get(h.name), envelope = JSON.parse(stored);
  assert.deepEqual(Object.keys(envelope).sort(), ['ciphertext', 'format', 'iv']);
  for (const secret of [KEY, saved.update, '비공개 최근 저장 내용', 'activeNoteId', 'cursor']) assert.equal(stored.includes(secret), false);
  const restored = await h.cache.load(KEY);
  assert.deepEqual(restored, { format: h.name, ...saved });
  const doc = new h.Y.Doc(); h.Y.applyUpdate(doc, Buffer.from(restored.update, 'base64'));
  assert.equal(doc.getText('body').toString(), '비공개 최근 저장 내용'); doc.destroy();
  await h.cache.save(KEY, saved);
  assert.notEqual(JSON.parse(h.values.get(h.name)).iv, envelope.iv);
});
test('wrong password key, ciphertext tampering, and a different origin fail closed', async () => {
  const h = await setup(); await h.cache.save(KEY, h.snapshot());
  assert.equal(await h.cache.load(WRONG_KEY), null); assert.equal(h.values.has(h.name), false);
  await h.cache.save(KEY, h.snapshot());
  const envelope = JSON.parse(h.values.get(h.name));
  envelope.ciphertext = (envelope.ciphertext.startsWith('A') ? 'B' : 'A') + envelope.ciphertext.slice(1);
  h.values.set(h.name, JSON.stringify(envelope));
  assert.equal(await h.cache.load(KEY), null); assert.equal(h.values.has(h.name), false);
  await h.cache.save(KEY, h.snapshot());
  const other = h.createSnapshotCache({ storage: h.storage, crypto: webcrypto, origin: 'https://other.example.test' });
  assert.equal(await other.load(KEY), null);
});
test('invalid cursors, note identifiers, keys, oversized updates and trailing Yjs bytes are rejected', async () => {
  const h = await setup(), valid = h.snapshot();
  for (const patch of [
    { cursor: -1 }, { cursor: 1.5 }, { cursor: Number.MAX_SAFE_INTEGER + 1 }, { cursor: '12' },
    { activeNoteId: 'not-a-note-id' }, { format: 'wrong-format' }, { update: 'AA==' },
    { update: Buffer.concat([Buffer.from(valid.update, 'base64'), Buffer.from([0])]).toString('base64') },
    { update: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') },
  ]) assert.equal(await h.cache.save(KEY, { ...valid, ...patch }), false);
  for (const key of ['', KEY + '=', 'bad-key', Buffer.alloc(31).toString('base64url')]) assert.equal(await h.cache.save(key, valid), false);
  assert.equal(h.values.size, 0);
  assert.equal(await h.cache.save(KEY, { ...valid, cursor: Number.MAX_SAFE_INTEGER, activeNoteId: '556bd708-f15f-43a1-a73b-f2ae3a624876' }), true);
});
test('corrupt, malformed, or oversized stored envelopes are discarded without throwing', async () => {
  const h = await setup();
  for (const value of ['{', 'null', '{}', 'x'.repeat(4 * 1024 * 1024 + 257), JSON.stringify({ format: h.name, iv: '', ciphertext: '' })]) {
    h.values.set(h.name, value);
    assert.equal(await h.cache.load(KEY), null); assert.equal(h.values.has(h.name), false);
  }
});
test('storage exceptions and unsupported crypto remain optional cache misses', async () => {
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } };
  const h = await setup({ storage: denied });
  assert.equal(await h.cache.load(KEY), null); assert.equal(await h.cache.save(KEY, h.snapshot()), false); assert.equal(h.cache.clear(), false);
  const unsupported = await setup({ crypto: undefined });
  assert.equal(await unsupported.cache.load(KEY), null); assert.equal(await unsupported.cache.save(KEY, unsupported.snapshot()), false);
});
test('clear cancels an in-flight encryption so logout cannot recreate a saved copy', async () => {
  const gated = gatedCrypto('encrypt'), h = await setup({ crypto: gated.crypto });
  const pending = h.cache.save(KEY, h.snapshot()); await gated.started;
  assert.equal(h.cache.clear(), true); gated.release();
  assert.equal(await pending, false); assert.equal(h.values.size, 0);
});
test('a later save wins even when older encryption finishes last', async () => {
  const gated = gatedCrypto('encrypt'), h = await setup({ crypto: gated.crypto });
  const older = h.cache.save(KEY, h.snapshot('old', 1)); await gated.started;
  assert.equal(await h.cache.save(KEY, h.snapshot('new', 2)), true); gated.release();
  assert.equal(await older, false); assert.equal((await h.cache.load(KEY)).cursor, 2);
});
test('an old failed decryption cannot delete a newer saved copy', async () => {
  const gated = gatedCrypto('decrypt'), h = await setup({ crypto: gated.crypto });
  await h.cache.save(KEY, h.snapshot('old', 1));
  const older = h.cache.load(WRONG_KEY); await gated.started;
  await h.cache.save(KEY, h.snapshot('new', 2)); gated.release();
  assert.equal(await older, null); assert.equal((await h.cache.load(KEY)).cursor, 2);
});
test('a second tab replacement survives an older failed decryption', async () => {
  const gated = gatedCrypto('decrypt'), h = await setup({ crypto: gated.crypto });
  await h.cache.save(KEY, h.snapshot('old', 1));
  const older = h.cache.load(WRONG_KEY); await gated.started;
  const sibling = h.createSnapshotCache({ storage: h.storage, crypto: webcrypto, origin: ORIGIN });
  await sibling.save(KEY, h.snapshot('new', 2)); gated.release();
  assert.equal(await older, null); assert.equal((await h.cache.load(KEY)).cursor, 2);
});
test('save captures a matching cursor and document before awaiting encryption', async () => {
  const gated = gatedCrypto('encrypt'), h = await setup({ crypto: gated.crypto });
  const snapshot = h.snapshot('original', 1), update = snapshot.update;
  const pending = h.cache.save(KEY, snapshot); await gated.started;
  Object.assign(snapshot, h.snapshot('later', 99)); gated.release();
  assert.equal(await pending, true);
  const restored = await h.cache.load(KEY); assert.equal(restored.cursor, 1); assert.equal(restored.update, update);
});
