# Task 1 Report

## Result

Removed transfer-document receipt events from the BL progress calendar. OBL/H/C receipt events and transfer status management remain unchanged.

## Changed Files

- `cargo-dashboard.html`
  - Removed only the `transferReceiptDate` calculation and `type: "transfer"` calendar event push from `progressCalendarEvents()`.
- `test/dashboard-source.test.js`
  - Updated calendar behavior assertions to require OBL/H/C events and reject transfer events/text.
  - Updated the source assertion to require transfer receipt event construction to be absent.

## TDD Evidence

RED command:

```powershell
node --test test/dashboard-source.test.js
```

RED output:

```text
tests 39
pass 36
fail 3
```

The three failures were the two new no-transfer behavior assertions and the new source-level no-transfer assertion, all failing because the old transfer event was still present.

GREEN command:

```powershell
node --test test/dashboard-source.test.js
```

GREEN output:

```text
tests 39
pass 39
fail 0
cancelled 0
skipped 0
todo 0
```

## Self-Review

- `git diff --check` completed without whitespace errors.
- The production diff removes only five lines from the progress calendar event builder.
- OBL/H/C event generation remains present and tested.
- Transfer status fields and management remain present in the dashboard, mobile manager, merge utilities, APIs, and related tests.
- No unrelated files were changed for implementation; the requested report is the only additional artifact.

## Commit

Initial implementation commit: `5d20233` (`Remove transfer receipt from progress calendar`)

## Concerns

None.

## Review Follow-Up

### Changed File

- `test/progress-request-workflow.test.js`
  - Changed the stale transfer receipt source assertion from `assert.match` to `assert.doesNotMatch`.
  - All other workflow assertions were preserved.

### Verification

Command:

```powershell
node --test test/dashboard-source.test.js test/progress-request-workflow.test.js
```

Exact output summary:

```text
tests 60
pass 60
fail 0
cancelled 0
skipped 0
todo 0
```

### Commit

`e815a3e` (`Fix stale transfer calendar assertion`)

### Self-Review

- `git diff --check` completed without whitespace errors.
- The fix changes exactly one assertion in the reviewed file.
- The assertion now verifies that `(양도증)` is absent from `progressCalendarEvents` source while OBL/H/C and import-request checks remain unchanged.

### Concerns

None.
