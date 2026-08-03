# HCH Import Progress Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HCH B/L이 `수입신고` 또는 `수입(사용소비) 심사진행`에 최초 진입할 때 기존 서류 관련 메일 수신처로 안내 메일을 정확히 한 번 발송한다.

**Architecture:** 로컬 동기화가 업로드 전 HCH 기존 상태와 새 상태를 비교해 전환 이벤트를 Supabase에 먼저 적재하고, 업로드 성공 후 기존 `cargo-import-request` Vercel 함수의 HMAC 보호 내부 동작을 호출한다. Vercel 함수는 이벤트의 HCH 소유권과 발송 상태를 재검증하고 `original_doc_receipt` 수신 설정으로 메일을 보낸 뒤 `sent` 또는 `failed`를 기록한다.

**Tech Stack:** Python 3 `requests`/`hmac`, Node.js CommonJS, Vercel Serverless Functions, Supabase PostgREST/PostgreSQL, Nodemailer, Node test runner, Python `unittest`

## Global Constraints

- 감시 계정은 로그인 아이디가 정확히 `HCH`인 행만 사용한다.
- `수입신고`와 `수입(사용소비) 심사진행`은 동일한 `import_progress_started` 이벤트다.
- 동일 HCH B/L에는 두 상태 중 먼저 감지된 이벤트 한 건만 발송한다.
- CTF, 삼현 및 다른 연결 계정의 상태는 자동 메일을 만들지 않는다.
- 신규 동기화 당시 이미 신고진행인 과거 카드에는 소급 발송하지 않는다.
- 메일 수신처는 `original_doc_receipt`의 받는 사람과 참조를 재사용한다.
- 기존 12개 Vercel 함수 한도를 넘기지 않는다.
- 기존 카드, 요청, 서류, 날짜, 토글 및 관리 상태를 초기화하거나 덮어쓰지 않는다.

---

## File Structure

- `supabase/migrations/20260803_add_import_progress_notifications.sql`: 자동 알림 이력 테이블과 고유 제약을 정의한다.
- `lib/cargo-import-progress-notification.js`: 대상 상태 판정, HMAC 검증, 자동 안내 메일 본문 생성을 담당한다.
- `api/cargo-import-request.js`: 기존 사용자 요청 경로를 보존하면서 서명된 내부 자동 안내 동작을 추가한다.
- `test/import-progress-notification.test.js`: 내부 API 인증, HCH 제한, 수신처, 발송 및 중복 방지를 검증한다.
- `website_integration/sync_to_supabase.py`: HCH 상태 전환 감지, 이벤트 적재, 미발송 이벤트 재호출을 담당한다.
- `tests/test_import_progress_notification.py`: HCH 전환·연결 계정 제외·소급 방지·서명 생성을 검증한다.
- `website_integration/add_import_progress_notifications.sql`: 서버 PC 설치용 SQL 사본이다.
- `website_integration/vercel_package/api/cargo-import-request.js`: 로컬 배포 패키지 API 사본이다.
- `website_integration/vercel_package/lib/cargo-import-progress-notification.js`: 로컬 배포 패키지 라이브러리 사본이다.
- `docs/CHANGE_REQUEST_HISTORY.md`, `docs/DATA_PRESERVATION_RULES.md` 및 로컬 대응 문서: 누적 규칙과 데이터 보존 원칙을 기록한다.

---

### Task 1: Supabase Notification Ledger

**Files:**
- Create: `supabase/migrations/20260803_add_import_progress_notifications.sql`
- Create: `test/import-progress-notification.test.js`

**Interfaces:**
- Produces: `public.cargo_status_notifications` with unique `event_key`
- Produces: status values `pending | sent | failed`

- [ ] **Step 1: Write the failing migration contract test**

