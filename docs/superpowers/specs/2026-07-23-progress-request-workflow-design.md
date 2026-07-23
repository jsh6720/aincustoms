# BL Progress Request Workflow Design

## Goal

Make `BL별 진행현황` the default post-login screen and let shipper accounts submit document-receipt and import-declaration requests directly from the progress table. Preserve the existing card dashboard as a secondary view, record shipper-originated transport edits, and surface all relevant dates in the progress calendar.

## Scope

This change includes:

- Defaulting both admin and shipper logins to `BL별 진행현황`.
- Adding shipper-only request columns and request dialogs to the progress table.
- Adding an explicit import-declaration request date.
- Letting shippers choose between saving transport information only and saving plus sending an email.
- Visually distinguishing shipper-entered transport information for admins.
- Showing confirmation items when hovering a BL number.
- Expanding progress-calendar request and receipt events.
- Extending existing APIs and tables without adding a new Vercel serverless function.

The existing board, admin settings, mobile original-document page, release requests, and document scanning remain available and keep their current behavior unless explicitly changed below.

## Roles And Default View

### Shared behavior

- After successful login and data loading, both admin and shipper accounts open `BL별 진행현황`.
- The toolbar remains visible so users can navigate to the card dashboard and other role-appropriate views.
- Refreshing data preserves the currently selected view instead of forcing the card dashboard open.

### Admin behavior

- Admins keep the existing admin-only inspection and history status columns.
- Admins do not see the two shipper request columns.
- Admin transport edits save without sending notification email.
- Shipper-entered transport values use a pale blue background or border.
- Hovering a shipper-entered value shows the input account and input timestamp.
- Recent shipper requests appear as compact `화주요청` indicators in the progress-state area; hovering shows the latest request details.

### Shipper behavior

- Shippers do not see admin-only inspection and distribution-history columns.
- Between `진행상태` and `BL파일`, shippers see:
  - `서류수령요청`
  - `수입신고요청`
- Each request is represented by a compact `요청 X` or `요청 O` button styled consistently with the existing O/X controls.

## Request Availability And Interaction

### Document-receipt request

- Active for stages `입항전`, `입항`, and `반입`.
- Disabled for all other stages with a tooltip explaining the stage restriction.
- `요청 X` means no request record exists for the BL.
- `요청 O` means at least one request exists.
- Hovering `요청 O` shows the latest requester, requester email, requested receipt date, memo, and submitted time.
- Clicking either state opens the existing original-document request dialog.
- The dialog is prefilled with the latest request where available.
- Submitting inserts a new request record and sends the existing original-document request email.

### Import-declaration request

- Active for stages `입항` and `반입`.
- Disabled for all other stages with a tooltip explaining the stage restriction.
- `요청 X` means no import request record exists for the BL.
- `요청 O` means at least one request exists.
- Hovering `요청 O` shows the latest requester, requester email, import-request date, delivery address, requested release date, memo, and submitted time.
- Clicking either state opens the existing import-declaration request dialog.
- The dialog is prefilled with the latest request where available.
- A new `수입신고 요청일자` field defaults to the current date in Korea when no earlier value exists. The shipper may change it before sending.
- Submitting inserts a new request record and sends the existing import-declaration request email.

## Transport Information Save Choices

The progress transport dialog continues to edit:

- Arrival expected date
- Expected bonded-storage area
- Expected warehouse entry date

For shipper accounts, the dialog offers two commands:

- `저장만`: save changed values without sending email.
- `저장+메일`: save changed values and send the existing warehouse-change notification email.

For admin accounts, only `저장` is shown and no notification email is sent.

When `저장+메일` is selected and email delivery fails, the existing rollback behavior remains: the just-saved warehouse changes are reverted and the user sees a clear error. `저장만` does not depend on SMTP availability.

## Input Provenance

`cargo_card_user_inputs` records the latest transport edit provenance using:

- `transport_updated_by_role`
- `transport_updated_by_login`
- `transport_updated_at`

These fields are updated only when a `manual_fields` transport save succeeds. They do not alter document scanner values, quota data, inspection overrides, or request history.

