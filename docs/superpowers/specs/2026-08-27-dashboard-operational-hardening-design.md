# Dashboard Operational Hardening Design

## Goal

Harden the Hyundai livestock dashboard so local edits, Supabase synchronization,
and customer email notifications remain secure, recoverable, and deterministic
across source changes, machine restarts, transient outages, and concurrent
requests.

## Constraints

- Preserve every existing card, status, note, date, document receipt, request,
  account, mail setting, notification history, and exclusion record.
- Keep LAN access to the NEWMAIN dashboard for the existing office workflow.
- Do not send real customer mail during implementation or verification.
- Do not rotate or revoke a credential until every consumer has been prepared
  and the replacement has been verified.
- Do not rewrite Git history as part of this change.
- Keep NEWMAIN as the only local dashboard server and Supabase synchronization
  runner.
- Use the Git checkout at `homepage_aincustoms` as the only website deployment
  source. The `vercel_package` directory is a mirror, never an independent
  source of truth.

## Current Risks Addressed

1. Local mutation and configuration APIs are reachable on the LAN without
   authentication, and configuration reads can expose credentials.
2. `state.json` is read and overwritten by separate processes without one
   cross-process read-modify-write lock or atomic replacement.
3. NEWMAIN can keep an old Flask process alive after source files change.
4. Automatic mail checks status before SMTP delivery instead of atomically
   claiming the event, so concurrent requests can both send.
5. Automatic schedule candidates exist only from 09:00 through 09:59 KST, so
   an outage for that hour causes a permanent omission.
6. Secrets and historical account bootstrap passwords remain in shared or
   Git-tracked files.
7. Supabase schema application, logs, source mirroring, and local rollback are
   not enforced by one repeatable operational path.

## Architecture

### 1. Protected Local Runtime

NEWMAIN uses a machine-local runtime directory:

`C:\ProgramData\AIN\HyundaiDashboard`

It contains the active local state, state backups, and local-only secret
configuration. ACLs grant access only to Administrators and the Windows account
that runs the dashboard tasks. Shared source files contain no active secret.

The transition is staged. Code first supports an explicit runtime directory and
retains the current shared files as a read-only migration source. A bootstrap
script on NEWMAIN validates the existing JSON, copies it once, writes a backup,
applies ACLs, and updates the scheduled tasks. It never deletes the shared
source files.

### 2. Local Authentication Boundary

The dashboard page and read-only cargo data remain available on the office LAN.
Configuration and every state-changing route require a signed local
administrator session.

- A machine-local bootstrap command creates or resets the local administrator
  password without storing the plaintext password.
- Flask stores only a salted password hash and a random session-signing secret
  in the protected runtime directory.
- Login creates an `HttpOnly`, `SameSite=Strict` session cookie with an eight-
  hour expiry.
- `/api/config` returns an allow-list of non-secret settings. It never returns
  the UNIPASS key, mail password, service-role key, or signing secret.
- Unauthenticated mutation requests return `401`; authenticated non-admin
  requests return `403`.
- The local sync process uses a separate machine-local internal token and does
  not impersonate a browser session.

### 3. Transactional Local State Store

A shared Python state-store module owns every local state operation. Flask and
the synchronization process must not open `state.json` directly.

For each mutation the store:

1. acquires an inter-process lock;
2. reads and validates the latest JSON while holding the lock;
3. applies a narrowly scoped mutation callback;
4. writes UTF-8 JSON to a temporary file and flushes it;
5. preserves the previous valid file as a timestamped backup;
6. atomically replaces the active file;
7. keeps the latest 30 daily backups and never deletes the active file.

Malformed JSON stops the write and preserves both the active file and backups.
Tests exercise two writers updating different B/L records and prove neither
change is lost.

### 4. Version-Aware NEWMAIN Service

Flask exposes a non-secret `/api/health` response containing process start time,
application version, and source fingerprint. A NEWMAIN-only supervisor compares
that fingerprint with the current shared source before each synchronization.

- A dead server is started.
- A healthy matching server is retained.
- A healthy stale server is stopped only when its command line exactly matches
  this project, then restarted and polled until healthy.
- Failure to become healthy stops synchronization with a non-zero exit code.
- Task installers refuse to register server or sync tasks outside NEWMAIN unless
  an explicit emergency override is supplied.

This produces a short controlled restart after source changes and prevents an
old in-memory Flask application from silently serving old routes.

### 5. Durable Automatic Mail Outbox

Manual and automatic mail use the same database claim principle. A Supabase
RPC atomically changes one eligible notification from `pending` or `failed` to
`sending`, records a unique claim token and timestamp, and increments the
attempt count. Only the claimant may mark it `sent` or `failed`.

A `sending` or `sent` event cannot be claimed again automatically. A `sending`
claim older than ten minutes is moved to `delivery_uncertain` by reconciliation
and remains excluded from automatic retry until an administrator checks the
mailbox and explicitly resets it. This favors preventing duplicate customer
mail over automatic recovery from the narrow crash window between SMTP success
and database settlement. A failure confirmed before SMTP acceptance may return
to `failed` and retry normally.

Schedule eligibility becomes:

- before 09:00 KST: no send;
- previous scheduled day from 09:00 until midnight: previous-day event is
  eligible;
