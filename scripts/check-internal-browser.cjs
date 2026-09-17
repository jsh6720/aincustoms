// Isolated browser check: real UI + handler, synthetic password and in-memory storage only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createInternalShareHandler } = require('../lib/internal-share-server');
const root = path.resolve(__dirname, '..');
const password = crypto.randomBytes(20).toString('base64url');
const salt = crypto.randomBytes(16);
const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
const rows = [], ops = new Map();
const snapshotStorageKey = 'ain-note-snapshot-v1';
const pageControls = new WeakMap();
let blocked = false;
let credentialState = { revision: 0, password_hash: null };
let failLogout = false, holdLogout = null, logoutStarted = null, csrfRejections = 0;
let holdPasswordChange = null, passwordChangeStarted = null, passwordChangeRequests = 0;
const passwordChangeReplies = [];
function decryptSnapshot(stored, snapshotKey) {
  const envelope = JSON.parse(stored);
  assert.deepEqual(Object.keys(envelope).sort(), ['ciphertext', 'format', 'iv']);
  assert.equal(envelope.format, snapshotStorageKey);
  const iv = Buffer.from(envelope.iv, 'base64url'), encrypted = Buffer.from(envelope.ciphertext, 'base64');
  assert.equal(iv.length, 12); assert.ok(encrypted.length > 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(snapshotKey, 'base64url'), iv);
  decipher.setAAD(Buffer.from(snapshotStorageKey + ':https://ain.example.test'));
  decipher.setAuthTag(encrypted.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8'));
}
const env = { INTERNAL_SHARE_PASSWORD_HASH: `scrypt:${salt.toString('base64url')}:${key.toString('base64url')}`, INTERNAL_SHARE_SESSION_SECRET: crypto.randomBytes(32).toString('hex'), SUPABASE_URL: 'https://storage.example.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only' };
const handler = createInternalShareHandler({ env, fetch: async (address, options = {}) => {
  const url = new URL(address), body = options.body ? JSON.parse(options.body) : {};
  let data;
  if (url.pathname.endsWith('/internal_share_auth_state')) data = { ...credentialState };
  else if (url.pathname.endsWith('/internal_share_password_change')) {
    if (body.p_expected_revision !== credentialState.revision) data = { changed: false };
    else { credentialState = { revision: credentialState.revision + 1, password_hash: body.p_password_hash }; data = { changed: true, revision: credentialState.revision }; }
  }
  else if (url.pathname.endsWith('/internal_share_login_guard')) data = { allowed: true, attempt_id: crypto.randomUUID() };
  else if (url.pathname.endsWith('/internal_share_login_complete')) data = true;
  else if (url.pathname.endsWith('/internal_share_append')) {
    let seq = ops.get(body.p_op_id);
    if (!seq) { seq = rows.length + 1; rows.push({ seq, op_id: body.p_op_id, update_base64: body.p_update_base64 }); ops.set(body.p_op_id, seq); }
    data = { seq };
  } else if (url.pathname.endsWith('/internal_share_read_page')) {
    const candidates = rows.filter(r => r.seq > body.p_after);
    let bytes = 0;
    const updates = [];
    for (const row of candidates) {
      const size = row.update_base64.length + 256;
      if (updates.length >= 256 || bytes + size > 3 * 1024 * 1024) break;
      updates.push(row); bytes += size;
    }
    data = { updates, cursor: updates.at(-1)?.seq ?? body.p_after, has_more: updates.length < candidates.length };
  }
  else throw new Error('Unexpected mock storage path');
  return { ok: true, json: async () => data };
} });

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'chrome' });
  try {
    const artifacts = path.join(root, '.artifacts'); fs.mkdirSync(artifacts, { recursive: true });
    async function context(viewport) {
      const context = await browser.newContext({ viewport });
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== 'https://ain.example.test') return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>External link test</p>' });
        if (url.pathname === '/api/internal-share') {
          const action = request.postData() ? JSON.parse(request.postData()).action : url.searchParams.get('action') || 'session';
          const controls = pageControls.get(request.frame().page());
          if (action === 'sync' && controls) {
            controls.syncAfter.push(Number(url.searchParams.get('after') || 0));
            if (controls.syncDelayMs) await new Promise(resolve => setTimeout(resolve, controls.syncDelayMs));
            if (controls.holdSync) { controls.syncStarted?.(); await controls.holdSync; }
          }
          if (action === 'change_password') {
            passwordChangeRequests++;
            if (holdPasswordChange) { passwordChangeStarted?.(); await holdPasswordChange; }
          }
          if (blocked) return route.abort('internetdisconnected');
          const headers = await request.allHeaders();
          const req = { method: request.method(), query: Object.fromEntries(url.searchParams), headers: { ...headers, host: url.host }, body: request.postData() || undefined, socket: { remoteAddress: '127.0.0.1' } };
          if (req.body && JSON.parse(req.body).action === 'logout') {
            if (failLogout) { failLogout = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Logout test failure' }) }); }
            if (holdLogout) { logoutStarted?.(); await holdLogout; }
          }
          const reply = { code: 200, headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(value) { this.body = JSON.stringify(value); return this; } };
          await handler(req, reply);
          const replyBody = JSON.parse(reply.body);
          if (controls && replyBody.authenticated && replyBody.snapshotKey) controls.snapshotKeys.push(replyBody.snapshotKey);
          if (action === 'session' && controls?.holdSessionResponse) {
            controls.sessionResponseStarted?.(replyBody);
            await controls.holdSessionResponse;
          }
          if (action === 'change_password') passwordChangeReplies.push({ status: reply.code, ...JSON.parse(reply.body) });
          if (reply.code === 403 && JSON.parse(reply.body).error === 'CSRF_REJECTED') csrfRejections++;
          return route.fulfill({ status: reply.code, headers: { 'Content-Type': 'application/json', ...reply.headers }, body: reply.body });
        }
        if (['/internal','/internal/','/note/'].includes(url.pathname)) return route.fulfill({status:307,headers:{location:'/note'},body:''});
        const name = url.pathname === '/note' ? 'index.html' : url.pathname.split('/').pop();
        if (!['index.html', 'app.js', 'style.css'].includes(name)) return route.fulfill({ status: 404, body: '' });
        const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html';
        return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(path.join(root, 'internal', name)) });
      });
      return context;
    }
    const aContext = await context({ width: 1440, height: 1000 }), bContext = await context({ width: 1280, height: 900 });
    const a = await aContext.newPage(), b = await bContext.newPage();
    const aControls = { syncAfter: [], snapshotKeys: [], syncDelayMs: 0, holdSync: null, syncStarted: null };
    pageControls.set(a, aControls);
    const errors = []; for (const page of [a,b]) page.on('pageerror', error => errors.push(error.message));
    async function login(page, credential = password) {
      await page.goto('https://ain.example.test/note');
      await page.locator('#password').fill(credential); await page.locator('#login-submit').click();
      await page.locator('.cm-content[contenteditable=true]').waitFor();
    }
    async function expectSearchCount(page, count) {
      await page.waitForFunction(expected => document.querySelector('#search-count')?.textContent === expected, count);
    }
    async function fillPasswordChange(page, current, next, confirm = next) {
      await page.locator('#current-password').fill(current);
      await page.locator('#new-password').fill(next);
      await page.locator('#confirm-password').fill(confirm);
    }
    await login(a); await login(b);
    await a.locator('.cm-content').click(); await a.keyboard.insertText('# 업무 공유\n오늘 업무');
    await b.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('오늘 업무'));
    // Search uses synthetic Korean text already present in the shared note.
    const initialText = await a.locator('.cm-content').innerText();
    await a.locator('#document-search').fill('업무'); await expectSearchCount(a, '1/2');
    assert.equal(await a.evaluate(() => document.activeElement?.id), 'document-search');
    assert.equal(await a.locator('.cm-documentSearchMatch').count(), 2);
    assert.equal(await a.locator('.cm-documentSearchMatch-current').count(), 1);
    assert.equal(await a.locator('.cm-line').first().locator('.cm-documentSearchMatch-current').innerText(), '업무');
    await a.screenshot({ path: path.join(artifacts, 'internal-search-desktop.png'), fullPage: true });
    await a.locator('#search-next').click(); await expectSearchCount(a, '2/2');
    assert.equal(await a.locator('.cm-line').nth(1).locator('.cm-documentSearchMatch-current').innerText(), '업무');
    await a.locator('#search-next').click(); await expectSearchCount(a, '1/2');
    await a.locator('#search-previous').click(); await expectSearchCount(a, '2/2');
    await a.locator('#document-search').focus();
    await a.locator('#document-search').press('Shift+Enter'); await expectSearchCount(a, '1/2');
    await a.locator('#document-search').press('Enter'); await expectSearchCount(a, '2/2');
    await a.locator('#document-search').fill('없는검색어'); await expectSearchCount(a, '0/0');
    assert.equal(await a.locator('#search-previous').isDisabled(), true);
    assert.equal(await a.locator('#search-next').isDisabled(), true);
    await a.locator('#document-search').fill('업무'); await expectSearchCount(a, '1/2');
    await a.locator('#read-view-button').click();
    assert.equal(await a.locator('#document-search').isVisible(), false);
    assert.match(await a.locator('#preview-host').innerText(), /오늘 업무/);
    await a.locator('#edit-view-button').click();
    assert.equal(await a.locator('.cm-content').innerText(), initialText);
    await a.locator('#document-search').fill('업무');
    await a.locator('#document-search').press('Escape'); await expectSearchCount(a, '0/0');
    assert.equal(await a.locator('#document-search').inputValue(), '');
    assert.equal(await a.locator('#search-clear').isDisabled(), true);
    const mobileSearchWidths = [];
    for (const width of [390, 320]) {
      await a.setViewportSize({ width, height: 844 });
      await a.locator('#document-search').fill('업무'); await expectSearchCount(a, '1/2');
      assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await a.locator('#search-next').evaluate(button => button.getBoundingClientRect().right <= innerWidth), true);
      const inputWidth = await a.locator('#document-search').evaluate(input => input.getBoundingClientRect().width);
      assert.ok(inputWidth >= 100, `Search input must remain at least 100px wide at ${width}px viewport; actual ${inputWidth}px`);
      mobileSearchWidths.push({ viewport: width, input: inputWidth });
    }
    await a.screenshot({ path: path.join(artifacts, 'internal-search-mobile.png'), fullPage: true });
    await a.locator('#search-clear').click(); await expectSearchCount(a, '0/0');
    await a.setViewportSize({ width: 1440, height: 1000 });
    blocked = true;
    for (const [page, text] of [[a, ' / 통관'], [b, ' / 서류']]) { await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(text); }
    blocked = false;
    for (const page of [a,b]) await page.evaluate(() => dispatchEvent(new Event('online')));
    for (const page of [a,b]) await page.waitForFunction(() => { const t=document.querySelector('.cm-content')?.textContent; return t?.includes('통관') && t?.includes('서류'); });
    assert.equal(await a.locator('.cm-content').innerText(), await b.locator('.cm-content').innerText());
    // A sibling tab renews the shared cookie while this tab holds the old CSRF.
    const sibling = await aContext.newPage();
    await sibling.goto('https://ain.example.test/note');
    assert.equal(await sibling.evaluate(async password => (await fetch('/api/internal-share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', password }) })).status, password), 200);
    await sibling.close();
    await a.locator('.cm-content').click(); await a.keyboard.press('Control+End'); await a.keyboard.insertText(' / 세션갱신');
    await b.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('세션갱신'));
    assert.ok(csrfRejections >= 1);
    // Switching editors shares one pending queue, including an offline new note.
    blocked = true;
    await a.locator('.cm-content').click(); await a.keyboard.press('Control+End'); await a.keyboard.insertText(' / 전환전입력');
    let teamText = await a.locator('.cm-content').innerText();
    await a.locator('#new-note-button').click();
    await a.locator('#note-title-input').fill('통관 업무');
    await a.locator('#note-category-input').fill('업무');
    await a.locator('#note-form button[type=submit]').click();
    await a.locator('#note-heading').filter({hasText:'통관 업무'}).waitFor();
    const noteId = await a.locator('#notes-list [data-note-id][aria-current="page"]').getAttribute('data-note-id');
    assert.notEqual(noteId,'team');
    await a.locator('.cm-content').click(); await a.keyboard.insertText('# 새 노트\n분리된 업무 내용');
    await a.locator('#document-search').fill('분리'); await expectSearchCount(a, '1/1');
    await a.locator('#notes-list [data-note-id="team"]').click();
    assert.equal(await a.locator('#document-search').inputValue(), '');
    await expectSearchCount(a, '0/0');
    assert.equal(await a.locator('.cm-content').innerText(),teamText);
    blocked = false;
    for (const page of [a,b]) await page.evaluate(() => dispatchEvent(new Event('online')));
    await b.locator(`#notes-list [data-note-id="${noteId}"]`).waitFor();
    await b.locator(`#notes-list [data-note-id="${noteId}"]`).click();
    await b.waitForFunction(()=>document.querySelector('.cm-content')?.textContent.includes('분리된 업무 내용'));
    assert.equal((await b.locator('.cm-content').innerText()).includes('오늘 업무'),false);
    await b.locator('.cm-content').click(); await b.keyboard.press('Control+End'); await b.keyboard.insertText(' / 다른 구성원');
    await a.locator(`#notes-list [data-note-id="${noteId}"]`).click();
    await a.waitForFunction(()=>document.querySelector('.cm-content')?.textContent.includes('다른 구성원'));
    await b.locator('#edit-note-button').click();
    await b.locator('#note-title-input').fill('서류 진행');
    await b.locator('#note-category-input').fill('통관');
    await b.locator('#note-form button[type=submit]').click();
    await a.waitForFunction(()=>document.querySelector('#note-heading')?.textContent==='서류 진행');
    assert.match(await a.locator('#notes-list').innerText(),/통관/);
    // Both dialogs start from the same values; unrelated changed fields must merge.
    await a.locator('#edit-note-button').click(); await b.locator('#edit-note-button').click();
    await a.locator('#note-title-input').fill('서류 진행 (팀)');
    await b.locator('#note-category-input').fill('공동업무');
    await a.locator('#note-form button[type=submit]').click();
    await b.waitForFunction(()=>document.querySelector('#note-heading')?.textContent==='서류 진행 (팀)');
    await b.locator('#note-form button[type=submit]').click();
    await a.waitForFunction(()=>document.querySelector('#note-category')?.textContent==='공동업무');
    assert.equal(await a.locator('#note-heading').textContent(),'서류 진행 (팀)');
    await a.waitForFunction(()=>document.querySelector('#sync-status')?.dataset.kind==='saved');
    // A cold load and a cached load see the same synthetic sync latency. Only a's
    // request is held, so b can continue saving remote changes during refresh.
    await a.evaluate(storageKey => localStorage.removeItem(storageKey), snapshotStorageKey);
    aControls.syncDelayMs = 600; aControls.syncAfter.length = 0;
    const coldStarted = performance.now();
    await a.reload(); await a.locator('.cm-content[contenteditable=true]').waitFor();
    const coldEditableMs = Math.round(performance.now() - coldStarted);
    assert.equal(aControls.syncAfter[0], 0);
    assert.equal(await a.locator('.cm-content').innerText(),teamText);
    await a.waitForFunction(storageKey => Boolean(localStorage.getItem(storageKey)), snapshotStorageKey);
    const encryptedSnapshot = await a.evaluate(storageKey => localStorage.getItem(storageKey), snapshotStorageKey);
    assert.equal(encryptedSnapshot.includes('오늘 업무'), false);
    assert.equal(encryptedSnapshot.includes('분리된 업무 내용'), false);
    assert.equal(encryptedSnapshot.includes('서류 진행 (팀)'), false);
    assert.ok(aControls.snapshotKeys.length > 0);
    const savedSnapshot = decryptSnapshot(encryptedSnapshot, aControls.snapshotKeys.at(-1));
    assert.ok(savedSnapshot.cursor > 0); assert.equal(savedSnapshot.activeNoteId, 'team');
    const storedValues = await a.evaluate(() => Object.values(localStorage).join('\n'));
    for (const snapshotKey of aControls.snapshotKeys) assert.equal(storedValues.includes(snapshotKey), false);
    let releaseCachedSync;
    aControls.holdSync = new Promise(resolve => { releaseCachedSync = resolve; });
    const cachedSyncStarted = new Promise(resolve => { aControls.syncStarted = resolve; });
    aControls.syncAfter.length = 0;
    const cachedStarted = performance.now();
    await a.reload(); await a.locator('.cm-content[contenteditable=false]').waitFor();
    const cachedReadableMs = Math.round(performance.now() - cachedStarted);
    await a.locator('#loading-notice').waitFor({ state: 'visible' });
    assert.equal(await a.locator('.cm-content').innerText(), teamText);
    assert.equal(await a.locator('#new-note-button').isDisabled(), true);
    assert.equal(await a.locator('#edit-note-button').isDisabled(), true);
    assert.equal(await a.locator('[data-insert="link"]').isDisabled(), true);
    await a.locator('.cm-content').click(); await a.keyboard.insertText('캐시 대기 중 입력 금지'); await a.keyboard.press('Control+z');
    assert.equal(await a.locator('.cm-content').innerText(), teamText);
    await cachedSyncStarted;
    assert.ok(aControls.syncAfter[0] > 0, 'Cached reload must request only updates after its saved cursor');
    assert.equal(aControls.syncAfter[0], savedSnapshot.cursor);
    await b.locator('#notes-list [data-note-id="team"]').click();
    await b.locator('.cm-content').click(); await b.keyboard.press('Control+End'); await b.keyboard.insertText(' / 캐시새로고침중원격입력');
    await b.waitForFunction(() => document.querySelector('#sync-status')?.dataset.kind === 'saved');
    assert.equal(await a.locator('.cm-content').innerText(), teamText);
    releaseCachedSync(); aControls.holdSync = null; aControls.syncStarted = null; aControls.syncDelayMs = 0;
    await a.locator('.cm-content[contenteditable=true]').waitFor();
    await a.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('캐시새로고침중원격입력'));
    await a.locator('#loading-notice').waitFor({ state: 'hidden' });
    assert.equal(await a.locator('#new-note-button').isDisabled(), false);
    assert.equal(await a.locator('#edit-note-button').isDisabled(), false);
    teamText = await a.locator('.cm-content').innerText();
    assert.equal(teamText, await b.locator('.cm-content').innerText());
    const loadTimings = { syntheticSyncDelayMs: 600, coldEditableMs, cachedReadableMs, deltaAfter: aControls.syncAfter[0] };
    await a.locator(`#notes-list [data-note-id="${noteId}"]`).click();
    assert.match(await a.locator('.cm-content').innerText(),/분리된 업무 내용.*다른 구성원/s);
    await a.locator('.cm-content').click(); await a.keyboard.press('Control+End'); await a.keyboard.insertText('\nhttps://example.com/work\n[위험](javascript:alert(1))\n<img src=x onerror="window.__unsafe=1">');
    await a.locator('#read-view-button').click();
    await a.locator('#preview-host a[href="https://example.com/work"]').waitFor();
    const safe = a.locator('#preview-host a[href="https://example.com/work"]');
    assert.equal(await safe.getAttribute('target'), '_blank'); assert.match(await safe.getAttribute('rel'), /noopener/);
    assert.equal(await a.locator('#preview-host a[href^="javascript:"]').count(), 0);
    assert.equal(await a.locator('#preview-host img').count(), 0);
    assert.equal(await a.evaluate(() => window.__unsafe), undefined);
    const popupPromise = a.waitForEvent('popup'); await safe.click(); const popup = await popupPromise;
    await popup.waitForLoadState(); assert.equal(popup.url(), 'https://example.com/work'); await popup.close();
    const downloadPromise = a.waitForEvent('download');
    await a.locator('#backup-button').click();
    const backup = await downloadPromise;
    const exported = JSON.parse(fs.readFileSync(await backup.path(),'utf8'));
    assert.equal(exported.format,'ain-internal-yjs-v2');
    assert.equal(exported.activeNoteId,noteId);
    assert.equal(exported.notes.find(note=>note.id==='team').text,teamText);
    assert.equal(exported.notes.find(note=>note.id===noteId).category,'공동업무');
    assert.match(exported.notes.find(note=>note.id===noteId).text,/분리된 업무 내용/);
    await a.screenshot({ path: path.join(artifacts, 'internal-desktop.png'), fullPage: true });
    await a.setViewportSize({ width: 390, height: 844 });
    assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await a.locator('#notes-toggle-button').click();
    await a.locator('#notes-list [data-note-id="team"]').waitFor({state:'visible'});
    await a.locator('#notes-list [data-note-id="team"]').click();
    assert.equal((await a.locator('.cm-content .cm-line').allTextContents()).join('\n'),teamText);
    await a.locator('#notes-toggle-button').click();
    await a.locator(`#notes-list [data-note-id="${noteId}"]`).click();
    await a.screenshot({ path: path.join(artifacts, 'internal-mobile.png'), fullPage: true });
    await a.locator('#edit-view-button').click();
    failLogout = true;
    await a.locator('#logout-button').click();
    await a.locator('#app-error-message').filter({ hasText: 'Logout test failure' }).waitFor();
    assert.equal(await a.locator('.cm-content').getAttribute('contenteditable'), 'true');
    const beforeLogout = await a.locator('.cm-content').innerText();
    // The retry's successful authentication is captured before logout but only
    // delivered afterward. It must not reopen the closed workspace or cache.
    let releaseRetrySession;
    aControls.holdSessionResponse = new Promise(resolve => { releaseRetrySession = resolve; });
    const retrySessionStarted = new Promise(resolve => { aControls.sessionResponseStarted = resolve; });
    const retrySessionResponse = a.waitForResponse(response => new URL(response.url()).searchParams.get('action') === 'session');
    await a.locator('#retry-button').click();
    assert.equal((await retrySessionStarted).authenticated, true);
    let releaseLogout;
    holdLogout = new Promise(resolve => { releaseLogout = resolve; });
    const started = new Promise(resolve => { logoutStarted = resolve; });
    await a.locator('#logout-button').click(); await started;
    assert.equal(await a.locator('.cm-content').getAttribute('contenteditable'), 'false');
    assert.equal(await a.locator('[data-insert="link"]').isDisabled(), true);
    await a.locator('.cm-content').click(); await a.keyboard.insertText('사라지면 안 되는 입력'); await a.keyboard.press('Control+z');
    assert.equal(await a.locator('.cm-content').innerText(), beforeLogout);
    releaseLogout(); await a.locator('#login-shell').waitFor({ state: 'visible' });
    assert.equal(await a.locator('#preview-host').textContent(), '');
    assert.equal(await a.evaluate(storageKey => localStorage.getItem(storageKey), snapshotStorageKey), null);
    const readsAfterLogout = aControls.syncAfter.length;
    releaseRetrySession(); aControls.holdSessionResponse = null; aControls.sessionResponseStarted = null;
    await (await retrySessionResponse).finished();
    await a.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await a.locator('#login-shell').isVisible(), true);
    assert.equal(await a.locator('#app-shell').isVisible(), false);
    assert.equal(await a.locator('.cm-content').count(), 0);
    assert.equal(await a.evaluate(storageKey => localStorage.getItem(storageKey), snapshotStorageKey), null);
    assert.equal(aControls.syncAfter.length, readsAfterLogout);
    const unauthorized = await a.evaluate(async () => (await fetch('/api/internal-share?action=sync&after=0')).status);
    assert.equal(unauthorized, 401);
    holdLogout = null; logoutStarted = null;
    // Credential rotation is confined to this handler's synthetic in-memory state.
    await a.setViewportSize({ width: 1440, height: 1000 });
    await login(a);
    const newPassword = crypto.randomBytes(3).toString('hex'); // Synthetic six-character boundary.
    await a.locator('#settings-button').click();
    await a.locator('#password-dialog').waitFor({ state: 'visible' });
    assert.match(await a.locator('#password-dialog').innerText(), /접속 중인 구성원 모두/);
    assert.equal(await a.locator('#new-password').getAttribute('minlength'), '6');
    assert.equal(await a.locator('#confirm-password').getAttribute('minlength'), '6');
    const beforeShortPassword = passwordChangeRequests;
    await fillPasswordChange(a, password, 'abcde');
    await a.locator('#password-change-submit').click();
    assert.match(await a.locator('#password-change-error').innerText(), /6자 이상/);
    assert.equal(passwordChangeRequests, beforeShortPassword);
    await fillPasswordChange(a, 'synthetic-wrong-current-password', newPassword);
    await a.locator('#password-change-submit').click();
    await a.locator('#password-change-error').waitFor({ state: 'visible' });
    assert.equal(passwordChangeReplies.at(-1).status, 401);
    assert.equal(passwordChangeReplies.at(-1).error, 'INVALID_PASSWORD');
    assert.match(await a.locator('#password-change-error').innerText(), /현재 공유 비밀번호가 맞지 않습니다/);
    assert.equal(await a.locator('#app-shell').isVisible(), true);
    assert.equal(await a.locator('#password-dialog').isVisible(), true);
    assert.equal(credentialState.revision, 0);
    const beforeMismatch = passwordChangeRequests;
    await fillPasswordChange(a, password, newPassword, newPassword + '-mismatch');
    await a.locator('#password-change-submit').click();
    assert.match(await a.locator('#password-change-error').innerText(), /일치하지/);
    assert.equal(passwordChangeRequests, beforeMismatch);
    await a.locator('#password-change-cancel').click();
    assert.equal(await a.locator('#current-password').inputValue(), '');
    assert.equal(await a.locator('#new-password').inputValue(), '');
    assert.equal(await a.locator('#confirm-password').inputValue(), '');
    // Pending offline edits must finish saving before any credential request is sent.
    blocked = true;
    await a.locator('.cm-content').click(); await a.keyboard.press('Control+End');
    await a.keyboard.insertText('\n비밀번호 변경 전 보존검증');
    const persistedTeam = await a.locator('.cm-content').innerText();
    await a.locator('#settings-button').click(); await fillPasswordChange(a, password, newPassword);
    const beforeBlockedChange = passwordChangeRequests;
    await a.locator('#password-change-submit').click();
    await a.locator('#password-change-error').waitFor({ state: 'visible' });
    await a.waitForFunction(() => !document.querySelector('#password-change-submit').disabled);
    assert.match(await a.locator('#password-change-error').innerText(), /먼저 변경사항 저장을 완료/);
    assert.equal(passwordChangeRequests, beforeBlockedChange);
    assert.equal(credentialState.revision, 0);
    assert.equal(await a.locator('.cm-content').getAttribute('contenteditable'), 'true');
    assert.equal(await a.locator('#password-dialog').isVisible(), true);
    await a.locator('#password-change-cancel').click();
    blocked = false;
    for (const page of [a,b]) await page.evaluate(() => dispatchEvent(new Event('online')));
    await a.waitForFunction(() => document.querySelector('#sync-status')?.dataset.kind === 'saved');
    await b.locator('#notes-list [data-note-id="team"]').click();
    await b.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('비밀번호 변경 전 보존검증'));
    assert.equal(await b.locator('.cm-content').innerText(), persistedTeam);
    await a.waitForFunction(storageKey => Boolean(localStorage.getItem(storageKey)), snapshotStorageKey);
    const preRotationSnapshot = await a.evaluate(storageKey => localStorage.getItem(storageKey), snapshotStorageKey);
    const preRotationKey = aControls.snapshotKeys.at(-1);
    let releasePasswordChange;
    holdPasswordChange = new Promise(resolve => { releasePasswordChange = resolve; });
    const changeStarted = new Promise(resolve => { passwordChangeStarted = resolve; });
    await a.locator('#settings-button').click(); await fillPasswordChange(a, password, newPassword);
    await a.screenshot({ path: path.join(artifacts, 'internal-password-settings.png'), fullPage: true });
    await a.locator('#password-change-submit').click(); await changeStarted;
    assert.equal(await a.locator('#password-change-submit').isDisabled(), true);
    assert.equal(await a.locator('#password-change-cancel').isDisabled(), true);
    assert.equal(await a.locator('#current-password').isDisabled(), true);
    assert.equal(await a.locator('#new-password').isDisabled(), true);
    assert.equal(await a.locator('.cm-content').getAttribute('contenteditable'), 'false');
    assert.equal(await a.locator('[data-insert="link"]').isDisabled(), true);
    await a.keyboard.press('Escape'); assert.equal(await a.locator('#password-dialog').isVisible(), true);
    const beforeDuplicate = passwordChangeRequests;
    await a.locator('#password-change-form').evaluate(form => form.requestSubmit());
    assert.equal(passwordChangeRequests, beforeDuplicate);
    assert.equal(await a.evaluate(secret => Object.values(localStorage).some(value => value.includes(secret)), newPassword), false);
    releasePasswordChange(); await a.locator('#login-shell').waitFor({ state: 'visible' });
    assert.equal(await a.evaluate(storageKey => localStorage.getItem(storageKey), snapshotStorageKey), null);
    holdPasswordChange = null; passwordChangeStarted = null;
    assert.equal(credentialState.revision, 1);
    assert.equal(passwordChangeReplies.at(-1).status, 200);
    assert.equal(passwordChangeReplies.at(-1).authenticated, false);
    assert.equal(passwordChangeReplies.at(-1).passwordChanged, true);
    assert.match(await a.locator('#login-notice').innerText(), /변경/);
    assert.equal(await a.locator('#password-dialog').isVisible(), false);
    for (const id of ['password', 'current-password', 'new-password', 'confirm-password']) assert.equal(await a.locator('#' + id).inputValue(), '');
    const siblingUnauthorized = await b.evaluate(async () => (await fetch('/api/internal-share?action=sync&after=0')).status);
    assert.equal(siblingUnauthorized, 401);
    // Even if an old encrypted snapshot is restored, expired authentication must
    // not expose its content and the rotated key must not unlock that snapshot.
    await a.evaluate(({ storageKey, snapshot }) => localStorage.setItem(storageKey, snapshot), { storageKey: snapshotStorageKey, snapshot: preRotationSnapshot });
    await a.reload(); await a.locator('#login-shell').waitFor({ state: 'visible' });
    assert.equal(await a.locator('#app-shell').isVisible(), false);
    assert.equal(await a.locator('.cm-content').count(), 0);
    assert.equal(await a.locator('#preview-host').textContent(), '');
    await a.locator('#password').fill(password); await a.locator('#login-submit').click();
    await a.locator('#login-error').waitFor({ state: 'visible' });
    assert.equal(await a.locator('#login-shell').isVisible(), true);
    assert.equal(await a.locator('#app-shell').isVisible(), false);
    // Put the original ciphertext back after the unauthenticated session check,
    // then hold the new session's first sync to expose any incorrect reuse.
    await a.evaluate(({ storageKey, snapshot }) => localStorage.setItem(storageKey, snapshot), { storageKey: snapshotStorageKey, snapshot: preRotationSnapshot });
    let releaseRotatedSync;
    aControls.holdSync = new Promise(resolve => { releaseRotatedSync = resolve; });
    const rotatedSyncStarted = new Promise(resolve => { aControls.syncStarted = resolve; });
    aControls.syncAfter.length = 0;
    await a.locator('#password').fill(newPassword); await a.locator('#login-submit').click();
    await rotatedSyncStarted;
    assert.notEqual(aControls.snapshotKeys.at(-1), preRotationKey);
    assert.throws(() => decryptSnapshot(preRotationSnapshot, aControls.snapshotKeys.at(-1)));
    assert.equal(aControls.syncAfter[0], 0, 'A snapshot encrypted before password rotation must not seed the new session');
    assert.equal(await a.locator('.cm-content').count(), 0);
    assert.equal(await a.locator('#preview-host').textContent(), '');
    releaseRotatedSync(); aControls.holdSync = null; aControls.syncStarted = null;
    await a.locator('.cm-content[contenteditable=true]').waitFor();
    assert.equal(await a.locator('.cm-content').innerText(), persistedTeam);
    await a.locator(`#notes-list [data-note-id="${noteId}"]`).click();
    assert.equal(await a.locator('.cm-content').innerText(), beforeLogout);
    // A long synthetic note exercises page scrolling rather than only short editor content.
    await a.locator('#new-note-button').click();
    await a.locator('#note-title-input').fill('장문 검색 검증');
    await a.locator('#note-category-input').fill('검증');
    await a.locator('#note-form button[type=submit]').click();
    await a.locator('#note-heading').filter({ hasText: '장문 검색 검증' }).waitFor();
    const longBody = Array.from({ length: 500 }, (_, index) => `검증용 문서 줄 ${String(index + 1).padStart(3, '0')}${[299, 449].includes(index) ? ' 장문이동검증' : ''}`).join('\n');
    await a.locator('.cm-content').click(); await a.keyboard.insertText(longBody);
    const longSearchViews = [];
    async function checkLongSearchViewport(page, viewportWidth, matchNumber) {
      await page.waitForFunction(() => {
        const rect = document.querySelector('.cm-documentSearchMatch-current')?.getBoundingClientRect();
        return scrollY > 0 && rect?.top >= 0 && rect.bottom <= innerHeight;
      });
      const positions = await page.evaluate(() => {
        const rect = selector => {
          const bounds = document.querySelector(selector).getBoundingClientRect();
          return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right, width: bounds.width, height: bounds.height };
        };
        return { scrollY, width: innerWidth, height: innerHeight, toolbar: rect('.document-toolbar'), current: rect('.cm-documentSearchMatch-current'), controls: ['#document-search', '#search-previous', '#search-next'].map(rect) };
      });
      assert.ok(positions.scrollY > 0, `Long note must scroll at ${viewportWidth}px, result ${matchNumber}`);
      assert.ok(positions.current.top >= positions.toolbar.bottom && positions.current.bottom <= positions.height, `Search match must remain visible below the toolbar at ${viewportWidth}px, result ${matchNumber}`);
      for (const control of positions.controls) assert.ok(control.width > 0 && control.height > 0 && control.top >= 0 && control.bottom <= positions.height && control.left >= 0 && control.right <= positions.width, `Search controls must remain in the viewport after long-note navigation at ${viewportWidth}px, result ${matchNumber}: ${JSON.stringify(control)}`);
      longSearchViews.push({ viewport: viewportWidth, result: matchNumber, scrollY: positions.scrollY, searchTop: positions.controls[0].top, matchTop: positions.current.top });
    }
    for (const width of [1440, 320]) {
      await a.setViewportSize({ width, height: width === 320 ? 844 : 1000 });
      await a.locator('#search-clear').click({ force: true });
      await a.evaluate(() => scrollTo(0, 0));
      await a.locator('#document-search').fill('장문이동검증'); await expectSearchCount(a, '1/2');
      await checkLongSearchViewport(a, width, 1);
      await a.locator('#search-next').click(); await expectSearchCount(a, '2/2');
      await checkLongSearchViewport(a, width, 2);
      await a.screenshot({ path: path.join(artifacts, width === 320 ? 'internal-search-long-mobile.png' : 'internal-search-long-desktop.png'), fullPage: false });
    }
    // An isolated page delays only WebCrypto decryption to force the narrow
    // overlap between cache restoration and another opener or logout.
    const raceContext = await context({ width: 1280, height: 900 }), race = await raceContext.newPage();
    race.on('pageerror', error => errors.push(error.message));
    const raceControls = { syncAfter: [], snapshotKeys: [] }; pageControls.set(race, raceControls);
    await login(race, newPassword);
    await race.waitForFunction(storageKey => Boolean(localStorage.getItem(storageKey)), snapshotStorageKey);
    const raceSnapshot = decryptSnapshot(await race.evaluate(storageKey => localStorage.getItem(storageKey), snapshotStorageKey), raceControls.snapshotKeys.at(-1));
    await race.addInitScript(() => {
      const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      window.__snapshotDecryptStarted = false;
      window.__releaseSnapshotDecrypt = release;
      crypto.subtle.decrypt = async (...args) => {
        window.__snapshotDecryptStarted = true;
        await gate;
        return decrypt(...args);
      };
    });
    raceControls.syncAfter.length = 0;
    await race.reload(); await race.waitForFunction(() => window.__snapshotDecryptStarted);
    assert.equal(await race.locator('.cm-content').count(), 0);
    const duplicateSession = race.waitForResponse(response => new URL(response.url()).searchParams.get('action') === 'session');
    // Invoke the registered retry control directly while its error banner is
    // hidden to exercise concurrent openers without altering production code.
    await race.locator('#retry-button').evaluate(button => button.click());
    await (await duplicateSession).finished();
    await race.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(raceControls.syncAfter, [], 'Retry must await the existing cache restore before starting sync');
    await race.evaluate(() => window.__releaseSnapshotDecrypt());
    await race.locator('.cm-content[contenteditable=true]').waitFor();
    assert.deepEqual(raceControls.syncAfter, [raceSnapshot.cursor]);
    assert.equal(await race.locator('.cm-content').count(), 1);
    assert.equal(await race.locator('.cm-content').innerText(), persistedTeam);
    raceControls.syncAfter.length = 0;
    await race.reload(); await race.waitForFunction(() => window.__snapshotDecryptStarted);
    await race.locator('#logout-button').click(); await race.locator('#login-shell').waitFor({ state: 'visible' });
    await race.evaluate(() => window.__releaseSnapshotDecrypt());
    await race.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await race.locator('#app-shell').isVisible(), false);
    assert.equal(await race.locator('.cm-content').count(), 0);
    assert.equal(await race.evaluate(storageKey => localStorage.getItem(storageKey), snapshotStorageKey), null);
    assert.deepEqual(raceControls.syncAfter, []);
    await raceContext.close();
    assert.deepEqual(errors, []);
    console.log('PASS: mobile search input widths ' + JSON.stringify(mobileSearchWidths));
    console.log('PASS: long-note search viewport positions ' + JSON.stringify(longSearchViews));
    console.log('PASS: encrypted cache, authenticated read-only cached preview, blocked cached editing, remote delta merge, logout clearing and password-rotation rejection; synthetic load timings ' + JSON.stringify(loadTimings));
    console.log('PASS: delayed retry authentication cannot reopen after logout; overlapping retry awaits one cache restore; logout cancels delayed cache decryption without restoring content or storage.');
    console.log('PASS: password gate, 2-browser concurrent Korean typing, cross-tab CSRF renewal, live Korean search/count/arrows/wrap/keyboard/reset, search preview and mobile layout, note-switch search clearing, multiple notes/categories, offline switch preservation, per-note separation, shared rename, refresh persistence, safe clickable links/new tab, XSS rejection, failed logout recovery, delayed logout input lock, password validation, offline flush guard, delayed credential-change lock, old-session revocation, old-password rejection, new-password login and retained notes. Storage and credentials are synthetic mocks; production DB NOT tested.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
