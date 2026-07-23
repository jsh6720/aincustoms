# Dashboard Default View and Calendar Preferences Design

## Goal

Restore the milestone dashboard as the default post-login view, expose the
progress table through a concise `BL 진행` navigation button, persist optional
calendar event visibility per account, and add a consignee-filtered `CTF`
shipper account.

## User Experience

### Default view

- Every authenticated role opens on the milestone board.
- The header navigation button is labeled `BL 진행`.
- Selecting `BL 진행` opens the existing BL progress table and calendar.
- The progress page keeps a `대시보드` action that returns to the milestone
  board.
- Viewer accounts can see the board but keep all existing read-only
  restrictions.

### Calendar event controls

The following event types are always visible:

- Original document request date
- Original document receipt date, including OBL, H/C, and transfer document
  receipt labels
- Estimated arrival date

The progress calendar header contains compact checkbox legend controls for:

- Import declaration request date
- Expected warehouse entry date

Optional selections are stored in Supabase per login account and are restored
on every browser or computer after login. The default for an account without a
saved preference is that both optional event types are visible.

Changing a preference updates only the authenticated account's calendar
settings. It does not modify cargo data and is allowed for shipper, viewer, and
admin roles.

## Data Model and API

Add a nullable JSONB column named `calendar_preferences` to
`public.shipper_accounts`.

The stored object uses this schema:

```json
{
  "import_request": true,
  "warehouse_expected": true
}
```

`verify_shipper_login` returns the preference object so it can be included in
the signed session. The cargo data response returns the normalized current
preference. A dedicated authenticated endpoint,
`/api/cargo-calendar-preferences`, accepts a complete preference object,
validates only the supported boolean keys, updates the current account row, and
returns the normalized saved value.

## CTF Account

Create or update this regular shipper account:

- Login ID: `CTF`
- Password: `ctf1234`
- Display name: `캐틀팜`
- Consignee filter: `캐틀팜`
- Active: true

The password is hashed in Supabase with `pgcrypto`; it is not stored in source
code outside the one-time SQL migration statement.

## Error Handling

- A failed calendar preference save restores the previous checkbox state and
  shows the API error.
- Unknown preference keys and non-boolean values return HTTP 400.
- Missing or invalid sessions return HTTP 401.
- Missing Supabase schema changes return a message naming the required
  migration.
- Existing cargo mutation restrictions remain unchanged.

## Testing

- Source tests verify the dashboard is the initial view and navigation labels
  are correct.
- Unit tests verify calendar event filtering and preference normalization.
- API tests verify authentication, account-scoped persistence, validation, and
  that no cargo rows are mutated.
- Migration tests verify the preference column, account creation, hashed
  password, and `캐틀팜` filter.
- Existing Node and Python integration suites must remain green.
- Production verification logs in as `CTF`, confirms only matching cargo is
  visible, changes an optional calendar checkbox, reloads the page, and
  confirms the preference persists.
