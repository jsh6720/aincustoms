# AIN Requirements Read Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every AIN requirements list, dashboard count, unified search, refresh, and detail view reliably read the single Google Sheet database without stale authenticated UI or transient fan-out failures.

**Architecture:** Keep the existing static Vanilla JavaScript application and Apps Script v3 endpoint. Centralize read reliability in `google-sheets-api.js`: coalesce identical in-flight table reads, cap distinct remote reads at two, retry only transient reads, preserve safe upstream error metadata, and prevent stale responses from clearing or populating a newer session. Make page navigation load the selected section on demand and correct unified-result navigation; no Google Sheet writes, backend deployment, new datastore, framework, or dependency is introduced.

**Tech Stack:** HTML, Vanilla JavaScript, browser Fetch API, Node.js `node:test`, Vercel Preview, Google Apps Script v3.

**Spec:** `docs/superpowers/specs/2026-08-20-ain-requirements-migration-design.md`

## Global Constraints

- Keep `Ain_compliance_db` as the only operational database; do not modify Google Sheet data during this task.
- Do not modify or redeploy Genspark.
- Do not modify Apps Script unless a public-client implementation and live verification still reproduce a backend defect.
- Preserve the `/requirements/` static Vanilla JavaScript architecture and the existing public Apps Script endpoint.
- Retry only idempotent reads. Never automatically replay login, add, update, delete, upload, or other writes.
- Keep `UNAUTHORIZED` mapped to synthetic 401 and `FORBIDDEN` mapped to synthetic 403; map retryable server/transport failures to synthetic 503.
- Never let an old in-flight response clear, populate, or expose data to a newer browser session.
- Cache only successful table responses for 30 minutes and clear all cache on login, logout, explicit DB refresh, or current-session authorization failure.
- Do not expose tokens, credentials, Sheet data rows, or private Apps Script source in logs, tests, Git, or browser error text.
- Use TDD: capture valid RED, apply the minimum production change, then run focused and full suites.
- Push only the existing feature branch after tests and independent review pass; do not merge the PR or deploy production.

---

### Task 1: Centralize Reliable Read Scheduling and Session Safety

**Files:**
- Modify: `requirements/js/google-sheets-api.js`
- Modify: `requirements/js/auth.js`
- Modify: `test/requirements-api-client.test.js`
- Modify: `test/requirements-auth-ui.test.js`

**Interfaces:**
- Consumes: `sessionStorage.ainRequirementsSession`, `AIN_REQUIREMENTS_CONFIG.apiUrl`, native `fetch`, `AbortController`, and `CustomEvent`.
- Produces: existing `GoogleSheetsAPI.getData(tableName)` and fetch-shim interfaces with single-flight reads, a two-request remote concurrency cap, bounded transient retry, token-generation guards, and `ain-requirements-session-expired` browser event.

- [ ] **Step 1: Extend the API harness with delayed, concurrent, HTTP-error, and non-JSON responses**

Add a controllable response factory to `requirements-api-client.test.js` that records active remote calls and implements `ok`, `status`, `text()`, and optional delays. Provide deterministic zero-delay retry injection so tests do not sleep.

- [ ] **Step 2: Write failing single-flight and concurrency tests**

```javascript
test("concurrent reads of one table share one wire request", async () => {
  const pending = deferredJson({ success: true, data: [{ id: "one" }] });
  const { context, calls } = harness([pending.response]);
  const first = context.API.getData("radio_law");
  const second = context.API.getData("radio_law");
  assert.equal(calls.length, 1);
  pending.resolve();
  assert.deepEqual(await first, await second);
});

test("cold reads never exceed two remote requests", async () => {
  const { context, maxActive } = concurrentHarness();
  await Promise.all(["chemical_confirmation", "msds", "radio_law", "electrical_law"].map(
    table => context.API.getData(table)
  ));
  assert.equal(maxActive(), 2);
});
```

- [ ] **Step 3: Write failing retry and non-retry tests**

