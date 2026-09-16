let refs;
let actions = {};
let currentView = 'edit';

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
      submitButton.querySelector('span').textContent = '문서 열기';
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
  return refs;
}

export function setAuthenticated(authenticated) {
  if (!refs) return;
  refs.appShell.hidden = !authenticated;
  refs.loginShell.hidden = authenticated;
  refs.passwordInput.value = '';
  showError('');
  if (!authenticated) {
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
