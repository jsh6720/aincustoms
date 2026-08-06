# Warehouse Schedule Notification Design

## Goal

Send two independent automatic notices for each manually entered bonded-
warehouse arrival schedule:

1. at or after 09:00 KST on the previous day;
2. at or after 09:00 KST on the scheduled day.

The notice schedule uses only the saved `warehouse_expected_date`. UNIPASS
actual-arrival matching is not a mail trigger.

## Operating Model

- Reuse the `HyundaiDashboardSupabaseSync` task on `NEWMAIN` every five minutes.
- Use the HCH account as the canonical source so linked CTF and Samhyeon rows
  do not produce duplicate mail.
- The local sync inserts immutable outbox rows and calls the existing signed
  Vercel mail endpoint.
- SMTP credentials remain only in Vercel.

## Event Rules

- Before 09:00 KST, neither event is eligible.
- On the previous day at or after 09:00, create `warehouse_arrival_eve`.
- On the scheduled day at or after 09:00, create `warehouse_arrival_today`.
- After the scheduled day, do not create stale events.
- The unique identity contains event type, normalized B/L, scheduled date, and
  a normalized warehouse hash. Repeated synchronization is idempotent.
- Changing the scheduled date or warehouse produces a new pair of notices.

## Previous-Day Notice

- To: effective shipper plus destination recipients.
- CC: effective AIN recipients.
- Include shipper, destination, B/L, scheduled date, and planned warehouse.
- Ask recipients to reply to `jsh@aincustoms.com` when the actual plan differs.
- If OBL is not carrier-submitted, include a warning that planned warehouse
  entry may be difficult and request confirmation of OBL receipt and schedule.

## Same-Day Notice

- Use the same role-based recipient routing.
- State that today is the scheduled warehouse-entry date.
- Include shipper, destination, B/L, scheduled date, and planned warehouse.
- Do not repeat the previous-day OBL warning.

## Delivery History And Retry

- Reuse `cargo_status_notifications` with `warehouse_arrival_eve` and
  `warehouse_arrival_today` event types.
- Keep unique event key, immutable snapshot, attempt count, send time, and last
  error.
- Retry `pending` and `failed` rows; never resend `sent` rows.
- Preserve all existing card, document, request, status, date, and mail-setting
  rows.

## Warehouse Display Preservation

- Terminal, container terminal, pier, wharf, and CY data does not replace a
  manually entered planned warehouse.
- A customs warehouse, refrigerated warehouse, frozen warehouse, or bonded
  warehouse can take display precedence when actually queried.
- The manual database value is preserved even when customs data is displayed.
- This display precedence does not create or suppress either email event.

## Verification

- Previous-day 08:59 KST: no event.
- Previous-day 09:00 KST: one `warehouse_arrival_eve` event.
- Scheduled-day 08:59 KST: no event.
- Scheduled-day 09:00 KST: one separate `warehouse_arrival_today` event.
- Repeated sync: no duplicate send.
- Linked account rows: HCH produces one canonical event only.
- Mail routing: shipper and destination in To, AIN in CC.
- Tests use mocked mail transport; no customer mail is sent during verification.