- scheduled day from 09:00 until midnight: same-day event is eligible;
- daily missing-plan reminder from 09:00 until midnight: that date's event is
  eligible;
- after the applicable date: no stale event is newly created.

Pending and confirmed-pre-delivery failed events remain retryable only while
their business date is still eligible. `sending`, `delivery_uncertain`, and
`sent` events do not retry automatically. HCH remains the sole canonical source, and
hidden, source-missing, permanently excluded, and grace-expired fully released
cards remain ineligible.

### 6. Credential Remediation

Credential changes use a prepare, switch, verify, revoke sequence:

1. remove active UNIPASS and Supabase secrets from shared source and shared
   configuration;
2. install the protected NEWMAIN runtime configuration;
3. verify local API lookup and one no-mail synchronization;
4. update the matching Vercel environment value when a Supabase key changes;
5. verify website login, data read, and signed automatic endpoint without SMTP;
6. revoke the previous key only after both consumers pass;
7. reset every account whose bootstrap password appeared in SQL history.

Tracked migrations no longer contain executable plaintext bootstrap passwords.
Old Git history is left intact for deployment safety, so password rotation is
mandatory and makes those historical values unusable.

### 7. Source, Schema, Logging, And Recovery

- The website Git checkout is authoritative. A checksum command compares the
  deployment files with the optional local mirror and fails on drift.
- The local dashboard receives a private local Git repository only after secret
  files, state, logs, caches, and temporary files are excluded. No remote is
  added without explicit approval.
- A Supabase system-metadata row records the required dashboard schema version.
  Vercel APIs and NEWMAIN sync fail with one actionable migration message when
  production is older than the code.
- Python and Node dependencies are pinned and lock files are committed where
  supported.
- Logs rotate at 10 MB with ten retained files. Notification failures record
  event ID, event type, response status, and a sanitized error without recipient
  content or credentials.
- Before cutover, the active state and task definitions are exported. Rollback
  restores the prior task action, prior state copy, and prior Git revision; it
  never deletes Supabase operational rows.

## Failure Handling

- Local authentication setup failure leaves existing read-only dashboard access
  intact but keeps all mutation routes closed.
- State migration failure retains and continues to reference the existing valid
  shared state; it never creates an empty replacement.
- Server restart failure blocks synchronization and records a task failure.
- Schema-version mismatch blocks writes and mail but permits an authenticated
  read-only status response.
- A failure confirmed before SMTP acceptance returns the claimed event to
  `failed`. A database update failure after SMTP acceptance leaves the event in
  `sending`; reconciliation changes stale claims to `delivery_uncertain`, which
  requires mailbox review and an explicit administrator decision before resend.
- Credential rotation is rolled back by restoring the previous environment
  values before the old credential is revoked.

## Verification

### Automated

- Local mutation routes reject anonymous requests and accept a valid admin
  session.
- Config responses contain no secret fields or secret values.
- Concurrent state mutations preserve both updates, and interrupted writes keep
  valid JSON plus a recoverable backup.
- A stale source fingerprint triggers one controlled restart; a matching one
  does not restart.
- Non-NEWMAIN task registration fails without the emergency override.
- Two concurrent automatic-mail requests yield one claim and one mocked SMTP
  call.
- Confirmed-pre-delivery failures retry; sent, sending, and delivery-uncertain
  claims do not retry automatically.
- 08:59 creates no schedule event; 09:00 and a later same-day recovery create
  exactly one event; the following date creates no stale previous-day event.
- Hidden and excluded cards never create or retry mail.
- Schema mismatch prevents writes with the exact migration filename.
- Mirror drift, unpinned dependencies, secret-bearing tracked files, and
  oversized logs are detected by focused tests or validation scripts.

### Operational

- Export and compare the existing state before and after migration by record
  counts and normalized SHA-256 inventory.
- Confirm NEWMAIN `/api/health` matches the deployed source fingerprint.
- Run the full Python and Node suites.
- Run one synchronization with all SMTP delivery functions mocked or disabled;
  no customer mail is sent.
- Verify the latest `cargo_sync_runs` row, task exit code, and rotated UTF-8 log.
- Verify the homepage production marker and authenticated role-filtered data.
- Verify rollback artifacts before declaring the cutover complete.

## Rollout Order

1. Capture backups, task definitions, hashes, and current production health.
2. Add tests and implement the transactional local state store.
3. Add local authentication, redacted configuration, and protected runtime
   bootstrap.
4. Add health fingerprinting, NEWMAIN guard, controlled restart, and log
   rotation.
5. Add and apply the atomic automatic-mail migration and schema-version guard.
6. Deploy the Vercel automatic-mail claim changes.
7. Install the NEWMAIN protected runtime and update scheduled tasks.
8. Verify no-mail synchronization and production read paths.
9. Rotate exposed credentials and account passwords in coordinated order.
10. Establish local Git baseline and enforce website source checksum checks.

## Non-Goals

- No redesign of dashboard cards, milestones, calendars, or mail wording.
- No customer-account data migration to a new authentication provider.
- No deletion of Git history, Supabase rows, shared source files, or state
  backups.
- No real SMTP delivery as part of testing.
