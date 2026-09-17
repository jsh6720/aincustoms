import * as Y from 'yjs';

export const SNAPSHOT_STORAGE_KEY = 'ain-note-snapshot-v1';
const MAX_UPDATE_BYTES = 2 * 1024 * 1024;
const MAX_CIPHERTEXT_BYTES = 3 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = MAX_CIPHERTEXT_BYTES - 16;
const MAX_STORED_CHARACTERS = Math.ceil(MAX_CIPHERTEXT_BYTES / 3) * 4 + 256;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function encode(bytes, url = false) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  const value = btoa(text);
  return url ? value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : value;
}
function decode(value, limit, url = false) {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(limit / 3) * 4) throw new Error('Invalid encoding');
  if (!(url ? /^[A-Za-z0-9_-]+$/ : /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).test(value)) throw new Error('Invalid encoding');
  const bytes = Uint8Array.from(atob(url ? value.replace(/-/g, '+').replace(/_/g, '/') : value), character => character.charCodeAt(0));
  if (bytes.length > limit || encode(bytes, url) !== value) throw new Error('Invalid encoding');
  return bytes;
}
function validateSnapshot(value, requireFormat = true) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (requireFormat ? value.format !== SNAPSHOT_STORAGE_KEY : value.format !== undefined && value.format !== SNAPSHOT_STORAGE_KEY) ||
      !Number.isSafeInteger(value.cursor) || value.cursor < 0 ||
      typeof value.activeNoteId !== 'string' || (value.activeNoteId !== 'team' && !UUID.test(value.activeNoteId))) throw new Error('Invalid snapshot');
  const bytes = decode(value.update, MAX_UPDATE_BYTES);
  let consumed;
  class CompleteUpdateDecoder extends Y.UpdateDecoderV1 {
    constructor(decoder) { super(decoder); consumed = decoder; }
  }
  Y.decodeUpdateV2(bytes, CompleteUpdateDecoder);
  if (!consumed || consumed.pos !== bytes.length) throw new Error('Invalid update');
  return { format: SNAPSHOT_STORAGE_KEY, cursor: value.cursor, update: value.update, activeNoteId: value.activeNoteId };
}

// The caller supplies a fresh server-authenticated key for each load. This module
// never stores that key and cannot authorize a session or enable offline editing.
export function createSnapshotCache({ storage, crypto, origin } = {}) {
  let generation = 0;
  const available = () => storage && crypto?.subtle && typeof crypto.getRandomValues === 'function' && typeof origin === 'string' && origin.length > 0 && origin.length <= 2048;
  const additionalData = () => new TextEncoder().encode(`${SNAPSHOT_STORAGE_KEY}:${origin}`);
  async function importKey(value) {
    const bytes = decode(value, 32, true);
    if (bytes.length !== 32) throw new Error('Invalid key');
    return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }
  function discard(mine, original) {
    // An older failure must not remove a replacement from this cache or another tab.
    try {
      if (mine === generation && typeof original === 'string' && storage.getItem(SNAPSHOT_STORAGE_KEY) === original) storage.removeItem(SNAPSHOT_STORAGE_KEY);
    } catch { /* Cache failure never prevents server-backed loading. */ }
  }
  return {
    async load(key) {
      const mine = generation;
      let original;
      try {
        if (!available()) return null;
        original = storage.getItem(SNAPSHOT_STORAGE_KEY);
        if (original === null) return null;
        if (typeof original !== 'string' || original.length > MAX_STORED_CHARACTERS) throw new Error('Invalid cache');
        const envelope = JSON.parse(original);
        if (!envelope || envelope.format !== SNAPSHOT_STORAGE_KEY || Object.keys(envelope).length !== 3) throw new Error('Invalid cache');
        const iv = decode(envelope.iv, 12, true), ciphertext = decode(envelope.ciphertext, MAX_CIPHERTEXT_BYTES);
        if (iv.length !== 12 || ciphertext.length <= 16) throw new Error('Invalid cache');
        const imported = await importKey(key);
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: additionalData() }, imported, ciphertext);
        if (plaintext.byteLength > MAX_PAYLOAD_BYTES) throw new Error('Invalid cache');
        const result = validateSnapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)));
        if (mine !== generation || storage.getItem(SNAPSHOT_STORAGE_KEY) !== original) return null;
        return result;
      } catch { discard(mine, original); return null; }
    },
    async save(key, snapshot) {
      const mine = ++generation;
      try {
        if (!available()) return false;
        // Copy before awaiting crypto so cursor and document always match.
        const payload = new TextEncoder().encode(JSON.stringify(validateSnapshot(snapshot, false)));
        if (payload.byteLength > MAX_PAYLOAD_BYTES) return false;
        const imported = await importKey(key);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: additionalData() }, imported, payload);
        if (encrypted.byteLength > MAX_CIPHERTEXT_BYTES || mine !== generation) return false;
        const envelope = JSON.stringify({ format: SNAPSHOT_STORAGE_KEY, iv: encode(iv, true), ciphertext: encode(new Uint8Array(encrypted)) });
        if (envelope.length > MAX_STORED_CHARACTERS) return false;
        storage.setItem(SNAPSHOT_STORAGE_KEY, envelope);
        return true;
      } catch { return false; }
    },
    clear() {
      generation++;
      try { storage.removeItem(SNAPSHOT_STORAGE_KEY); return true; } catch { return false; }
    },
  };
}
