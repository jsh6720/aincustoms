# Progress Table Alignment Design

## Goal

Improve the B/L progress table scanability by removing unused column space, keeping schedule dates on one line, aligning headers with row values, and distinguishing transfer-document receipt events in the calendar.

## Table Layout

- Keep every existing progress column and behavior.
- Reduce the widths of compact fields such as number, meat type, delivery terms, milestone, and status indicators.
- Give B/L, ETA, and warehouse expected date enough width to remain on one line.
- Render schedule dates with a slightly smaller font and `white-space: nowrap`.
- Center headers and ordinary short values both horizontally and vertically.
- Keep long descriptive fields, including warehouse location and progress state, left-aligned for readability.
- Preserve horizontal scrolling on narrower viewports.

## Calendar Labels

- Keep the existing `서류수령 B/L` event label when no transfer document is received.
- When `doc_transfer_received` is true, render the receipt event as `서류수령 B/L (양도증)`.
- Reuse the existing effective receipt date; no new date field, API route, or database migration is introduced.

## Compatibility

- Keep the deployed website and local integration HTML identical.
- Do not alter authorization, document toggles, schedule editing, or notification behavior.

## Verification

- Add source-level regression tests for the date-column layout, centered table cells, and transfer receipt calendar label.
- Run all homepage Node tests and local Python integration tests.
- Verify the deployed page visually after publishing.
