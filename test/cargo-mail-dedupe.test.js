const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildManualMailEventKey,
  deliverManualMailOnce,
} = require("../lib/cargo-mail-dedupe");

function notificationStore(initial = null) {
  let row = initial;
  const calls = [];
  return {
    calls,
    get row() { return row; },
    async fetch(path, options = {}) {
      calls.push({ path, options });
      if (path.includes("/rpc/claim_cargo_manual_mail")) {
        if (row) return [{ id: row.id, claimed: false, status: row.status }];
        row = { id: "event-1", status: "pending" };
        return [{ id: row.id, claimed: true, status: row.status }];
      }
      if (options.method === "PATCH") {
        row = { ...row, ...JSON.parse(options.body) };
        return [row];
      }
      if (path.includes("cargo_status_notifications")) return row ? [row] : [];
      throw new Error(`unexpected request: ${path}`);
    },
  };
}

test("manual mail event key is stable for equivalent payloads", () => {
  const first = buildManualMailEventKey({
    mailType: "obl_carrier_submission",
    accountId: "account-1",
    blNumber: " one y-1 ",
    businessPayload: { date: "2026-08-13", memo: "접수" },
  });
  const second = buildManualMailEventKey({
    mailType: "obl_carrier_submission",
    accountId: "account-1",
    blNumber: "ONEY-1",
    businessPayload: { memo: "접수", date: "2026-08-13" },
  });
  assert.equal(first, second);
});

test("manual mail sends once and marks the event sent", async () => {
  const store = notificationStore();
  let sent = 0;
  const result = await deliverManualMailOnce({
    supabaseFetch: store.fetch,
    mailType: "original_doc_receipt",
    accountId: "account-1",
    blNumber: "BL-1",
    businessPayload: { received_date: "2026-08-13", documents: ["obl"] },
    cardSnapshot: { consignee: "현대코퍼레이션H" },
    send: async () => { sent += 1; },
  });
  assert.equal(result.sent, true);
  assert.equal(result.deduplicated, false);
  assert.equal(sent, 1);
  assert.equal(store.row.status, "sent");
  assert.ok(store.row.sent_at);
});

test("manual mail skips an event that was already sent", async () => {
  const store = notificationStore({
    id: "event-1",
    event_key: "existing",
    status: "sent",
  });
  let sent = 0;
  const result = await deliverManualMailOnce({
    supabaseFetch: store.fetch,
    mailType: "original_doc_receipt",
    accountId: "account-1",
    blNumber: "BL-1",
    businessPayload: { received_date: "2026-08-13", documents: ["obl"] },
    send: async () => { sent += 1; },
  });
  assert.equal(result.sent, false);
  assert.equal(result.deduplicated, true);
  assert.equal(sent, 0);
});

test("manual mail migration adds an atomic service-role claim", () => {
  const migration = fs.readFileSync(path.join(
    __dirname,
    "..",
    "supabase",
    "migrations",
    "20260813_add_manual_mail_deduplication.sql"
  ), "utf8");
  assert.match(migration, /'manual_mail'/);
  assert.match(migration, /create or replace function public\.claim_cargo_manual_mail/i);
  assert.match(migration, /on conflict \(event_key\) do nothing/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /grant execute on function public\.claim_cargo_manual_mail[^;]+to service_role/is);
});
