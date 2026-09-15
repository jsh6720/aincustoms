const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const { buildWarehouseScheduleMail, warehouseName } = require("../lib/cargo-warehouse-schedule-notification");
const { deliverWarehouseDigest } = require("../lib/cargo-warehouse-digest");
const { createSyncSignature } = require("../lib/cargo-import-progress-notification");
const ACCOUNT = "4388ab8f-ddd0-4542-a2c4-8e68e90f9ab3";
const eventId = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const now = new Date("2026-09-15T00:05:00Z");
const snapshot = {
  account_id: ACCOUNT, consignee: "현대코퍼레이션H", destination: "캐틀팜_우육_호주",
  bl_number: "ONEYBNEG05206900", warehouse_expected_date: "2026-09-16",
  planned_storage_yard: "강동냉장(주)보세창고 (02111182/A20101)", obl_warning: true,
};
const other = { ...snapshot, bl_number: "ONEYBNEG05300400" };
const recipients = { to: ["shipper@example.com", "destination@example.com"], cc: ["ops@example.com"] };

function store(snapshots = [snapshot, other]) {
  const events = snapshots.map((card_snapshot, i) => ({
    id: eventId(i + 1), event_key: "live:" + card_snapshot.bl_number, event_type: "warehouse_arrival_eve",
    account_id: ACCOUNT, bl_number: card_snapshot.bl_number, status: "pending", attempt_count: 0, card_snapshot,
  }));
  const cards = snapshots.map(s => ({ ...s, fully_released: false }));
  const inputs = snapshots.map(s => ({ bl_number: s.bl_number, warehouse_expected_date: s.warehouse_expected_date, storage_yard: s.planned_storage_yard }));
  const lifecycle = [];
  const settlements = [];
  let settlementFails = false;
  const db = async (url, options = {}) => {
    const parsed = new URL("https://example.invalid" + url), q = parsed.searchParams;
    const body = options.body ? JSON.parse(options.body) : {};
    if (url.includes("/rpc/settle_cargo_mail")) {
      if (settlementFails) throw Error("unavailable");
      const row = events.find(e => e.id === body.p_event_id && e.claim_token === body.p_claim_token && e.status === "sending");
      settlements.push(body);
      if (!row) return [{ settled: false }];
      row.status = body.p_status; row.error_message = body.p_error_message;
      return [{ settled: true, status: row.status }];
    }
    if (parsed.pathname.endsWith("/cargo_status_notifications")) {
      if (options.method === "PATCH") {
        const ids = q.get("id").startsWith("in.") ? q.get("id").slice(4, -1).split(",") : [q.get("id").slice(3)];
        const rows = events.filter(e => ids.includes(e.id)
          && (q.get("status") === "eq.sending" ? e.status === "sending" : ["pending", "failed"].includes(e.status))
          && (!q.get("claim_token") || e.claim_token === q.get("claim_token").slice(3)));
        for (const row of rows) Object.assign(row, body);
        return structuredClone(rows);
      }
      if (q.get("id")) return structuredClone(events.filter(e => e.id === q.get("id").slice(3)));
      return structuredClone(events.filter(e => ["pending", "failed"].includes(e.status)
        && e.event_type === q.get("event_type").slice(3)
        && e.card_snapshot.warehouse_expected_date === q.get("card_snapshot->>warehouse_expected_date").slice(3)).slice(Number(q.get("offset")), Number(q.get("offset")) + 200));
    }
    if (parsed.pathname.endsWith("/cargo_cards")) return structuredClone(cards);
    if (parsed.pathname.endsWith("/cargo_card_user_inputs")) return structuredClone(inputs);
    if (parsed.pathname.endsWith("/cargo_card_lifecycle")) return structuredClone(lifecycle);
    if (parsed.pathname.endsWith("/shipper_accounts")) return [{ id: ACCOUNT, login_id: "HCH" }];
    throw Error("Unexpected " + url);
  };
  return { events, inputs, cards, lifecycle, settlements, db, failSettlement: () => { settlementFails = true; } };
}
const run = (s, sendMail, extra = {}) => deliverWarehouseDigest({
  db: s.db, eventId: eventId(1), resolveRecipients: async () => recipients, sendMail, now, ...extra,
});

