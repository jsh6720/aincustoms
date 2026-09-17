let refs;
let actions = {};
let currentView = 'edit';
let notes = [], activeNoteId = '', notesSignature = '';
let notesBusy = true, noteSubmitting = false, noteSelecting = false, editedNoteId = null;
let editedNoteOriginal = null;

function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error('Missing UI element: ' + id);
  return element;
}

async function invoke(name, ...args) {
  try {
    await actions[name]?.(...args);
  } catch (error) {
    showError(error instanceof Error ? error.message : '처리하지 못했습니다. 다시 시도해 주세요.');
  }
}

function setNotesOpen(open) {
  refs.appShell.classList.toggle('is-notes-open', open);
  byId('notes-toggle-button').setAttribute('aria-expanded', String(open));
  byId('notes-toggle-label').textContent = open ? '닫기' : '열기';
}

function setNoteError(message = '') {
  byId('note-form-error').textContent = message;
  byId('note-form-error').hidden = !message;
}

function syncNoteControls() {
  if (!refs) return;
  const busy = notesBusy || noteSubmitting || noteSelecting;
  byId('new-note-button').disabled = busy;
  byId('edit-note-button').disabled = busy || !notes.some(note => note.id === activeNoteId);
  refs.notesList.setAttribute('aria-busy', String(busy));
  refs.notesList.querySelectorAll('[data-note-id]').forEach(button => { button.disabled = busy; });
  refs.noteTitleInput.disabled = notesBusy || noteSubmitting;
  refs.noteCategoryInput.disabled = notesBusy || noteSubmitting;
  byId('note-submit-button').disabled = notesBusy || noteSubmitting;
  byId('note-cancel-button').disabled = noteSubmitting;
  byId('note-submit-button').textContent = noteSubmitting ? '처리 중…' : editedNoteId === null ? '만들기' : '저장';
  const status = byId('note-form-status');
  status.textContent = noteSubmitting ? '노트 정보를 반영하고 있습니다.' : notesBusy ? '연결을 확인하는 중입니다. 잠시 후 다시 시도해 주세요.' : '';
  status.hidden = !status.textContent;
}

function renderNoteList() {
  const query = byId('notes-search').value.trim().toLocaleLowerCase('ko');
  const filtered = notes.filter(note => note.title.toLocaleLowerCase('ko').includes(query));
  const categories = [...new Set(filtered.map(note => note.category))].sort((a, b) => a.localeCompare(b, 'ko'));
  const focusedId = refs.notesList.contains(document.activeElement) ? document.activeElement.dataset.noteId : null;
  const fragment = document.createDocumentFragment();
  for (const category of categories) {
    const group = document.createElement('section');
    group.className = 'note-group';
    const categoryHeading = document.createElement('h3');
    categoryHeading.className = 'note-group-heading';
    categoryHeading.textContent = category;
    const categoryNotes = filtered.filter(note => note.category === category);
    const count = document.createElement('span');
    count.textContent = String(categoryNotes.length);
    categoryHeading.append(count);
    group.append(categoryHeading);
    for (const note of categoryNotes) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'note-list-button';
      button.dataset.noteId = note.id;
      button.title = note.title;
      const icon = document.createElement('span');
      icon.className = 'note-list-icon';
      icon.textContent = '▤';
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'note-list-title';
      label.textContent = note.title;
      button.append(icon, label);
      const selected = note.id === activeNoteId;
      button.classList.toggle('is-active', selected);
      if (selected) button.setAttribute('aria-current', 'page');
      button.addEventListener('click', async () => {
        if (notesBusy || noteSubmitting || noteSelecting) return;
        noteSelecting = true;
        syncNoteControls();
        try {
          if (!actions.selectNote) throw new Error('노트를 열 수 없습니다. 화면을 새로고침해 주세요.');
          await actions.selectNote(note.id);
          setNotesOpen(false);
        } catch (error) {
          showError(error instanceof Error ? error.message : '노트를 열지 못했습니다. 다시 시도해 주세요.');
        } finally { noteSelecting = false; syncNoteControls(); }
      });
      group.append(button);
    }
    fragment.append(group);
  }
  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'notes-empty';
    empty.textContent = query ? '검색한 제목의 노트가 없습니다.' : notesBusy ? '노트를 불러오는 중입니다.' : '새 노트를 만들어 업무를 기록해 보세요.';
    fragment.append(empty);
  }
  refs.notesList.replaceChildren(fragment);
  syncNoteControls();
  if (focusedId) [...refs.notesList.querySelectorAll('[data-note-id]')].find(button => button.dataset.noteId === focusedId)?.focus({ preventScroll: true });
}

