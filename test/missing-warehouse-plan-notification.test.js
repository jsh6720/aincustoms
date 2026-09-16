const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const { buildMissingWarehousePlanMail } = require("../lib/cargo-missing-warehouse-plan-notification");
const { deliverMissingWarehousePlanDigest, parseDate } = require("../lib/cargo-missing-warehouse-plan-digest");
const { createSyncSignature } = require("../lib/cargo-import-progress-notification");
const ACCOUNT = "4ddea76d-5295-4c59-a5ad-25a3ace9d51e";
const ID = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const TYPE = "warehouse_plan_missing";
const now = new Date("2026-09-16T00:01:00Z");
const snapshot = { account_id: ACCOUNT, consignee: "현대코퍼레이션H", destination: "캐틀팜_우육_호주",
  notice_date: "2026-09-16", bl_number: "AEL2071517", eta_date: "2026-09-17",
  obl_carrier_submitted_date: "2026-09-14", missing_warehouse_plan_fields: ["반입예정구역", "반입예정일"] };
const other = { ...snapshot, bl_number: "ONEYSYDG03114800", entry_date: "20260916",
  eta_date: "2026-09-16", obl_carrier_submitted_date: "2026-09-09" };
const makeEvent = (s, id) => ({ id: ID(id), account_id: ACCOUNT, bl_number: s.bl_number,
  event_type: TYPE, event_key: "hch:" + TYPE + ":" + s.bl_number + ":" + s.notice_date,
  status: "pending", attempt_count: 0, card_snapshot: structuredClone(s) });

function store(snapshots = [snapshot, other]) {
  const events = snapshots.map((s, i) => makeEvent(s, i + 1));
  const cards = snapshots.map(s => ({ ...s, fully_released: false }));
  const inputs = snapshots.map(s => ({ bl_number: s.bl_number, eta_date: s.eta_date,
    obl_carrier_submitted_date: s.obl_carrier_submitted_date, storage_yard: null, warehouse_expected_date: null }));
  const lifecycle = [], writes = [];
  const flags = { settlementFails: false, attemptFails: false, login: "HCH" };
  const db = async (url, options = {}) => {
    const parsed = new URL("https://example.invalid" + url), q = parsed.searchParams;
    const body = options.body ? JSON.parse(options.body) : {};
    if (options.method) writes.push({ url, body });
    if (url.includes("/rpc/settle_cargo_mail")) {
      if (flags.settlementFails) throw Error("DB unavailable");
      const row = events.find(e => e.id === body.p_event_id && e.claim_token === body.p_claim_token && e.status === "sending");
      if (!row) return [{ settled: false }];
      row.status = body.p_status;
      return [{ settled: true }];
    }
    if (parsed.pathname.endsWith("/cargo_status_notifications")) {
      let rows = events;
      if (q.get("id")) {
        const ids = q.get("id").startsWith("in.") ? q.get("id").slice(4, -1).split(",") : [q.get("id").slice(3)];
        rows = rows.filter(e => ids.includes(e.id));
      }
      for (const field of ["account_id", "event_type", "claim_token"]) {
        if (q.get(field)) rows = rows.filter(e => e[field] === q.get(field).slice(3));
      }
      if (q.get("status")) rows = rows.filter(e => q.get("status") === "eq.sending"
        ? e.status === "sending" : ["pending", "failed"].includes(e.status));
      if (q.get("card_snapshot->>notice_date")) rows = rows.filter(e => e.card_snapshot.notice_date === q.get("card_snapshot->>notice_date").slice(3));
      if (options.method === "PATCH") {
        if (flags.attemptFails && body.attempt_count) throw Error("DB unavailable before SMTP");
        for (const row of rows) Object.assign(row, body);
      } else if (q.has("offset")) rows = rows.slice(Number(q.get("offset")), Number(q.get("offset")) + Number(q.get("limit")));
      return structuredClone(rows);
    }
    const page = rows => structuredClone(rows.slice(Number(q.get("offset") || 0), Number(q.get("offset") || 0) + 200));
    if (parsed.pathname.endsWith("/cargo_cards")) return page(cards);
    if (parsed.pathname.endsWith("/cargo_card_user_inputs")) return page(inputs);
    if (parsed.pathname.endsWith("/cargo_card_lifecycle")) return page(lifecycle);
    if (parsed.pathname.endsWith("/shipper_accounts")) return [{ id: ACCOUNT, login_id: flags.login }];
    throw Error("Unexpected " + url);
  };
  return { events, cards, inputs, lifecycle, writes, flags, db };
}
const run = (s, sendMail, overrides = {}) => deliverMissingWarehousePlanDigest({ db: s.db, eventId: ID(1), sendMail, now, ...overrides });

