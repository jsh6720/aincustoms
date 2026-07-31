const test = require("node:test");
const assert = require("node:assert/strict");

const {
  customsArrivalConfirmed,
  customsQuarantineFlags,
  customsQuarantinePassed,
  effectiveArrivalDate,
  freeTimeExpiry,
  normalizeInspectionStatus,
  sortProgressCards,
} = require("../lib/cargo-progress-utils");

test("Customs entry date automatically confirms the arrival date", () => {
  assert.equal(customsArrivalConfirmed({ entry_date: "20260801" }), true);
  assert.equal(customsArrivalConfirmed({ entry_date: "2026-08-01" }), true);
  assert.equal(
    customsArrivalConfirmed({ entry_date: "", eta_date: "2026-07-31" }),
    false
  );
});

test("actual Customs entry date overrides a stale manual ETA after arrival", () => {
  assert.equal(
    effectiveArrivalDate({
      stage: "반입",
      entry_date: "20260723",
      eta_date: "2026-07-24",
      first_arrival_date: "2026-07-24",
    }),
    "2026-07-23"
  );
});

test("manual ETA remains the fallback before Customs has an entry date", () => {
  assert.equal(
    effectiveArrivalDate({
      stage: "입항전",
      entry_date: "",
      eta_date: "2026-07-25",
      first_arrival_date: "",
    }),
    "2026-07-25"
  );
});

test("three free-time days include the arrival date", () => {
  assert.equal(
    freeTimeExpiry({ eta_date: "2026-07-25", free_time_days: 3 }),
    "2026-07-27"
  );
});

test("free-time expiry prefers an explicit override", () => {
  assert.equal(
    freeTimeExpiry({
      eta_date: "2026-07-25",
      free_time_days: 3,
      free_time_expiry_override: "2026-08-01",
    }),
    "2026-08-01"
  );
});

test("free-time expiry falls back to API arrival and three days", () => {
  assert.equal(
    freeTimeExpiry({ first_arrival_date: "2026-07-30" }),
    "2026-08-01"
  );
});

test("free-time expiry follows the actual Customs entry date after arrival", () => {
  assert.equal(
    freeTimeExpiry({
      entry_date: "20260723",
      eta_date: "2026-07-24",
      free_time_days: 3,
    }),
    "2026-07-25"
  );
});

test("inspection status accepts automatic, O, triangle, and X only", () => {
  assert.equal(normalizeInspectionStatus(""), null);
  assert.equal(normalizeInspectionStatus("o"), "O");
  assert.equal(normalizeInspectionStatus("△"), "△");
  assert.equal(normalizeInspectionStatus("x"), "X");
  assert.throws(() => normalizeInspectionStatus("pending"), /invalid inspection status/i);
});

test("Customs quarantine pass recognizes only the matching approved inspection text", () => {
  assert.equal(
    customsQuarantinePassed("검사/검역 동물검역(합격)", "animal"),
    true
  );
  assert.equal(
    customsQuarantinePassed("검사/검역\n 식품의약품 ( 합격 )", "food"),
    true
  );
  assert.equal(
    customsQuarantinePassed("검사/검역 동물검역(불합격)", "animal"),
    false
  );
  assert.equal(
    customsQuarantinePassed("검사/검역 식품의약품(합격)", "animal"),
    false
  );
  assert.equal(customsQuarantinePassed("", "food"), false);
});

test("Customs quarantine flags come from cargo progress text, not generic pass fields", () => {
  assert.deepEqual(
    customsQuarantineFlags({
      prgs_stts: "검사/검역 식품의약품(합격)",
      animal_quarantine: "합격",
      food_quarantine: "합격",
    }),
    {
      progressText: "검사/검역 식품의약품(합격)",
      animalPassed: false,
      foodPassed: true,
    }
  );
  assert.deepEqual(
    customsQuarantineFlags({
      prgs_stts: "검사/검역 동물검역(합격)",
      cscl_prgs_stts: "수입신고전",
    }),
    {
      progressText: "검사/검역 동물검역(합격) 수입신고전",
      animalPassed: true,
      foodPassed: false,
    }
  );
});

test("progress cards sort by destination, ETA, milestone, and BL", () => {
  const cards = [
    { bl_number: "BL-5", destination: "다우린_계육", eta_date: "", stage: "반입" },
    { bl_number: "BL-4", destination: "캐틀팜_우육", eta_date: "2026-07-20", stage: "반입" },
    { bl_number: "BL-3", destination: "다우린_계육", eta_date: "2026-07-21", stage: "입항전" },
    { bl_number: "BL-2", destination: "다우린_계육", eta_date: "2026-07-20", stage: "반입" },
    { bl_number: "BL-1", destination: "다우린_계육", eta_date: "2026-07-20", stage: "입항" },
  ];

  assert.deepEqual(
    sortProgressCards(cards).map((card) => card.bl_number),
    ["BL-1", "BL-2", "BL-3", "BL-5", "BL-4"]
  );
});