export function renderNotes(items = [], selectedId = '') {
  if (!refs) return;
  notes = items.filter(note => note && typeof note.id === 'string').map(note => ({
    id: note.id, title: String(note.title || '제목 없는 노트'), category: String(note.category || '일반'),
  }));
  activeNoteId = selectedId;
  const active = notes.find(note => note.id === activeNoteId);
  byId('note-heading').textContent = active?.title || '팀 업무 노트';
  byId('note-category').textContent = active?.category || '일반';
  byId('notes-count').textContent = String(notes.length);
  document.title = active ? active.title + ' · AIN 노트' : '팀 공유 노트 · AIN';
  const signature = JSON.stringify([notes, activeNoteId]);
  if (signature !== notesSignature) {
    notesSignature = signature;
    const options = [...new Set(['일반', ...notes.map(note => note.category)])].sort((a, b) => a.localeCompare(b, 'ko')).map(category => {
      const option = document.createElement('option');
      option.value = category;
      return option;
    });
    byId('note-category-options').replaceChildren(...options);
    renderNoteList();
  }
  syncNoteControls();
}

export function setNotesBusy(busy) {
  notesBusy = Boolean(busy);
  syncNoteControls();
  if (refs && !notes.length) renderNoteList();
}

function openNoteDialog(id = null) {
  if (notesBusy || noteSubmitting || noteSelecting) return;
  const note = id === null ? null : notes.find(item => item.id === id);
  if (id !== null && !note) return;
  editedNoteId = id;
  editedNoteOriginal = note ? { title: note.title, category: note.category } : null;
  refs.noteTitleInput.value = note?.title || '';
  refs.noteCategoryInput.value = note?.category || '일반';
  refs.noteTitleInput.removeAttribute('aria-invalid');
  refs.noteCategoryInput.removeAttribute('aria-invalid');
  setNoteError();
  byId('note-dialog-title').textContent = note ? '노트 이름·분류 변경' : '새 노트 만들기';
  byId('note-dialog-description').textContent = note ? '이 노트의 제목과 카테고리를 변경합니다.' : '제목과 카테고리를 정하면 왼쪽 목록에 노트가 추가됩니다.';
  syncNoteControls();
  refs.noteDialog.showModal();
  refs.noteTitleInput.focus();
  if (note) refs.noteTitleInput.select();
}

export function setView(view) {
  currentView = view === 'read' ? 'read' : 'edit';
  const reading = currentView === 'read';
  byId('editor-panel').hidden = reading;
  byId('preview-panel').hidden = !reading;
  byId('editing-tools').hidden = reading;
  byId('reading-label').hidden = !reading;
  for (const [id, active] of [['edit-view-button', !reading], ['read-view-button', reading]]) {
    const button = byId(id);
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('is-active', active);
  }
  byId('view-hint').textContent = reading
    ? '링크를 선택하면 새 창에서 열립니다. 내용을 바꾸려면 편집을 선택하세요.'
    : '제목·목록은 위 도구로 추가할 수 있습니다. 링크는 읽기 화면에서 열립니다.';
  invoke('viewChanged', currentView);
}

