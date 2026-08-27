# Cargo dashboard hardening rollout

## Scope

This rollout changes the website APIs, Supabase mail/login coordination, and
the NEWMAIN local runtime without deleting cargo rows, account rows, mail
history, local state, or credentials.

## Baseline

- Previous production commit: `7a3a85465eb8069a5795d2d46679bf4164991410`
- Previous Vercel deployment: `dpl_9DWvquo3AVb52AdkhbqAP2P9EBsT`
- Older Vercel rollback candidate: `dpl_Hc6Db1kgv8a5KvNQw1RLDu9XUG4J`
- Supabase rows before migration:
  - `cargo_cards`: 61
  - `shipper_accounts`: 6
  - `cargo_status_notifications`: 55
  - notification statuses: `sent=55`
- NEWMAIN state SHA-256 before cutover:
  `037f3107f72ade1f2779a15964c07dc5d90a9ac3e3d4a716116ee5a31a456df3`
- NEWMAIN local data before cutover: 13 cards and 13 unique B/L values.

## Database rollout

- Applied migration: `add_operational_hardening`
- Recorded schema version: `20260828090000`
- Applied migration filename:
  `20260828090000_add_operational_hardening.sql`
- Added only coordination columns, rate-limit/metadata tables, constraints,
  indexes, and RPC definitions.
- Existing row counts and the `sent=55` notification distribution were
  unchanged after migration.
- Anonymous and authenticated execute rights were removed from every cargo
  security-definer RPC and the legacy administrator/login functions.
- No down migration is used. Previous application code remains compatible with
  the additive schema.

## Verification

- Homepage Node suite: 396 passed, 0 failed.
- Dashboard Python suite: 151 passed, 0 failed.
- Current legacy production HTML remains HTTP 200 with the unchanged baseline
  SHA-256 after the additive migration.
- No real SMTP test was sent.
- Supabase security advisors report no remaining executable
  security-definer warning. Service-role-only tables intentionally have RLS
  enabled without client policies.

## Website rollback

1. Select the recorded prior production deployment in Vercel only if a real
   production rollback is required.
2. Revert the single hardening merge commit in Git; never force-push or rewrite
   history.
3. Keep the additive database migration and current credentials in place.
4. Re-run the read/login smoke checks before declaring rollback complete.

## NEWMAIN rollback

1. Use the verified previous release fingerprint with
   `install_dashboard_release.ps1 -RollbackTo <fingerprint>`.
2. The installer validates the release fingerprint before changing the atomic
   pointer.
3. State, secrets, logs, backups, and rollback bundles remain outside every
   release and are never copied back from an old release.
4. Compare the protected state SHA-256 and B/L count before and after rollback.

## Outstanding rollout gates

- Vercel preview and production deployment.
- NEWMAIN install-only, no-mail sync, activation, task verification, and
  production-host rollback drill.
- Credential switch, verification, and old-key revocation.

## Rehearsal evidence

- A temporary worktree based on production commit `7a3a854` merged the
  complete feature branch without conflicts and passed all 396 Node tests.
- Reverting that local merge restored a tree exactly matching
  `origin/main`; no customer traffic or Vercel deployment was changed.
- The isolated local runtime completed candidate -> previous -> candidate with
  health fingerprint checks and an unchanged state hash.
- The final local candidate fingerprint is
  `2c978cbcbc81804421b45f7b1f908faa11eebebd1355b4e8ed1cf918149465aa`.
- The rehearsal found and fixed a Windows 260-character source path issue in
  rollback staging before production cutover.