test("approved three-column body and full BL subject; OBL warnings removed", () => {
  const m = buildWarehouseScheduleMail("warehouse_arrival_eve", [other, snapshot, snapshot]);
  assert.equal(m.subject, "[명일 입고 예정 안내] 현대코퍼레이션H / 캐틀팜 / 09-16 / 2건(ONEYBNEG05206900, ONEYBNEG05300400)");
  assert.match(m.text, /내일\(2026-09-16\)/);
  assert.match(m.text, /1 \| ONEYBNEG05206900 \| 강동냉장\(주\)보세창고/);
  assert.match(m.html, /<table/);
  assert.equal((m.html.match(/<th style=/g) || []).length, 3);
  assert.doesNotMatch(m.html, /OBL|접수|확인사항|02111182/);
  assert.match(m.html, /font-size:9pt/);
  assert.match(m.html, /Malgun Gothic/);
  assert.match(m.text, /jsh@aincustoms.com/);
  assert.equal(warehouseName("(주)강동 보세창고 (02111182/A20101)"), "(주)강동 보세창고");
});
test("today stays a planned notice and groups exactly like eve", () => {
  const m = buildWarehouseScheduleMail("warehouse_arrival_today", [snapshot, other]);
  assert.match(m.subject, /^\[금일 입고 예정 안내\]/);
  assert.match(m.text, /오늘\(2026-09-16\) 입고 예정/);
  assert.doesNotMatch(m.text, /입고 완료|실제 입고/);
});
test("different dates, destinations, conflicting yards rejected; HTML escaped", () => {
  for (const second of [{ ...other, warehouse_expected_date: "2026-09-17" }, { ...other, destination: "다우린" }, { ...snapshot, planned_storage_yard: "다른 창고" }]) {
    assert.throws(() => buildWarehouseScheduleMail("warehouse_arrival_eve", [snapshot, second]));
  }
  assert.throws(() => buildWarehouseScheduleMail("warehouse_arrival_eve", { ...snapshot, warehouse_expected_date: "2026-02-30" }));
  const m = buildWarehouseScheduleMail("warehouse_arrival_eve", { ...snapshot, planned_storage_yard: "<img src=x>" });
  assert.doesNotMatch(m.html, /<img/);
  assert.match(m.html, /&lt;img/);
});
test("two BLs, one SMTP, separate settlement; second trigger cannot resend", async () => {
  const s = store(); const mails = [];
  const send = async (...args) => { mails.push(args); return { accepted: recipients.to, messageId: "smtp-one" }; };
  const a = await run(s, send);
  const b = await run(s, send, { eventId: eventId(2) });
  assert.equal(a.sent, true); assert.equal(a.count, 2); assert.equal(a.messageId, "smtp-one");
  assert.equal(b.deduplicated, true); assert.equal(mails.length, 1);
  assert.equal(mails[0][1].length, 2); assert.deepEqual(mails[0][2], recipients);
  assert.equal(s.settlements.length, 2);
  assert.ok(s.events.every(e => e.status === "sent" && e.attempt_count === 1));
});
test("simultaneous BL triggers do not duplicate any SMTP", async () => {
  const s = store(); let sent = 0;
  const send = async () => { sent++; await new Promise(r => setTimeout(r, 10)); return { accepted: recipients.to }; };
  await Promise.all([run(s, send), run(s, send, { eventId: eventId(2) })]);
  assert.equal(sent, 1); assert.ok(s.events.every(e => e.status === "sent"));
});
test("different recipient lists or destination are separate digests", async () => {
  for (const different of ["recipients", "destination"]) {
    const s = store(different === "destination" ? [snapshot, { ...other, destination: "다우린_우육" }] : undefined);
    const mails = [];
    const resolveRecipients = async snap => different === "recipients" && snap.bl_number === other.bl_number
      ? { to: ["different@example.com"], cc: [] } : recipients;
    const sendMail = async (...args) => { mails.push(args); return { accepted: args[2].to }; };
    await run(s, sendMail, { resolveRecipients });
    await run(s, sendMail, { eventId: eventId(2), resolveRecipients });
    assert.equal(mails.length, 2); assert.ok(mails.every(m => m[1].length === 1));
  }
});
test("hidden, missing source, changed plan, old event are excluded", async () => {
  for (const mode of ["hidden", "source", "date", "yard", "old"]) {
    const s = store();
    if (mode === "hidden") s.inputs[1].is_hidden = true;
    if (mode === "source") s.lifecycle.push({ bl_number: other.bl_number, source_missing: true });
    if (mode === "date") s.inputs[1].warehouse_expected_date = "2026-09-17";
    if (mode === "yard") s.inputs[1].storage_yard = "새 창고";
    const calls = [];
    await run(s, async (_, rows) => { calls.push(rows); return { accepted: recipients.to }; },
      mode === "old" ? { now: new Date("2026-09-17T00:00:00Z") } : {});
    assert.equal(calls.length, mode === "old" ? 0 : 1);
    if (calls.length) assert.equal(calls[0].length, 1);
  }
});
test("SMTP ambiguous, rejected, or DB settlement failure cannot resend", async () => {
  for (const mode of ["timeout", "partial", "settlement"]) {
    const s = store(); let sends = 0;
    if (mode === "settlement") s.failSettlement();
    const send = async () => {
      sends++;
      if (mode === "timeout") throw Object.assign(Error("timeout"), { code: "ETIMEDOUT" });
      return { accepted: ["one@example.com"], rejected: mode === "partial" ? ["two@example.com"] : [] };
    };
    await run(s, send).catch(() => {});
    await run(s, send, { eventId: eventId(2) });
    assert.equal(sends, 1);
    assert.ok(s.events.every(e => ["sending", "delivery_uncertain"].includes(e.status)));
  }
});
test("pre-acceptance failure retries once as same group", async () => {
  const s = store();
  await assert.rejects(run(s, async () => { throw Object.assign(Error("auth"), { code: "EAUTH" }); }));
  assert.ok(s.events.every(e => e.status === "failed"));
  await run(s, async () => ({ accepted: recipients.to }));
  assert.ok(s.events.every(e => e.status === "sent" && e.attempt_count === 2));
});
test("test event requires stored test marker, cannot combine with real rows, has only JSH", async () => {
  const s = store();
  for (const e of s.events) { e.event_key = "test:warehouse-digest:" + e.id; e.card_snapshot.warehouse_digest_test = true; }
  s.events.push({ ...structuredClone(s.events[0]), id: eventId(3), event_key: "live:one", card_snapshot: { ...snapshot } });
  let received;
  await run(s, async (...args) => { received = args; return { accepted: ["jsh@aincustoms.com"] }; });
  assert.deepEqual(received[2], { to: ["jsh@aincustoms.com"], cc: [] });
  assert.equal(received[3], true);
  assert.equal(s.events[2].status, "pending");
});

