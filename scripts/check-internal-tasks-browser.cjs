// UI tests use synthetic notes and task data; no production API or credentials.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), Y = require('yjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), updates = [], operations = new Map();
const errors = [], requests = []; let expire = false, rejectAppend = false;
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    async function client() {
      const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } }); let authenticated = false;
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url()); assert.equal(url.origin, 'https://tasks.example.test');
        if (url.pathname === '/api/internal-share') {
          const body = req.postDataJSON() || {}, action = body.action || url.searchParams.get('action'); requests.push(action);
          const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
          if (action === 'login') { authenticated = true; return reply({ authenticated: true, csrf: 'synthetic', snapshotKey: 'a'.repeat(43) }); }
          if (action === 'session') return reply(authenticated && !expire ? { authenticated: true, csrf: 'synthetic', snapshotKey: 'a'.repeat(43) } : { authenticated: false });
          if (!authenticated || expire) return reply({ message: '다시 로그인해 주세요.' }, 401);
          if (action === 'logout') { authenticated = false; return reply({ success: true }); }
          if (action === 'sync') { const after = Number(url.searchParams.get('after')); return reply({ cursor: updates.length, hasMore: false, updates: updates.filter(row => row.seq > after) }); }
          if (action === 'append') {
            if (rejectAppend) return reply({ message: '검증용 연결 오류' }, 503);
            let seq = operations.get(body.op_id); if (!seq) { seq = updates.length + 1; operations.set(body.op_id, seq); updates.push({ seq, update: body.update }); }
            return reply({ seq });
          }
          throw new Error('Unexpected action ' + action);
        }
        const name = url.pathname === '/note' ? 'index.html' : url.pathname.split('/').pop();
        assert.ok(['index.html', 'app.js', 'style.css'].includes(name));
        return route.fulfill({ contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(path.join(root, 'internal', name)) });
      });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      await page.goto('https://tasks.example.test/note'); await page.locator('#password').fill('synthetic-only'); await page.locator('#login-submit').click(); await page.locator('.cm-content[contenteditable=true]').waitFor();
      return page;
    }
    const a = await client(), b = await client();
    const saved = page => page.waitForFunction(() => document.querySelector('#sync-status').dataset.kind === 'saved');
    await a.locator('.cm-content').fill('기존 노트 보존 확인'); await saved(a);
    for (const page of [a, b]) await page.locator('#tasks-quick-button').click();
    await a.locator('#task-people-open').click(); await a.locator('#task-person-name').fill('김아인'); await a.locator('#task-person-save').click(); await a.locator('#task-person-name').fill('이담당'); await a.locator('#task-person-save').click(); await a.locator('#task-people-cancel').click();
    await b.waitForFunction(() => document.querySelector('#task-filter-person').textContent.includes('이담당'));
    async function create(title, date, repeat, assignee = '김아인') {
      await a.locator('#task-new').click(); await a.locator('#task-title').fill(title); await a.locator('#task-details').fill('업무 상세 및 전달 사항'); await a.locator('#task-start').fill(date); await a.locator('#task-repeat').selectOption(repeat); await a.locator('#task-assignee').selectOption({ label: assignee }); await a.locator('#task-save').click(); await a.locator('#task-dialog').waitFor({ state: 'hidden' }); await saved(a);
    }
    await create('월말 정산', '2026-01-31', 'monthly');
    await create('15일 보고', '2026-09-28', 'fortnight', '이담당');
    await create('매일 확인', '2026-09-28', 'daily');
    await create('<img src=x onerror=alert(1)> 일회 업무', '2026-09-28', 'none');
    await b.waitForFunction(() => document.querySelectorAll('.task-card').length === 4);
    assert.equal(await a.locator('#tasks-list img').count(), 0);
    const monthly = page => page.locator('.task-card').filter({ hasText: '월말 정산' });
    await monthly(a).locator('input[type=checkbox]').click(); await saved(a);
    await b.waitForFunction(() => [...document.querySelectorAll('.task-card')].some(e => e.textContent.includes('월말 정산') && e.dataset.date === '2026-02-28'));
    await monthly(a).locator('input[type=checkbox]').click(); await saved(a);
    await a.waitForFunction(() => [...document.querySelectorAll('.task-card')].some(e => e.textContent.includes('월말 정산') && e.dataset.date === '2026-03-31'));
    await a.locator('#task-filter-status').selectOption('done'); assert.equal(await a.locator('.task-card').count(), 2);
    await a.locator('.task-card[data-date="2026-01-31"] input').click(); await a.locator('#task-reset').click(); assert.equal(await monthly(a).getAttribute('data-date'), '2026-01-31');
    await a.locator('#task-filter-person').selectOption({ label: '이담당' }); assert.equal(await a.locator('.task-card').count(), 1);
    await a.locator('#task-filter-date').fill('2026-10-13'); assert.match(await a.locator('#tasks-list').textContent(), /15일 보고/);
    await a.locator('#task-filter-date').fill('2026-10-14'); assert.equal(await a.locator('.task-card').count(), 0);
    await a.locator('#task-reset').click();
    await monthly(a).getByRole('button', { name: '수정', exact: true }).click(); await a.locator('#task-details').fill('수정된 내용');
    await monthly(b).getByRole('button', { name: '수정', exact: true }).click(); await b.locator('#task-title').fill('월말 정산 새 제목'); await b.locator('#task-save').click(); await saved(b);
    await a.waitForFunction(() => document.querySelector('#tasks-list').textContent.includes('새 제목'));
    await a.locator('#task-save').click(); await saved(a); assert.match(await monthly(a).textContent(), /새 제목/); assert.match(await monthly(a).textContent(), /수정된 내용/);
    a.once('dialog', d => d.accept()); await monthly(a).getByRole('button', { name: '보관', exact: true }).click(); await a.locator('#task-filter-status').selectOption('archived'); assert.equal(await a.locator('.task-card').count(), 1); await a.getByRole('button', { name: '복원', exact: true }).click(); await a.locator('#task-reset').click();
    const downloadEvent = a.waitForEvent('download'); await a.locator('#backup-button').click(); const download = await downloadEvent; const data = JSON.parse(fs.readFileSync(await download.path(), 'utf8')); assert.equal(data.companyTasks.tasks.length, 4); assert.equal(data.companyTasks.people.length, 2);
    await a.reload(); await a.locator('.cm-content[contenteditable=true]').waitFor(); assert.match(await a.locator('.cm-content').textContent(), /기존 노트 보존/); await a.locator('#tasks-quick-button').click(); assert.equal(await a.locator('.task-card').count(), 4);
    fs.mkdirSync(path.join(root, '.artifacts'), { recursive: true }); await a.screenshot({ path: path.join(root, '.artifacts', 'internal-tasks-desktop.png'), fullPage: true });
    for (const width of [390, 320]) {
      await a.setViewportSize({ width, height: 844 });
      const overflow = await a.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && e.getBoundingClientRect().width > 0).map(e => ({ tag: e.tagName, id: e.id, cls: e.className, right: e.getBoundingClientRect().right })).slice(0, 15));
      assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, JSON.stringify({ width, overflow }));
      await a.locator('#task-new').click(); assert.equal(await a.evaluate(() => { const b = document.querySelector('#task-dialog').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth; }), true); await a.locator('#task-cancel').click();
    }
    await a.screenshot({ path: path.join(root, '.artifacts', 'internal-tasks-mobile.png'), fullPage: true });
    rejectAppend = true; await a.locator('#task-new').click(); await a.locator('#task-title').fill('미저장 복구'); await a.locator('#task-save').click(); await a.waitForFunction(() => document.querySelector('#sync-status').dataset.kind === 'error'); assert.match(await a.locator('#tasks-list').textContent(), /미저장 복구/); rejectAppend = false; await a.locator('#retry-button').click(); await saved(a);
    await a.locator('#task-new').click(); await a.locator('#task-title').fill('비공개 입력 중'); expire = true; await a.locator('#login-shell').waitFor({ state: 'visible' }); assert.equal(await a.locator('#task-dialog').evaluate(e => e.open), false); assert.equal(await a.locator('#task-title').inputValue(), ''); assert.equal(await a.locator('#tasks-list').textContent(), '');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ pass: true, cases: ['shared-people', 'four-recurrences', 'month-end-no-drift', 'completion-undo', 'date-assignee-filters', 'concurrent-edits', 'archive-restore', 'backup', 'reload-note-preservation', 'xss', 'mobile320-390', 'retry-unsaved', 'expiry-scrub'], productionWrites: false }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
