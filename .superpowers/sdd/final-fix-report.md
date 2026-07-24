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
  `website_integration/vercel_package/lib`. The copy instructions now keep
  shared helpers outside Vercel's `api` function directory.

## TDD Evidence

RED:

- Focused Node run: 45 passed, 5 failed on strict preference validation,
  login response preferences, DB-over-cookie freshness, duplicate-safe CTF
  migration source, and calendar legend grouping.
- Focused Python run failed because `build_upload_rows` and the packaged
  `vercel_package/api` plus `vercel_package/lib` layout did not exist.

GREEN:

- `node --test test\calendar-preferences.test.js test\dashboard-source.test.js`:
  50 passed, 0 failed.
- `python -m unittest hyundai_dashboard.tests.test_sync_account_routing`:
  2 passed, 0 failed.
- `python -m unittest hyundai_dashboard.tests.test_website_progress_features`:
  9 passed, 0 failed.

## Full Verification

- `node --test`: 91 passed, 0 failed.
- `python -m unittest discover -s hyundai_dashboard\tests -p "test_*.py"`:
  27 passed, 0 failed.
- `node --check` over the local package: 16 files checked successfully.
- Homepage `api/*.js`: exactly 12 handlers.
- Local packaged `api/*.js`: 11 handlers.
- Local packaged `lib/*.js`: 5 helpers.
- Local `cargo-data.js`, `cargo-login.js`,
  `cargo-calendar-preferences.js`, and `cargo-dashboard.html` are
  byte-identical to the homepage sources.
- `git diff --check`: passed; Git reported only the repository's expected
  LF-to-CRLF checkout warnings.

## Local Non-Git Changes

Changed or added:

- `website_integration/sync_to_supabase.py`
- `website_integration/cargo-dashboard.html`
- `website_integration/HOMEPAGE_INTEGRATION_GUIDE.md`
- `tests/test_sync_account_routing.py` (added)
- `tests/test_website_progress_features.py`

Moved from `website_integration/vercel_api` to
`website_integration/vercel_package/api`:

- `cargo-admin.js`
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

Moved and renamed from `website_integration/vercel_api` to
`website_integration/vercel_package/lib`:

- `_cargo-auth.js` to `cargo-auth.js`
- `_cargo-calendar-preferences.js` to `cargo-calendar-preferences.js`
- `_cargo-doc-status.js` to `cargo-doc-status.js`
- `_cargo-mail-utils.js` to `cargo-mail-utils.js`
- `_cargo-original-doc-utils.js` to `cargo-original-doc-utils.js`

The now-empty `website_integration/vercel_api` directory was removed.

## Remaining Deployment Concern

The SQL migration has source-contract coverage but was not executed against a
live Supabase database in this pass. Deployment must apply
`20260724_add_calendar_preferences_and_ctf.sql` before the updated API is
released.