test("missing-plan title lists all BLs; table retains each missing field and OBL date", () => {
  const mail = buildMissingWarehousePlanMail([other, snapshot, snapshot]);
  assert.equal(mail.subject, "[반입예정정보 입력 확인] 현대코퍼레이션H / 캐틀팜 / 09-16 / 2건(AEL2071517, ONEYSYDG03114800)");
  assert.match(mail.text, /1 \| AEL2071517 \| 2026-09-14 \| 반입예정구역, 반입예정일/);
  assert.match(mail.text, /2 \| ONEYSYDG03114800 \| 2026-09-09/);
  assert.equal((mail.html.match(/<th style=/g) || []).length, 4);
  assert.match(mail.html, /Malgun Gothic/); assert.match(mail.html, /font-size:9pt/);
  assert.doesNotMatch(mail.text, /캐틀팜_우육/);
});
test("rejects mixed notice dates, destinations and conflicting duplicates; escapes HTML", () => {
  for (const modified of [{ ...other, notice_date: "2026-09-17" }, { ...other, destination: "다우린" },
    { ...snapshot, missing_warehouse_plan_fields: ["반입예정일"] }]) {
    assert.throws(() => buildMissingWarehousePlanMail([snapshot, modified]));
  }
  assert.throws(() => buildMissingWarehousePlanMail({ ...snapshot, notice_date: "2026-02-30" }));
  const mail = buildMissingWarehousePlanMail({ ...snapshot, consignee: "<script>" });
  assert.doesNotMatch(mail.html, /<script>/); assert.match(mail.html, /&lt;script&gt;/);
});
test("two different ETA dates combine on the same check day; already-sent trigger does not resend", async () => {
  const s = store(), calls = [];
  const before = structuredClone([s.cards, s.inputs, s.lifecycle]);
  const send = async rows => { calls.push(rows); return { messageId: "one", accepted: ["ops@example.com"] }; };
  const a = await run(s, send);
  const b = await run(s, send, { eventId: ID(2) });
  assert.equal(a.count, 2); assert.equal(a.sent, true); assert.equal(a.messageId, "one");
  assert.equal(b.deduplicated, true); assert.equal(calls.length, 1);
  assert.ok(s.events.every(e => e.status === "sent" && e.attempt_count === 1));
  assert.deepEqual([s.cards, s.inputs, s.lifecycle], before);
  assert.ok(s.writes.every(w => /cargo_status_notifications|settle_cargo_mail/.test(w.url)));
});
test("concurrent BL triggers share one claim and SMTP operation", async () => {
  const s = store(); let sends = 0;
  const send = async () => { sends++; await new Promise(r => setTimeout(r, 8)); return { accepted: ["ops@example.com"] }; };
  await Promise.all([run(s, send), run(s, send, { eventId: ID(2) })]);
  assert.equal(sends, 1); assert.ok(s.events.every(e => e.status === "sent"));
});
test("other consignee/destination/account or other notification type cannot join", async () => {
  for (const mode of ["consignee", "destination", "account", "type"]) {
    const s = store(), calls = [];
    if (mode === "consignee") s.events[1].card_snapshot.consignee = s.cards[1].consignee = "다른화주";
    if (mode === "destination") s.events[1].card_snapshot.destination = s.cards[1].destination = "다우린";
    if (mode === "account") s.events[1].account_id = ID(77);
    if (mode === "type") s.events[1].event_type = "warehouse_arrival_eve";
    await run(s, async rows => { calls.push(rows); return {}; });
    assert.equal(calls.length, 1); assert.equal(calls[0].length, 1); assert.equal(s.events[1].status, "pending");
  }
});
test("live input is rechecked: exclude completed or hidden rows and update partially filled fields", async () => {
  for (const mode of ["complete", "hidden", "source", "excluded", "released", "no-obl", "far-eta", "past-customs", "partial"]) {
    const s = store(), calls = [];
    if (mode === "complete") Object.assign(s.inputs[1], { storage_yard: "강동", warehouse_expected_date: "2026-09-18" });
    if (mode === "hidden") s.inputs[1].is_hidden = true;
    if (mode === "source") s.lifecycle.push({ bl_number: other.bl_number, source_missing: true });
    if (mode === "excluded") s.lifecycle.push({ bl_number: other.bl_number, permanently_excluded: true });
    if (mode === "released") Object.assign(s.cards[1], { fully_released: true, last_release_date: "2026-09-08" });
    if (mode === "no-obl") s.inputs[1].obl_carrier_submitted_date = null;
    if (mode === "far-eta") { s.cards[1].entry_date = null; s.inputs[1].eta_date = "2026-09-20"; }
    if (mode === "past-customs") s.cards[1].entry_date = "20260915";
    if (mode === "partial") s.inputs[1].storage_yard = "강동";
    await run(s, async rows => { calls.push(rows); return {}; });
    assert.equal(calls[0].length, mode === "partial" ? 2 : 1, mode);
    if (mode === "partial") assert.deepEqual(calls[0][1].missing_warehouse_plan_fields, ["반입예정일"]);
  }
});
test("strict current-day/09:00 KST window; previous daily events and missing dates stay unsent", async () => {
  for (const date of ["2026-09-15T23:59:59Z", "2026-09-16T15:00:00Z"]) {
    const s = store(); let count = 0;
    await run(s, async () => { count++; }, { now: new Date(date) });
    assert.equal(count, 0); assert.equal(s.writes.length, 0);
  }
  const s = store(); s.events[0].card_snapshot.notice_date = "";
  await run(s, async () => assert.fail("must not send")); assert.equal(s.writes.length, 0);
});
test("arrival boundary and compact customs dates match NEWMAIN rule", async () => {
  assert.equal(parseDate("20260916"), "2026-09-16"); assert.equal(parseDate("20260230"), null);
  for (const days of [0, 3, 4]) {
    const s = store([snapshot]); s.inputs[0].eta_date = "2026-09-" + (16 + days);
    let calls = 0; await run(s, async () => { calls++; return {}; });
    assert.equal(calls, days <= 3 ? 1 : 0);
  }
});
test("next day uses a new daily event without resetting the prior sent record", async () => {
  const s = store([snapshot]); let count = 0;
  const send = async () => { count++; return {}; };
  await run(s, send);
  const first = structuredClone(s.events[0]);
  s.events.push(makeEvent({ ...snapshot, notice_date: "2026-09-17" }, 3));
  await run(s, send, { eventId: ID(3), now: new Date("2026-09-17T00:00:00Z") });
  assert.equal(count, 2); assert.deepEqual(s.events[0], first); assert.equal(s.events[1].status, "sent");
});
test("sent, sending, uncertain, invalid keys and wrong HCH identity cannot be sent", async () => {
  for (const mode of ["sent", "sending", "delivery_uncertain", "invalid-key", "not-hch"]) {
    const s = store();
    if (mode === "invalid-key") s.events[0].event_key = "untrusted";
    else if (mode === "not-hch") s.flags.login = "CTF";
    else s.events[0].status = mode;
    await run(s, async () => assert.fail("must not send")).catch(error => assert.match(error.message, /HCH/));
    assert.equal(s.writes.length, 0);
  }
});
test("ambiguous SMTP, partial acceptance or settlement failure block automatic retries", async () => {
  for (const mode of ["timeout", "partial", "settlement"]) {
    const s = store(); let calls = 0;
    s.flags.settlementFails = mode === "settlement";
    const send = async () => { calls++; if (mode === "timeout") throw Object.assign(Error("timeout"), { code: "ETIMEDOUT" });
      return { accepted: ["one@example.com"], rejected: mode === "partial" ? ["two@example.com"] : [] }; };
    await run(s, send).catch(() => {});
    await run(s, send, { eventId: ID(2) });
    assert.equal(calls, 1); assert.ok(s.events.every(e => ["sending", "delivery_uncertain"].includes(e.status)));
  }
});
test("pre-SMTP failures can retry as a group without resetting prior attempt counts", async () => {
  for (const mode of ["auth", "attempt-write"]) {
    const s = store(); let calls = 0;
    s.flags.attemptFails = mode === "attempt-write";
    await assert.rejects(run(s, async () => { calls++; throw Object.assign(Error("auth"), { code: "EAUTH" }); }));
    assert.equal(calls, mode === "auth" ? 1 : 0); assert.ok(s.events.every(e => e.status === "failed"));
    s.flags.attemptFails = false;
    await run(s, async () => ({ accepted: ["ops@example.com"] }));
    assert.ok(s.events.every(e => e.status === "sent"));
  }
});
test("pagination does not truncate the second BL", async () => {
  const s = store(), junk = Array.from({ length: 200 }, (_, i) => makeEvent({ ...snapshot, bl_number: "DUMMY" + i, destination: "다른납품처" }, i + 10));
  s.events.unshift(...junk);
  const calls = []; await run(s, async rows => { calls.push(rows); return {}; });
  assert.equal(calls[0].length, 2); assert.ok(junk.every(e => e.status === "pending"));
});

