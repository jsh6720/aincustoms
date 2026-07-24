# Vercel Function Budget Report

Date: 2026-07-24

## Budget

- Vercel Hobby limit: 12 Serverless Functions.
- Baseline `api/*.js` count: 12.
- Calendar-preferences standalone handler count: 13.
- Final `api/*.js` count: 12.

## Consolidation

Calendar preference saves now use `PATCH /api/cargo-data`. The existing
`cargo-data` function retains its `GET` dashboard response and handles the
preference write only for the authenticated session account. The former
`api/cargo-calendar-preferences.js` function was removed.

The consolidated PATCH flow preserves preference validation, migration error
guidance, normalized returned preferences, and the refreshed `cargo_session`
cookie. The dashboard continues using its serialized optimistic-save queue;
only the request URL changed.

## Guardrail

`test/calendar-preferences.test.js` asserts exactly 12 JavaScript API files and
asserts that the removed standalone preference handler is absent.