```js
test("notification migration stores one import event per HCH BL", () => {
  assert.match(migration, /create table if not exists public\.cargo_status_notifications/i);
  assert.match(migration, /event_key text not null unique/i);
  assert.match(migration, /check \(status in \('pending', 'sent', 'failed'\)\)/i);
  assert.match(migration, /references public\.shipper_accounts\(id\)/i);
});
```

- [ ] **Step 2: Run the contract test and verify failure**

Run: `node --test test/import-progress-notification.test.js`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Add the notification ledger migration**

```sql
create table if not exists public.cargo_status_notifications (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null check (event_type in ('import_progress_started')),
  account_id uuid not null references public.shipper_accounts(id) on delete cascade,
  bl_number text not null,
  detected_status text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  card_snapshot jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cargo_status_notifications_retry_idx
  on public.cargo_status_notifications (status, created_at)
  where status in ('pending', 'failed');

alter table public.cargo_status_notifications enable row level security;
revoke all on table public.cargo_status_notifications from anon, authenticated;
grant all on table public.cargo_status_notifications to service_role;
```

- [ ] **Step 4: Run the contract test and verify pass**

Run: `node --test test/import-progress-notification.test.js`

Expected: PASS for the migration contract.

- [ ] **Step 5: Commit the migration**

```powershell
git add supabase/migrations/20260803_add_import_progress_notifications.sql test/import-progress-notification.test.js
git commit -m "feat: add cargo status notification ledger"
```

---

### Task 2: HCH Transition Detection in Local Sync

**Files:**
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/sync_to_supabase.py`
- Create: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/tests/test_import_progress_notification.py`

**Interfaces:**
- Produces: `is_import_progress_status(value: object) -> bool`
- Produces: `build_import_progress_candidates(rows, accounts, previous_statuses) -> list[dict]`
- Produces event key: `hch:import_progress_started:<NORMALIZED_BL>`

- [ ] **Step 1: Write failing transition tests**

```python
def test_first_of_two_progress_statuses_creates_one_hch_event(self):
    candidates = build_import_progress_candidates(
        rows=[
            {"account_id": "hch-id", "bl_number": "BL001", "prgs_stts": "수입신고"},
            {"account_id": "ctf-id", "bl_number": "BL001", "prgs_stts": "수입(사용소비) 심사진행"},
        ],
        accounts=[
            {"id": "hch-id", "login_id": "HCH"},
            {"id": "ctf-id", "login_id": "CTF"},
        ],
        previous_statuses={"BL001": "수입신고전"},
    )
    self.assertEqual(len(candidates), 1)
    self.assertEqual(candidates[0]["account_id"], "hch-id")
    self.assertEqual(candidates[0]["event_key"], "hch:import_progress_started:BL001")
```

Also cover:

```python
self.assertFalse(is_import_progress_status("수입신고전"))
self.assertFalse(is_import_progress_status("수입신고수리"))
self.assertTrue(is_import_progress_status("수입신고"))
self.assertTrue(is_import_progress_status("수입(사용소비) 심사진행"))
```

- [ ] **Step 2: Run the focused Python test and verify failure**

Run from `Y:/3. Automation/15. Hyundai corp dashboard`:

```powershell
python -m unittest hyundai_dashboard.tests.test_import_progress_notification -v
```

Expected: FAIL because the transition helpers do not exist.

- [ ] **Step 3: Implement exact status and HCH-only detection**

```python
IMPORT_PROGRESS_STATUSES = {
    "수입신고",
    "수입(사용소비) 심사진행",
}

def is_import_progress_status(value):
    return str(value or "").strip() in IMPORT_PROGRESS_STATUSES

def normalize_notification_bl(value):
    return "".join(str(value or "").upper().split())
```

`build_import_progress_candidates` must:

1. Resolve only the account whose `login_id.upper() == "HCH"`.
2. Ignore rows for all other account IDs.
3. Require a previous row for the B/L so existing historical progress cards are not mailed.
4. Require previous non-progress and current progress.
5. Emit one candidate per normalized B/L with event type `import_progress_started`.

