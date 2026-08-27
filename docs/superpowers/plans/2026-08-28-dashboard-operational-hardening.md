# Dashboard Operational Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 현대 축산물 통관 대시보드의 로컬 상태 저장, 서버 실행, 홈페이지 동기화, Supabase, 자동 메일을 데이터 보존과 즉시 롤백이 가능한 운영 구조로 전환한다.

**Architecture:** 홈페이지 저장소는 Git/Vercel의 유일한 배포 원본으로 유지한다. 로컬 대시보드는 격리 작업본에서 개발한 뒤 NEWMAIN의 `C:\ProgramData\AIN\HyundaiDashboard`에 버전별 release로 설치하고, 상태·비밀·로그·백업은 release 밖의 보호된 runtime에 둔다. 로컬 상태는 하나의 교차 프로세스 잠금/원자 저장 모듈만 사용한다. 자동 메일은 Supabase RPC로 원자 claim하고 SMTP 결과가 불확실한 건은 자동 재발송하지 않는다.

**Tech Stack:** Python 3.12, Flask 3.1.3, requests 2.34.2, pypdf 6.13.2, PowerShell 5.1+, Node.js/Vercel Functions, nodemailer 6.9.16, Supabase Postgres/RPC, Windows Task Scheduler, Git/Vercel.

**Spec:** `docs/superpowers/specs/2026-08-27-dashboard-operational-hardening-design.md`

## Global Constraints

- 운영 소스: `\\192.168.0.107\아인서울_업무\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard`
- 격리 작업본: `\\192.168.0.107\아인서울_업무\3. Automation\15. Hyundai corp dashboard\.worktrees\hyundai_dashboard-operational-hardening`
- 홈페이지 Git 저장소: `\\192.168.0.107\아인서울_업무\3. Automation\homepage_aincustoms`
- NEWMAIN runtime: `C:\ProgramData\AIN\HyundaiDashboard`
- 실제 고객 메일은 테스트 중 발송하지 않는다. Node 테스트는 transporter mock을 쓰고, 로컬 dry run은 `--skip-notifications`를 사용한다.
- `state.json`, Supabase secret, UNIPASS key, SMTP password, 로그인 비밀번호 원문을 Git·로그·테스트 fixture에 넣지 않는다.
- DB 변경은 열/함수/테이블 추가 및 제약 확장만 한다. 운영 행 삭제, 기존 열 삭제, Git history rewrite, `supabase db reset --linked`는 금지한다.
- NEWMAIN 외 PC에서는 서버·동기화 작업 등록을 기본 거부한다. 긴급 override는 명시적 스위치와 감사 로그가 있어야 한다.
- 각 task는 실패 테스트, 최소 구현, focused green, 전체 회귀, 커밋 순서로 진행한다.
- 로컬 cutover 전까지 운영 공유 원본과 현재 NEWMAIN 프로세스는 변경하지 않는다.
- credential 전환은 새 credential 검증 후 기존 credential 폐기 순서다. 폐기 후 롤백은 새 credential을 유지한 채 코드만 되돌린다.

## Task 1: 격리 작업본과 변경 전 롤백 번들

**Files:**

- Create: `hyundai_dashboard/tests/test_rollback_bundle.py`
- Create: `hyundai_dashboard/website_integration/create_rollback_bundle.ps1`
- Create: `hyundai_dashboard/website_integration/restore_rollback_bundle.ps1`
- Create: `hyundai_dashboard/website_integration/rollback_manifest.py`
- Create: `hyundai_dashboard/.gitignore`

**Step 1: Write the failing tests**

`test_rollback_bundle.py`에 다음 계약을 먼저 작성한다.

- 임시 runtime에서 번들을 만들면 `manifest.json`, `source.zip`, `state.json`, `config.json`, `scheduled_tasks/*.xml`이 생성된다.
- manifest에는 `created_at_kst`, `computer_name`, `source_sha256`, `state_sha256`, `homepage_commit`, `release_fingerprint`가 있다.
- secret 값은 manifest와 stdout에 포함되지 않는다.
- restore는 기본 dry-run이며 `-Apply -ExpectedManifestSha256 <hash>`가 없으면 아무 파일도 바꾸지 않는다.
- 해시가 다르거나 computer가 NEWMAIN이 아니면 restore가 중단된다.

**Step 2: Verify RED**

Run from the isolated dashboard copy:

```powershell
python -m unittest tests.test_rollback_bundle -v
```

Expected: import/file-not-found failures for the three new implementation files.

**Step 3: Implement the minimum rollback bundle**

`rollback_manifest.py` exposes:

```text
sha256_file(path: Path) -> str
build_manifest(source_root: Path, runtime_root: Path, homepage_commit: str) -> dict[str, object]
verify_manifest(bundle_dir: Path, expected_sha256: str) -> dict[str, object]
```