function loadHandler(db, sendMail) {
  const handlerPath = path.resolve(__dirname, "../api/cargo-import-request.js");
  const original = Module._load;
  delete require.cache[handlerPath];
  Module._load = function(request, parent, isMain) {
    if (parent?.filename === handlerPath && request === "../lib/cargo-auth") return { supabaseFetch: db, requireWritableSession() { throw Error("no session"); } };
    if (parent?.filename === handlerPath && request === "nodemailer") return { createTransport: () => ({ sendMail }) };
    return original.call(this, request, parent, isMain);
  };
  try { return require(handlerPath); } finally { Module._load = original; delete require.cache[handlerPath]; }
}
test("signed production handler sends test only to JSH; bad signature changes nothing", async () => {
  const kst = new Date(Date.now() + 9 * 3600000 + 86400000).toISOString().slice(0, 10);
  const s = store([snapshot, other].map(v => ({ ...v, warehouse_expected_date: kst })));
  for (const e of s.events) { e.event_key = "test:warehouse-digest:" + e.id; e.card_snapshot.warehouse_digest_test = true; }
  const sent = [];
  const handler = loadHandler(s.db, async mail => { sent.push(mail); return { accepted: ["jsh@aincustoms.com"], messageId: "verified" }; });
  const prev = { ...process.env };
  Object.assign(process.env, { SUPABASE_SERVICE_ROLE_KEY: "secret", SMTP_HOST: "smtp.example.com", SMTP_USER: "sender@example.com", SMTP_PASS: "secret" });
  const response = () => ({ statusCode: 0, body: null, setHeader() {}, status(v) { this.statusCode = v; return this; }, json(v) { this.body = v; return this; } });
  const stamp = String(Math.floor(Date.now() / 1000));
  const req = { method: "POST", headers: { "x-cargo-sync-timestamp": stamp, "x-cargo-sync-signature": "invalid" },
    body: { action: "auto_warehouse_schedule_notice", event_id: eventId(1) } };
  try {
    const bad = response(); await handler(req, bad); assert.equal(bad.statusCode, 401); assert.equal(sent.length, 0);
    req.headers["x-cargo-sync-signature"] = createSyncSignature("secret", stamp, eventId(1));
    const good = response(); await handler(req, good);
    assert.equal(good.statusCode, 200); assert.equal(good.body.email_sent, true); assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "jsh@aincustoms.com"); assert.equal(sent[0].cc, undefined); assert.equal(sent[0].bcc, undefined);
    assert.match(sent[0].subject, /^\[테스트\] \[명일/);
    assert.equal((sent[0].html.match(/<tr>/g) || []).length, 3);
  } finally {
    for (const key of ["SUPABASE_SERVICE_ROLE_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) {
      if (prev[key] === undefined) delete process.env[key]; else process.env[key] = prev[key];
    }
  }
});
test("original schedule migration still supports eve and today", () => {
  const migration = fs.readFileSync(path.resolve(__dirname, "../supabase/migrations/20260806_add_warehouse_schedule_notifications.sql"), "utf8");
  assert.match(migration, /warehouse_arrival_eve/); assert.match(migration, /warehouse_arrival_today/);
});