- [ ] **Step 4: Run the focused Python test and verify pass**

Run: `python -m unittest hyundai_dashboard.tests.test_import_progress_notification -v`

Expected: all transition tests PASS.

- [ ] **Step 5: Commit local detection**

```powershell
git add hyundai_dashboard/website_integration/sync_to_supabase.py hyundai_dashboard/tests/test_import_progress_notification.py
git commit -m "feat: detect HCH import progress transitions"
```

---

### Task 3: Signed Existing-API Mail Delivery

**Files:**
- Create: `lib/cargo-import-progress-notification.js`
- Modify: `api/cargo-import-request.js`
- Modify: `test/import-progress-notification.test.js`

**Interfaces:**
- Produces: `isValidSyncSignature({ secret, timestamp, eventId, signature, nowMs }) -> bool`
- Produces: `buildImportProgressMail(card, notification) -> { subject, text }`
- Consumes: POST body `{ action: "auto_import_progress_notice", event_id: string }`
- Consumes headers: `x-cargo-sync-timestamp`, `x-cargo-sync-signature`

- [ ] **Step 1: Write failing helper and handler tests**

```js
test("two progress labels share one mail event type", () => {
  assert.equal(isImportProgressStatus("수입신고"), true);
  assert.equal(isImportProgressStatus("수입(사용소비) 심사진행"), true);
  assert.equal(isImportProgressStatus("수입신고수리"), false);
});

test("internal notice rejects invalid HMAC before Supabase calls", async () => {
  const response = await invokeInternalNotice({ signature: "bad" });
  assert.equal(response.statusCode, 401);
  assert.equal(supabaseCalls.length, 0);
});

test("sent HCH event is idempotent and sends no second email", async () => {
  const response = await invokeInternalNotice({ eventStatus: "sent" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.deduplicated, true);
  assert.equal(sentMail.length, 0);
});
```

- [ ] **Step 2: Run focused Node tests and verify failure**

Run: `node --test test/import-progress-notification.test.js`

Expected: FAIL because the helper and internal action do not exist.

- [ ] **Step 3: Implement signature and mail helpers**

```js
function signaturePayload(timestamp, eventId) {
  return `${String(timestamp)}.${String(eventId)}`;
}

function isValidSyncSignature({ secret, timestamp, eventId, signature, nowMs = Date.now() }) {
  if (!secret || !/^\d+$/.test(String(timestamp)) || !eventId || !signature) return false;
  if (Math.abs(nowMs - Number(timestamp) * 1000) > 300_000) return false;
  const expected = crypto.createHmac("sha256", secret)
    .update(signaturePayload(timestamp, eventId))
    .digest("hex");
  return timingSafeTextEqual(expected, String(signature));
}
```

`buildImportProgressMail` must use subject
`[수입신고 진행 안내] ${consignee} / ${bl_number}` and include HCH card information.

- [ ] **Step 4: Extend the existing API before normal session authentication**

For `action === "auto_import_progress_notice"`:

1. Verify the short-lived HMAC with `SUPABASE_SERVICE_ROLE_KEY`.
2. Fetch the notification by `id` and `event_type=import_progress_started`.
3. Return `{ success: true, deduplicated: true }` without mail when status is `sent`.
4. Verify `notification.account_id` belongs to `shipper_accounts.login_id=HCH`.
5. Fetch the exact HCH card and verify its current status is one of the two progress labels.
6. Resolve recipients from `original_doc_receipt`, using the same fallback TO/CC as H/C receipt mail.
7. Send one email, then PATCH the event to `sent`, incrementing `attempt_count` and setting `sent_at`.
8. On SMTP failure, PATCH the event to `failed` with `error_message` and return HTTP 502.
9. Leave the existing interactive import-request route unchanged.

- [ ] **Step 5: Run focused Node tests and verify pass**

Run: `node --test test/import-progress-notification.test.js`