`create_rollback_bundle.ps1` accepts `-ProjectRoot`, `-RuntimeRoot`, and `-HomepageRoot`; exports both scheduled tasks, copies the last valid state/config into the protected bundle, creates a source zip excluding caches/logs/secrets, then writes the manifest last.

`restore_rollback_bundle.ps1` accepts `-BundlePath`, `-RuntimeRoot`, `-ExpectedManifestSha256`, and `-Apply`. It validates hashes before stopping tasks, restores into a new release directory, atomically changes only `current_release.json`, restores task XML if requested, and never deletes the current release.

`.gitignore` must include at least:

```gitignore
state.json
config.json
website_integration/supabase_sync_config.json
logs/
runtime/
backups/
rollback/
__pycache__/
*.pyc
.pytest_cache/
node_modules/
.env*
```

**Step 4: Verify GREEN and create the pre-change bundle**

```powershell
python -m unittest tests.test_rollback_bundle -v
powershell -NoProfile -ExecutionPolicy Bypass -File .\website_integration\create_rollback_bundle.ps1 -ProjectRoot "Y:\3. Automation\15. Hyundai corp dashboard\hyundai_dashboard" -RuntimeRoot "C:\ProgramData\AIN\HyundaiDashboard" -HomepageRoot "Y:\3. Automation\homepage_aincustoms"
```

Verify the manifest hash twice and record the bundle path in the implementation log. Do not print secret file contents.

**Step 5: Prepare isolated workspaces**

- Create homepage branch `codex/dashboard-operational-hardening` from current `main`.
- Copy the dashboard into the exact isolated path above, excluding runtime data and caches.
- Initialize Git in the isolated dashboard path, but do not create the first commit until Task 2 removes source-embedded secrets.

## Task 2: 보호 runtime, 비밀 분리, 로컬 관리자 인증

**Files:**

- Create: `hyundai_dashboard/runtime_paths.py`
- Create: `hyundai_dashboard/local_security.py`
- Create: `hyundai_dashboard/tests/test_runtime_security.py`
- Create: `hyundai_dashboard/website_integration/setup_newmain_runtime.ps1`
- Modify: `hyundai_dashboard/app.py`
- Modify: `hyundai_dashboard/templates/index.html`
- Modify: `hyundai_dashboard/website_integration/setup_supabase_sync_config.py`
- Modify: `hyundai_dashboard/website_integration/supabase_sync_config.example.json`

**Step 1: Write the failing tests**

Add Flask-client and pure-unit tests proving:

- `runtime_paths(runtime_root)` returns stable `state`, `secrets`, `logs`, `backups`, `releases`, and `current_release` paths.
- local `/api/cargo-login` rejects wrong credentials and sets an HttpOnly, SameSite=Strict, eight-hour signed cookie on success.
- every local mutation route returns 401 without a session and succeeds with a valid admin session.
- `/api/config` never returns `api_key`, `service_role_key`, password hashes, SMTP password, session secret, or sync token.
- `/api/data` and `/api/cargo-data` remain readable on the LAN without a login.
- the source tree contains no hardcoded UNIPASS key or Supabase secret pattern.

**Step 2: Verify RED**

```powershell
python -m unittest tests.test_runtime_security -v
```

Expected: current unconditional local login, exposed config, and source secret assertions fail.

**Step 3: Implement protected runtime and auth**

`runtime_paths.py` uses `AIN_DASHBOARD_RUNTIME_ROOT`, defaulting to `C:\ProgramData\AIN\HyundaiDashboard`; tests may pass a temporary root.

`local_security.py` exposes:

```text
hash_password(password: str) -> str
verify_password(password_hash: str, password: str) -> bool
create_local_session(login_id: str, secret: str, now: datetime) -> str
verify_local_session(token: str, secret: str, now: datetime) -> dict | None
require_local_admin(view) -> callable
redact_config(config: dict) -> dict
```

Use Werkzeug's salted password hash, HMAC-signed session payload, constant-time signature comparison, and an eight-hour expiry. Protect all POST/PUT/DELETE local routes and config GET/POST. Keep the two read APIs public.

`setup_newmain_runtime.ps1` must:

- refuse a non-NEWMAIN computer unless `-EmergencyOverride -Reason <text>` is supplied;
- create runtime directories with ACL limited to Administrators and the scheduled-task user;
- copy existing state and secrets without changing values;
- generate a random Flask signing secret and local admin password hash without logging plaintext;
- write UTF-8 without BOM;
- leave the network copy untouched until verification.

Replace the hardcoded UNIPASS key in `app.py` with protected runtime config lookup. Change `setup_supabase_sync_config.py` to write only under the protected runtime.

**Step 4: Verify GREEN**

