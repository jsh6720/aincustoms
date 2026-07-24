# Task 3 Report: Calendar Preferences Migration and CTF Account

## Changed Files

- `supabase/migrations/20260724_add_calendar_preferences_and_ctf.sql`
- `test/calendar-preferences.test.js`
- `.superpowers/sdd/task-3-report.md`

## TDD Evidence

- RED: `node --test test\\calendar-preferences.test.js` failed because `20260724_add_calendar_preferences_and_ctf.sql` did not exist. The pre-existing nine tests passed and the added migration test failed with `ENOENT`.
- GREEN: `node --test test\\calendar-preferences.test.js` passed all 10 tests after adding the migration.
- Full suite: `node --test` completed with 85 passing tests and one unrelated failure in `test/viewer-account.test.js`. Its old source assertion expects the viewer-only progress screen that Task 2 is concurrently replacing with the board-first experience.

## Self-Review

- The migration defaults `calendar_preferences` to both optional event groups enabled, backfills nulls, and enforces `not null` for repeatable application to partially initialized schemas.
- `verify_shipper_login(text, text)` is dropped by its exact signature and recreated with the existing login fields plus `calendar_preferences`; its login comparison remains case-insensitive and only returns active accounts with matching pgcrypto hashes.
- The CTF seed updates an existing case-insensitive login match before inserting an absent account through the existing `login_id` conflict rule. The requested password occurs only in the migration seed and source assertion, never in runtime JavaScript.

## Commit

The commit SHA is reported in the task completion response because a commit cannot contain its own final content hash.

## Concerns

- The migration has not been applied to a Supabase database in this task, so its source contract is covered by Node assertions but live SQL execution remains a deployment-time check.
- The full Node suite will remain red until the concurrent Task 2 update reconciles `test/viewer-account.test.js` with the new board-first viewer behavior.
