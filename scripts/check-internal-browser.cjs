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
let blocked = false;
let failLogout = false, holdLogout = null, logoutStarted = null, csrfRejections = 0;
const env = { INTERNAL_SHARE_PASSWORD_HASH: `scrypt:${salt.toString('base64url')}:${key.toString('base64url')}`, INTERNAL_SHARE_SESSION_SECRET: crypto.randomBytes(32).toString('hex'), SUPABASE_URL: 'https://storage.example.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only' };
const handler = createInternalShareHandler({ env, fetch: async (address, options = {}) => {
  const url = new URL(address), body = options.body ? JSON.parse(options.body) : {};
  let data;
  if (url.pathname.endsWith('/internal_share_login_guard')) data = { allowed: true, attempt_id: crypto.randomUUID() };
  else if (url.pathname.endsWith('/internal_share_login_complete')) data = true;
  else if (url.pathname.endsWith('/internal_share_append')) {
    let seq = ops.get(body.p_op_id);
    if (!seq) { seq = rows.length + 1; rows.push({ seq, op_id: body.p_op_id, update_base64: body.p_update_base64 }); ops.set(body.p_op_id, seq); }
    data = { seq };
  } else if (url.pathname.endsWith('/internal_share_updates')) data = rows.filter(r => r.seq > Number(url.searchParams.get('seq').slice(3))).slice(0, Number(url.searchParams.get('limit')));
  else throw new Error('Unexpected mock storage path');
  return { ok: true, json: async () => data };
} });

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'chrome' });
  try {
    async function context(viewport) {
      const context = await browser.newContext({ viewport });
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== 'https://ain.example.test') return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>External link test</p>' });
        if (url.pathname === '/api/internal-share') {
          if (blocked) return route.abort('internetdisconnected');
          const headers = await request.allHeaders();
          const req = { method: request.method(), query: Object.fromEntries(url.searchParams), headers: { ...headers, host: url.host }, body: request.postData() || undefined, socket: { remoteAddress: '127.0.0.1' } };
          if (req.body && JSON.parse(req.body).action === 'logout') {
            if (failLogout) { failLogout = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Logout test failure' }) }); }
            if (holdLogout) { logoutStarted?.(); await holdLogout; }
          }
          const reply = { code: 200, headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(value) { this.body = JSON.stringify(value); return this; } };
          await handler(req, reply);
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
    const errors = []; for (const page of [a,b]) page.on('pageerror', error => errors.push(error.message));
    async function login(page) {
      await page.goto('https://ain.example.test/note');
      await page.locator('#password').fill(password); await page.locator('#login-submit').click();
      await page.locator('.cm-content[contenteditable=true]').waitFor();
    }
    await login(a); await login(b);
    await a.locator('.cm-content').click(); await a.keyboard.insertText('# 업무 공유\n오늘 업무');
    await b.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('오늘 업무'));
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
    const teamText = await a.locator('.cm-content').innerText();
    await a.locator('#new-note-button').click();
    await a.locator('#note-title-input').fill('통관 업무');
    await a.locator('#note-category-input').fill('업무');
    await a.locator('#note-form button[type=submit]').click();
    await a.locator('#note-heading').filter({hasText:'통관 업무'}).waitFor();
    const noteId = await a.locator('#notes-list [data-note-id][aria-current="page"]').getAttribute('data-note-id');
    assert.notEqual(noteId,'team');
    await a.locator('.cm-content').click(); await a.keyboard.insertText('# 새 노트\n분리된 업무 내용');
    await a.locator('#notes-list [data-note-id="team"]').click();
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
    await a.reload(); await a.locator('.cm-content[contenteditable=true]').waitFor();
    assert.equal(await a.locator('.cm-content').innerText(),teamText);
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
    const artifacts = path.join(root, '.artifacts'); fs.mkdirSync(artifacts, { recursive: true });
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
    const unauthorized = await a.evaluate(async () => (await fetch('/api/internal-share?action=sync&after=0')).status);
    assert.equal(unauthorized, 401); assert.deepEqual(errors, []);
    console.log('PASS: password gate, 2-browser concurrent Korean typing, cross-tab CSRF renewal, multiple notes/categories, offline switch preservation, per-note separation, shared rename, refresh persistence, safe clickable links/new tab, XSS rejection, mobile overflow, failed logout recovery, delayed logout input lock and protected API. Storage is a synthetic mock; production DB NOT tested.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