Assert that an `INTERNAL_ERROR`, `NETWORK_ERROR`, HTTP 429, HTTP 500, or malformed 5xx read is retried at most twice and ultimately resolves on success. Assert that `UNAUTHORIZED`, `FORBIDDEN`, validation errors, login, add, update, and delete are attempted exactly once. Assert retry exhaustion returns a safe synthetic 503 result without response body or credential text.

- [ ] **Step 4: Write failing stale-session and visible-session-expiry tests**

Assert that an old-token `UNAUTHORIZED` arriving after a replacement login leaves the replacement session and cache intact. Assert that an authorization failure for the current token clears cache/session exactly once and dispatches `ain-requirements-session-expired`; `auth.js` must handle the event by resetting `currentUser` and returning to the login screen.

- [ ] **Step 5: Run the focused RED suite**

```powershell
node --test test/requirements-api-client.test.js test/requirements-auth-ui.test.js
```

Expected: the new tests fail because there is no single-flight map, concurrency cap, retry classification, safe HTTP parsing, token-generation guard, or session-expiry event.

- [ ] **Step 6: Implement the minimum API reliability layer**

In `google-sheets-api.js`, add:

```javascript
const pendingTableReads = new Map();
const MAX_CONCURRENT_READS = 2;
const MAX_READ_ATTEMPTS = 3;
const READ_TIMEOUT_MS = 90000;
```

Queue only remote `getData` work; cache hits remain immediate. Key pending work by the request token plus mapped table. Remove pending entries in `finally`. Parse upstream text safely, retain only status/error code, map retryable failures to 503, and retry only `getData`. Before clearing a session or caching/returning data, compare the current token with the token captured for that request; return `STALE_SESSION` without exposing rows if they differ.

In `auth.js`, listen once for `ain-requirements-session-expired` and call the existing logout/login-screen lifecycle without confirmation.

- [ ] **Step 7: Run focused GREEN and full requirement suites**

```powershell
node --test test/requirements-api-client.test.js test/requirements-auth-ui.test.js
node --test test/requirements-*.test.js
```

Expected: all tests pass with zero credential/token logging.

- [ ] **Step 8: Commit Task 1**

```powershell
git add -- requirements/js/google-sheets-api.js requirements/js/auth.js test/requirements-api-client.test.js test/requirements-auth-ui.test.js
git commit -m "fix: stabilize requirements data reads"
```

### Task 2: Reload Every Selected List and Correct Navigation/Error Rendering

**Files:**
- Modify: `requirements/js/app.js`
- Modify: `requirements/js/unified-search.js`
- Modify: `requirements/index.html`
- Create: `test/requirements-list-reliability.test.js`

**Interfaces:**
- Consumes: `loadCurrentSection()`, the reliable `tables/...` fetch shim from Task 1, menu `data-section` values, and existing list renderers.
- Produces: on-demand list loading for all seven tabs, correct unified-card navigation, and safe 401/403/404/503 detail behavior.

- [ ] **Step 1: Write the failing navigation-retry test**

Create a no-dependency VM/DOM harness. Simulate an initial failed chemical or radio preload, click its menu item, and assert the corresponding loader is called again. Parameterize the six ordinary tabs and include `review_needed` through its existing loader.

- [ ] **Step 2: Write the failing unified-result navigation test**

```javascript
test("a unified radio result activates and reloads the radio tab", async () => {
  navigateToSection("radioSection", "radio", "hmt130");
  assert.equal(clickedMenuSection, "radio");
  assert.equal(activeSection, "radioSection");
  assert.equal(searchValue, "hmt130");
  assert.equal(searchCalls, 1);
});
```

The test must fail while `data-section` is compared with `radioSection` rather than `radio`.

- [ ] **Step 3: Write failing detail error tests**

Assert that 401 returns to login, 403 shows an access error, 404 shows “not found,” and 503 shows a retryable load error. No error object may be rendered as a record. Assert a normal record still renders its fields.

