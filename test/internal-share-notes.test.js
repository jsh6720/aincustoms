const test = require('node:test');
const assert = require('node:assert/strict');

const FIRST = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
const CREATED = '2026-09-17T01:00:00.000Z';

async function setup() {
  const Y = await import('yjs');
  const notes = await import('../internal/notes.mjs');
  return { Y, ...notes, doc: new Y.Doc() };
}

function exchange(Y, a, b) {
  const fromA = Y.encodeStateAsUpdate(a), fromB = Y.encodeStateAsUpdate(b);
  Y.applyUpdate(a, fromB); Y.applyUpdate(b, fromA);
}

test('legacy body stays the same shared text and listing never inserts defaults', async () => {
  const { Y, doc, listNotes, getNoteText, updateNote } = await setup();
  const body = doc.getText('body');
  body.insert(0, '기존 업무 내용\n원본 보존');
  const before = Y.encodeStateAsUpdate(doc);
  let writes = 0; doc.on('update', () => writes++);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(listNotes(doc), [{ id: 'team', title: '팀 업무 노트', category: '일반', createdAt: null }]);
    assert.equal(getNoteText(doc, 'team'), body);
  }
  assert.equal(writes, 0);
  assert.equal(doc.share.has('notes'), false);
  assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
  updateNote(doc, 'team', { title: '기존 문서', category: '통관' });
  assert.equal(getNoteText(doc, 'team'), body);
  assert.equal(body.toString(), '기존 업무 내용\n원본 보존');
  assert.equal(listNotes(doc)[0].category, '통관');
});

test('creating a note is atomic, trims labels and separates every note body', async () => {
  const { doc, createNote, listNotes, getNoteText } = await setup();
  let writes = 0;
  const snapshots = [];
  doc.on('update', () => { writes++; snapshots.push(listNotes(doc)); });
  assert.equal(createNote(doc, { title: '  검역 준비  ', category: '  수입  ' }, { id: FIRST, now: CREATED }), FIRST);
  assert.equal(writes, 1);
  assert.deepEqual(snapshots[0][1], { id: FIRST, title: '검역 준비', category: '수입', createdAt: CREATED });
  createNote(doc, { title: '회의 기록', category: '   ' }, { id: SECOND, now: () => new Date(CREATED) });
  assert.equal(listNotes(doc)[2].category, '일반');
  getNoteText(doc, 'team').insert(0, '기존');
  getNoteText(doc, FIRST).insert(0, '첫 노트');
  getNoteText(doc, SECOND).insert(0, '둘째 노트');
  assert.deepEqual(listNotes(doc).map(note => getNoteText(doc, note.id).toString()), ['기존', '첫 노트', '둘째 노트']);
  assert.equal(getNoteText(doc, FIRST), doc.getText(`note:${FIRST}`));
});

test('independent first edits of legacy metadata merge without replacing either field', async () => {
  const { Y, doc: a, listNotes, updateNote } = await setup();
  const b = new Y.Doc();
  updateNote(a, 'team', { title: '공유 업무' });
  updateNote(b, 'team', { category: '운영' });
  exchange(Y, a, b);
  assert.deepEqual(listNotes(a), listNotes(b));
  assert.equal(listNotes(a)[0].title, '공유 업무');
  assert.equal(listNotes(a)[0].category, '운영');
});

test('concurrent metadata and content edits converge across notes and retain legacy data', async () => {
  const { Y, doc: a, createNote, listNotes, updateNote, getNoteText } = await setup();
  getNoteText(a, 'team').insert(0, '원문');
  createNote(a, { title: '준비' }, { id: FIRST, now: CREATED });
  createNote(a, { title: '확인' }, { id: SECOND, now: CREATED });
  getNoteText(a, FIRST).insert(0, '공유');
  const b = new Y.Doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  updateNote(a, FIRST, { title: '준비 완료' });
  updateNote(b, FIRST, { category: '검역' });
  getNoteText(a, FIRST).insert(2, ' 첫째');
  getNoteText(b, FIRST).insert(2, ' 둘째');
  getNoteText(a, SECOND).insert(0, '독립 본문');
  getNoteText(b, 'team').insert(2, ' 유지');
  exchange(Y, a, b);
  assert.deepEqual(listNotes(a), listNotes(b));
  assert.equal(listNotes(a)[1].title, '준비 완료');
  assert.equal(listNotes(a)[1].category, '검역');
  for (const id of ['team', FIRST, SECOND]) assert.equal(getNoteText(a, id).toString(), getNoteText(b, id).toString());
  assert.match(getNoteText(a, FIRST).toString(), /첫째/);
  assert.match(getNoteText(a, FIRST).toString(), /둘째/);
  assert.equal(getNoteText(a, SECOND).toString(), '독립 본문');
  assert.equal(getNoteText(a, 'team').toString(), '원문 유지');
  assert.equal(getNoteText(b, 'team'), b.getText('body'));
});

