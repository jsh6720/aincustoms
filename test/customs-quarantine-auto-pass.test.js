const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const dashboard = fs.readFileSync(
  path.join(__dirname, "..", "cargo-dashboard.html"),
  "utf8"
);
const cargoDataApi = fs.readFileSync(
  path.join(__dirname, "..", "api", "cargo-data.js"),
  "utf8"
);

function inspectionToggle(card, type) {
  const start = dashboard.indexOf("function inspectionStatusLabel");
  const end = dashboard.indexOf("function progressDocToggle", start);
  assert.ok(start >= 0 && end > start, "inspection render helpers should exist");
  const context = {
    currentUserRole: "admin",
    currentCards: [card],
    esc: (value) => String(value ?? ""),
  };
  vm.createContext(context);
  vm.runInContext(
    `${dashboard.slice(start, end)}
this.renderInspectionToggle = progressManualStatusToggle;`,
    context
  );
  return context.renderInspectionToggle(card, type);
}

test("Customs animal approval overrides a manual triangle with a locked sourced O", () => {
  const html = inspectionToggle(
    {
      animal_quarantine: "△",
      animal_quarantine_override: "△",
      animal_quarantine_customs_passed: true,
    },
    "animal"
  );

  assert.match(html, /class="doc-o"/);
  assert.match(html, />O<\/span>/);
  assert.match(html, /title="관세청 확인"/);
  assert.doesNotMatch(html, /<button/);
});

test("Customs food approval overrides a manual X with a locked sourced O", () => {
  const html = inspectionToggle(
    {
      food_quarantine: "X",
      food_quarantine_override: "X",
      food_quarantine_customs_passed: true,
    },
    "food"
  );

  assert.match(html, /class="doc-o"/);
  assert.match(html, /title="관세청 확인"/);
  assert.doesNotMatch(html, /<button/);
});

test("manual inspection state remains editable when Customs has not approved it", () => {
  const html = inspectionToggle(
    {
      animal_quarantine: "△",
      animal_quarantine_override: "△",
      animal_quarantine_customs_passed: false,
    },
    "animal"
  );

  assert.match(html, /<button/);
  assert.match(html, />△<\/button>/);
  assert.doesNotMatch(html, /관세청 확인/);
});

test("cargo data keeps raw Customs quarantine text and exposes approval flags", () => {
  assert.match(cargoDataApi, /animal_quarantine_customs_text/);
  assert.match(cargoDataApi, /food_quarantine_customs_text/);
  assert.match(cargoDataApi, /animal_quarantine_customs_passed/);
  assert.match(cargoDataApi, /food_quarantine_customs_passed/);
});
