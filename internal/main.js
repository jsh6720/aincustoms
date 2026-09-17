import * as Y from 'yjs';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { EditorView, keymap, drawSelection, placeholder } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yCollab, yUndoManagerKeymap, ySyncAnnotation } from 'y-codemirror.next';
import { initUI, setAuthenticated, setStatus, showError } from './ui.js';
import { SharedDocumentSync, encode, decode } from './sync.mjs';
import { createSnapshotCache } from './snapshot-cache.mjs';
import { renderPreview } from './preview.mjs';
import { listNotes, createNote, updateNote, getNoteText } from './notes.mjs';
import { documentSearchExtension, createDocumentSearchController } from './document-search.mjs';

let csrf = '', doc = null, sync = null, editor = null, renderTimer, loggingOut = false, changingPassword = false;
let activeNoteId = 'team';
let editorUndo = null;
let documentSearch = null;
let snapshotSecret = '', snapshotSignature = '', showingSnapshot = false;
let openingTask = null;
let workspaceEpoch = 0;
let snapshotStorage;
try { snapshotStorage = window.localStorage; } catch { /* Server loading works without browser storage. */ }
const snapshotCache = createSnapshotCache({ storage: snapshotStorage, crypto: window.crypto, origin: location.origin });
const editAccess = new Compartment();
const utf8 = new TextEncoder();

function adoptSession(result) {
  csrf = result.csrf;
  if (snapshotSecret && snapshotSecret !== result.snapshotKey) snapshotCache.clear();
  snapshotSecret = typeof result.snapshotKey === 'string' ? result.snapshotKey : '';
}
function clearSnapshot() {
  snapshotCache.clear(); snapshotSecret = ''; snapshotSignature = ''; showingSnapshot = false;
  document.getElementById('loading-notice').hidden = true;
}
function rememberSnapshot() {
  if (!doc || !sync?.ready || sync.unsaved || sync.paused || loggingOut || changingPassword || ui.appShell.hidden || !snapshotSecret) return;
  const signature = `${snapshotSecret}:${sync.cursor}`;
  if (signature === snapshotSignature) return;
  snapshotSignature = signature;
  // Capture only fully acknowledged state. No key, text, title or cursor is
  // persisted outside the encrypted envelope; a quota failure is nonfatal.
  void snapshotCache.save(snapshotSecret, { cursor: sync.cursor, update: encode(Y.encodeStateAsUpdate(doc)), activeNoteId: 'team' });
}

async function request(action, data = {}, refreshed = false) {
  const reading = ['session', 'sync'].includes(action);
  const query = reading ? '?' + new URLSearchParams({ action, ...data }) : '';
  const response = await fetch('/api/internal-share' + query, {
    method: reading ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: reading ? {} : { 'Content-Type': 'application/json' },
    body: reading ? undefined : JSON.stringify({ action, csrf, ...data }),
    signal: AbortSignal.timeout(15000),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('서버 응답을 읽을 수 없습니다. 잠시 후 다시 시도해 주세요.'); }
  // Another tab can renew the shared cookie. Keep this operation's ID/payload,
  // refresh only its CSRF token, and retry at most once.
  if (!reading && action !== 'login' && !refreshed && response.status === 403 && result.error === 'CSRF_REJECTED') {
    const renewingEpoch = workspaceEpoch;
    const session = await request('session');
    if (renewingEpoch !== workspaceEpoch) throw new Error('접속 상태가 변경되어 요청을 취소했습니다.');
    if (!session.authenticated) throw Object.assign(new Error('다시 로그인해 주세요.'), { status: 401 });
    adoptSession(session);
    return request(action, data, true);
  }
  if (!response.ok) throw Object.assign(new Error(result.message || '문서 서버에 연결할 수 없습니다.'), { status: response.status, code: result.error });
  return result;
}

function saveFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const accessExtensions = enabled => [EditorView.editable.of(enabled), EditorState.readOnly.of(!enabled)];
function setEditing(enabled) {
  editor?.dispatch({ effects: editAccess.reconfigure(accessExtensions(enabled)) });
  document.querySelectorAll('[data-insert]').forEach(button => { button.disabled = !enabled; });
  ui.setNotesBusy(!enabled);
}

function activeNote() { return listNotes(doc).find(note => note.id === activeNoteId); }
function bodyText() { return getNoteText(doc, activeNoteId); }
function requireEditableNotes() {
  if (!doc || !sync?.ready || sync.paused || loggingOut || changingPassword || ui.appShell.hidden) {
    throw new Error('문서를 불러온 뒤 다시 시도해 주세요.');
  }
}
function destroyEditor() {
  documentSearch?.destroy(); documentSearch = null;
  ui.clearDocumentSearch();
  editor?.destroy(); editor = null;
  editorUndo?.destroy(); editorUndo = null;
}
function selectNote(id) {
  requireEditableNotes();
  if (!listNotes(doc).some(note => note.id === id)) throw new Error('노트를 찾을 수 없습니다.');
  if (activeNoteId !== id) {
    // Every note shares one CRDT sync queue, so switching editors never discards
    // pending changes or assigns them to the newly selected note.
    destroyEditor(); ui.editorHost.replaceChildren();
    activeNoteId = id;
    createEditor();
  } else render();
}
function onDocumentUpdate() {
  clearTimeout(renderTimer); renderTimer = setTimeout(render, 100);
}

function render() {
  if (!doc) return;
  ui.renderNotes(listNotes(doc), activeNoteId);
  const text = bodyText().toString();
  renderPreview(ui.previewHost, text);
  ui.outlineHost.replaceChildren();
  let offset = 0, count = 0;
  for (const line of text.split('\n')) {
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading && count++ < 100) {
      const at = offset, button = document.createElement('button');
      button.type = 'button'; button.textContent = heading[2]; button.className = 'outline-item';
      button.style.paddingLeft = `${(heading[1].length - 1) * 12 + 8}px`;
      button.addEventListener('click', () => {
        document.getElementById('edit-view-button').click();
        editor?.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'start' }) }); editor?.focus();
      });
      ui.outlineHost.append(button);
    }
    offset += line.length + 1;
  }
  if (!count) ui.outlineHost.textContent = '제목을 추가하면 문서 목차가 표시됩니다.';
}