```powershell
python -m unittest tests.test_runtime_security tests.test_local_template_delivery -v
rg -n "service_role_key|sb_secret_|api_key\s*=|dkdls123|ctf1234|dwr1234" .
```

The `rg` result may show field names and redacted examples only; it must show no credential values.

**Step 5: Create the first isolated-dashboard Git commit**

```powershell
git add .gitignore runtime_paths.py local_security.py app.py templates/index.html tests/test_rollback_bundle.py tests/test_runtime_security.py website_integration/create_rollback_bundle.ps1 website_integration/restore_rollback_bundle.ps1 website_integration/rollback_manifest.py website_integration/setup_newmain_runtime.ps1 website_integration/setup_supabase_sync_config.py website_integration/supabase_sync_config.example.json
git commit -m "security: isolate dashboard runtime and mutations"
```

## Task 3: 교차 프로세스 원자 상태 저장소

**Files:**

- Create: `hyundai_dashboard/state_store.py`
- Create: `hyundai_dashboard/tests/test_state_store.py`
- Modify: `hyundai_dashboard/app.py`
- Modify: `hyundai_dashboard/website_integration/sync_to_supabase.py`

**Step 1: Write the failing tests**

Tests must cover:

- UTF-8 and UTF-8 BOM state loading.
- two multiprocessing writers updating different BLs without lost updates.
- a mutator exception and simulated `os.replace` failure preserving the previous valid state.
- backup creation before replacement and retention of the newest 30 daily backups.
- malformed current JSON falling back to the newest valid backup without writing an empty state.
- both `pull_original_docs_to_local_state` and `pull_user_quota_inputs_to_local_state` using the shared mutation API.

**Step 2: Verify RED**

```powershell
python -m unittest tests.test_state_store -v
```

Expected: module missing and concurrent update preservation failing.

**Step 3: Implement one state API**

`state_store.py` exposes:

```text
state_lock(state_path: Path, timeout_seconds: float = 30.0) -> ContextManager[None]
load_state(state_path: Path, defaults: dict, backup_dir: Path) -> dict
mutate_state(state_path: Path, defaults: dict, backup_dir: Path, mutator: Callable[[dict], None]) -> dict
atomic_write_json(path: Path, value: dict, backup_dir: Path, retention_days: int = 30) -> None
```

Use a Windows lock file with `msvcrt.locking`, latest-read inside the lock, temp file in the same directory, flush plus `os.fsync`, validation re-read, backup of the previous valid file, and `os.replace`.

Convert every app mutation from separate `load_state()`/`save_state()` calls to one `mutate_state()` callback. Convert both sync pull functions to the same module. Remove the process-local `threading.Lock` as the source of write safety.

**Step 4: Verify GREEN and regressions**

```powershell
python -m unittest tests.test_state_store tests.test_sync_transport_preservation tests.test_sync_document_refresh tests.test_card_ui_state -v
python -m unittest discover -s tests -v
```

**Step 5: Commit**

```powershell
git add state_store.py app.py website_integration/sync_to_supabase.py tests/test_state_store.py
git commit -m "fix: make dashboard state updates transactional"
```

## Task 4: 소스 지문 health, 서버 supervisor, NEWMAIN 작업 가드, 로그 회전

**Files:**

- Create: `hyundai_dashboard/build_info.py`
- Create: `hyundai_dashboard/tests/test_runtime_supervisor.py`
- Create: `hyundai_dashboard/website_integration/ensure_dashboard_server.ps1`
- Create: `hyundai_dashboard/website_integration/log_rotation.ps1`
- Create: `hyundai_dashboard/website_integration/runtime_launcher.ps1`
- Modify: `hyundai_dashboard/app.py`
- Modify: `hyundai_dashboard/website_integration/run_dashboard_server.ps1`
- Modify: `hyundai_dashboard/website_integration/run_supabase_sync.ps1`
- Modify: `hyundai_dashboard/website_integration/install_dashboard_startup_task.ps1`
- Modify: `hyundai_dashboard/website_integration/install_supabase_sync_task.ps1`
- Modify: `hyundai_dashboard/start.bat`

**Step 1: Write the failing tests**

- `/api/health` returns `ok`, `version`, `source_fingerprint`, `release_path`, `state_path`, `computer_name`, and `started_at` without secrets.
- matching fingerprint keeps the exact running process.
- stale fingerprint stops only a Python process whose command line and release path both match this project, starts the current release, and polls health until the expected fingerprint appears.
- unknown process on port 5010 is never killed and produces an actionable failure.
- task installers reject a non-NEWMAIN hostname without override.
- logs rotate at 10 MiB and retain ten archives in UTF-8.

**Step 2: Verify RED**

```powershell
python -m unittest tests.test_runtime_supervisor -v
```

**Step 3: Implement supervisor and stable launcher**