test('read operations on synced and malformed metadata never emit writes', async () => {
  const { Y, doc, createNote, listNotes, getNoteText } = await setup();
  createNote(doc, { title: '유효한 노트' }, { id: FIRST, now: CREATED });
  const map = doc.getMap('notes');
  map.set('team:title', { invalid: true }); map.set('team:category', '\n');
  map.set('invalid:title', '잘못된 식별자');
  map.set(`${SECOND}:title`, ['잘못된 제목']); map.set(`${SECOND}:createdAt`, CREATED);
  map.set(`${UNKNOWN}:title`, '잘못된 날짜'); map.set(`${UNKNOWN}:createdAt`, 'yesterday');
  const remote = new Y.Doc(); Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  const before = Y.encodeStateAsUpdate(remote);
  let writes = 0; remote.on('update', () => writes++);
  assert.deepEqual(listNotes(remote).map(note => note.id), ['team', FIRST]);
  assert.equal(listNotes(remote)[0].title, '팀 업무 노트');
  assert.equal(listNotes(remote)[0].category, '일반');
  getNoteText(remote, FIRST);
  assert.throws(() => getNoteText(remote, UNKNOWN), /찾을 수 없습니다/);
  assert.equal(writes, 0); assert.deepEqual(Y.encodeStateAsUpdate(remote), before);
  const wrongRoot = new Y.Doc(); wrongRoot.getText('notes').insert(0, 'unexpected');
  assert.deepEqual(listNotes(wrongRoot).map(note => note.id), ['team']);
});

test('invalid labels, IDs, unknown notes and duplicate creates never change existing data', async () => {
  const { Y, doc, createNote, updateNote, getNoteText, listNotes } = await setup();
  createNote(doc, { title: '유효', category: '확인' }, { id: FIRST, now: CREATED });
  getNoteText(doc, FIRST).insert(0, '보존');
  const before = Y.encodeStateAsUpdate(doc);
  const invalidCreates = [
    () => createNote(doc, { title: '' }, { id: SECOND }),
    () => createNote(doc, { title: ' '.repeat(3) }, { id: SECOND }),
    () => createNote(doc, { title: '가'.repeat(81) }, { id: SECOND }),
    () => createNote(doc, { title: '새 노트', category: '가'.repeat(41) }, { id: SECOND }),
    () => createNote(doc, { title: '새\n노트' }, { id: SECOND }),
    () => createNote(doc, { title: '새 노트', category: '\u0000' }, { id: SECOND }),
    () => createNote(doc, { title: '새 노트' }, { id: 'team' }),
    () => createNote(doc, { title: '새 노트' }, { id: '../body' }),
    () => createNote(doc, { title: '새 노트' }, { id: SECOND, now: 'invalid' }),
    () => createNote(doc, { title: '덮어쓰기' }, { id: FIRST }),
    () => updateNote(doc, UNKNOWN, { title: '없음' }),
    () => getNoteText(doc, UNKNOWN),
    () => getNoteText(doc, 'body'),
    () => updateNote(doc, FIRST, { title: '부분 변경도 금지', category: '\t' }),
  ];
  for (const action of invalidCreates) assert.throws(action);
  assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
  assert.equal(listNotes(doc)[1].title, '유효');
  assert.equal(getNoteText(doc, FIRST).toString(), '보존');
  createNote(doc, { title: '가'.repeat(80), category: '나'.repeat(40) }, { id: SECOND, now: Date.parse(CREATED) });
  assert.equal(listNotes(doc).length, 3);
});

test('the local note limit includes the legacy note and does not block existing edits', async () => {
  const { Y, doc, MAX_NOTES, createNote, updateNote, listNotes, getNoteText } = await setup();
  let last;
  for (let index = 1; index < MAX_NOTES; index++) {
    last = createNote(doc, { title: `노트 ${index}` }, { id: `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`, now: CREATED });
  }
  assert.equal(listNotes(doc).length, MAX_NOTES);
  const before = Y.encodeStateAsUpdate(doc);
  assert.throws(() => createNote(doc, { title: '초과 노트' }, { id: UNKNOWN }), /최대 100개/);
  assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
  updateNote(doc, last, { title: '계속 수정' });
  getNoteText(doc, last).insert(0, '저장 가능');
  assert.equal(listNotes(doc).find(note => note.id === last).title, '계속 수정');
  assert.equal(getNoteText(doc, last).toString(), '저장 가능');
});
