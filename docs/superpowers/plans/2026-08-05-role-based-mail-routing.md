# Role-Based Cargo Mail Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable AIN, shipper, and destination mail defaults, route request and schedule-change mails by those roles, and preview final arrival/inbound change mail content before sending.

**Architecture:** Extend the existing `cargo_mail_settings` contract with three role keys and centralize routing in `lib/cargo-mail-settings.js`. Existing API files continue to generate and send their own mail, but delegate recipient selection to the shared role router. `cargo-quota` exposes a preview-only action so the browser can show the exact server-generated To, CC, subject, and body before the existing save-and-send request.

**Tech Stack:** Node.js CommonJS, Vercel Serverless Functions, Supabase PostgREST/PostgreSQL, Nodemailer, browser JavaScript, Node test runner

## Global Constraints

- Preserve all existing cargo, document, request, status, date, and feature-mail-setting values.
- Saved database settings take priority over environment or code defaults.
- Request mail routes To AIN and CC to shipper/destination; schedule-change mail routes To shipper/destination and CC to AIN.
- Arrival schedule subject is `[입항 스케줄 변경] 현대_<B/L> / <납품처>` and the body must not contain `귀`.
- No additional Vercel serverless function may be created.
- Homepage source and local deployment mirrors must finish byte-identical for mirrored files.

---

### Task 1: Shared Role Recipient Contract

**Files:**
- Modify: `lib/cargo-mail-settings.js`
- Modify: `test/mail-settings-and-obl-input.test.js`

**Interfaces:**
- Produces: `ROLE_MAIL_SETTING_KEYS`
- Produces: `resolveRequestRecipients(options) -> { to: string[], cc: string[] }`
- Produces: `resolveScheduleRecipients(options) -> { to: string[], cc: string[] }`

- [ ] Write failing tests for role defaults, database priority, fallback behavior, and deduplication.
- [ ] Run `node --test test/mail-settings-and-obl-input.test.js` and verify the new tests fail for missing role routing.
- [ ] Implement the three role settings and two role routers.
- [ ] Re-run the focused test and verify it passes.

### Task 2: Arrival Mail Copy and Preview

**Files:**
- Modify: `lib/cargo-mail-utils.js`
- Modify: `api/cargo-quota.js`
- Modify: `cargo-dashboard.html`
- Modify: `test/cargo-mail-utils.test.js`
- Modify: `test/progress-request-workflow.test.js`

**Interfaces:**
- Produces: exact arrival schedule subject/body contract.
- Produces: `cargo-quota` POST action `preview_transport_mail` returning `{ to, cc, subject, text }` without persistence or SMTP.

- [ ] Write failing tests for the requested subject/body, absence of `귀`, role routing, and preview-only no-send behavior.
- [ ] Run the focused tests and verify expected failures.
- [ ] Implement the mail builder, preview API action, and reusable browser preview dialog.
- [ ] Re-run focused tests and verify they pass.

### Task 3: Request and Schedule API Routing

**Files:**
- Modify: `api/cargo-original-doc-request.js`
- Modify: `api/cargo-import-request.js`
- Modify: `api/cargo-release-request.js`
- Modify: `api/cargo-quota.js`
- Modify: `test/progress-request-workflow.test.js`

**Interfaces:**
- Consumes: `resolveRequestRecipients` and `resolveScheduleRecipients`.

- [ ] Add failing handler assertions for request To/CC and schedule-change To/CC.
- [ ] Run focused API tests and verify failures identify the legacy routing.
- [ ] Replace legacy account/function-only selection with role routing and compatibility fallbacks.
- [ ] Re-run focused API tests and verify they pass.

### Task 4: Administrator Settings and Migration

**Files:**
- Modify: `api/cargo-admin.js`
- Modify: `cargo-dashboard.html`
- Create: `supabase/migrations/20260805_add_role_mail_settings.sql`
- Modify: `test/mail-settings-and-obl-input.test.js`

**Interfaces:**
- Administrator GET/POST includes `ain_default`, `shipper_default`, and `destination_default`.

- [ ] Add failing migration and administrator UI/API contract tests.
- [ ] Run the focused test and verify failure.
- [ ] Implement role-setting rows, effective-value prefill, and save behavior.
- [ ] Re-run the focused test and verify pass.

### Task 5: Mirrors, History, Verification, and Deployment

**Files:**
- Modify mirrored files under `hyundai_dashboard/website_integration/vercel_package/`.
- Modify: `hyundai_dashboard/website_integration/cargo-dashboard.html`
- Create: `hyundai_dashboard/website_integration/add_role_mail_settings.sql`
- Modify: both change-history documents.

**Interfaces:**
- Produces byte-identical deployable mirrors.

- [ ] Mirror homepage API, library, HTML, and SQL files.
- [ ] Record role routing, preview, copy, fallback, and preservation rules in cumulative history.
- [ ] Run `node --test test/*.test.js` and `git diff --check`.
- [ ] Verify mirror hashes for every mirrored source.
- [ ] Commit, push `main`, verify Vercel production is Ready, and smoke-test the live dashboard/API.