function createEditor() {
  const text = bodyText();
  editorUndo = new Y.UndoManager(text);
  editor = new EditorView({
    parent: ui.editorHost,
    state: EditorState.create({ doc: text.toString(), extensions: [
      editAccess.of(accessExtensions(!loggingOut && !changingPassword && sync.ready && !sync.paused)), EditorView.lineWrapping, drawSelection(), markdown(), documentSearchExtension,
      keymap.of([...yUndoManagerKeymap.map(binding => ({ ...binding, run: view => view.state.facet(EditorState.readOnly) ? true : binding.run(view) })), ...defaultKeymap]),
      placeholder('공유할 업무 내용을 입력하세요.\n제목·목록을 사용해 정리하고, URL을 붙여 넣으면 읽기 화면에서 클릭할 수 있습니다.'),
      // y-codemirror also handles native historyUndo/historyRedo beforeinput.
      // Stop these before its handler when logout/expiry has locked editing.
      Prec.highest(EditorView.domEventHandlers({ beforeinput: (_event, view) => view.state.facet(EditorState.readOnly) })),
      yCollab(text, null, { undoManager: editorUndo }),
      EditorView.contentAttributes.of({ 'aria-label': '공유 문서 편집', spellcheck: 'false' }),
      EditorState.transactionFilter.of(transaction => {
        if (!transaction.docChanged || transaction.annotation(ySyncAnnotation)) return transaction;
        if (transaction.startState.facet(EditorState.readOnly)) return [];
        let bytes = 0;
        transaction.changes.iterChanges((_a, _b, _c, _d, inserted) => { bytes += utf8.encode(inserted.toString()).length; });
        if (bytes > 32000 || utf8.encode(transaction.newDoc.toString()).length > 250000) {
          queueMicrotask(() => showError('한 번에 붙여 넣는 내용은 32KB, 문서 전체는 250KB까지 지원합니다. 내용을 나누어 입력해 주세요.'));
          return [];
        }
        return transaction;
      }),
    ] }),
  });
  documentSearch = createDocumentSearchController(editor, result => ui.setSearchResult(result.current, result.count));
  render();
}

function onStatus(event) {
  setStatus(event.message, event.state);
  if (event.state === 'locked') {
    workspaceEpoch++; openingTask = null;
    clearSnapshot();
    if (sync) { sync.paused = true; clearTimeout(sync.timer); }
    documentSearch?.clear();
    setEditing(false);
    setAuthenticated(false); showError('접속 시간이 만료되었거나 공유 비밀번호가 변경되었습니다. 현재 비밀번호로 다시 로그인하면 이 화면에 남은 변경사항을 이어서 저장합니다.');
  } else if (event.state === 'error') {
    if (showingSnapshot && !sync?.ready) {
      document.getElementById('loading-notice').textContent = '마지막 저장본을 표시하고 있습니다. 최신 내용 확인이 끝나면 편집할 수 있습니다.';
      setEditing(false);
    }
    showError(event.message + ' 화면을 닫기 전에 문서 또는 복구용 백업을 내려받으세요.');
  } else if (event.state === 'saved') {
    showingSnapshot = false;
    document.getElementById('loading-notice').hidden = true;
    showError('');
    // A failed first load may recover on the background retry, not only the button.
    if (!editor && sync?.ready && doc) createEditor();
    if (editor && sync?.ready && !sync.paused && !ui.appShell.hidden) setEditing(!loggingOut && !changingPassword);
    rememberSnapshot();
  }
}