`build_info.py` computes SHA-256 from `app.py`, `templates/index.html`, state/runtime modules, and sync code. `runtime_launcher.ps1` reads an atomically written `current_release.json` and launches only that release.

`ensure_dashboard_server.ps1` accepts `-ExpectedFingerprint`, `-RuntimeRoot`, and `-DryRun`; it checks `http://127.0.0.1:5010/api/health`, validates process ownership before stop, starts hidden, and polls with a bounded timeout.

Both installers register actions through the stable runtime launcher and use `New-ScheduledTaskTrigger` only on NEWMAIN. `run_supabase_sync.ps1` calls the supervisor before sync and propagates non-zero exit codes. All scripts call `Rotate-Log -MaxBytes 10485760 -Keep 10` before append.

**Step 4: Verify GREEN**

```powershell
python -m unittest tests.test_runtime_supervisor tests.test_notification_health -v
powershell -NoProfile -ExecutionPolicy Bypass -File .\website_integration\ensure_dashboard_server.ps1 -RuntimeRoot "$env:TEMP\ain-dashboard-runtime-test" -ExpectedFingerprint test -DryRun
```

**Step 5: Commit**

```powershell
git add build_info.py app.py start.bat tests/test_runtime_supervisor.py website_integration/ensure_dashboard_server.ps1 website_integration/log_rotation.ps1 website_integration/runtime_launcher.ps1 website_integration/run_dashboard_server.ps1 website_integration/run_supabase_sync.ps1 website_integration/install_dashboard_startup_task.ps1 website_integration/install_supabase_sync_task.ps1
git commit -m "ops: supervise one versioned NEWMAIN runtime"
```

## Task 5: 오전 9시 이후 당일 catch-up과 무메일 동기화

**Files:**

- Modify: `hyundai_dashboard/tests/test_warehouse_schedule_notification.py`
- Modify: `hyundai_dashboard/tests/test_missing_warehouse_plan_notification.py`
- Modify: `hyundai_dashboard/tests/test_import_progress_notification.py`
- Modify: `hyundai_dashboard/tests/test_notification_health.py`
- Modify: `hyundai_dashboard/website_integration/sync_to_supabase.py`

**Step 1: Add failing schedule tests**

- 08:59 KST creates no previous-day, same-day, or missing-plan event.
- 09:00, 10:00, 14:00, and 23:59 on the applicable date create/dispatch the same immutable event key once.
- the following date never creates a stale previous-date event.
- `pending` and confirmed-pre-delivery `failed` events retry only within the valid business date.
- `sending`, `delivery_uncertain`, and `sent` never enter the retry set.
- hidden, `source_missing`, permanent-exclusion, and release-grace-expired cards never create or retry mail.
- `--skip-notifications` performs account/data synchronization but creates and dispatches no mail event.

**Step 2: Verify RED**

```powershell
python -m unittest tests.test_warehouse_schedule_notification tests.test_missing_warehouse_plan_notification tests.test_import_progress_notification tests.test_notification_health -v
```

**Step 3: Implement business-window helpers**

Add pure helpers:

```text
is_same_day_send_window(now_kst: datetime, business_date: date) -> bool
is_previous_day_send_window(now_kst: datetime, business_date: date) -> bool
is_retryable_notification_status(status: str) -> bool
```

Replace the 09:00-09:59 condition with 09:00-through-23:59 eligibility. Filter retry rows by current card lifecycle again immediately before dispatch. Add argparse `--skip-notifications` and make notification exceptions fail the sync process with an explicit event id/type, never a success exit.

**Step 4: Verify GREEN**

Run the focused tests, then:

```powershell
python .\website_integration\sync_to_supabase.py --skip-notifications
```

Verify upload/pull counts and zero SMTP/API notification dispatch calls.

**Step 5: Commit**

```powershell
git add website_integration/sync_to_supabase.py tests/test_warehouse_schedule_notification.py tests/test_missing_warehouse_plan_notification.py tests/test_import_progress_notification.py tests/test_notification_health.py
git commit -m "fix: recover same-day notification windows safely"
```

## Task 6: Supabase 원자 claim, 불확실 발송 격리, schema version

**Files:**

- Create via Supabase CLI, then normalize name: `homepage_aincustoms/supabase/migrations/20260828090000_add_operational_hardening.sql`
- Create: `homepage_aincustoms/test/operational-hardening-migration.test.js`

**Step 1: Create the migration through the CLI and write failing static-contract tests**

```powershell
npx supabase migration new add_operational_hardening
```

Rename the CLI-created empty migration to the exact path above before editing it. Tests must require:

