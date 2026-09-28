const test = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');
const model = import('../internal/tasks.mjs');
const ID = '11111111-1111-4111-8111-111111111111';
const PID = '22222222-2222-4222-8222-222222222222';
const task = (start, repeat = 'none', until = '') => ({ title: '요건 확인', schedule: { start, repeat, until } });
test('empty task reads do not mutate or register roots in legacy note', async () => {
  const m = await model, doc = new Y.Doc(); doc.getText('body').insert(0, '기존 노트');
  let updates = 0; doc.on('update', () => updates++);
  assert.deepEqual(m.exportTasks(doc), { people: [], tasks: [], completions: [] });
  assert.deepEqual(m.taskRows(doc), []); assert.equal(updates, 0); assert.equal(doc.share.size, 1);
});
test('dates and monthly recurrence clamp without drifting including leap year', async () => {
  const m = await model;
  assert.equal(m.validDate('2026-02-30'), false); assert.equal(m.validDate('2026-2-01'), false);
  assert.equal(m.validDate('2101-01-01'), false); assert.equal(m.validDate('2024-02-29'), true);
  for (const [start, index, expected] of [['2026-01-31', 1, '2026-02-28'], ['2026-01-31', 2, '2026-03-31'], ['2024-01-31', 1, '2024-02-29'], ['2024-02-29', 12, '2025-02-28'], ['2026-12-31', 2, '2027-02-28']]) assert.equal(m.occurrenceAt(task(start, 'monthly').schedule, index), expected);
  assert.equal(m.isOccurrence(task('2026-01-31', 'monthly').schedule, '2026-03-28'), false);
  assert.equal(m.isOccurrence(task('2026-01-31', 'monthly').schedule, '2026-02-28'), true);
  assert.equal(m.todaySeoul(new Date('2026-09-27T15:01:00Z')), '2026-09-28');
});
test('daily, 15-day and end-inclusive recurrence are anchored calendar intervals', async () => {
  const m = await model;
  assert.equal(m.occurrenceAt(task('2026-09-28', 'fortnight').schedule, 1), '2026-10-13');
  assert.equal(m.occurrenceAt(task('2026-09-28', 'daily').schedule, 3), '2026-10-01');
  assert.equal(m.occurrenceAt(task('2026-09-28', 'none').schedule, 1), null);
  assert.equal(m.occurrenceAt(task('2026-09-28', 'daily', '2026-09-29').schedule, 1), '2026-09-29');
  assert.equal(m.occurrenceAt(task('2026-09-28', 'daily', '2026-09-29').schedule, 2), null);
  assert.equal(m.occurrenceAt(task('2100-12-31', 'daily').schedule, 1), null);
});
test('user registration deduplicates names and validates assignment and date before any write', async () => {
  const m = await model, doc = new Y.Doc();
  assert.equal(m.addPerson(doc, ' 김 아인 ', PID), PID); assert.equal(m.addPerson(doc, '김아인'), PID);
  assert.equal(m.listPeople(doc).length, 1);
  assert.throws(() => m.createTask(doc, { ...task('2026-09-28'), assignee: 'unknown' }), /담당자/);
  assert.throws(() => m.createTask(doc, task('2026-02-30')), /시작일/);
  assert.equal(m.listTasks(doc).length, 0);
  m.createTask(doc, { ...task('2026-09-28'), assignee: PID }, ID);
  assert.equal(m.taskRows(doc, { assignee: PID }).length, 1); assert.equal(m.taskRows(doc, { assignee: '' }).length, 0);
});
test('completion advances pending occurrence, undo restores it, date filter exposes future dates', async () => {
  const m = await model, doc = new Y.Doc(); m.createTask(doc, task('2026-09-28', 'daily'), ID);
  m.completeTask(doc, ID, '2026-09-28', true, '김아인');
  assert.equal(m.taskRows(doc)[0].date, '2026-09-29');
  assert.equal(m.taskRows(doc, { status: 'done' })[0].completed.by, '김아인');
  assert.equal(m.taskRows(doc, { status: 'all', date: '2027-01-01' })[0].date, '2027-01-01');
  m.completeTask(doc, ID, '2026-09-28', false);
  assert.equal(m.taskRows(doc)[0].date, '2026-09-28'); assert.equal(m.taskRows(doc, { status: 'done' }).length, 0);
});
test('two offline clients completing same occurrence converge without skipping the next task', async () => {
  const m = await model, a = new Y.Doc(), b = new Y.Doc(); m.createTask(a, task('2026-01-31', 'monthly'), ID);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); m.completeTask(a, ID, '2026-01-31', true, 'A'); m.completeTask(b, ID, '2026-01-31', true, 'B');
  const au = Y.encodeStateAsUpdate(a), bu = Y.encodeStateAsUpdate(b); Y.applyUpdate(a, bu); Y.applyUpdate(b, au);
  assert.deepEqual(m.exportTasks(a), m.exportTasks(b)); assert.equal(m.completions(a).length, 1); assert.equal(m.taskRows(a)[0].date, '2026-02-28');
  m.updateTask(a, ID, { title: '수정 제목' }); m.updateTask(b, ID, { details: '독립 수정' });
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b)); Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  assert.equal(m.listTasks(a)[0].title, '수정 제목'); assert.equal(m.listTasks(a)[0].details, '독립 수정'); assert.deepEqual(m.exportTasks(a), m.exportTasks(b));
});
test('archive keeps completion history and restore; reschedule preserves former completion dates', async () => {
  const m = await model, doc = new Y.Doc(); m.createTask(doc, task('2026-09-28'), ID); m.completeTask(doc, ID, '2026-09-28', true);
  m.updateTask(doc, ID, { archived: true }); assert.equal(m.taskRows(doc).length, 0); assert.equal(m.taskRows(doc, { status: 'archived' }).length, 1);
  assert.throws(() => m.completeTask(doc, ID, '2026-09-28', false), /보관/);
  m.updateTask(doc, ID, { archived: false, schedule: task('2026-10-01').schedule });
  assert.equal(m.taskRows(doc)[0].date, '2026-10-01'); assert.equal(m.taskRows(doc, { status: 'done' })[0].date, '2026-09-28');
  m.completeTask(doc, ID, '2026-09-28', false); assert.equal(m.completions(doc).length, 0);
});
test('Yjs backup roundtrip retains notes, tasks, people and completion state', async () => {
  const m = await model, a = new Y.Doc(), b = new Y.Doc(); a.getText('body').insert(0, '보존'); m.addPerson(a, '담당자', PID); m.createTask(a, { ...task('2026-09-28'), assignee: PID }, ID); m.completeTask(a, ID, '2026-09-28', true);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); assert.deepEqual(m.exportTasks(b), m.exportTasks(a)); assert.equal(b.getText('body').toString(), '보존');
});
