# Valuation Google self-test handoff

## Global Constraints

- Continue the approved Google staging gate, not production deployment. User screenshot confirms homage decl executes as jsh79065432@gmail.com and web app access is all users; deployment version is not visible.
- Preserve existing production Code.gs, frontend, original Sheets, backups, credentials, Git history and deployment state.
- Prepare local artifacts only. User runs them in a NEW standalone Apps Script project. Block the known production script ID before any side effect.
- Use only freshly created synthetic test spreadsheets. Never reuse user DB IDs or a backup as a test fixture. Do not log passwords, tokens, session secrets, data rows or exception details.
- This is an editor Google-service smoke test, NOT HTTP/redirect/CORS verification. Do not claim full staging/production readiness from a PASS.

## Task 1: Standalone staging self-test bundle

Files owned by implementer: scripts/build-valuation-google-selftest.cjs, test/helpers/valuation-google-selftest.gs, test/valuation-google-selftest.test.js, and a new test helper if needed. Do not change existing API or frontend or existing harness behavior.

- TDD first. Tests must execute the generated bundle and check side effects/observable outcomes, not merely grep strings. Use the real current apps-script/valuation/Code.gs and mock Google services only in Node tests.
- Export a pure build function and provide CLI with an explicit output path. It assembles the current backend with the self-test runner. Replace the two production sheet constants with empty runtime variables, rejecting unexpected source structure. The runner assigns them only to two SpreadsheetApp.create results in that invocation; no persisted DB IDs and no external input selecting a sheet. Outside a running test, API requests must have no usable sheet targets.
- Entry point: runValuationGoogleSelfTest. Guard ScriptApp.getScriptId() against production script 1AUaVAdAHmDEZzE0PAne2AiGMZpa72e8kA6blCLZCm6ARdpFTwUctMZ4O before properties, locks, file reads/writes or creation. Require a new project: if a production session secret exists and this project has not been marked as self-test-owned, refuse execution. Do not alter production Code.gs in the build.
- Each manual run creates exactly two clearly named test spreadsheets with only artificial companies/accounts/declarations. Keep files for inspection; no deletion or share changes. State this in safe logs. Secret/passwords must be freshly generated; no real credentials required. Never store/log passwords outside these artificial cells. Initialization uses actual created sheet gids.
- Exercise real doPost handlers in the generated bundle: unauthenticated denial; valid administrator login; account-list password omission; non-admin isolation of synthetic company data and admin action denial; account edit with omitted password preserves B and exact spaces; old customer token invalidates on company change; literal =1+1 and leading-zero declaration text; Korean value readback; extra column and formatting preservation; stale revision denial. Check successful API outputs and actual cell values. Fail-fast with a fixed test label only, no actual response/token dump. Safe completion log contains pass count, two created-file links (no secrets), and explicit HTTP_NOT_TESTED marker.
- Tests cover production-project early refusal with zero Google mutations, fresh fixture binding without original/backup IDs, generated bundle run success and regression injection that makes a check fail, harmless outside-test requests, no secret values in result/logs, and preserve original source file bytes.
- Keep implementation bounded (~200 runner lines preferred); no deployment, OAuth workaround, production probes, new web UI or generalized test platform.
- Run focused tests, then report exact RED/GREEN evidence. Parent runs whole suite once and writes human instructions. No git commit/push/stage due dirty prior task work.

## Handoff gate

Parent reviews generated artifact, independent reviewer checks spec and quality, then generate a paste-ready .txt outside public repo and Korean guide. Open file in Codex. Ask user to create a new project, paste, save, select runValuationGoogleSelfTest, run and send safe result log. If Google blocks authorization, stop without bypassing protections. Current production version, full source and actual HTTP/CORS remain gates before release.