- status values `pending`, `sending`, `sent`, `failed`, `delivery_uncertain`;
- `claim_token uuid`, `claimed_at timestamptz`, and an index for retryable pending/failed events;
- restricted security-definer RPCs with empty `search_path` and fully qualified names;
- revoke from PUBLIC, anon, authenticated and grant only to service_role;
- a schema metadata row with version `20260828090000`;
- no DROP TABLE/COLUMN, TRUNCATE, DELETE, or production password literal.

**Step 2: Verify RED**

```powershell
node --test test/operational-hardening-migration.test.js
```

**Step 3: Implement additive SQL**

Create/replace these interfaces:

```sql
public.claim_cargo_automatic_mail(p_event_id uuid, p_allowed_event_types text[])
  returns table (id uuid, claimed boolean, status text, claim_token uuid,
                 event_type text, card_snapshot jsonb);

public.claim_cargo_manual_mail(p_event_key text, p_account_id uuid,
  p_bl_number text, p_detected_status text, p_card_snapshot jsonb)
  returns table (id uuid, claimed boolean, status text, claim_token uuid);

public.settle_cargo_mail(p_event_id uuid, p_claim_token uuid,
  p_status text, p_error_message text default null)
  returns table (id uuid, settled boolean, status text);
```

The claim RPC locks one row and changes only `pending` or `failed` to `sending`. A stale `sending` row becomes `delivery_uncertain` and returns `claimed=false`; it is never automatically reclaimed. Settlement requires matching id/token and current `sending` status. Only `sent`, confirmed-pre-delivery `failed`, or `delivery_uncertain` are valid settlement targets.

Create `public.cargo_system_metadata` with RLS and service-role-only access, and upsert component `cargo_dashboard`, version `20260828090000`, migration filename.

**Step 4: Local SQL verification only**

```powershell
node --test test/operational-hardening-migration.test.js
npx supabase db lint --local
```

If local Supabase is unavailable, keep the static test green and defer linked dry-run to Task 11; do not substitute SQL Editor copy/paste.

**Step 5: Commit**

```powershell
git add supabase/migrations/20260828090000_add_operational_hardening.sql test/operational-hardening-migration.test.js
git commit -m "db: claim cargo mail atomically"
```

## Task 7: Vercel 자동·수동 메일의 단일 claim 경로

**Files:**

- Create: `homepage_aincustoms/lib/cargo-automatic-mail-dedupe.js`
- Create: `homepage_aincustoms/test/cargo-automatic-mail-dedupe.test.js`
- Modify: `homepage_aincustoms/lib/cargo-mail-dedupe.js`
- Modify: `homepage_aincustoms/test/cargo-mail-dedupe.test.js`
- Modify: `homepage_aincustoms/api/cargo-import-request.js`
- Modify: `homepage_aincustoms/api/cargo-original-doc-receipt-mail.js`
- Modify: `homepage_aincustoms/api/cargo-original-doc-request.js`
- Modify: `homepage_aincustoms/api/cargo-quota.js`
- Modify: `homepage_aincustoms/api/cargo-release-request.js`

**Step 1: Write failing concurrency and uncertainty tests**

- two concurrent calls for one automatic event yield one RPC claim and one mocked `sendMail` call;
- `claimed=false` returns deduplicated without SMTP;
- successful SMTP plus successful settlement returns sent;
- successful SMTP plus settlement failure leaves `sending` and returns `delivery_uncertain=true`, never updates to failed;
- SMTP rejection known before acceptance settles to failed and may retry;
- timeout/connection-loss after an attempted SMTP transaction settles to `delivery_uncertain`;
- a resolved SMTP result with any rejected required recipient settles to `delivery_uncertain` and records only sanitized acceptance counts;
- manual mail uses the returned claim token and the same uncertainty rule.

**Step 2: Verify RED**

```powershell
node --test test/cargo-automatic-mail-dedupe.test.js test/cargo-mail-dedupe.test.js
```

**Step 3: Implement the shared delivery contract**

`cargo-automatic-mail-dedupe.js` exports:

```text
deliverAutomaticMailOnce({ supabaseFetch, eventId, allowedEventTypes, sendMail, classifySmtpError }) -> Promise<DeliveryResult>
classifySmtpFailure(error) -> "failed" | "delivery_uncertain"
```

Refactor the three automatic handlers in `cargo-import-request.js` to claim first, validate the claimed snapshot, call the injected transporter once, and settle with the token. Remove read-status/send/update race sequences.

Update `deliverManualMailOnce` to use the token-returning RPC and `settle_cargo_mail`. Keep existing event keys and user-visible response shapes for compatibility.

**Step 4: Verify GREEN and full Node regression**

```powershell
node --test test/cargo-automatic-mail-dedupe.test.js test/cargo-mail-dedupe.test.js test/import-progress-notification.test.js test/warehouse-schedule-notification.test.js test/missing-warehouse-plan-notification.test.js
node --test test/*.test.js
```

Expected: mocked SMTP only; zero real network delivery.