function openDocument() {
  // Retry and other session refresh paths must share the same cache restore;
  // never rewind a cursor after a second opener has already begun polling.
  if (openingTask) return openingTask;
  const task = loadDocument();
  openingTask = task;
  void task.finally(() => { if (openingTask === task) openingTask = null; }).catch(() => {});
  return task;
}
function createSyncDocument() {
  doc = new Y.Doc();
  doc.on('update', onDocumentUpdate);
  sync = new SharedDocumentSync({ doc, request, author: () => ui.nameInput.value.trim().slice(0, 24), status: onStatus, hidden: () => document.hidden });
  sync.paused = true;
}
async function loadDocument() {
  setAuthenticated(true); setStatus('문서 불러오는 중…', 'syncing');
  setEditing(false);
  if (!doc) {
    createSyncDocument();
    // Fresh authentication must finish before decrypting any cached content.
    // Pause event-driven polling until its matching cursor has been restored.
    const openingDoc = doc, openingSync = sync, openingKey = snapshotSecret;
    let snapshot = await snapshotCache.load(openingKey);
    if (doc !== openingDoc || sync !== openingSync || openingKey !== snapshotSecret || ui.appShell.hidden) return;
    if (snapshot) {
      try { Y.applyUpdate(doc, decode(snapshot.update), sync); }
      catch {
        // A validly decoded but unusable snapshot must not strand loading or
        // leave a partially applied document in the authoritative sync queue.
        snapshotCache.clear(); snapshotSignature = ''; snapshot = null;
        sync.close(); doc.off('update', onDocumentUpdate); doc.destroy(); clearTimeout(renderTimer);
        createSyncDocument();
      }
    }
    if (snapshot) {
      sync.cursor = snapshot.cursor;
      showingSnapshot = true;
      createEditor(); setEditing(false);
      const notice = document.getElementById('loading-notice');
      notice.textContent = '마지막 저장본을 먼저 표시했습니다. 최신 변경사항을 확인하는 동안 잠시 읽기 전용입니다.';
      notice.hidden = false;
    }
  }
  ui.setNotesBusy(true);
  const connectingSync = sync;
  const connected = await connectingSync.resume();
  if (sync !== connectingSync) return;
  if (connected && !editor) createEditor();
  if (connected && editor && sync?.ready && !sync.paused && !ui.appShell.hidden) setEditing(!loggingOut && !changingPassword);
}

function closeWorkspace() {
  workspaceEpoch++;
  openingTask = null;
  clearSnapshot();
  csrf = ''; sync?.close(); destroyEditor(); doc?.off('update', onDocumentUpdate); doc?.destroy();
  sync = null; doc = null; clearTimeout(renderTimer); activeNoteId = 'team';
  ui.editorHost.replaceChildren(); ui.previewHost.replaceChildren(); ui.outlineHost.replaceChildren();
  ui.renderNotes([], 'team'); ui.setNotesBusy(true); setAuthenticated(false);
}

