# Compact Customs Arrival Label Design

## Goal

Prevent the Customs arrival source label from overflowing the fixed-width arrival-date column.

## Approved Behavior

- Display only the normalized date, such as `2026-06-27`, inside the table cell.
- Keep the existing red confirmed border for Customs actual arrival dates.
- Expose `관세청 실제입항일 · 자동 확정` as the button title/hover description.
- Keep manual ETA display and editing behavior unchanged.
- Keep calendar labels unchanged.

## Scope

Only the dashboard presentation and its source-level regression tests change. Cargo data, Supabase fields, confirmation rules, sorting, and calendar event dates remain untouched.

## Verification

- A focused test must fail before implementation because the current display includes `(관세청)`.
- The focused dashboard tests and the full Node test suite must pass after implementation.
- The deployed page must render the date without the suffix and retain the confirmed class and hover description.