function loadHandler(db, sendMail) {
  const file = path.resolve(__dirname, "../api/cargo-import-request.js"), original = Module._load;
  delete require.cache[file];
  Module._load = function(request, parent, isMain) {
    if (parent?.filename === file && request === "../lib/cargo-auth") return { supabaseFetch: db, requireWritableSession() { assert.fail("browser session"); } };
    if (parent?.filename === file && request === "nodemailer") return { createTransport: () => ({ sendMail }) };
    if (parent?.filename === file && request === "../lib/cargo-missing-warehouse-plan-digest") {
      return { deliverMissingWarehousePlanDigest: args => deliverMissingWarehousePlanDigest({ ...args, now }) };
    }
    return original.call(this, request, parent, isMain);
  };
  try { return require(file); } finally { Module._load = original; delete require.cache[file]; }
}
test("signed API sends one digest only to the existing three internal recipients", async () => {
  const s = store(), mails = [];
  const handler = loadHandler(s.db, async mail => { mails.push(mail); return { accepted: mail.to.split(","), messageId: "mock" }; });
  const keys = ["SUPABASE_SERVICE_ROLE_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS"], previous = { ...process.env };
  Object.assign(process.env, { SUPABASE_SERVICE_ROLE_KEY: "secret", SMTP_HOST: "smtp.example.com", SMTP_USER: "sender@example.com", SMTP_PASS: "secret" });
  const response = () => ({ statusCode: 0, setHeader() {}, status(v) { this.statusCode = v; return this; }, json(v) { this.body = v; return this; } });
  const stamp = String(Math.floor(Date.now() / 1000));
  const req = { method: "POST", headers: { "x-cargo-sync-timestamp": stamp, "x-cargo-sync-signature": "invalid" },
    body: { action: "auto_missing_warehouse_plan_notice", event_id: ID(1) } };
  try {
    const denied = response(); await handler(req, denied); assert.equal(denied.statusCode, 401); assert.equal(s.writes.length, 0);
    req.headers["x-cargo-sync-signature"] = createSyncSignature("secret", stamp, ID(1));
    const good = response(); await handler(req, good);
    assert.equal(good.statusCode, 200); assert.equal(good.body.email_sent, true); assert.equal(good.body.grouped_count, 2);
    assert.equal(mails.length, 1); assert.equal(mails[0].to, "jsh@aincustoms.com,jhcho@aincustoms.com,bill@aincustoms.com");
    assert.equal(mails[0].cc, undefined); assert.equal(mails[0].bcc, undefined);
    assert.equal((mails[0].html.match(/<tr>/g) || []).length, 3);
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});
test("daily event migration remains unchanged and permits missing-plan events", () => {
  const migration = fs.readFileSync(path.resolve(__dirname, "../supabase/migrations/20260821_add_missing_warehouse_plan_notifications.sql"), "utf8");
  assert.match(migration, /warehouse_plan_missing/); assert.match(migration, /manual_mail/);
});
