import { REPEATS, listPeople, addPerson, listTasks, createTask, updateTask, assignTask, completeTask, taskRows, todaySeoul } from './tasks.mjs';

export function initTasks({ getDoc, requireEditable, author, onView }) {
  const $ = id => document.getElementById(id);
  const node = (tag, text, className = '') => { const e = document.createElement(tag); e.textContent = text; e.className = className; return e; };
  let enabled = false, visible = false, original = null, signature = '';
  let dragging = '', assigning = '';
  let revealed = '';
  const sidebarButton = node('button', '☑ 회사 할 일', 'button tasks-nav-button');
  sidebarButton.id = 'tasks-page-button'; sidebarButton.type = 'button';
  document.querySelector('.notes-heading').before(sidebarButton);
  const quick = node('button', '회사 할 일 ↗', 'button button-small'); quick.type = 'button'; quick.id = 'tasks-quick-button';
  document.querySelector('.document-topline').append(quick);
  const panel = document.createElement('section'); panel.id = 'tasks-panel'; panel.hidden = true;
  panel.setAttribute('aria-label', '회사 할 일');
  // Static markup only. All user-authored values below use textContent/value.
  panel.innerHTML = `
    <div class="tasks-heading"><div><span class="eyebrow">TEAM TASKS</span><h1>회사 할 일</h1><p>담당자와 날짜를 정하고, 함께 진행 상황을 확인하세요.</p></div><button id="tasks-back-button" class="button" type="button">노트로 돌아가기</button></div>
    <div class="tasks-actions"><button id="task-new" class="button button-primary" type="button" disabled>＋ 할 일 추가</button><button id="task-people-open" class="button" type="button" disabled>담당자 등록</button><span id="tasks-sync-status" role="status">연결 중</span></div>
    <button id="task-filters-toggle" class="button mobile-filter-toggle" type="button" aria-expanded="false" aria-controls="tasks-filters">담당자·날짜 필터 열기</button>
    <div id="tasks-filters" class="tasks-filters">
      <label>업무 검색<input id="task-search" type="search" placeholder="제목·내용 검색" maxlength="200"></label>
      <label>담당자<select id="task-filter-person"><option value="*">전체 담당자</option><option value="">미배정</option></select></label>
      <label>업무일<input id="task-filter-date" type="date" min="2000-01-01" max="2100-12-31"></label>
      <label>상태<select id="task-filter-status"><option value="pending">미완료</option><option value="done">완료 기록</option><option value="all">전체</option><option value="archived">보관된 업무</option></select></label>
      <button id="task-today" class="button" type="button">오늘</button><button id="task-reset" class="button" type="button">초기화</button>
    </div>
    <p class="tasks-help">날짜를 비우면 업무별 가장 이른 미완료 일정을 표시합니다. 날짜를 선택하면 해당 일자의 반복 일정까지 조회합니다. 미처리된 지난 일정은 자동 완료되지 않습니다.</p>
    <p id="tasks-error" class="field-error" role="alert" hidden></p><p id="tasks-summary" role="status"></p>
    <div class="tasks-board-layout"><div class="tasks-main-list"><div id="tasks-list" class="tasks-list"></div><button id="tasks-more" class="button" type="button" hidden>더 보기</button></div>
      <aside class="task-assignment-board" aria-labelledby="task-assignment-heading"><h2 id="task-assignment-heading">담당자별 배정</h2><p class="tasks-help">업무를 담당자 블록으로 끌어 놓으세요. 또는 업무의 ‘배정’을 누른 뒤 담당자를 선택하세요.</p><p class="tasks-help">반복 업무는 전체 일정의 담당자가 바뀝니다. 완료 기록·날짜·내용은 유지됩니다.</p><div id="task-assignee-blocks"></div><div class="task-assignment-feedback"><p id="task-assignment-status" role="status" aria-live="polite"></p><button id="task-assignment-cancel" class="button button-small" type="button" hidden>배정 선택 취소</button></div><p class="tasks-help">숫자는 필터와 무관한 전체 미완료 업무 수입니다. 배정 선택 없이 블록을 누르면 해당 담당자의 업무를 조회합니다.</p></aside>
    </div>
    <p class="tasks-help">담당자 이름은 업무 배분용이며 별도 로그인 계정이 아닙니다. 같은 공유 비밀번호로 접속한 구성원 모두 수정할 수 있습니다. 메일·알림은 발송하지 않습니다.</p>`;
  document.querySelector('.document-heading').before(panel);
  const dialog = document.createElement('dialog'); dialog.id = 'task-dialog'; dialog.className = 'note-dialog task-dialog';
  dialog.setAttribute('aria-labelledby', 'task-dialog-heading');
  dialog.innerHTML = `<form id="task-form"><span class="eyebrow">TEAM TASKS</span><h2 id="task-dialog-heading">할 일 추가</h2>
    <label for="task-title">할 일 <span>필수 · 최대 200자</span></label><input id="task-title" required maxlength="200" autocomplete="off">
    <label for="task-details">업무 내용 <span>목록과 담당자 블록에 표시</span></label><textarea id="task-details" maxlength="2000" rows="4" placeholder="진행할 내용, 전달 사항, 확인할 자료 등을 입력하세요."></textarea>
    <label for="task-assignee">담당자</label><select id="task-assignee"><option value="">미배정</option></select>
    <div class="task-date-grid"><div><label for="task-start">업무일 / 반복 시작일</label><input id="task-start" type="date" required min="2000-01-01" max="2100-12-31"></div><div><label for="task-repeat">반복 주기</label><select id="task-repeat"><option value="none">반복 없음</option><option value="daily">매일</option><option value="fortnight">15일마다</option><option value="monthly">매월</option></select></div></div>
    <label for="task-due">업무 기한 <span>선택 · 완료해야 하는 날짜</span></label><input id="task-due" type="date" min="2000-01-01" max="2100-12-31">
    <p class="tasks-help">반복 업무는 첫 업무의 기한을 입력하세요. 다음 업무에도 시작일부터 기한까지의 일수가 동일하게 적용됩니다. 기한을 비우면 ‘기한 미설정’으로 표시합니다.</p>
    <label for="task-until">반복 종료일 <span>기한과 별개 · 선택</span></label><input id="task-until" type="date" min="2000-01-01" max="2100-12-31">
    <p class="tasks-help">매일은 주말 포함, 15일마다는 시작일부터 15일 간격입니다. 매월은 시작일과 같은 날짜이며 없는 날짜는 말일로 표시합니다. 일정·담당자 수정은 이 업무 전체에 적용되며 기존 완료 일자는 유지됩니다.</p>
    <p id="task-form-error" class="field-error" role="alert" hidden></p><div class="note-dialog-actions"><button id="task-cancel" class="button" type="button">취소</button><button id="task-save" class="button button-primary" type="submit">저장</button></div></form>`;
  document.body.append(dialog);
  const peopleDialog = document.createElement('dialog'); peopleDialog.id = 'task-people-dialog'; peopleDialog.className = 'note-dialog'; peopleDialog.setAttribute('aria-labelledby', 'task-people-heading');
  peopleDialog.innerHTML = `<form id="task-people-form"><h2 id="task-people-heading">담당자 등록</h2><p class="tasks-help">이름을 등록하면 할 일의 담당자로 선택할 수 있습니다. 동명이인은 부서 등을 함께 입력하세요.</p><label for="task-person-name">사용자 이름</label><input id="task-person-name" maxlength="40" required autocomplete="off"><p id="task-people-error" class="field-error" role="alert" hidden></p><div class="note-dialog-actions"><button id="task-people-cancel" class="button" type="button">닫기</button><button id="task-person-save" class="button button-primary" type="submit">등록</button></div><div id="task-people-list" class="task-people-list"></div></form>`;
  document.body.append(peopleDialog);
  function error(id, message = '') { $(id).textContent = message; $(id).hidden = !message; }
  function guard(action, target = 'tasks-error') { try { requireEditable(); action(); error(target); render(); } catch (e) { error(target, e.message); signature = ''; render(); } }
  function show(value) {
    if (value && $('app-shell').hidden) return;
    resetAssignment(); visible = value; panel.hidden = !value; document.querySelector('.document-workspace').classList.toggle('is-task-view', value);
    sidebarButton.setAttribute('aria-pressed', String(value));
    $('mobile-notes').setAttribute('aria-pressed', String(!value));
    $('mobile-tasks').setAttribute('aria-pressed', String(value));
    $('app-shell').classList.remove('is-notes-open'); $('notes-toggle-button').setAttribute('aria-expanded', 'false'); $('notes-toggle-label').textContent = '열기';
    onView?.(value); if (value) render();
  }
  sidebarButton.onclick = quick.onclick = () => show(true); $('tasks-back-button').onclick = () => show(false);
  function mobilePage(value) { show(value); window.scrollTo({ top: 0, behavior: 'instant' }); }
  $('mobile-notes').onclick = () => mobilePage(false);
  $('mobile-tasks').onclick = () => mobilePage(true);
  $('mobile-list').onclick = () => { $('notes-toggle-button').click(); if ($('app-shell').classList.contains('is-notes-open')) $('workspace-sidebar').scrollIntoView({ block: 'start' }); };
  $('task-filters-toggle').onclick = () => {
    const open = panel.classList.toggle('is-filters-open');
    $('task-filters-toggle').setAttribute('aria-expanded', String(open));
    render();
  };
  const filters = () => ({ date: $('task-filter-date').value, assignee: $('task-filter-person').value, status: $('task-filter-status').value });
  let limit = 100;
  for (const field of ['task-filter-date', 'task-filter-person', 'task-filter-status', 'task-search']) $(field).addEventListener('input', () => { limit = 100; render(); });
  $('task-today').onclick = () => { $('task-filter-date').value = todaySeoul(); $('task-filter-status').value = 'all'; limit = 100; render(); };
  $('task-reset').onclick = () => { $('task-filter-date').value = ''; $('task-filter-person').value = '*'; $('task-filter-status').value = 'pending'; $('task-search').value = ''; limit = 100; render(); };
  $('tasks-more').onclick = () => { limit += 100; render(); };
  function revealTask(taskId, assignee = '*') {
    $('task-search').value = ''; $('task-filter-date').value = ''; $('task-filter-person').value = assignee;
    $('task-filter-status').value = taskRows(getDoc()).some(row => row.id === taskId) ? 'pending' : 'all';
    const rows = taskRows(getDoc(), filters());
    limit = Math.max(100, rows.findIndex(row => row.id === taskId) + 1);
    revealed = taskId; signature = ''; render();
    const card = [...$('tasks-list').children].find(card => card.dataset.taskId === taskId);
    if (card) { card.tabIndex = -1; card.focus({ preventScroll: true }); card.scrollIntoView({ block: 'center', behavior: 'auto' }); }
  }
  function resetAssignment() {
    dragging = ''; assigning = '';
    $('task-assignment-status').textContent = ''; $('task-assignment-cancel').hidden = true;
    panel.querySelectorAll('.is-dragging,.is-drop-over,.is-assignment-selected').forEach(e => e.classList.remove('is-dragging', 'is-drop-over', 'is-assignment-selected'));
  }
  $('task-assignment-cancel').onclick = resetAssignment;
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') resetAssignment(); });
  function assign(taskId, person) {
    guard(() => {
      assignTask(getDoc(), taskId, person.id);
      resetAssignment();
      revealTask(taskId, person.id);
      $('task-assignment-status').textContent = person.name + ' 배정 반영 · 상단 저장 상태를 확인해 주세요.';
    });
  }
  function renderAssignments(people, pending) {
    const blocks = $('task-assignee-blocks'); blocks.replaceChildren();
    for (const person of [{ id: '', name: '미배정' }, ...people]) {
      const group = node('section', '', 'task-assignee-group');
      const block = node('button', '', 'task-assignee-block'); block.type = 'button'; block.dataset.assigneeId = person.id;
      const assigned = pending.filter(task => task.assignee === person.id), count = assigned.length;
      block.append(node('strong', person.name), node('span', '미완료 ' + count + '건'));
      block.setAttribute('aria-label', person.name + ' · 미완료 ' + count + '건 · 배정 또는 조회');
      block.onclick = () => {
        if (assigning) assign(assigning, person);
        else { $('task-search').value = ''; $('task-filter-date').value = ''; $('task-filter-status').value = 'pending'; $('task-filter-person').value = person.id; limit = 100; render(); }
      };
      block.ondragover = event => {
        if (!enabled || !dragging) return;
        event.preventDefault(); event.dataTransfer.dropEffect = 'move'; block.classList.add('is-drop-over');
      };
      block.ondragleave = event => { if (!block.contains(event.relatedTarget)) block.classList.remove('is-drop-over'); };
      block.ondrop = event => {
        event.preventDefault(); block.classList.remove('is-drop-over');
        if (!enabled || !dragging) return;
        const taskId = dragging; dragging = ''; assign(taskId, person);
      };
      group.append(block);
      const previews = node('div', '', 'task-assignee-previews');
      for (const task of assigned.slice(0, 5)) {
        const preview = node('button', '', 'task-assignee-preview'); preview.type = 'button'; preview.dataset.taskId = task.id;
        preview.append(node('strong', task.title), node('span', task.deadline ? '기한 ' + task.deadline : '기한 미설정', 'task-preview-due'), node('span', task.details || '업무 내용 미입력 · 수정에서 추가하세요.', 'task-preview-details'));
        preview.onclick = () => revealTask(task.id, person.id);
        previews.append(preview);
      }
      if (!count) previews.append(node('p', '배정된 미완료 업무가 없습니다.', 'tasks-help'));
      if (count > 5) previews.append(node('p', '외 ' + (count - 5) + '건 · 담당자 이름을 눌러 전체 조회', 'tasks-help'));
      // Dropping onto a preview also assigns to this group, never edits its content.
      group.ondragover = block.ondragover; group.ondragleave = block.ondragleave; group.ondrop = block.ondrop;
      block.ondragover = null; block.ondragleave = null; block.ondrop = null;
      group.append(previews); blocks.append(group);
    }
  }
  function options(element, people, includeAll) {
    const previous = element.value, signature = JSON.stringify(people);
    if (element.dataset.people === signature) return;
    element.dataset.people = signature; element.replaceChildren();
    if (includeAll) { const option = node('option', '전체 담당자'); option.value = '*'; element.append(option); }
    const empty = node('option', '미배정'); empty.value = ''; element.append(empty);
    for (const person of people) { const option = node('option', person.name); option.value = person.id; element.append(option); }
    if ([...element.options].some(option => option.value === previous)) element.value = previous;
  }
  function openTask(task = null) {
    guard(() => {
      original = task ? structuredClone(task) : null;
      $('task-form').reset(); error('task-form-error');
      options($('task-assignee'), listPeople(getDoc()), false);
      $('task-dialog-heading').textContent = task ? '할 일 수정' : '할 일 추가';
      $('task-title').value = task?.title || ''; $('task-details').value = task?.details || ''; $('task-assignee').value = task?.assignee || '';
      $('task-start').value = task?.schedule.start || todaySeoul(); $('task-repeat').value = task?.schedule.repeat || 'none'; $('task-until').value = task?.schedule.until || '';
      $('task-due').value = task?.dueDate || '';
      dialog.showModal(); $('task-title').focus();
    });
  }
  $('task-new').onclick = () => openTask();
  function closeTask() { dialog.close(); $('task-form').reset(); original = null; error('task-form-error'); }
  $('task-cancel').onclick = closeTask; dialog.addEventListener('cancel', e => { e.preventDefault(); closeTask(); });
  $('task-form').onsubmit = event => {
    event.preventDefault(); guard(() => {
      const fields = { title: $('task-title').value, details: $('task-details').value, dueDate: $('task-due').value, assignee: $('task-assignee').value, schedule: { start: $('task-start').value, repeat: $('task-repeat').value, until: $('task-repeat').value === 'none' ? '' : $('task-until').value } };
      let taskId = original?.id;
      if (original) {
        if (!listTasks(getDoc()).some(task => task.id === original.id && !task.archived)) throw new Error('다른 구성원이 이 업무를 보관했습니다. 다시 확인해 주세요.');
        // Only changed fields: do not overwrite concurrent changes in untouched fields.
        const patch = Object.fromEntries(Object.entries(fields).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(original[key])));
        updateTask(getDoc(), original.id, patch);
      } else taskId = createTask(getDoc(), fields);
      closeTask(); revealTask(taskId);
    }, 'task-form-error');
  };
  $('task-people-open').onclick = () => guard(() => { $('task-people-form').reset(); error('task-people-error'); peopleDialog.showModal(); $('task-person-name').focus(); });
  function closePeople() { peopleDialog.close(); $('task-people-form').reset(); error('task-people-error'); }
  $('task-people-cancel').onclick = closePeople; peopleDialog.addEventListener('cancel', e => { e.preventDefault(); closePeople(); });
  $('task-people-form').onsubmit = event => { event.preventDefault(); guard(() => { addPerson(getDoc(), $('task-person-name').value); $('task-person-name').value = ''; $('task-person-name').focus(); }, 'task-people-error'); };
  function render() {
    const doc = getDoc(); if (!visible || !doc || $('app-shell').hidden) return;
    const people = listPeople(doc), names = new Map(people.map(person => [person.id, person.name]));
    options($('task-filter-person'), people, true); options($('task-assignee'), people, false);
    const peopleKey = JSON.stringify(people);
    if ($('task-people-list').dataset.key !== peopleKey) { $('task-people-list').dataset.key = peopleKey; $('task-people-list').replaceChildren(...people.map(person => node('span', person.name, 'task-person-chip'))); }
    const query = $('task-search').value.trim().toLocaleLowerCase('ko');
    const filterCount = Number(Boolean($('task-filter-date').value)) + Number($('task-filter-person').value !== '*') + Number($('task-filter-status').value !== 'pending');
    $('task-filters-toggle').textContent = `담당자·날짜 필터 ${panel.classList.contains('is-filters-open') ? '닫기' : '열기'}${filterCount ? ' · 적용 ' + filterCount + '개' : ''}`;
    const rows = taskRows(doc, filters()).filter(row => (row.title + '\n' + row.details).toLocaleLowerCase('ko').includes(query));
    const pending = taskRows(doc);
    const today = todaySeoul(), key = JSON.stringify([rows, people, pending, enabled, today, limit]);
    if (key === signature) return; signature = key;
    $('tasks-summary').textContent = `${rows.length}건 · 표시 ${Math.min(limit, rows.length)}건`;
    $('tasks-more').hidden = rows.length <= limit;
    renderAssignments(people, pending);
    const list = $('tasks-list'); list.replaceChildren();
    for (const row of rows.slice(0, limit)) {
      const card = node('article', '', 'task-card' + (row.completed ? ' is-complete' : '')); card.dataset.taskId = row.id; card.dataset.date = row.date;
      if (row.id === revealed) card.classList.add('is-revealed');
      card.draggable = enabled && !row.archived;
      if (assigning === row.id) card.classList.add('is-assignment-selected');
      card.ondragstart = event => {
        if (!enabled || row.archived || event.target.closest('input,select,textarea,a')) { event.preventDefault(); return; }
        resetAssignment(); dragging = row.id; card.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-ain-task', row.id);
      };
      card.ondragend = () => { dragging = ''; panel.querySelectorAll('.is-dragging,.is-drop-over').forEach(e => e.classList.remove('is-dragging', 'is-drop-over')); };
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = Boolean(row.completed); check.disabled = !enabled || row.archived; check.setAttribute('aria-label', row.title + ' · ' + row.date + ' 완료');
      check.onchange = () => guard(() => completeTask(getDoc(), row.id, row.date, check.checked, author()));
      const body = node('div', '', 'task-card-body'); body.append(node('h2', row.title));
      const meta = node('div', '', 'task-meta'); meta.append(node('span', row.date), node('span', names.get(row.assignee) || '미배정'), node('span', REPEATS[row.schedule.repeat]));
      meta.append(node('span', row.deadline ? '업무 기한 ' + row.deadline : '기한 미설정', 'task-deadline'));
      if (!row.archived && !row.completed && row.deadline && row.deadline < today) meta.append(node('span', '기한 지남', 'task-overdue'));
      if (row.schedule.until) meta.append(node('span', row.schedule.until + '까지'));
      body.append(meta);
      body.append(node('p', row.details || '업무 내용 미입력 · 수정에서 내용을 추가하세요.', 'task-description'));
      if (row.completed) body.append(node('p', `완료 ${row.completed.at ? new Date(row.completed.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : ''}${row.completed.by ? ' · ' + row.completed.by : ''}`, 'tasks-help'));
      const actions = node('div', '', 'task-card-actions');
      if (!row.archived) {
        const assignButton = node('button', '⠿ 배정', 'button button-small task-assign-button'); assignButton.type = 'button'; assignButton.disabled = !enabled;
        assignButton.onclick = () => {
          resetAssignment(); assigning = row.id; card.classList.add('is-assignment-selected');
          $('task-assignment-status').textContent = '“' + row.title + '” 배정할 담당자를 선택하세요.';
          $('task-assignment-cancel').hidden = false; $('task-assignee-blocks').querySelector('button')?.focus();
        };
        actions.append(assignButton);
      }
      if (!row.archived) { const edit = node('button', '수정', 'button button-small'); edit.type = 'button'; edit.disabled = !enabled; edit.onclick = () => openTask(listTasks(getDoc()).find(task => task.id === row.id)); actions.append(edit); }
      const archive = node('button', row.archived ? '복원' : '보관', 'button button-small'); archive.type = 'button'; archive.disabled = !enabled;
      archive.onclick = () => guard(() => { if (!row.archived && !window.confirm('이 업무의 전체 반복 일정을 보관할까요? 완료 기록은 유지되며 보관된 업무에서 복원할 수 있습니다.')) return; updateTask(getDoc(), row.id, { archived: !row.archived }); });
      actions.append(archive); card.append(check, body, actions); list.append(card);
    }
    if (!rows.length) list.append(node('p', '조건에 맞는 할 일이 없습니다. 날짜·담당자·상태 필터를 확인하거나 새 업무를 추가하세요.', 'tasks-empty'));
  }
  function setEnabled(value) {
    enabled = value;
    for (const id of ['task-new', 'task-people-open', 'task-save', 'task-person-save']) $(id).disabled = !value;
    if (!value) { resetAssignment(); closeTask(); closePeople(); }
    render();
  }
  function clear() {
    panel.classList.remove('is-filters-open'); $('task-filters-toggle').setAttribute('aria-expanded', 'false');
    closeTask(); closePeople(); show(false); signature = ''; revealed = '';
    $('tasks-list').replaceChildren(); $('task-assignee-blocks').replaceChildren(); $('task-people-list').replaceChildren(); $('task-people-list').removeAttribute('data-key');
    for (const id of ['task-filter-person', 'task-assignee']) { $(id).removeAttribute('data-people'); options($(id), [], id === 'task-filter-person'); }
    $('task-search').value = ''; $('task-filter-date').value = ''; $('task-filter-status').value = 'pending'; $('tasks-summary').textContent = ''; error('tasks-error');
  }
  // Refresh the derived dates when a page stays open over Korean midnight.
  setInterval(() => { if (visible && !$('app-shell').hidden) render(); }, 60000);
  return { render, show, setEnabled, clear, status(message) { $('tasks-sync-status').textContent = message; } };
}
