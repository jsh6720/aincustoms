# Compact Progress Layout Design

## Goal

Reduce unused space in compact dashboard cards and make the B/L progress table easier to scan while adding editable ETA support to the existing progress editor.

## Display Rules

- Compact cards keep the existing two-row summary and all current fields.
- The B/L track uses content-aware sizing and a smaller column gap so the complete B/L stays visible without leaving a large blank track.
- The progress table displays the shipper as the first four Korean characters of the normalized name, for example `현대코퍼`.
- The progress table displays only the destination segment before the first underscore, for example `캐틀팜` or `다우린`.
- Shipper and destination cells stay on one line.

## ETA Editing

- The existing progress warehouse editor also contains an `입항예정일` date input.
- The editor preloads the effective ETA shown by the card.
- Saving sends only `eta_date`, `storage_yard`, and `warehouse_expected_date` through the existing `/api/cargo-quota` manual-fields action.
- Existing authorization and shipper notification rules remain unchanged. Admin edits do not send notification email; shipper changes do.

## Compatibility

- No database migration or new API route is required.
- The local integration HTML and the deployed website HTML remain synchronized.
- Existing card expansion, scroll restoration, calendar, and warehouse editing behavior must remain unchanged.

## Verification

- Source tests assert the compact layout contract, short shipper/destination rules, and ETA editor payload.
- Existing Node and Python integration tests remain green.
- The deployed page is checked for the new ETA input and compact display helpers.
