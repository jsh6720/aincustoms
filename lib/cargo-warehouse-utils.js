function cleanLocation(value) {
  return String(value || "").trim();
}

function isCustomsWarehouse(value) {
  const text = cleanLocation(value).replace(/\s+/g, "").toUpperCase();
  if (!text) return false;
  if (["터미널", "부두", "컨테이너야드", "CY"].some((token) => text.includes(token))) {
    return false;
  }
  return ["보세창고", "냉장", "냉동", "창고"].some((token) => text.includes(token));
}

function effectiveStorageYard(manualValue, customsValue) {
  const manual = cleanLocation(manualValue);
  const customs = cleanLocation(customsValue);
  if (isCustomsWarehouse(customs)) return customs;
  return manual || customs;
}

module.exports = {
  effectiveStorageYard,
  isCustomsWarehouse,
};