**Step 5: Commit**

```powershell
git add lib/cargo-automatic-mail-dedupe.js lib/cargo-mail-dedupe.js api test
git commit -m "fix: prevent concurrent and uncertain mail resend"
```

## Task 8: Schema preflight와 홈페이지 로그인 속도 제한

**Files:**

- Add to: `homepage_aincustoms/supabase/migrations/20260828090000_add_operational_hardening.sql`
- Create: `homepage_aincustoms/lib/cargo-schema.js`
- Create: `homepage_aincustoms/test/cargo-schema.test.js`
- Create: `homepage_aincustoms/test/cargo-login-rate-limit.test.js`
- Modify: `homepage_aincustoms/api/cargo-login.js`
- Modify: `homepage_aincustoms/lib/cargo-auth.js`
- Modify: `homepage_aincustoms/api/cargo-admin.js`
- Modify: `homepage_aincustoms/api/cargo-card-visibility.js`
- Modify: `homepage_aincustoms/api/cargo-import-request.js`
- Modify: `homepage_aincustoms/api/cargo-original-doc-receipt-mail.js`
- Modify: `homepage_aincustoms/api/cargo-original-doc-request.js`
- Modify: `homepage_aincustoms/api/cargo-original-docs.js`
- Modify: `homepage_aincustoms/api/cargo-quota.js`
- Modify: `homepage_aincustoms/api/cargo-release-request.js`
- Modify: `homepage_aincustoms/api/cargo-revision.js`
- Modify: `hyundai_dashboard/website_integration/sync_to_supabase.py`
- Modify: `hyundai_dashboard/tests/test_notification_health.py`

**Step 1: Write failing tests**

- schema version match allows mutation/mail/sync.
- mismatch blocks mutation/mail with HTTP 503 and names `20260828090000_add_operational_hardening.sql` without exposing secrets.
- read-only cargo data remains available during mismatch.
- five failed logins for the same HMAC-derived client/login key in 15 minutes cause a 15-minute lock.
- successful login resets the counter.
- API returns one generic invalid-login message for nonexistent, wrong-password, and locked cases.
- raw IP and raw login id are not stored in the throttle table.

**Step 2: Verify RED**

```powershell
node --test test/cargo-schema.test.js test/cargo-login-rate-limit.test.js
python -m unittest tests.test_notification_health -v
```

**Step 3: Implement schema and guarded login RPC**

Extend the migration with `public.cargo_login_rate_limits` and:

```sql
public.verify_shipper_login_guarded(
  p_login_id text,
  p_password text,
  p_client_key text
) returns table (
  id uuid,
  login_id text,
  display_name text,
  consignee_filter text,
  release_request_to text,
  role text,
  calendar_preferences jsonb,
  account_category text,
  login_allowed boolean
);
```

Use `security definer`, `set search_path = ''`, fully qualified tables/functions, row lock, case-insensitive login, and service-role-only execute.

`cargo-schema.js` exports `assertCargoSchema(supabaseFetch)`. Apply it before every website mutation and automatic mail handler. Add `ensure_schema_version(cfg)` before local sync writes. Do not block read APIs.

`cargo-login.js` derives `p_client_key` with HMAC-SHA256 over normalized client IP plus lowercase login id using `CARGO_SESSION_SECRET`; it never logs the source values.

**Step 4: Verify GREEN**

```powershell
node --test test/cargo-schema.test.js test/cargo-login-rate-limit.test.js
node --test test/*.test.js
python -m unittest tests.test_notification_health -v
```

**Step 5: Commit both repositories**

Homepage:

```powershell
git add supabase/migrations/20260828090000_add_operational_hardening.sql lib/cargo-schema.js lib/cargo-auth.js api test/cargo-schema.test.js test/cargo-login-rate-limit.test.js
git commit -m "security: gate cargo writes and throttle login"
```

Dashboard isolated repository:

```powershell
git add website_integration/sync_to_supabase.py tests/test_notification_health.py
git commit -m "ops: stop sync on schema mismatch"
```

## Task 9: 비밀 흔적 제거, 의존성 고정, 홈페이지 mirror 단일화

**Files:**

- Modify: `homepage_aincustoms/supabase/migrations/20260724_add_calendar_preferences_and_ctf.sql`
- Modify: `homepage_aincustoms/supabase/migrations/20260806_add_dawoorin_account.sql`
- Modify: `hyundai_dashboard/website_integration/add_admin_management.sql`
- Modify: `hyundai_dashboard/website_integration/supabase_schema.sql`
- Create: `homepage_aincustoms/test/no-secret-source.test.js`
- Create: `hyundai_dashboard/tests/test_source_hygiene.py`
- Create: `hyundai_dashboard/website_integration/sync_homepage_mirror.ps1`
- Create: `hyundai_dashboard/website_integration/verify_homepage_mirror.py`
- Create: `hyundai_dashboard/tests/test_homepage_mirror.py`
- Modify: both `package.json` files
- Create: both `package-lock.json` files
- Modify: `hyundai_dashboard/requirements.txt`
- Modify: `homepage_aincustoms/docs/DATA_PRESERVATION_RULES.md`
- Modify: `homepage_aincustoms/docs/CHANGE_REQUEST_HISTORY.md`
- Modify: dashboard copies of those two documents

