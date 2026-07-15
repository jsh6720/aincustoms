const test = require("node:test");
const assert = require("node:assert/strict");

const { hasTransferDocument } = require("../lib/cargo-doc-status");

test("detects transfer document from object JSON", () => {
  assert.equal(hasTransferDocument({ TRANSFER: ["09_TRANSFER_BL.pdf"] }), true);
});

test("detects transfer document from string JSON", () => {
  assert.equal(hasTransferDocument('{"TRANSFER":["09_TRANSFER_BL.pdf"]}'), true);
});

test("returns false for missing or malformed transfer status", () => {
  assert.equal(hasTransferDocument({ TRANSFER: [] }), false);
  assert.equal(hasTransferDocument("not-json"), false);
  assert.equal(hasTransferDocument(null), false);
});
