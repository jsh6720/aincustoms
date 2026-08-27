const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifySmtpFailure,
  deliverAutomaticMailOnce,
} = require("../lib/cargo-automatic-mail-dedupe");

function automaticStore({
  status = "pending",
  eventType = "warehouse_arrival_today",
  settleThrows = false,
  settleRefused = false,
} = {}) {
  const row = {
    id: "event-1",
    status,
    event_type: eventType,
    card_snapshot: { bl_number: "BL001" },
    claim_token: null,
  };
  const calls = [];
  let claimNumber = 0;
  return {
    calls,
    row,
    async fetch(url, options = {}) {
      calls.push({ url, options });
      if (url.includes("/rpc/claim_cargo_automatic_mail")) {
        if (!["pending", "failed"].includes(row.status)) {
          return [{ ...row, claimed: false }];
        }
        claimNumber += 1;
        row.status = "sending";
        row.claim_token = "claim-" + claimNumber;
        return [{ ...row, claimed: true }];
      }
      if (url.includes("/rpc/settle_cargo_mail")) {
        if (settleThrows) throw new Error("database unavailable");
        const body = JSON.parse(options.body);
        if (settleRefused) return [{ id: row.id, settled: false, status: row.status }];
        assert.equal(body.p_event_id, row.id);
        assert.equal(body.p_claim_token, row.claim_token);
        row.status = body.p_status;
        row.error_message = body.p_error_message;
        return [{ id: row.id, settled: true, status: row.status }];
      }
      throw new Error("unexpected request: " + url);
    },
  };
}

test("two concurrent automatic deliveries claim once and send once", async () => {
  const store = automaticStore();
  let sendCount = 0;
  let releaseSend;
  const sendGate = new Promise((resolve) => { releaseSend = resolve; });
  const sendMail = async () => {
    sendCount += 1;
    await sendGate;
    return { accepted: ["recipient@example.com"], rejected: [] };
  };

  const first = deliverAutomaticMailOnce({
    supabaseFetch: store.fetch,
    eventId: "event-1",
    allowedEventTypes: ["warehouse_arrival_today"],
    sendMail,
  });
  const second = deliverAutomaticMailOnce({
    supabaseFetch: store.fetch,
    eventId: "event-1",
    allowedEventTypes: ["warehouse_arrival_today"],
    sendMail,
  });
  await new Promise((resolve) => setImmediate(resolve));
  releaseSend();

  const results = await Promise.all([first, second]);
  assert.equal(sendCount, 1);
  assert.equal(results.filter((item) => item.sent).length, 1);
  assert.equal(results.filter((item) => item.deduplicated).length, 1);
  assert.equal(store.row.status, "sent");
});

test("unclaimed automatic event is deduplicated without SMTP", async () => {
  const store = automaticStore({ status: "sent" });
  let sendCount = 0;
  const result = await deliverAutomaticMailOnce({
    supabaseFetch: store.fetch,
    eventId: "event-1",
    allowedEventTypes: ["warehouse_arrival_today"],
    sendMail: async () => { sendCount += 1; },
  });

  assert.equal(result.sent, false);
  assert.equal(result.deduplicated, true);
  assert.equal(sendCount, 0);
});

test("successful SMTP and settlement returns sent", async () => {
  const store = automaticStore();
  const result = await deliverAutomaticMailOnce({
    supabaseFetch: store.fetch,
    eventId: "event-1",
    allowedEventTypes: ["warehouse_arrival_today"],
    sendMail: async (claim) => {
      assert.equal(claim.card_snapshot.bl_number, "BL001");
      return { accepted: ["recipient@example.com"], rejected: [] };
    },
  });

  assert.equal(result.sent, true);
  assert.equal(result.deliveryUncertain, false);
  assert.equal(store.row.status, "sent");
});

test("SMTP success with failed settlement is delivery uncertain and never marked failed", async () => {
  const store = automaticStore({ settleThrows: true });
  const result = await deliverAutomaticMailOnce({
    supabaseFetch: store.fetch,
    eventId: "event-1",
    allowedEventTypes: ["warehouse_arrival_today"],
    sendMail: async () => ({ accepted: ["recipient@example.com"], rejected: [] }),
  });

  assert.equal(result.sent, false);
  assert.equal(result.deliveryUncertain, true);
  assert.equal(store.row.status, "sending");
  assert.equal(
    store.calls.filter((call) => call.url.includes("/rpc/settle_cargo_mail")).length,
    1
  );
});

test("known pre-acceptance rejection settles failed and can be claimed again", async () => {
  const store = automaticStore();
  const rejection = Object.assign(new Error("authentication failed for user@example.com"), {
    code: "EAUTH",
    accepted: [],
    rejected: ["recipient@example.com"],
  });

  await assert.rejects(
    deliverAutomaticMailOnce({
      supabaseFetch: store.fetch,
      eventId: "event-1",
      allowedEventTypes: ["warehouse_arrival_today"],
      sendMail: async () => { throw rejection; },
    }),
    (error) => error.deliveryStatus === "failed"
  );
  assert.equal(store.row.status, "failed");
  assert.doesNotMatch(store.row.error_message, /example\.com/);

  const retry = await deliverAutomaticMailOnce({
    supabaseFetch: store.fetch,
    eventId: "event-1",
    allowedEventTypes: ["warehouse_arrival_today"],
    sendMail: async () => ({ accepted: ["recipient@example.com"], rejected: [] }),
  });
  assert.equal(retry.sent, true);
});

test("timeout after an attempted SMTP transaction settles delivery uncertain", async () => {
  const store = automaticStore();
  const timeout = Object.assign(new Error("socket timeout for recipient@example.com"), {
    code: "ETIMEDOUT",
  });

  await assert.rejects(
    deliverAutomaticMailOnce({
      supabaseFetch: store.fetch,
      eventId: "event-1",
      allowedEventTypes: ["warehouse_arrival_today"],
      sendMail: async () => { throw timeout; },
    }),
    (error) => error.deliveryUncertain === true
  );
  assert.equal(store.row.status, "delivery_uncertain");
  assert.doesNotMatch(store.row.error_message, /recipient@example\.com/);
});

test("resolved SMTP with rejected recipients is uncertain and stores counts only", async () => {
  const store = automaticStore();
  const result = await deliverAutomaticMailOnce({
    supabaseFetch: store.fetch,
    eventId: "event-1",
    allowedEventTypes: ["warehouse_arrival_today"],
    sendMail: async () => ({
      accepted: ["accepted@example.com"],
      rejected: ["rejected@example.com"],
    }),
  });

  assert.equal(result.sent, false);
  assert.equal(result.deliveryUncertain, true);
  assert.equal(store.row.status, "delivery_uncertain");
  assert.match(store.row.error_message, /accepted=1 rejected=1/);
  assert.doesNotMatch(store.row.error_message, /example\.com/);
});

test("SMTP failure classification is conservative", () => {
  assert.equal(classifySmtpFailure({ code: "EAUTH", accepted: [] }), "failed");
  assert.equal(classifySmtpFailure({ code: "EENVELOPE", accepted: [] }), "failed");
  assert.equal(classifySmtpFailure({ code: "ETIMEDOUT" }), "delivery_uncertain");
  assert.equal(classifySmtpFailure(new Error("unknown transport error")), "delivery_uncertain");
});
