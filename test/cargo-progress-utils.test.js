const test = require("node:test");
const assert = require("node:assert/strict");

const {
  freeTimeExpiry,
  normalizeInspectionStatus,
  sortProgressCards,
} = require("../lib/cargo-progress-utils");

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

test("inspection status accepts automatic, O, triangle, and X only", () => {
  assert.equal(normalizeInspectionStatus(""), null);
  assert.equal(normalizeInspectionStatus("o"), "O");
  assert.equal(normalizeInspectionStatus("△"), "△");
  assert.equal(normalizeInspectionStatus("x"), "X");
  assert.throws(() => normalizeInspectionStatus("pending"), /invalid inspection status/i);
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