const ui = initUI({
  findText(query) { if (!ui.appShell.hidden) documentSearch?.setQuery(query); },
  findNext() { if (!ui.appShell.hidden) documentSearch?.next(); },
  findPrevious() { if (!ui.appShell.hidden) documentSearch?.previous(); },
  createNote(fields) {
    requireEditableNotes();
    selectNote(createNote(doc, fields));
  },
  updateNote(id, fields) {
    requireEditableNotes();
    updateNote(doc, id, fields); render();
  },
  selectNote,
  async login(password) {
    const loginEpoch = ++workspaceEpoch;
    document.getElementById('login-notice').hidden = true;
    const result = await request('login', { password });
    if (loginEpoch !== workspaceEpoch) return;
    adoptSession(result);
    await openDocument();
  },
  async changePassword(fields) {
    requireEditableNotes();
    changingPassword = true;
    const logoutButton = document.getElementById('logout-button');
    logoutButton.disabled = true; setEditing(false); editor?.contentDOM.blur();
    let submitted = false;
    try {
      // Freeze local input and require an acknowledged flush. Unlike logout,
      // changing the shared credential must never discard pending edits.
      for (let attempt = 0; sync?.unsaved && attempt < 4; attempt++) {
        if (!await sync.tick()) break;
      }
      if (sync?.unsaved || sync?.paused) throw new Error('먼저 변경사항 저장을 완료해 주세요. 연결을 확인한 뒤 다시 시도하세요.');
      submitted = true;
      const result = await request('change_password', fields);
      if (result.passwordChanged !== true) throw new Error('변경 결과를 확인할 수 없습니다.');
      closeWorkspace();
      const notice = document.getElementById('login-notice');
      notice.textContent = '공유 비밀번호를 변경했습니다. 새 비밀번호로 다시 로그인해 주세요.';
      notice.hidden = false;
    } catch (error) {
      if (error.code === 'INVALID_PASSWORD') throw new Error('현재 공유 비밀번호가 맞지 않습니다. 다시 확인해 주세요.');
      if (error.code === 'PASSWORD_CHANGED' || error.code === 'AUTH_REQUIRED') {
        onStatus({ state: 'locked', message: '공유 비밀번호가 변경되었습니다. 다시 로그인해 주세요.' });
        throw new Error('공유 비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해 주세요.');
      }
      if (submitted && (!error.status || error.status >= 500)) {
        const message = '변경 결과를 확인하지 못했습니다. 이미 변경되었을 수 있으니 새 비밀번호로 먼저 다시 로그인해 주세요. 미저장 내용은 이 화면에 유지됩니다.';
        onStatus({ state: 'locked', message }); showError(message);
        throw new Error(message);
      }
      throw error;
    } finally {
      changingPassword = false; logoutButton.disabled = false;
      if (editor && sync?.ready && !sync.paused && !ui.appShell.hidden) setEditing(true);
    }
  },
  async logout() {
    if (loggingOut || changingPassword) return;
    workspaceEpoch++;
    loggingOut = true;
    const button = document.getElementById('logout-button');
    button.disabled = true; setEditing(false); editor?.contentDOM.blur();
    try {
      if (sync?.unsaved) {
        await sync.tick();
        if (sync.unsaved && !confirm('아직 저장되지 않은 변경사항이 있습니다. 백업하지 않고 로그아웃하면 잃을 수 있습니다. 로그아웃할까요?')) return;
      }
      await request('logout'); closeWorkspace();
    } finally {
      loggingOut = false; button.disabled = false;
      if (editor && sync?.ready && !sync.paused && !ui.appShell.hidden) setEditing(true);
    }
  },
  download() {
    if (!doc || !sync?.ready) return;
    const title = activeNote().title.replace(/[\\/:*?"<>|]/g, '_');
    saveFile(`아인_${title}_${stamp()}.md`, bodyText().toString(), 'text/markdown;charset=utf-8');
  },
  backup() {
    if (!doc || !sync?.ready) return;
    saveFile(`아인_전체노트_복구본_${stamp()}.json`, JSON.stringify({ format: 'ain-internal-yjs-v2', createdAt: new Date().toISOString(), cursor: sync.cursor, hasUnsavedChanges: Boolean(sync.unsaved), activeNoteId, update: encode(Y.encodeStateAsUpdate(doc)), notes: listNotes(doc).map(note => ({ ...note, text: getNoteText(doc, note.id).toString() })) }, null, 2), 'application/json');
  },
  async retry() {
    if (loggingOut || changingPassword) return;
    const retryEpoch = workspaceEpoch;
    const session = await request('session');
    if (retryEpoch !== workspaceEpoch || loggingOut || changingPassword) return;
    if (!session.authenticated) { onStatus({ state: 'locked', message: '다시 로그인해 주세요.' }); return; }
    adoptSession(session); await openDocument();
  },
  insert(kind) {
    if (!editor || !sync?.ready || sync.paused || loggingOut || changingPassword) return;
    const inserts = { heading: '\n## 제목\n', list: '\n- 내용\n', checkbox: '\n- [ ] 할 일\n', link: '[링크 이름](https://example.com)' };
    const selection = editor.state.selection.main;
    editor.dispatch({ changes: { from: selection.from, to: selection.to, insert: inserts[kind] || '' } }); editor.focus();
  },
});

window.addEventListener('beforeunload', event => { if (sync?.unsaved) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && sync && !sync.paused) sync.tick(); });
window.addEventListener('online', () => { if (sync && !sync.paused) sync.tick(); });
setAuthenticated(false);
const initialEpoch = workspaceEpoch;
request('session').then(async result => {
  if (initialEpoch === workspaceEpoch && result.authenticated) { adoptSession(result); await openDocument(); }
}).catch(error => { if (initialEpoch === workspaceEpoch) showError(error.message); });