**Step 1: Write failing hygiene tests**

- tracked source contains no known bootstrap password, `sb_secret_`, legacy service-role JWT, or hardcoded UNIPASS key.
- historical account migrations generate an unusable random bootstrap hash and never overwrite an existing password on conflict.
- authoritative homepage files and `website_integration/vercel_package` match a checked manifest hash.
- requirements use exact versions and both Node packages have lock files.
- active logs are below 10 MiB after rotation.

**Step 2: Verify RED**

```powershell
node --test test/no-secret-source.test.js
python -m unittest tests.test_source_hygiene tests.test_homepage_mirror -v
```

**Step 3: Sanitize and pin**

- Replace plaintext bootstrap literals with generated disabled/random hashes while preserving already-applied production behavior; never change existing accounts in historical migration replays.
- Pin `Flask==3.1.3`, `requests==2.34.2`, `pypdf==6.13.2`.
- Pin `nodemailer` to `6.9.16` and create lock files with `npm install --package-lock-only --ignore-scripts`.
- Make `homepage_aincustoms` authoritative. `sync_homepage_mirror.ps1` copies only manifest-listed files after tests; `verify_homepage_mirror.py` reports drift and never silently overwrites.
- Record every new invariant and rollback command in both history/preservation documents.

**Step 4: Verify GREEN**

```powershell
node --test test/no-secret-source.test.js test/*.test.js
python -m unittest tests.test_source_hygiene tests.test_homepage_mirror -v
python -m unittest discover -s tests -v
```

**Step 5: Commit**

Commit homepage hygiene/migration history separately from dashboard runtime/mirror changes so either side can be reverted without the other.

## Task 10: 버전별 NEWMAIN release 설치와 전환

**Files:**

- Create: `hyundai_dashboard/website_integration/install_dashboard_release.ps1`
- Create: `hyundai_dashboard/tests/test_release_install.py`
- Modify: `hyundai_dashboard/website_integration/setup_newmain_runtime.ps1`
- Modify: `hyundai_dashboard/website_integration/runtime_launcher.ps1`
- Modify: `hyundai_dashboard/website_integration/HOMEPAGE_INTEGRATION_GUIDE.md`

**Step 1: Write failing release tests**

- install copies code to `releases/<fingerprint>` and never places state/secrets inside the release.
- validation failure leaves `current_release.json` unchanged.
- success changes the pointer with atomic replace and retains the previous release.
- `-RollbackTo <fingerprint>` selects an existing verified release only.
- task definitions always point to the stable launcher, not a release directory or network path.

**Step 2: Verify RED**

```powershell
python -m unittest tests.test_release_install -v
```

**Step 3: Implement install/cutover script**

`install_dashboard_release.ps1` accepts `-SourceRoot`, `-RuntimeRoot`, `-ExpectedFingerprint`, `-InstallOnly`, `-Activate`, and `-RollbackTo`. It copies into a temporary release directory, installs pinned dependencies into the stable venv, runs Python tests, validates file hashes, renames to the fingerprint, then changes the pointer only with `-Activate`.

Before activation, it calls `create_rollback_bundle.ps1`. After activation, it calls `ensure_dashboard_server.ps1` and restores the previous pointer automatically if health does not match within the timeout.