Expected: HMAC, HCH-only, recipients, sent deduplication and failure persistence tests PASS.

- [ ] **Step 6: Run existing import request regression tests**

Run:

```powershell
node --test test/progress-request-workflow.test.js test/mail-settings-and-obl-input.test.js
```

Expected: all existing manual request tests PASS.

- [ ] **Step 7: Commit the API extension**

```powershell
git add lib/cargo-import-progress-notification.js api/cargo-import-request.js test/import-progress-notification.test.js
git commit -m "feat: email HCH import progress notices"
```

---

### Task 4: Persist, Retry, and Dispatch from Sync

**Files:**
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/sync_to_supabase.py`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/tests/test_import_progress_notification.py`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/supabase_sync_config.example.json`

**Interfaces:**
- Produces: `fetch_hch_previous_statuses(cfg, account_id) -> dict[str, str]`
- Produces: `insert_import_progress_candidates(cfg, candidates) -> int`
- Produces: `fetch_retryable_import_notifications(cfg) -> list[dict]`
- Produces: `build_sync_signature(secret, timestamp, event_id) -> str`
- Produces: `dispatch_import_progress_notifications(cfg, events) -> {sent, failed}`

- [ ] **Step 1: Write failing persistence and signature tests**

```python
def test_sync_signature_matches_timestamp_and_event_id(self):
    signature = build_sync_signature("secret", "1785720000", "event-id")
    expected = hmac.new(
        b"secret", b"1785720000.event-id", hashlib.sha256
    ).hexdigest()
    self.assertEqual(signature, expected)
```

Mock `requests.post` to verify candidate insertion uses:

```text
/rest/v1/cargo_status_notifications?on_conflict=event_key
Prefer: resolution=ignore-duplicates,return=representation
```

Mock dispatch to verify pending/failed events are retried and sent events are never queried.

- [ ] **Step 2: Run focused Python tests and verify failure**

Run: `python -m unittest hyundai_dashboard.tests.test_import_progress_notification -v`

Expected: FAIL because persistence/dispatch helpers do not exist.

- [ ] **Step 3: Implement ledger persistence and HMAC dispatch**

Use the existing service-role key only as the HMAC secret. Send:

```python
headers = {
    "Content-Type": "application/json",
    "X-Cargo-Sync-Timestamp": timestamp,
    "X-Cargo-Sync-Signature": build_sync_signature(secret, timestamp, event_id),
}
body = {"action": "auto_import_progress_notice", "event_id": event_id}
```

Default API URL:

```python
cfg.get("notification_api_url") or "https://www.aincustoms.com/api/cargo-import-request"
```

Network or mail failures must be reported in the sync summary but must not abort card upload.

- [ ] **Step 4: Wire the sequence into `main()`**

The order must be:

1. Fetch HCH prior statuses.
2. Build new rows.
3. Build transition candidates.
4. Insert candidates as `pending` before card upsert.
5. Upsert cards and existing linked state.
6. Fetch all `pending`/`failed` import-progress events.
7. Dispatch each event through the existing API.
8. Add queued/sent/failed counts to `cargo_sync_runs.message`.

- [ ] **Step 5: Run focused Python tests and verify pass**

Run: `python -m unittest hyundai_dashboard.tests.test_import_progress_notification -v`

Expected: all HCH detection, persistence, retry and HMAC tests PASS.

- [ ] **Step 6: Run local sync regression tests**

Run from the parent workspace:

```powershell
python -m unittest hyundai_dashboard.tests.test_sync_account_routing hyundai_dashboard.tests.test_quarantine_history hyundai_dashboard.tests.test_sync_lifecycle -v
```

Expected: all tests PASS.

- [ ] **Step 7: Commit sync dispatch**

```powershell
git add hyundai_dashboard/website_integration/sync_to_supabase.py hyundai_dashboard/tests/test_import_progress_notification.py hyundai_dashboard/website_integration/supabase_sync_config.example.json
git commit -m "feat: dispatch HCH import progress notifications"
```

---

### Task 5: Mirrors, Cumulative Rules, Verification, and Deployment

**Files:**
- Create: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/add_import_progress_notifications.sql`
- Create: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/vercel_package/lib/cargo-import-progress-notification.js`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/vercel_package/api/cargo-import-request.js`
- Modify: `docs/CHANGE_REQUEST_HISTORY.md`
- Modify: `docs/DATA_PRESERVATION_RULES.md`
- Modify: `Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/CHANGE_REQUEST_HISTORY.md`

