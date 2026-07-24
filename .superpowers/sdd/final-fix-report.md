# Final Release-Blocking Fix Report

Date: 2026-07-24

## Scope Completed

- Replaced first-match sync routing with deterministic multi-account row
  generation. A Hyundai Corporation H card delivered to 캐틀팜 now produces
  one HCH row and one CTF row, with account/config matches deduplicated.
- Changed `GET /api/cargo-data` to read the verified account's current
  `calendar_preferences` from Supabase. A missing account row falls back to
  the signed session; database errors are not hidden.
- Added normalized `calendar_preferences` to the login response and required
  preference writes to contain exactly the two supported boolean keys.
- Added `role="group"` to the calendar legend.
- Reworked the CTF migration to choose one deterministic canonical row,
  deactivate and rename case-variant duplicates without deleting them, then
  update the canonical row by ID.
- Replaced the local flat Vercel template with
  `website_integration/vercel_package/api` and
  `website_integration/vercel_package/lib`. Both directories are now
  byte-faithful mirrors of the canonical homepage `api` and `lib`
  directories, including all viewer-safe write guards and dashboard
  endpoints.

## TDD Evidence

RED:

- Focused Node run: 45 passed, 5 failed on strict preference validation,
  login response preferences, DB-over-cookie freshness, duplicate-safe CTF
  migration source, and calendar legend grouping.
- Focused Python run failed because `build_upload_rows` and the packaged
  `vercel_package/api` plus `vercel_package/lib` layout did not exist.
- Final re-review focused Python run failed 5 tests because the package had
  only 11 handlers and 5 helpers, omitted `cargo-card-visibility.js` and
  `cargo-request-utils.js`, retained stale auth/write behavior, and was not a
  complete byte match.

GREEN:

- `node --test test\calendar-preferences.test.js test\dashboard-source.test.js`:
  50 passed, 0 failed.
- `python -m unittest hyundai_dashboard.tests.test_sync_account_routing`:
  2 passed, 0 failed.
- `python -m unittest hyundai_dashboard.tests.test_website_progress_features`:
  11 passed, 0 failed after adding complete set, byte-equivalence, dashboard
  endpoint, exact handler-count, import-resolution, and viewer write-guard
  checks.

## Full Verification

- `node --test`: 91 passed, 0 failed.
- `python -m unittest discover -s hyundai_dashboard\tests -p "test_*.py"`:
  29 passed, 0 failed.
- `node --check` over the local package: 18 files checked successfully.
- Homepage `api/*.js`: exactly 12 handlers.
- Local packaged `api/*.js`: exactly 12 handlers.
- Local packaged `lib/*.js`: exactly 6 helpers.
- The complete local packaged `api` and `lib` filename sets and every file's
  bytes are identical to the homepage sources.
- Every `/api/...` endpoint referenced by the local dashboard and mobile
  dashboard has a packaged handler.
- `git diff --check`: passed; Git reported only the repository's expected
  LF-to-CRLF checkout warnings.

## Local Non-Git Changes

Changed or added:

- `website_integration/sync_to_supabase.py`
- `website_integration/cargo-dashboard.html`
- `website_integration/HOMEPAGE_INTEGRATION_GUIDE.md`
- `tests/test_sync_account_routing.py` (added)
- `tests/test_website_progress_features.py`

Final `website_integration/vercel_package/api` mirror:

- `cargo-admin.js`
- `cargo-card-visibility.js`
- `cargo-data.js`
- `cargo-import-request.js`
- `cargo-login.js`
- `cargo-logout.js`
- `cargo-original-doc-receipt-mail.js`
- `cargo-original-doc-request.js`
- `cargo-original-docs.js`
- `cargo-quota.js`
- `cargo-release-request.js`
- `cargo-revision.js`

Final `website_integration/vercel_package/lib` mirror:

- `cargo-auth.js`
- `cargo-calendar-preferences.js`
- `cargo-doc-status.js`
- `cargo-mail-utils.js`
- `cargo-original-doc-utils.js`
- `cargo-request-utils.js`

The now-empty `website_integration/vercel_api` directory was removed.

## Remaining Deployment Concern

The SQL migration has source-contract coverage but was not executed against a
live Supabase database in this pass. Deployment must apply
`20260724_add_calendar_preferences_and_ctf.sql` before the updated API is
released.