- [ ] **Step 4: Run the focused RED suite**

```powershell
node --test test/requirements-list-reliability.test.js
```

Expected: navigation does not reload ordinary tabs, unified menu selection misses, and detail error objects can be rendered.

- [ ] **Step 5: Implement on-demand list loading and correct navigation**

After any menu activation, set `currentSection` and invoke `loadCurrentSection()` for every supported section. Remove the eager `loadChemicalData` through `loadNonTargetData` DOM-render burst at the end of `loadDashboard`; dashboard statistics still populate the Task 1 cache, and tab entry renders from cache or retries a prior failure. In unified navigation compare menu `data-section` with `dataType`, activate the target section, then await the intended filtered list load.

- [ ] **Step 6: Implement safe detail response handling and bump asset versions**

Check `response.ok` before rendering a record; branch on 401/403/404/503 with non-secret Korean messages. Change the query version on modified scripts in `requirements/index.html` from `v=6.0.0` to `v=6.0.1` so Vercel/browser caches revalidate the fix.

- [ ] **Step 7: Run focused, requirement, and full repository suites**

```powershell
node --test test/requirements-list-reliability.test.js
node --test test/requirements-*.test.js
node --test test/*.test.js
```

Expected: detail/list reliability tests, all requirement tests, and the entire existing repository suite pass.

- [ ] **Step 8: Commit Task 2**

```powershell
git add -- requirements/js/app.js requirements/js/unified-search.js requirements/index.html test/requirements-list-reliability.test.js
git commit -m "fix: reload requirements lists on demand"
```

### Task 3: Independent Review, Preview Publication, and End-to-End Read Verification

**Files:**
- Modify only if review finds a reproducible Critical/Important defect: the exact public client file and its focused test.
- Append operational evidence to the task report/SDD ledger; do not publish secrets or DB rows.

**Interfaces:**
- Consumes: Task 1 and Task 2 commits, draft PR #1, Vercel Preview, existing Apps Script v3 deployment, and read-only signed diagnostics.
- Produces: independent task review, one final whole-branch review, updated Preview deployment, and a verified read matrix for all eight public tables.

- [ ] **Step 1: Generate the review package and dispatch an independent reviewer**

The reviewer must check the complete remediation diff for retry safety, session isolation, cache/pending cleanup, DOM navigation, non-replayed writes, secret exposure, and regression coverage. Any Critical/Important finding enters the documented fix/re-review loop.

- [ ] **Step 2: Run final local verification**

```powershell
node --test test/requirements-*.test.js
node --test test/*.test.js
git diff --check origin/main...HEAD
git status --short
```

- [ ] **Step 3: Push the already-authorized feature branch**

Push only `feature/ain-requirements-migration`; do not merge PR #1 and do not deploy production.

- [ ] **Step 4: Wait for Vercel Preview and verify asset revision**

Confirm the Preview is READY and `google-sheets-api.js`, `auth.js`, `app.js`, and `unified-search.js` load at `v=6.0.1` with no Genspark references or secret-bearing files.

- [ ] **Step 5: Verify the read-only API matrix**

Using an in-memory signed diagnostic token, request `chemical_confirmation`, `msds`, `radio_law`, `electrical_law`, `medical_device`, `non_target`, `review_needed`, and `users`. Record only HTTP status, success/error code, elapsed time, and row count; verify `hmt130` exists in radio law. Do not write data.

- [ ] **Step 6: Verify user-visible flows**

Verify login, dashboard counts, every list tab, `hmt130` unified search, unified-card navigation, DB refresh, session expiry to login, empty state, and retryable error state. Genspark remains unchanged. If physical browser automation remains unavailable, provide the user with one concise final visual confirmation checklist and do not claim those visual checks were automated.

- [ ] **Step 7: Complete final whole-branch review**

Dispatch a fresh reviewer over the entire remediation diff. Resolve Critical/Important findings through one focused fix wave and scoped re-review before calling the Preview complete.