**Interfaces:**
- Consumes: final migration, helper, API and sync implementation from Tasks 1-4
- Produces: deployable website and server-PC package with matching source hashes

- [ ] **Step 1: Copy deployable artifacts exactly**

Use `Copy-Item` for mechanical mirrors:

```powershell
Copy-Item supabase/migrations/20260803_add_import_progress_notifications.sql `
  "Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/add_import_progress_notifications.sql"
Copy-Item api/cargo-import-request.js `
  "Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/vercel_package/api/cargo-import-request.js"
Copy-Item lib/cargo-import-progress-notification.js `
  "Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/vercel_package/lib/cargo-import-progress-notification.js"
```

- [ ] **Step 2: Record cumulative behavior and preservation rules**

Add rules stating:

- HCH only, one event per B/L across both accepted statuses.
- CTF/Samhyeon linked rows never trigger mail.
- Existing progress cards are not backfilled.
- Failed sends retry; sent events never resend.
- Feature changes may not reset existing dates, toggles, requests, revisions or linked-account state.

- [ ] **Step 3: Run the full website test suite**

Run: `node --test test/*.test.js`

Expected: all tests PASS and API file count remains exactly 12.

- [ ] **Step 4: Run the full available local unittest suite**

Run from `Y:/3. Automation/15. Hyundai corp dashboard`:

```powershell
python -m unittest discover -s hyundai_dashboard/tests -p "test_*.py" -v
```

Expected: all tests related to sync and notification PASS; any unrelated pre-existing mirror failure must be reported explicitly rather than hidden.

- [ ] **Step 5: Verify mirror hashes and source hygiene**

```powershell
Get-FileHash api/cargo-import-request.js
Get-FileHash "Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/vercel_package/api/cargo-import-request.js"
Get-FileHash lib/cargo-import-progress-notification.js
Get-FileHash "Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard/website_integration/vercel_package/lib/cargo-import-progress-notification.js"
git diff --check
```

Expected: each source/mirror hash pair matches and `git diff --check` is clean.

- [ ] **Step 6: Commit documentation and mirrors**

```powershell
git add docs/CHANGE_REQUEST_HISTORY.md docs/DATA_PRESERVATION_RULES.md
git commit -m "docs: record import progress notification rules"
```

Commit local repository mirror and documentation changes separately if it is a Git worktree.

- [ ] **Step 7: Push website commits and verify Vercel**

```powershell
git push origin main
```

Verify:

- GitHub commit checks succeed.
- Vercel production deployment is Ready.
- `https://www.aincustoms.com/cargo-dashboard.html` returns HTTP 200.
- Unauthenticated `POST /api/cargo-import-request` remains rejected.
- Invalid internal HMAC is rejected with HTTP 401.

- [ ] **Step 8: Apply the Supabase migration before enabling sync dispatch**

Run the complete contents of
`website_integration/add_import_progress_notifications.sql` once in the Supabase SQL Editor.

Expected: `Success. No rows returned.` Existing tables and rows remain unchanged.

- [ ] **Step 9: Run one server-PC sync smoke test**

```powershell
cd "Y:/3. Automation/15. Hyundai corp dashboard/hyundai_dashboard"
python ".\website_integration\sync_to_supabase.py"
```

Expected: normal card upload succeeds, existing progress cards generate no historical mail,
and the sync summary reports notification queue counts without an exception.

