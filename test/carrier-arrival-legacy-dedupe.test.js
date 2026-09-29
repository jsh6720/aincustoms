const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { buildManualMailEventKey } = require("../lib/cargo-mail-dedupe");
const { buildArrivalScheduleChangeMail, buildWarehouseChangeMail } = require("../lib/cargo-mail-utils");
const { effectiveStorageYard } = require("../lib/cargo-warehouse-utils");

const source = fs.readFileSync(path.join(__dirname, "../api/cargo-quota.js"), "utf8");
function functionSection(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing helper section: ${start}`);
  return source.slice(from, to);
}
const { effectiveTransportValues, transportMailPayload } = vm.runInNewContext([
  functionSection("function normalizeCargoDate(", "function isMissingDeliveryDateColumn("),
  functionSection("function effectiveTransportValues(", "function applyArrivalEdit("),
  functionSection("function transportMailPayload(", "async function sendWarehouseChangeMail("),
  "({ effectiveTransportValues, transportMailPayload })",
].join("\n"), { effectiveStorageYard });

// Captured from the actual ba23bdc quota, mail-template, and event-key generators.
// Keep these literal: this regression must also run without Git or its history.
const baselineCases = [
  { customs: false, type: "arrival", key: "manual_mail:7c50319e99f75869e53a5255c6ef4b084efd3ce71c8a30f2648d96bc666aa2f2" },
  { customs: false, type: "warehouse", key: "manual_mail:cf3159d7ab7a6d4fa4e1a556768643a55224999863087f0764fddc71c358b6ca" },
  { customs: true, type: "arrival", key: "manual_mail:a037cac00132849a239aad8956757069a29f031c694cc34ba59c0f4509aad942" },
  { customs: true, type: "warehouse", key: "manual_mail:d96110b885ebef49cefc15c7cf07a24b0deb7042f6ebb22986c7668ada3ac4c9" },
];
const recipients = Object.freeze({ to: Object.freeze(["test@example.invalid"]), cc: Object.freeze([]) });
const currentLabel = "\uad00\uc138\uccad \uc804\uc0b0";
const legacyLabel = "\uad00\uc138\uccad \ud655\uc778";
const currentLine = `\uc785\ud56d\uc77c: 2026-09-29 (${currentLabel})`;
const legacyLine = `\uc785\ud56d\uc77c: 2026-09-29 (${legacyLabel})`;

function fixture(customs) {
  return {
    card: { account_id: "review", bl_number: "TEST", entry_date: customs ? "20260929" : null, eta_date: "2026-10-01", free_time_days: 3 },
    input: { eta_date: "2026-10-01", eta_date_confirmed: false, free_time_days: 3 },
  };
}
function buildMail(type, card, previous, next) {
  return type === "arrival"
    ? buildArrivalScheduleChangeMail(card, previous, next)
    : buildWarehouseChangeMail(card, {}, previous, next);
}
function eventKey(type, card, businessPayload) {
  return buildManualMailEventKey({
    mailType: type === "arrival" ? "arrival_schedule_change" : "warehouse_change",
    accountId: card.account_id,
    blNumber: card.bl_number,
    businessPayload,
  });
}

for (const baseline of baselineCases) {
  test(`${baseline.type} legacy key matches ba23bdc with Customs=${baseline.customs}`, () => {
    const { card, input } = fixture(baseline.customs);
    const values = Object.freeze(effectiveTransportValues(input, card));
    const mail = Object.freeze(buildMail(baseline.type, card, values, values));
    const before = JSON.stringify({ values, recipients, mail });
    const payload = transportMailPayload(values, values, recipients, mail);

    assert.equal(eventKey(baseline.type, card, payload), baseline.key);
    for (const side of ["previous", "next"]) {
      assert.equal(Object.hasOwn(payload[side], "carrier_arrival_date"), false);
      assert.equal(Object.hasOwn(payload[side], "customs_arrival_date"), false);
    }
    assert.equal(payload.subject, mail.subject);
    assert.equal(JSON.stringify({ values, recipients, mail }), before);
    if (baseline.customs) {
      assert.ok(mail.text.includes(currentLine));
      assert.ok(mail.html.includes(currentLabel));
      assert.equal(mail.text.includes(legacyLabel), false);
      assert.equal(mail.html.includes(legacyLabel), false);
      assert.equal(payload.text, mail.text.replace(currentLine, legacyLine));
    } else {
      assert.equal(payload.text, mail.text);
    }
  });
}

for (const type of ["arrival", "warehouse"]) {
  for (const transition of ["confirm", "unconfirm"]) {
    test(`${type} ${transition} keeps carrier metadata and the approved wording in its key`, () => {
      const { card, input } = fixture(true);
      const previous = effectiveTransportValues({ ...input, eta_date_confirmed: transition === "unconfirm" }, card);
      const next = effectiveTransportValues({ ...input, eta_date_confirmed: transition === "confirm" }, card);
      const mail = buildMail(type, card, previous, next);
      const payload = transportMailPayload(previous, next, recipients, mail);

      for (const side of ["previous", "next"]) {
        assert.equal(Object.hasOwn(payload[side], "carrier_arrival_date"), true);
        assert.equal(Object.hasOwn(payload[side], "customs_arrival_date"), true);
      }
      assert.equal(payload.previous.carrier_arrival_date, next.carrier_arrival_date || previous.carrier_arrival_date);
      assert.equal(payload.next.carrier_arrival_date, next.carrier_arrival_date);
      assert.equal(payload.text, mail.text);
      assert.ok(payload.text.includes(currentLine));
      assert.notEqual(eventKey(type, card, payload), baselineCases.find(item => item.customs && item.type === type).key);
    });
  }

  test(`${type} carrier save-and-send and send-after-save share a key only for identical mail`, () => {
    const { card, input } = fixture(true);
    const previous = effectiveTransportValues(input, card);
    const next = effectiveTransportValues({ ...input, eta_date_confirmed: true }, card);
    const saveMail = buildMail(type, card, previous, next);
    const resendMail = buildMail(type, card, next, next);
    const savePayload = transportMailPayload(previous, next, recipients, saveMail);
    const resendPayload = transportMailPayload(next, next, recipients, resendMail);

    assert.equal(saveMail.subject, resendMail.subject);
    assert.equal(saveMail.text, resendMail.text);
    assert.equal(eventKey(type, card, savePayload), eventKey(type, card, resendPayload));
    assert.equal(savePayload.previous.eta_date, next.eta_date);
    assert.equal(previous.eta_date, "2026-09-29");

    const changedPrevious = { ...previous, storage_yard: "Before" };
    const changedNext = { ...next, storage_yard: "After" };
    const changeMail = buildMail(type, card, changedPrevious, changedNext);
    const savedMail = buildMail(type, card, changedNext, changedNext);
    assert.match(changeMail.text, /Before -> After/);
    assert.notEqual(changeMail.text, savedMail.text);
    assert.notEqual(
      eventKey(type, card, transportMailPayload(changedPrevious, changedNext, recipients, changeMail)),
      eventKey(type, card, transportMailPayload(changedNext, changedNext, recipients, savedMail))
    );
  });
}

test("legacy normalization only changes the standalone standard Customs arrival line", () => {
  const { card, input } = fixture(true);
  const values = effectiveTransportValues(input, card);
  const lines = [currentLine, `Reference: ${currentLine}`, `${currentLine} extra`, `Note: ${currentLabel}`];
  const mail = Object.freeze({ subject: currentLabel, text: lines.join("\n") });
  const payload = transportMailPayload(values, values, recipients, mail);

  assert.equal(payload.subject, mail.subject);
  assert.equal(payload.text, [legacyLine, ...lines.slice(1)].join("\n"));
  assert.equal(mail.text, lines.join("\n"));
});