**Step 4: Verify in a temporary runtime**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\website_integration\install_dashboard_release.ps1 -SourceRoot $PWD -RuntimeRoot "$env:TEMP\ain-dashboard-release-test" -ExpectedFingerprint (python -c "from build_info import source_fingerprint; print(source_fingerprint())") -InstallOnly
python -m unittest tests.test_release_install -v
```

**Step 5: Commit**

```powershell
git add website_integration/install_dashboard_release.ps1 website_integration/setup_newmain_runtime.ps1 website_integration/runtime_launcher.ps1 website_integration/HOMEPAGE_INTEGRATION_GUIDE.md tests/test_release_install.py
git commit -m "ops: install reversible dashboard releases"
```

## Task 11: 전체 검증, additive DB 적용, preview, production cutover

**Files:**

- Create: `homepage_aincustoms/docs/operations/2026-08-28-hardening-rollout.md`
- Create: `hyundai_dashboard/docs/operations/2026-08-28-hardening-rollout.md`

**Step 1: Capture immutable baselines**

Record without secret values:

- homepage `git rev-parse HEAD` and current production deployment URL/id;
- NEWMAIN current process id, command line, `/api/health` or root hash, tasks XML, state hash and BL count;
- Supabase migration list, row counts for cards/accounts/notifications, and status counts;
- current Vercel environment variable names only.

Run the rollback bundle again and record its path/hash.

**Step 2: Run all tests before external changes**

Dashboard isolated repository:

```powershell
python -m unittest discover -s tests -v
```

Homepage repository:

```powershell
node --test test/*.test.js
git diff --check
```

All failures must be either fixed or explicitly shown to be unchanged legacy expectations with an issue reference. No customer mail may be sent.

**Step 3: Apply the additive Supabase migration safely**

```powershell
npx supabase link --project-ref bbuoegplscttvixbuavy
npx supabase db push --dry-run
npx supabase db push
npx supabase migration list
```

Verify the metadata version, new columns, functions, privileges, existing row counts, and login for one admin plus one shipper using API tests. Do not run a down migration; old code remains compatible with the additive schema.

**Step 4: Preview the homepage code**

- Push `codex/dashboard-operational-hardening`.
- Let Vercel create a preview deployment.
- Set preview environment to prevent real mail or use mocked endpoint verification.
- Verify login, cargo read, schema mismatch behavior, mutation authorization, and concurrent automatic endpoint tests without SMTP.

**Step 5: Production homepage deployment**

- Merge by one merge commit so the full feature is revertible.
- Push `main` and verify Vercel production points to that commit.
- Record the new deployment URL/id and keep the prior production deployment available.
- If verification fails, immediately promote the recorded prior Vercel deployment and `git revert` the hardening merge commit; do not rewrite history.

**Step 6: NEWMAIN runtime cutover**

On NEWMAIN only:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\website_integration\setup_newmain_runtime.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\website_integration\install_dashboard_release.ps1 -SourceRoot $PWD -RuntimeRoot "C:\ProgramData\AIN\HyundaiDashboard" -ExpectedFingerprint (python -c "from build_info import source_fingerprint; print(source_fingerprint())") -InstallOnly
python .\website_integration\sync_to_supabase.py --skip-notifications
powershell -NoProfile -ExecutionPolicy Bypass -File .\website_integration\install_dashboard_release.ps1 -SourceRoot $PWD -RuntimeRoot "C:\ProgramData\AIN\HyundaiDashboard" -ExpectedFingerprint (python -c "from build_info import source_fingerprint; print(source_fingerprint())") -Activate
```

Verify `/api/health`, local anonymous reads, authenticated mutations, state hash/BL count, one no-mail sync, task exit code, and rotated UTF-8 logs. Then enable the two scheduled tasks.

**Step 7: Credential switch/verify/revoke**

- Create a new Supabase secret key; update protected NEWMAIN runtime and Vercel environment.
- Verify no-mail sync, website login/read, and signed automatic endpoint authorization.
- Only then revoke the old key.
- Rotate every account whose bootstrap password appeared in tracked SQL; do not place new passwords in Git or this rollout document.
- Remove the network secret config only after the protected copy and rollback bundle verify.

## Task 12: 롤백 훈련과 완료 기준

**Files:**

- Modify: both rollout documents from Task 11
- Modify: both `CHANGE_REQUEST_HISTORY.md` and `DATA_PRESERVATION_RULES.md`

**Step 1: Local rollback drill**

In a temporary runtime first, then during an agreed NEWMAIN maintenance window:

- switch from the new release to the previous fingerprint;
- confirm previous health/root and unchanged state hash/BL count;
- switch forward again and confirm new health;
- verify both releases use the same protected state/secrets and no data copy-back occurs.

**Step 2: Website rollback drill without customer traffic**

- confirm the prior Vercel production deployment can be selected;
- verify the Git revert command against a throwaway branch;
- do not promote or send mail during the drill unless production rollback is actually required.

**Step 3: Database compatibility drill**

- run the previous homepage code test suite against the additive schema in preview/staging mode;
- confirm old code ignores new columns/statuses without deleting rows;
- document that credential revocation is not reversed; code rollback continues with the new credential.

**Step 4: Completion gate**

Do not declare completion until all are true:

- full Python and Node suites are green;
- state concurrency, interrupted write, source fingerprint, task host guard, log rotation, schema gate, login throttle, concurrent mail claim, and uncertain-delivery tests are green;
- Supabase migration list and metadata match `20260828090000`;
- homepage production and NEWMAIN health show the expected commit/fingerprint;
- one no-mail synchronization succeeds and task history records exit code 0;
- no customer SMTP test was sent;
- rollback bundle, prior Vercel deployment, previous local release, and exact restore commands are recorded and verified;
- all modifications are recorded in cumulative change-history and data-preservation files.