export function initUI(callbacks = {}) {
  actions = callbacks;
  refs = {
    loginForm: byId('login-form'), passwordInput: byId('password'),
    loginError: byId('login-error'), appShell: byId('app-shell'),
    loginShell: byId('login-shell'), editorHost: byId('editor-host'),
    previewHost: byId('preview-host'), statusEl: byId('sync-status'),
    nameInput: byId('writer-name'), outlineHost: byId('outline-host'),
    notesList: byId('notes-list'), noteDialog: byId('note-dialog'),
    noteTitleInput: byId('note-title-input'), noteCategoryInput: byId('note-category-input'),
    renderNotes, setNotesBusy,
  };
  refs.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = byId('login-submit');
    if (submitButton.disabled) return;
    const password = refs.passwordInput.value;
    if (!password) {
      showError('공유 비밀번호를 입력해 주세요.');
      refs.passwordInput.focus();
      return;
    }
    showError('');
    submitButton.disabled = true;
    submitButton.querySelector('span').textContent = '확인 중…';
    try { await invoke('login', password); }
    finally {
      submitButton.disabled = false;
      submitButton.querySelector('span').textContent = '노트 공간 열기';
    }
  });
  byId('logout-button').addEventListener('click', () => invoke('logout'));
  byId('download-button').addEventListener('click', () => invoke('download'));
  byId('backup-button').addEventListener('click', () => invoke('backup'));
  byId('retry-button').addEventListener('click', () => invoke('retry'));
  refs.nameInput.addEventListener('change', () => {
    refs.nameInput.value = refs.nameInput.value.trim().slice(0, 24);
    invoke('nameChanged', refs.nameInput.value);
  });
  byId('edit-view-button').addEventListener('click', () => setView('edit'));
  byId('read-view-button').addEventListener('click', () => setView('read'));
  document.querySelectorAll('[data-insert]').forEach((button) => {
    button.addEventListener('click', () => invoke('insert', button.dataset.insert));
  });
  byId('notes-toggle-button').addEventListener('click', () => setNotesOpen(!refs.appShell.classList.contains('is-notes-open')));
  byId('notes-search').addEventListener('input', renderNoteList);
  byId('new-note-button').addEventListener('click', () => openNoteDialog());
  byId('edit-note-button').addEventListener('click', () => openNoteDialog(activeNoteId));
  byId('note-cancel-button').addEventListener('click', () => { if (!noteSubmitting) refs.noteDialog.close(); });
  refs.noteDialog.addEventListener('cancel', event => { if (noteSubmitting) event.preventDefault(); });
  byId('note-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (notesBusy || noteSubmitting) return;
    const title = refs.noteTitleInput.value.trim();
    const category = refs.noteCategoryInput.value.trim() || '일반';
    setNoteError();
    refs.noteTitleInput.setAttribute('aria-invalid', String(!title || title.length > 80));
    refs.noteCategoryInput.setAttribute('aria-invalid', String(category.length > 40));
    if (!title || title.length > 80) {
      setNoteError('노트 제목을 1자 이상 80자 이하로 입력해 주세요.');
      refs.noteTitleInput.focus();
      return;
    }
    if (category.length > 40) {
      setNoteError('카테고리는 40자 이하로 입력해 주세요.');
      refs.noteCategoryInput.focus();
      return;
    }
    noteSubmitting = true;
    syncNoteControls();
    try {
      if (editedNoteId === null) {
        if (!actions.createNote) throw new Error('노트를 만들 수 없습니다. 화면을 새로고침해 주세요.');
        await actions.createNote({ title, category });
      } else {
        if (!actions.updateNote) throw new Error('노트 정보를 변경할 수 없습니다. 화면을 새로고침해 주세요.');
        const changedFields = {};
        if (title !== editedNoteOriginal.title) changedFields.title = title;
        if (category !== editedNoteOriginal.category) changedFields.category = category;
        if (Object.keys(changedFields).length) await actions.updateNote(editedNoteId, changedFields);
      }
      byId('notes-search').value = '';
      renderNoteList();
      refs.noteDialog.close();
      setNotesOpen(false);
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : '노트 정보를 반영하지 못했습니다. 다시 시도해 주세요.');
    } finally { noteSubmitting = false; syncNoteControls(); }
  });
  syncNoteControls();
  return refs;
}

export function setAuthenticated(authenticated) {
  if (!refs) return;
  refs.appShell.hidden = !authenticated;
  refs.loginShell.hidden = authenticated;
  refs.passwordInput.value = '';
  showError('');
  if (!authenticated) {
    if (refs.noteDialog.open) refs.noteDialog.close();
    setNotesBusy(true);
    editedNoteId = null;
    editedNoteOriginal = null;
    setNoteError();
    refs.noteTitleInput.value = '';
    refs.noteCategoryInput.value = '일반';
    byId('note-form-status').textContent = '';
    byId('note-form-status').hidden = true;
    setNotesOpen(false);
    byId('notes-search').value = '';
    setView('edit');
    refs.passwordInput.focus();
  }
}

export function setStatus(text, kind = 'syncing') {
  const element = refs?.statusEl ?? byId('sync-status');
  element.textContent = text;
  element.dataset.kind = kind;
}

export function showError(message = '') {
  if (!refs) return;
  const loginVisible = !refs.loginShell.hidden;
  refs.loginError.textContent = loginVisible ? message : '';
  refs.loginError.hidden = !loginVisible || !message;
  refs.passwordInput.setAttribute('aria-invalid', String(loginVisible && Boolean(message)));
  byId('app-error-message').textContent = loginVisible ? '' : message;
  byId('app-error').hidden = loginVisible || !message;
}
