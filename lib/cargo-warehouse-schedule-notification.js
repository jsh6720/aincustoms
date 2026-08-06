function displayText(value, fallback = "-") {
  const text = String(value || "").trim();
  return text || fallback;
}

function displayDestination(value) {
  const text = displayText(value);
  return text === "-" ? text : text.split("_")[0].trim();
}

function buildWarehouseScheduleMail(eventType, snapshot = {}) {
  const isEve = eventType === "warehouse_arrival_eve";
  const isToday = eventType === "warehouse_arrival_today";
  if (!isEve && !isToday) {
    throw new Error("지원하지 않는 입고 일정 알림 유형입니다.");
  }

  const consignee = displayText(snapshot.consignee, "현대코퍼레이션H");
  const blNumber = displayText(snapshot.bl_number);
  const destination = displayDestination(snapshot.destination);
  const plannedDate = displayText(snapshot.warehouse_expected_date);
  const plannedYard = displayText(snapshot.planned_storage_yard);
  const lines = isEve
    ? [
        "안녕하세요. 아인합동관세사입니다.",
        "",
        "아래 화물은 내일 보세창고 입고 예정으로 안내드립니다.",
        "",
        `화주: ${consignee}`,
        `납품처: ${destination}`,
        `B/L: ${blNumber}`,
        `입고예정일: ${plannedDate}`,
        `입고예정구역: ${plannedYard}`,
        "",
        "실제 계획과 다른 경우 jsh@aincustoms.com으로 회신해 주시면 수정 반영하겠습니다.",
      ]
    : [
        "안녕하세요. 아인합동관세사입니다.",
        "",
        "오늘은 아래 화물의 예정된 입고일입니다.",
        "",
        `화주: ${consignee}`,
        `납품처: ${destination}`,
        `B/L: ${blNumber}`,
        `입고예정일: ${plannedDate}`,
        `입고예정구역: ${plannedYard}`,
      ];

  if (isEve && snapshot.obl_warning) {
    lines.push(
      "",
      "현재 OBL이 선사에 접수되지 않은 상태로 확인되어 예정대로 반입이 어려울 수 있습니다. OBL 접수 여부와 반입 일정을 확인해 주시기 바랍니다."
    );
  }
  lines.push("", "감사합니다.", "아인합동관세사무소");

  return {
    subject: `${isEve ? "[명일 입고 예정 안내]" : "[금일 입고 예정 안내]"} ${consignee}_${blNumber} / ${destination}`,
    text: lines.join("\n"),
  };
}

module.exports = {
  buildWarehouseScheduleMail,
};