The API returns the provenance fields with each card. Admin UI uses them only for a subtle visual distinction and a hover tooltip. The normal table remains compact; the login and timestamp are not permanently printed in cells.

## BL Confirmation Hover

- Hovering the BL number in the progress table shows the card's confirmation items.
- Both admin-authored and shipper-authored items are included.
- Each item shows its text, completion state, and compact author label (`아인` or `화주`).
- Completed items retain their completed/struck-through presentation.
- If no confirmation items exist, no tooltip panel is shown.
- The hover panel is read-only and does not replace the existing card editing controls.

## Calendar Events

The bottom progress calendar includes:

- `입항 BL번호` on the arrival expected date.
- `반입예정 BL번호` on the expected warehouse entry date.
- `서류요청 BL번호` on the requested document-receipt date.
- `수입신고요청 BL번호` on the explicit import-request date.
- `서류수령 BL번호 (OBL)` when only OBL is received.
- `서류수령 BL번호 (H/C)` when only H/C is received.
- `서류수령 BL번호 (OBL, H/C)` when both are received on the shared receipt date.
- `서류수령 BL번호 (양도증)` when the transfer document is marked received.

If OBL/H/C and the transfer document share the same receipt date, the calendar shows separate events, for example:

- `서류수령 ABC123 (OBL, H/C)`
- `서류수령 ABC123 (양도증)`

## Data Changes

### `cargo_import_requests`

Add:

- `requested_import_date date`

Existing rows remain valid. When reading an older row without this value, the UI falls back to the Korea calendar date derived from `created_at`.

### `cargo_card_user_inputs`

Add:

- `transport_updated_by_role text`
- `transport_updated_by_login text`
- `transport_updated_at timestamptz`

The migration is additive and does not delete or replace existing data.

## API Changes

### `GET /api/cargo-data`

- Fetch the new transport provenance fields.
- Fetch `requested_import_date` from import requests.
- Continue returning only the latest request of each type per account and BL for table state and hover details.
- Preserve fallback queries so deployments remain readable before the additive SQL migration is run.

### `POST /api/cargo-original-doc-request`

- Expand stage validation from `입항전` and `입항` to `입항전`, `입항`, and `반입`.
- Preserve request persistence and existing mail content.

### `POST /api/cargo-import-request`

- Expand stage validation from `반입` to `입항` and `반입`.
- Validate and save `requested_import_date`.
- If omitted, default to the current Korea date.
- Include the import-request date in the email body.

### `POST /api/cargo-quota`

- For `manual_fields`, accept a `send_notification` boolean.
- Record transport edit provenance from the verified session.
- Send warehouse-change mail only when the caller is a shipper and `send_notification` is true.
- Preserve rollback-on-mail-failure only for the save-plus-email path.
- Admin changes never send warehouse-change mail.

No new `/api` file is introduced, keeping the project within the Vercel Hobby serverless-function limit.

## Error Handling

- Request buttons are disabled outside their allowed stages.
- Submit buttons are disabled while a request is being sent to prevent duplicate submissions.
- Invalid dates and invalid optional email addresses receive field-specific messages.
- A successful database save followed by request-email failure reports the saved request and failed email separately.
- Transport `저장+메일` email failure reverts the transport change; `저장만` cannot fail because SMTP is unavailable.
- Missing additive columns trigger compatibility reads and a migration guidance message only when a write requires the columns.

## Verification

Automated coverage includes:

- Default progress view for admin and shipper login.
- View preservation during refresh.
- Role-specific request/admin columns.
- Stage-specific request activation.
- Request X/O state and latest-request tooltip content.
- Import-request date default and explicit override.
- Document and import request calendar events.
- OBL, H/C, combined OBL/H/C, and transfer receipt labels.
- Transport save-only and save-plus-email behavior.
- Admin no-email behavior.
- Transport provenance merge and admin visual marker.
- BL confirmation hover with both `아인` and `화주` entries.
- Backward-compatible reads before SQL migration.

Deployment verification includes:

- Node test suite.
- Existing Python dashboard test suite where shared integration files are touched.
- Local browser validation at desktop width for both roles.
- GitHub commit and push.
- Vercel production deployment status.
- Live `www.aincustoms.com/cargo-dashboard.html` verification.
