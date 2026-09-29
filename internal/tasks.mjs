// Tasks share the existing authenticated, encrypted-cache Yjs document.
// Occurrences are derived, not appended by timers or completion clicks.
export const REPEATS = Object.freeze({ none: '반복 없음', daily: '매일', fortnight: '15일마다', monthly: '매월' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DAY = 86400000;
function map(doc, name, write = false) { return write || doc.share.has(name) ? doc.getMap(name) : null; }
function id(value) { if (typeof value !== 'string' || !UUID.test(value)) throw new Error('업무 식별자가 올바르지 않습니다.'); return value; }
function label(value, max, required = true) {
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error('입력 내용을 확인해 주세요.');
  value = value.trim();
  if ((required && !value) || Array.from(value).length > max) throw new Error(`내용은 ${required ? '1' : '0'}~${max}자로 입력해 주세요.`);
  return value;
}
export function validDate(value) {
  return typeof value === 'string' && /^(20\d\d|2100)-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
export function todaySeoul(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
function schedule(value) {
  if (!value || !validDate(value.start) || !Object.hasOwn(REPEATS, value.repeat) || (value.until && (!validDate(value.until) || value.until < value.start))) throw new Error('시작일·반복 주기·종료일을 확인해 주세요. (2000~2100년)');
  return { start: value.start, repeat: value.repeat, until: value.until || '' };
}
export function occurrenceAt(value, index) {
  const s = schedule(value);
  if (!Number.isSafeInteger(index) || index < 0 || index > 37000 || (s.repeat === 'none' && index)) return null;
  const base = new Date(s.start + 'T00:00:00Z');
  if (s.repeat === 'monthly') {
    const year = base.getUTCFullYear(), month = base.getUTCMonth() + index;
    base.setUTCFullYear(year, month, Math.min(base.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate()));
  } else base.setUTCDate(base.getUTCDate() + index * (s.repeat === 'fortnight' ? 15 : 1));
  const date = base.toISOString().slice(0, 10);
  return validDate(date) && (!s.until || date <= s.until) ? date : null;
}
export function isOccurrence(s, date) {
  if (!validDate(date) || date < s.start || (s.until && date > s.until)) return false;
  if (s.repeat === 'monthly') {
    const a = new Date(s.start), b = new Date(date);
    return occurrenceAt(s, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth()) === date;
  }
  const days = Math.round((Date.parse(date) - Date.parse(s.start)) / DAY);
  return s.repeat === 'none' ? days === 0 : s.repeat === 'daily' || days % 15 === 0;
}
const nameKey = name => name.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('ko');
export function listPeople(doc) {
  const people = map(doc, 'taskPeople');
  return people ? [...people.entries()].filter(([key, name]) => UUID.test(key) && typeof name === 'string').map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ko')) : [];
}
export function addPerson(doc, name, personId = crypto.randomUUID()) {
  name = label(name, 40); id(personId);
  const people = listPeople(doc), found = people.find(person => nameKey(person.name) === nameKey(name));
  if (found) return found.id;
  if (people.length >= 100) throw new Error('담당자는 최대 100명까지 등록할 수 있습니다.');
  const target = map(doc, 'taskPeople', true);
  if (target.has(personId)) throw new Error('이미 존재하는 담당자입니다.');
  target.set(personId, name); return personId;
}
export function listTasks(doc) {
  const target = map(doc, 'companyTasks');
  if (!target) return [];
  const tasks = [];
  for (const key of target.keys()) {
    if (!key.endsWith(':title')) continue;
    const taskId = key.slice(0, -6);
    try {
      id(taskId);
      tasks.push({ id: taskId, title: label(target.get(key), 200), details: label(target.get(`${taskId}:details`) || '', 2000, false), dueDate: validDate(target.get(`${taskId}:dueDate`)) ? target.get(`${taskId}:dueDate`) : '', assignee: target.get(`${taskId}:assignee`) || '', schedule: schedule(target.get(`${taskId}:schedule`)), archived: target.get(`${taskId}:archived`) === true, createdAt: target.get(`${taskId}:createdAt`) || '' });
    } catch { /* Ignore malformed metadata without altering the underlying data. */ }
  }
  return tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
function cleanPatch(doc, patch) {
  const result = {};
  if (Object.hasOwn(patch, 'title')) result.title = label(patch.title, 200);
  if (Object.hasOwn(patch, 'details')) result.details = label(patch.details, 2000, false);
  if (Object.hasOwn(patch, 'schedule')) result.schedule = schedule(patch.schedule);
  if (Object.hasOwn(patch, 'dueDate')) {
    if (patch.dueDate !== '' && !validDate(patch.dueDate)) throw new Error('업무 기한 날짜를 확인해 주세요.');
    result.dueDate = patch.dueDate;
  }
  if (Object.hasOwn(patch, 'assignee')) {
    if (patch.assignee !== '' && !listPeople(doc).some(person => person.id === patch.assignee)) throw new Error('등록된 담당자를 선택해 주세요.');
    result.assignee = patch.assignee;
  }
  if (Object.hasOwn(patch, 'archived')) { if (typeof patch.archived !== 'boolean') throw new Error('보관 상태를 확인해 주세요.'); result.archived = patch.archived; }
  return result;
}
export function createTask(doc, fields, taskId = crypto.randomUUID()) {
  id(taskId);
  const patch = cleanPatch(doc, { title: fields.title, details: fields.details || '', dueDate: fields.dueDate || '', assignee: fields.assignee || '', schedule: fields.schedule, archived: false });
  if (patch.dueDate && patch.dueDate < patch.schedule.start) throw new Error('업무 기한은 시작일 이후로 입력해 주세요.');
  const tasks = listTasks(doc);
  if (tasks.length >= 2000) throw new Error('업무는 최대 2,000개까지 등록할 수 있습니다.');
  const target = map(doc, 'companyTasks', true);
  if ([...target.keys()].some(key => key.startsWith(taskId + ':'))) throw new Error('이미 존재하는 업무입니다.');
  doc.transact(() => { for (const [key, value] of Object.entries(patch)) target.set(`${taskId}:${key}`, value); target.set(`${taskId}:createdAt`, new Date().toISOString()); }, 'company-task');
  return taskId;
}
export function updateTask(doc, taskId, fields) {
  id(taskId);
  if (!listTasks(doc).some(task => task.id === taskId)) throw new Error('업무를 찾을 수 없습니다.');
  const patch = cleanPatch(doc, fields), target = map(doc, 'companyTasks', true);
  const current = listTasks(doc).find(task => task.id === taskId), next = { ...current, ...patch };
  if (next.dueDate && next.dueDate < next.schedule.start) throw new Error('업무 기한은 시작일 이후로 입력해 주세요.');
  doc.transact(() => { for (const [key, value] of Object.entries(patch)) target.set(`${taskId}:${key}`, value); }, 'company-task');
}
export function assignTask(doc, taskId, assignee) {
  const task = listTasks(doc).find(task => task.id === id(taskId));
  if (!task || task.archived) throw new Error('보관 중이거나 없는 업무는 배정할 수 없습니다.');
  const patch = cleanPatch(doc, { assignee });
  if (task.assignee !== patch.assignee) updateTask(doc, taskId, patch);
}
export function completions(doc) {
  const target = map(doc, 'taskCompletions');
  return target ? [...target.entries()].filter(([key, value]) => UUID.test(key.split('|')[0]) && validDate(key.split('|')[1]) && value?.done === true).map(([key, value]) => ({ taskId: key.split('|')[0], date: key.split('|')[1], ...value })) : [];
}
export function completeTask(doc, taskId, date, done, author = '') {
  const task = listTasks(doc).find(task => task.id === id(taskId));
  if (!task || task.archived) throw new Error('보관 중이거나 없는 업무는 완료 상태를 바꿀 수 없습니다.');
  const existing = map(doc, 'taskCompletions')?.get(`${taskId}|${date}`);
  if (typeof done !== 'boolean' || (!isOccurrence(task.schedule, date) && !(existing?.done && !done))) throw new Error('업무 일정이 변경되었습니다. 목록을 다시 확인해 주세요.');
  // One stable date key: simultaneous completions cannot create duplicate successors.
  map(doc, 'taskCompletions', true).set(`${taskId}|${date}`, { done, at: new Date().toISOString(), by: label(author, 40, false) });
}
export function occurrenceDueDate(task, date) {
  if (!task.dueDate) return '';
  const shifted = new Date(Date.parse(task.dueDate) + Date.parse(date) - Date.parse(task.schedule.start)).toISOString().slice(0, 10);
  return validDate(shifted) ? shifted : '';
}
export function taskRows(doc, { date = '', assignee = '*', status = 'pending' } = {}) {
  const done = completions(doc), doneMap = new Map(done.map(item => [`${item.taskId}|${item.date}`, item]));
  const rows = [];
  for (const task of listTasks(doc)) {
    if ((status === 'archived') !== task.archived || (assignee !== '*' && task.assignee !== assignee)) continue;
    const add = date => { const completed = doneMap.get(`${task.id}|${date}`); rows.push({ ...task, date, deadline: occurrenceDueDate(task, date), completed: completed || null }); };
    if (status === 'archived') { add(task.schedule.start); continue; }
    if (date) {
      if (isOccurrence(task.schedule, date) || doneMap.has(`${task.id}|${date}`)) {
        const completed = doneMap.has(`${task.id}|${date}`);
        if (status === 'all' || (status === 'done') === completed) add(date);
      }
      continue;
    }
    if (status === 'done' || status === 'all') for (const item of done) if (item.taskId === task.id) add(item.date);
    if (status !== 'done') {
      // At most (number of completed occurrences + 1) probes, not a daily scan from year 2000.
      for (let i = 0; i <= doneMap.size; i++) {
        const date = occurrenceAt(task.schedule, i);
        if (!date) break;
        if (!doneMap.has(`${task.id}|${date}`)) { add(date); break; }
      }
    }
  }
  return rows.sort((a, b) => (status === 'done' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) || a.title.localeCompare(b.title, 'ko') || a.id.localeCompare(b.id));
}
export function exportTasks(doc) { return { people: listPeople(doc), tasks: listTasks(doc), completions: completions(doc) }; }
