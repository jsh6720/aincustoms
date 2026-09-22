// Real UI + handler, synthetic credentials, append history and private bucket only.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), Y = require('yjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createInternalShareHandler } = require('../lib/internal-share-server');
const root = path.resolve(__dirname, '..'), password = crypto.randomBytes(20).toString('base64url');
const salt = crypto.randomBytes(16), key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
const env = { INTERNAL_SHARE_PASSWORD_HASH: `scrypt:${salt.toString('base64url')}:${key.toString('base64url')}`, INTERNAL_SHARE_SESSION_SECRET: crypto.randomBytes(32).toString('hex'), SUPABASE_URL: 'https://storage.example.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only' };
const rows = [], ops = new Map(), metadata = new Map(), objects = new Map(), controls = new WeakMap();
const externalRequests = [], pageErrors = [], imageReplies = [];
let uploadRequests = 0;
const handler = createInternalShareHandler({ env, fetch: async (address, options = {}) => {
  const url = new URL(address);
  if (/^\/storage\/v1\/object\/(?:authenticated\/)?internal-note-images\//.test(url.pathname)) {
    const name = url.pathname.split('/').at(-1);
    if (options.method === 'POST') {
      if (objects.has(name)) return new Response(JSON.stringify({ statusCode: '409', message: 'Duplicate' }), { status: 409 });
      assert.equal(options.headers['x-upsert'], 'false'); objects.set(name, Buffer.from(options.body)); return new Response('{}', { status: 200 });
    }
    const bytes = objects.get(name); return new Response(bytes || '{}', { status: bytes ? 200 : 404, headers: { 'Content-Type': bytes ? 'image/png' : 'application/json' } });
  }
  const body = options.body ? JSON.parse(options.body) : {};
  let data;
  if (url.pathname.endsWith('/internal_share_auth_state')) data = { revision: 0, password_hash: null };
  else if (url.pathname.endsWith('/internal_share_login_guard')) data = { allowed: true, attempt_id: crypto.randomUUID() };
  else if (url.pathname.endsWith('/internal_share_login_complete')) data = true;
  else if (url.pathname.endsWith('/internal_share_append')) {
    let seq = ops.get(body.p_op_id);
    if (!seq) { seq = rows.length + 1; rows.push({ seq, op_id: body.p_op_id, update_base64: body.p_update_base64 }); ops.set(body.p_op_id, seq); } data = { seq };
  } else if (url.pathname.endsWith('/internal_share_read_page')) {
    const updates = rows.filter(row => row.seq > body.p_after).slice(0, 256); data = { updates, cursor: updates.at(-1)?.seq ?? body.p_after, has_more: false };
  } else if (url.pathname.endsWith('/internal_share_image_reserve')) {
    if (!metadata.has(body.p_id)) metadata.set(body.p_id, { id: body.p_id, bytes: body.p_bytes, mime: 'image/png', width: body.p_width, height: body.p_height, ready: false }); data = { ...metadata.get(body.p_id) };
  } else if (url.pathname.endsWith('/internal_share_image_complete')) {
    const item = metadata.get(body.p_id); assert.ok(item); item.ready = true; data = { ...item };
  } else if (url.pathname.endsWith('/internal_share_image_read')) {
    const item = metadata.get(body.p_id); data = item?.ready ? { ...item } : null;
  } else throw new Error('Unexpected synthetic storage path: ' + url.pathname);
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
} });
function storedText(noteId = 'team') {
  const doc = new Y.Doc();
  try { for (const row of rows) Y.applyUpdate(doc, Buffer.from(row.update_base64, 'base64')); return doc.getText(noteId === 'team' ? 'body' : `note:${noteId}`).toString(); } finally { doc.destroy(); }
}
const imageRefs = text => [...text.matchAll(/\/api\/internal-share\?action=image&id=([0-9a-f]{64})/g)].map(match => match[1]);
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'chrome' });
  try {
    async function context() {
      const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } });
      await ctx.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== 'https://ain.example.test') { externalRequests.push(url.href); return route.abort('blockedbyclient'); }
        if (url.pathname === '/api/internal-share') {
          const payload = request.postData(), action = payload ? JSON.parse(payload).action : url.searchParams.get('action') || 'session';
          const control = controls.get(request.frame().page());
          if (action === 'image_upload') {
            uploadRequests++;
            if (control?.failUpload) { control.failUpload = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'STORAGE_UNAVAILABLE', message: '검증용 이미지 업로드 실패' }) }); }
          }
          const headers = await request.allHeaders();
          const req = { method: request.method(), query: Object.fromEntries(url.searchParams), headers: { ...headers, host: url.host }, body: payload || undefined, socket: { remoteAddress: '127.0.0.1' } };
          const reply = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(value) { this.body = JSON.stringify(value); return this; }, end(value) { this.body = value ?? ''; return this; } };
          await handler(req, reply);
          if (action === 'image') imageReplies.push({ status: reply.code, headers: { ...reply.headers }, binary: Buffer.isBuffer(reply.body) });
          if (action === 'image_upload' && control?.holdUpload) { control.uploadStarted?.(); await control.holdUpload; }
          try { return await route.fulfill({ status: reply.code, headers: { 'Content-Type': 'application/json', ...reply.headers }, body: reply.body }); } catch (error) { if (action !== 'image_upload' || !control?.allowAbortedUpload) throw error; }
          return;
        }
        const name = url.pathname === '/note' ? 'index.html' : url.pathname.split('/').pop();
        if (!['index.html', 'app.js', 'style.css'].includes(name)) return route.fulfill({ status: 404, body: '' });
        const contentType = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html';
        return route.fulfill({ status: 200, contentType, body: fs.readFileSync(path.join(root, 'internal', name)) });
      }); return ctx;
    }
    const aContext = await context(), bContext = await context(), a = await aContext.newPage(), b = await bContext.newPage();
    const aControl = {}; controls.set(a, aControl);
    for (const page of [a, b]) page.on('pageerror', error => pageErrors.push(error.message));
    async function login(page) { await page.goto('https://ain.example.test/note'); await page.locator('#password').fill(password); await page.locator('#login-submit').click(); await page.locator('.cm-content[contenteditable=true]').waitFor(); }
    async function saved(page = a) { await page.waitForFunction(() => document.querySelector('#sync-status')?.dataset.kind === 'saved'); }
    async function end(page = a) { await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); }
    async function pasteImage(page, fixture = {}) {
      await end(page);
      return page.evaluate(async fixture => {
        let file;
        if (fixture.kind === 'unsupported') file = new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'unsafe.svg', { type: 'image/svg+xml' });
        else if (fixture.kind === 'oversize') file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'oversize.png', { type: 'image/png' });
        else if (fixture.kind === 'corrupt') file = new File(['not an image'], 'broken.png', { type: 'image/png' });
        else {
          const canvas = document.createElement('canvas'); canvas.width = fixture.width || 720; canvas.height = fixture.height || 360;
          const ctx = canvas.getContext('2d'); ctx.fillStyle = fixture.color || '#dbe8e2'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#2d5849'; ctx.font = 'bold 32px sans-serif'; ctx.fillText('AIN screenshot paste test', 30, 90); ctx.font = '24px sans-serif'; ctx.fillText(fixture.label || 'Synthetic fixture - no user data', 30, 140);
          const blob = await new Promise(resolve => canvas.toBlob(resolve, fixture.type || 'image/png')); file = new File([blob], 'clipboard-image.' + (fixture.type === 'image/jpeg' ? 'jpg' : 'png'), { type: blob.type });
        }
        const data = new DataTransfer(); data.items.add(file); const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }); document.querySelector('.cm-content').dispatchEvent(event); return { prevented: event.defaultPrevented, size: file.size };
      }, fixture);
    }
    async function waitImages(page, count, host = '#editor-host') { await page.waitForFunction(({ count, host }) => { const imgs = [...document.querySelectorAll(host + ' img.note-image-content')]; return imgs.length === count && imgs.every(img => img.complete && img.naturalWidth > 0); }, { count, host }); }
    async function newNote(page, title) { await page.locator('#new-note-button').click(); await page.locator('#note-title-input').fill(title); await page.locator('#note-form button[type=submit]').click(); await page.locator('#note-heading').filter({ hasText: title }).waitFor(); return page.locator('#notes-list [data-note-id][aria-current=page]').getAttribute('data-note-id'); }
    await login(a); await login(b);
    await end(a); await a.keyboard.insertText('# 캡처 이미지 공유 검증\n원래 본문 유지\n'); await saved();
    assert.equal((await pasteImage(a)).prevented, true); await waitImages(a, 1); await saved(); await waitImages(b, 1);
    const firstBody = storedText(), firstId = imageRefs(firstBody)[0]; assert.match(firstId, /^[0-9a-f]{64}$/); assert.match(firstBody, /원래 본문 유지/);
    assert.ok(Buffer.byteLength(firstBody) < 1000, 'CRDT stores private references, not image base64'); assert.equal(objects.size, 1); assert.equal(metadata.size, 1);
    assert.ok(imageReplies.some(reply => reply.status === 200 && reply.binary && /no-store/.test(reply.headers['Cache-Control']) && reply.headers['X-Content-Type-Options'] === 'nosniff'));
    await a.locator('#read-view-button').click(); await waitImages(a, 1, '#preview-host'); assert.equal(await a.locator('#preview-host img').getAttribute('src'), '/api/internal-share?action=image&id=' + firstId); await a.locator('#edit-view-button').click();
    const artifacts = path.join(root, '.artifacts'); fs.mkdirSync(artifacts, { recursive: true }); await a.screenshot({ path: path.join(artifacts, 'internal-image-desktop.png'), fullPage: false });
    await a.reload(); await a.locator('.cm-content[contenteditable=true]').waitFor(); await waitImages(a, 1);
    await a.locator('#read-view-button').click(); await waitImages(a, 1, '#preview-host'); await a.locator('#edit-view-button').click();
    await end(a); const uploadsBeforeText = uploadRequests, imageReadsBeforeText = imageReplies.length;
    await a.evaluate(() => { const data = new DataTransfer(); data.setData('text/plain', '\n일반 텍스트 붙여넣기 유지'); document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); });
    await a.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('일반 텍스트 붙여넣기 유지')); await saved(); assert.equal(uploadRequests, uploadsBeforeText); assert.match(storedText(), /일반 텍스트 붙여넣기 유지/);
    await b.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('일반 텍스트 붙여넣기 유지'));
    await waitImages(a, 1); await waitImages(a, 1, '#preview-host');
    assert.equal(imageReplies.length, imageReadsBeforeText, 'Unrelated typing must reuse loaded image elements rather than refetch private bytes');
    await pasteImage(a); await waitImages(a, 2); await saved(); assert.equal(objects.size, 1); assert.deepEqual(imageRefs(storedText()), [firstId, firstId]);
    await pasteImage(a, { type: 'image/jpeg', color: '#d8e5fc', label: 'JPEG normalization fixture' }); await waitImages(a, 3); await saved(); assert.equal(objects.size, 2);
    for (const bytes of objects.values()) assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    for (const kind of ['network', 'unsupported', 'oversize', 'corrupt']) {
      const before = storedText(), count = uploadRequests; aControl.failUpload = kind === 'network';
      await pasteImage(a, kind === 'network' ? { label: 'failed upload fixture', color: '#ffaaaa' } : { kind });
      await a.waitForFunction(() => { const status = document.querySelector('#image-status'); return status && !status.hidden && status.dataset.kind === 'error'; }); await a.waitForFunction(() => !document.querySelector('#image-upload-button')?.disabled);
      await saved(); assert.equal(storedText(), before, kind + ' preserves original text'); assert.equal(uploadRequests, count + (kind === 'network' ? 1 : 0), kind + ' request count');
    }
    await end(a); await a.keyboard.insertText('\n![tracking](https://leak.example.test/private.png)\n<img src="https://leak.example.test/raw.png" onerror="window.__imageXss=1">\n![unsafe](javascript:alert(1))\n![embedded](data:image/svg+xml;base64,PHN2Zz4=)\n'); await saved();
    await a.locator('#read-view-button').click(); await waitImages(a, 3, '#preview-host'); assert.equal(await a.locator('#preview-host img').count(), 3); assert.equal(await a.evaluate(() => Boolean(window.__imageXss)), false); assert.deepEqual(externalRequests, []); await a.locator('#edit-view-button').click();
    for (const width of [390, 320]) { await a.setViewportSize({ width, height: 844 }); assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.equal(await a.locator('#image-upload-button').evaluate(button => button.getBoundingClientRect().right <= innerWidth), true); assert.equal(await a.locator('#document-search').evaluate(input => input.getBoundingClientRect().width >= 100), true); }
    await a.screenshot({ path: path.join(artifacts, 'internal-image-mobile.png'), fullPage: false }); await a.setViewportSize({ width: 1360, height: 950 });
    const otherId = await newNote(a, '이미지 전환 검증'); await end(a); await a.keyboard.insertText('별도 노트 원문'); await saved(); await a.locator('#notes-list [data-note-id=team]').click();
    const beforeSwitchTeam = storedText(), beforeSwitchOther = storedText(otherId);
    let releaseSwitch; aControl.holdUpload = new Promise(resolve => { releaseSwitch = resolve; }); aControl.allowAbortedUpload = true; const switchStarted = new Promise(resolve => { aControl.uploadStarted = resolve; });
    await pasteImage(a, { label: 'switch race fixture', color: '#ffedab' }); await switchStarted; await a.locator(`#notes-list [data-note-id="${otherId}"]`).click(); releaseSwitch(); aControl.holdUpload = null; aControl.uploadStarted = null;
    await a.waitForFunction(() => !document.querySelector('#image-upload-button')?.disabled); await saved(); assert.equal(storedText(otherId), beforeSwitchOther); assert.equal(storedText(), beforeSwitchTeam);
    await a.locator('#notes-list [data-note-id=team]').click(); await saved(); const beforeLogout = storedText();
    let releaseLogout; aControl.holdUpload = new Promise(resolve => { releaseLogout = resolve; }); const logoutStarted = new Promise(resolve => { aControl.uploadStarted = resolve; });
    await pasteImage(a, { label: 'logout race fixture', color: '#cacafa' }); await logoutStarted;
    a.once('dialog', dialog => dialog.accept()); await a.locator('#logout-button').click(); await a.locator('#login-shell').waitFor({ state: 'visible' }); releaseLogout(); aControl.holdUpload = null; aControl.uploadStarted = null;
    await a.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); assert.equal(await a.locator('#app-shell').isVisible(), false); assert.equal(await a.locator('.cm-content').count(), 0); assert.equal(storedText(), beforeLogout); assert.equal(await a.locator('#preview-host img').count(), 0);
    assert.equal(await a.evaluate(async id => (await fetch('/api/internal-share?action=image&id=' + id)).status, firstId), 401); await login(a); await waitImages(a, imageRefs(beforeLogout).length); assert.equal(storedText(), beforeLogout);
    // The visible image action also opens the normal local file chooser.
    await newNote(a, '이미지 파일 선택 검증');
    const chooserReady = a.waitForEvent('filechooser'); await a.locator('#image-upload-button').click();
    await (await chooserReady).setFiles({ name: 'synthetic-upload.png', mimeType: 'image/png', buffer: objects.values().next().value });
    await waitImages(a, 1); await saved();
    // Missing or unavailable image bytes never erase the text/reference itself.
    const missingNoteId = await newNote(a, '없는 이미지 검증'); await end(a);
    const missingBody = '이미지 오류에도 본문 유지\n![없는 이미지](/api/internal-share?action=image&id=' + '0'.repeat(64) + ')\n';
    await a.keyboard.insertText(missingBody); await a.locator('#editor-host .note-image-error').waitFor(); await saved();
    assert.equal(storedText(missingNoteId), missingBody);
    await a.locator('#read-view-button').click(); await a.locator('#preview-host .note-image-error').waitFor();
    assert.match(await a.locator('#preview-host').innerText(), /이미지 오류에도 본문 유지/); assert.equal(storedText(missingNoteId), missingBody);
    assert.deepEqual(externalRequests, []); assert.deepEqual(pageErrors, []);
    console.log('PASS: clipboard PNG inline/edit/read, two-browser sharing, refresh, deduplication, JPEG normalization, plaintext paste, unchanged-image no-refetch, failure/unsupported/oversize/corrupt preservation, external-image/XSS rejection, mobile layout, note-switch isolation, logout cancellation, authenticated reads, toolbar local-file upload and missing-image fallback. Synthetic in-memory data only; no live writes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
