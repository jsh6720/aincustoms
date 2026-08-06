# Warehouse Arrival Notification Design

## Goal

Send one automatic notice on the morning before each planned bonded-warehouse
arrival and one automatic notice when UNIPASS confirms the cargo actually
entered that same warehouse.

## Operating Model

- Reuse the `HyundaiDashboardSupabaseSync` Windows scheduled task on `NEWMAIN`.
- The task continues to run every five minutes and remains the only polling
  process for local UNIPASS data and planned transport data.
- Reuse the existing signed Vercel mail endpoint instead of creating another
  Serverless Function.
- Keep SMTP credentials only in Vercel. The local process sends only a signed
  event identifier.
- Use the HCH account as the canonical source so linked CTF and Samhyeon rows do
  not produce duplicate mail.

## Planned Arrival Notice

- A card is eligible when it has a planned warehouse arrival date and a planned
  warehouse name or bonded-area code.
- Starting at 09:00 KST on the day before the planned date, the next successful
  five-minute synchronization creates and dispatches the notice.
- If `NEWMAIN` was unavailable at 09:00, the first later synchronization sends
  the delayed notice while the planned arrival is still current.
- The deduplication identity includes normalized B/L, planned date, and planned
  warehouse identity. Repeating the same synchronization never resends it.
- If the date or warehouse changes after an earlier notice, the new combination
  produces one new change notice.
- The body states that a different actual plan should be reported by replying
  to `jsh@aincustoms.com` so the dashboard can be corrected.

## Actual Arrival Notice

- The local UNIPASS parser preserves the full bonded-in timestamp in addition
  to the existing bonded-in date.
- Terminal, pier, wharf, and CY records are not treated as actual bonded-
  warehouse arrival.
- Planned and actual warehouses match in this order:
  1. exact normalized bonded-area code when both records have a code;
  2. otherwise exact normalized warehouse name after removing whitespace,
     punctuation, company markers, and standard warehouse words.
- Fuzzy substring matching is not used because it can create false-positive
  delivery notices.
- A matching actual arrival creates one event containing the actual warehouse
  and UNIPASS bonded-in timestamp.
- A mismatching actual warehouse is recorded in synchronization diagnostics but
  does not send a misleading successful-arrival notice.

## Mail Routing

- Both notices use the existing role-based notice routing.
- To: effective shipper recipients plus effective destination recipients.
- CC: effective AIN recipients.
- Saved administrator settings take priority; existing feature settings and
  environment defaults remain compatibility fallbacks.
- The mail handler resolves recipients at send time so administrator changes are
  reflected without reinstalling the local task.

## Delivery History And Retry

- Extend `cargo_status_notifications` with planned-arrival and actual-arrival
  event types.
- Keep a unique event key, immutable event snapshot, attempt count, send time,
  and last error.
- `pending` and `failed` events are retried by later synchronization runs.
- `sent` events are never retried.
- Existing card, document, request, date, status, and mail-setting rows are not
  reset or deleted.

## Mail Content

### Planned notice

- Subject identifies planned bonded-warehouse arrival, shipper, B/L, and
  destination.
- Body includes shipper, destination, B/L, planned warehouse, planned date, and
  the correction-reply sentence.

### Actual notice

- Subject identifies actual bonded-warehouse arrival, shipper, B/L, and
  destination.
- Body includes shipper, destination, B/L, planned warehouse, actual warehouse,
  and the full UNIPASS bonded-in timestamp.

## Verification

- Before 09:00 KST no planned event is created.
- At or after 09:00 KST on the previous day exactly one planned event is sent.
- A server restart or repeated five-minute run does not duplicate mail.
- A changed planned date or warehouse produces one new notice.
- A terminal record never triggers an actual-arrival notice.
- Equal bonded-area codes trigger an actual-arrival notice even if display names
  differ slightly.
- Without codes, normalized exact names trigger the notice.
- Different warehouse identities do not trigger the notice.
- Actual mail contains the UNIPASS timestamp.
- HCH, CTF, and Samhyeon linked rows still produce only one event.
- Mail routing uses shipper and destination as To and AIN as CC.
- Existing Node and Python regression suites remain green.
