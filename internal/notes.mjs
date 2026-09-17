export const LEGACY_NOTE_ID = 'team';
export const MAX_NOTES = 100;
const LEGACY_NOTE = Object.freeze({ id: LEGACY_NOTE_ID, title: '팀 업무 노트', category: '일반', createdAt: null });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

function noteId(value, allowLegacy = true) {
  if (allowLegacy && value === LEGACY_NOTE_ID) return value;
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('올바른 노트 식별자가 아닙니다.');
  return value.toLowerCase();
}

function label(value, field) {
  const isCategory = field === 'category';
  const name = isCategory ? '카테고리' : '노트 제목';
  const limit = isCategory ? 40 : 80;
  if (isCategory && value === undefined) return '일반';
  if (typeof value !== 'string' || CONTROL_CHARACTERS.test(value)) throw new Error(`${name}에 올바른 문자를 입력해 주세요.`);
  const trimmed = value.trim();
  if (isCategory && !trimmed) return '일반';
  if (!trimmed || Array.from(trimmed).length > limit) throw new Error(`${name}은 1~${limit}자까지 입력할 수 있습니다.`);
  return trimmed;
}

function storedLabel(value, field, fallback) {
  try { return label(value, field); } catch { return fallback; }
}

function storedDate(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? value : null;
}

function creationDate(now) {
  const value = typeof now === 'function' ? now() : now;
  if (!(value instanceof Date) && typeof value !== 'number' && typeof value !== 'string') throw new Error('노트 생성 시간을 확인할 수 없습니다.');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('노트 생성 시간을 확인할 수 없습니다.');
  return date.toISOString();
}

function metadata(doc, create = false) {
  // Avoid even registering an empty root during a list operation on an old doc.
  if (!create && !doc.share.has('notes')) return null;
  try { return doc.getMap('notes'); } catch {
    if (!create) return null;
    throw new Error('노트 목록 형식을 확인할 수 없습니다. 복구용 백업을 보관해 주세요.');
  }
}

function readNote(map, id) {
  if (id === LEGACY_NOTE_ID) return {
    ...LEGACY_NOTE,
    title: storedLabel(map?.get(`${id}:title`), 'title', LEGACY_NOTE.title),
    category: storedLabel(map?.get(`${id}:category`), 'category', LEGACY_NOTE.category),
    createdAt: storedDate(map?.get(`${id}:createdAt`)),
  };
  if (!map) return null;
  const title = storedLabel(map.get(`${id}:title`), 'title', null);
  const createdAt = storedDate(map.get(`${id}:createdAt`));
  if (!title || !createdAt) return null;
  return { id, title, category: storedLabel(map.get(`${id}:category`), 'category', '일반'), createdAt };
}

/** Read the shared catalogue without inserting defaults or producing Yjs updates. */
export function listNotes(doc) {
  const map = metadata(doc);
  const notes = [];
  if (map) for (const key of map.keys()) {
    if (typeof key !== 'string' || !key.endsWith(':title')) continue;
    const id = key.slice(0, -6);
    if (!UUID.test(id) || id !== id.toLowerCase()) continue;
    const note = readNote(map, id);
    if (note) notes.push(note);
  }
  notes.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return [readNote(map, LEGACY_NOTE_ID), ...notes];
}

/** Create metadata only; every note's content is its own shared Y.Text. */
export function createNote(doc, { title, category } = {}, { id = crypto.randomUUID(), now = Date.now } = {}) {
  id = noteId(id, false);
  title = label(title, 'title');
  category = label(category, 'category');
  const createdAt = creationDate(now);
  const current = metadata(doc);
  if ((current && [...current.keys()].some(key => typeof key === 'string' && key.startsWith(`${id}:`))) || doc.share.has(`note:${id}`)) {
    throw new Error('이미 존재하는 노트입니다.');
  }
  // This is a client-side limit. Concurrent/offline creations can temporarily
  // exceed it; existing remote notes are never discarded to enforce the limit.
  if (listNotes(doc).length >= MAX_NOTES) throw new Error(`노트는 최대 ${MAX_NOTES}개까지 만들 수 있습니다.`);
  const map = metadata(doc, true);
  doc.transact(() => {
    // Flat fields also merge independent first-time edits of the legacy note.
    // Inserting a separate nested map on each client would lose one whole map.
    map.set(`${id}:title`, title);
    map.set(`${id}:category`, category);
    map.set(`${id}:createdAt`, createdAt);
    doc.getText(`note:${id}`);
  }, 'note-metadata');
  return id;
}

export function updateNote(doc, id, patch = {}) {
  id = noteId(id);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('수정할 노트 정보를 확인해 주세요.');
  const current = metadata(doc);
  if (!readNote(current, id)) throw new Error('선택한 노트를 찾을 수 없습니다.');
  const changes = [];
  for (const field of ['title', 'category']) {
    if (Object.hasOwn(patch, field)) changes.push([field, label(patch[field], field)]);
  }
  if (!changes.length) return;
  const map = metadata(doc, true);
  doc.transact(() => {
    for (const [field, value] of changes) if (map.get(`${id}:${field}`) !== value) map.set(`${id}:${field}`, value);
  }, 'note-metadata');
}

export function getNoteText(doc, id) {
  id = noteId(id);
  if (!readNote(metadata(doc), id)) throw new Error('선택한 노트를 찾을 수 없습니다.');
  return doc.getText(id === LEGACY_NOTE_ID ? 'body' : `note:${id}`);
}
