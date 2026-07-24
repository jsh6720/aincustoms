# Cargo Progress Operations Design

## Goal

Extend the BL progress dashboard with clearer inspection states, three-day free-time
management, independent arrival and warehouse dates, sticker and OBL submission
tracking, deterministic sorting, and a reversible lifecycle for cards whose local
source folders disappear.

## Scope

### Inspection states

- Animal and food quarantine use three states:
  - `O`: passed
  - `△`: application prepared
  - `X`: not prepared or not progressed
- API-confirmed passes remain automatic and cannot be downgraded by an ordinary
  manual toggle.
- Administrators can set the manual state where the API has not locked the value.
- The progress table, expanded card editor, and local dashboard use the same labels.

### Free time

- The default free-time duration is three calendar days.
- The arrival date counts as day one, so the default expiry date is the effective
  arrival date plus two days.
- Existing manually stored durations, including 7 or 14 days, are migrated to three
  days unless an administrator later changes the value.
- The effective arrival date is selected in this order:
  1. Manually entered ETA.
  2. API entry/arrival date.
- The BL progress table adds a `만기(프리타임)` column immediately after `입항예정`.
- The expiry value is calculated from the effective arrival date and duration.
  Administrators can explicitly override the expiry date.

### Arrival and warehouse dates

- ETA and warehouse expected date are stored and updated independently.
- Saving a warehouse expected date must never write or clear ETA.
- The displayed warehouse expected date uses:
  1. A manually entered warehouse expected date.
  2. The API arrival date when cargo information is available.
- Email behavior for shipper edits remains limited to the warehouse fields that the
  shipper actually changed.

### Sticker request

- Add a `스티커요청` column immediately after `유통이력`.
- The value is `X` by default and can be changed to `O` when requested.
- The value is persisted per account and BL and is visible to administrators.

### OBL carrier submission

- Add an `OBL 접수일` column immediately before `동물검역`.
- Track OBL carrier submission separately from OBL original-document receipt.
- Store a carrier-submitted flag, submission date, actor, and timestamp per account
  and BL.
- Add a top-level OBL submission section to the mobile administrator page.
- The mobile flow supports selecting a BL, marking submission complete, entering the
  submission date, and sending a completion email using the existing receipt-mail
  recipient conventions.

### Card lifecycle

- If a locally synced BL disappears from the source folders, do not delete its
  related data.
- Mark the card automatically hidden with reason `로컬 폴더 없음`.
- Preserve notes, requests, document status, and calendar history.
- If the local folder returns before permanent exclusion, automatically restore the
  card.
- In the administrator `숨김 포함` view, provide `영구 제외`.
- Permanent exclusion creates a tombstone keyed by account and BL. A tombstoned card
  is not recreated by later local syncs, even if its folder exists.
- Provide an administrator exclusion-history view with a restore action.

### BL progress sorting

Sort progress rows in this order:

1. Destination name, ascending.
2. Effective ETA, ascending; missing dates last.
3. Milestone order:
   `입항전`, `입항`, `반입`, `수입신고`, `반출`.
4. BL number as a stable final tie-breaker.

## Data model

Extend `cargo_card_user_inputs` with:

- `sticker_requested boolean not null default false`
- `obl_carrier_submitted boolean not null default false`
- `obl_carrier_submitted_date date`
- `obl_carrier_submitted_by text`
- `obl_carrier_submitted_at timestamptz`
- `free_time_expiry_override date`

Add a card lifecycle table:

```text
cargo_card_lifecycle
- account_id uuid
- bl_number text
- source_missing boolean
- source_missing_at timestamptz
- permanently_excluded boolean
- permanently_excluded_at timestamptz
- permanently_excluded_by text
- restored_at timestamptz
- restored_by text
- primary key (account_id, bl_number)
```

The migration updates existing `free_time_days` values to `3`.

## Data flow

1. The local scanner emits the complete current set of account/BL keys.
2. Sync upserts current cards, clears `source_missing` for returned keys, and skips
   tombstoned keys.
3. Sync marks previously active but absent keys as `source_missing`.
4. The website data API merges cargo data, user input, and lifecycle state.
5. Normal views exclude hidden, source-missing, and permanently excluded rows.
6. The administrator hidden view includes source-missing rows but excludes permanent
   tombstones unless the exclusion-history view is open.

## Error handling

- Reject invalid inspection values outside `O`, `△`, `X`, and blank automatic state.
- Reject non-positive free-time durations.
- Do not send OBL completion mail unless the database save succeeds.
- If mail fails after a successful save, keep the saved state and report the mail
  failure explicitly.
- Lifecycle sync must be idempotent so repeated scheduled runs do not duplicate
  exclusions or restore events.

## Testing

- Unit tests for inclusive three-day expiry calculation.
- API tests proving ETA and warehouse expected date do not overwrite one another.
- Tests for inspection `△` rendering and persistence.
- Tests for sticker request default and toggle.
- Tests for OBL submission persistence, mobile UI, and email payload.
- Sync tests for source-folder disappearance, automatic restore, permanent
  exclusion, and administrator restore.
- Sorting tests covering destination, ETA, milestone, missing dates, and BL
  tie-breaking.
- Full homepage Node test suite and local dashboard Python regression suite.

## Deployment

1. Apply the Supabase migration.
2. Deploy the website API and dashboard files.
3. Update the local dashboard and synchronization script.
4. Run one manual sync and verify an existing BL end to end.
5. Confirm the Vercel production deployment and live dashboard behavior.
