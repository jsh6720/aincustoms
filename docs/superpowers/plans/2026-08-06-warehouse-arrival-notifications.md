# Warehouse Schedule Notifications Implementation Plan

**Goal:** Send one notice after 09:00 KST on the day before the manually saved
warehouse-entry date and one separate notice after 09:00 KST on that date.

- [x] Add Python tests for both time windows, stale dates, HCH-only creation,
  and event-key changes.
- [x] Build HCH-only immutable outbox candidates from manual
  `warehouse_expected_date` and `storage_yard` values.
- [x] Add retry and signed dispatch through the existing Vercel endpoint.
- [x] Add an idempotent Supabase event-type migration.
- [x] Add Korean previous-day and same-day mail builders.
- [x] Include an OBL-not-submitted warning only in the previous-day notice.
- [x] Route To to shipper and destination and CC to AIN settings.
- [x] Mirror tested homepage runtime files into the local deployment package.
- [x] Run the full Node suite and focused Python schedule/location regressions.
- [x] Record the unrelated legacy local-template test failures separately rather
  than treating them as schedule-notification regressions.
- [ ] Commit, push, and verify production deployment.
- [ ] Apply the Supabase migration before the NEWMAIN task creates new events.

Production verification must not send an unsolicited customer email.
