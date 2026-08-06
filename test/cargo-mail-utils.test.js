const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildArrivalScheduleChangeMail,
  buildTransportRollbackPayload,
  buildWarehouseChangeMail,
  destinationName,
  mergeManualFields,
  mergeRecipients,
  parseRecipientList,
  warehouseChanges,
} = require("../lib/cargo-mail-utils");

test("builds the approved detailed arrival schedule change email", () => {
  const mail = buildArrivalScheduleChangeMail(
    {
      bl_number: "MEDUWE188588",
      consignee: "현대코퍼레이션H",
      destination: "다우린_계육_브라질",
      obl_received: false,
      doc_iv_received: false,
      doc_co_received: false,
    },
    {
      eta_date: "2026-04-20",
      storage_yard: "삼진냉장",
      warehouse_expected_date: "2026-04-23",
      free_time_days: 3,
    },
    {
      eta_date: "2026-04-22",
      storage_yard: "삼진냉장",
      warehouse_expected_date: "2026-04-24",
      free_time_days: 3,
    }
  );

  assert.equal(mail.subject, "[입항 스케줄 변경] 현대_MEDUWE188588 / 다우린");
  assert.equal(mail.text, [
    "반입예정정보가 변경되었습니다.",
    "",
    "화주명: 현대코퍼레이션H",
    "B/L: MEDUWE188588",
    "납품처: 다우린",
    "입항예정일: 2026-04-20 -> 2026-04-22",
    "만기일: 2026-04-24",
    "",
    "반입예정구역: 삼진냉장",
    "반입예정일: 2026-04-23 -> 2026-04-24",
    "비고: OBL 원본 미수령, IV 미수취",
    "",
    "관련하여 수정 및 문의사항이 있으신 경우 jsh@aincustoms.com 로 메일 부탁드리겠습니다.",
  ].join("\n"));
  assert.doesNotMatch(mail.text, /C\/O 미수취/);
  assert.match(mail.html, /입항예정일: 2026-04-20 <strong>→ 2026-04-22<\/strong>/);
});

test("keeps only the destination name before cargo descriptors", () => {
  assert.equal(destinationName("캐틀팜*우육*호주"), "캐틀팜");
  assert.equal(destinationName("다우린_계육_브라질"), "다우린");
  assert.equal(destinationName("삼현"), "삼현");
  assert.equal(destinationName(""), "-");
});

test("parses, validates, and de-duplicates recipient lists", () => {
  assert.deepEqual(
    parseRecipientList("a@example.com; B@example.com\na@example.com"),
    ["a@example.com", "B@example.com"]
  );
  assert.throws(() => parseRecipientList("not-an-email"), /올바르지 않은 이메일/);
});

test("merges a warehouse-only patch without clearing other manual fields", () => {
  assert.deepEqual(
    mergeManualFields(
      {
        delivery_terms: "CIF",
        eta_date: "2026-07-25",
        storage_yard: "기존창고",
        free_time_days: 14,
        free_time_expiry_date: "2026-08-07",
        warehouse_expected_date: "2026-07-24",
      },
      { storage_yard: "새창고", warehouse_expected_date: "2026-07-26" }
    ),
    {
      delivery_terms: "CIF",
      eta_date: "2026-07-25",
      storage_yard: "새창고",
      free_time_days: 14,
      free_time_expiry_date: "2026-08-07",
      warehouse_expected_date: "2026-07-26",
    }
  );
});

test("merges fixed and additional recipients case-insensitively", () => {
  assert.deepEqual(
    mergeRecipients(["a@example.com", "b@example.com"], ["A@example.com", "c@example.com"]),
    ["a@example.com", "b@example.com", "c@example.com"]
  );
});

test("detects only effective warehouse value changes", () => {
  assert.deepEqual(
    warehouseChanges(
      { storage_yard: "부산신항", warehouse_expected_date: "2026-07-24" },
      { storage_yard: "부산신항", warehouse_expected_date: "2026-07-25" }
    ),
    ["warehouse_expected_date"]
  );
  assert.deepEqual(
    warehouseChanges(
      { storage_yard: "부산신항", warehouse_expected_date: "2026-07-24" },
      { storage_yard: "부산신항", warehouse_expected_date: "2026-07-24" }
    ),
    []
  );
});

test("builds transport rollback values with previous provenance", () => {
  assert.deepEqual(
    buildTransportRollbackPayload(
      {
        delivery_terms: "CIF",
        storage_yard: "Previous yard",
        warehouse_expected_date: "2026-07-24",
        transport_updated_by_role: "admin",
        transport_updated_by_login: "AIN",
        transport_updated_at: "2026-07-22T01:02:03.000Z",
      },
      {
        delivery_terms: "FOB",
        storage_yard: "Next yard",
        warehouse_expected_date: "2026-07-25",
        transport_updated_by_role: "shipper",
        transport_updated_by_login: "SHIPPER-1",
        transport_updated_at: "2026-07-23T04:05:06.000Z",
      }
    ),
    {
      delivery_terms: "CIF",
      storage_yard: "Previous yard",
      warehouse_expected_date: "2026-07-24",
      transport_updated_by_role: "admin",
      transport_updated_by_login: "AIN",
      transport_updated_at: "2026-07-22T01:02:03.000Z",
    }
  );
});

test("builds a warehouse change email with before and after values", () => {
  const mail = buildWarehouseChangeMail(
    {
      bl_number: "ONEYBNEG04197300",
      consignee: "현대코퍼레이션H",
      destination: "캐틀팜_우육_호주",
      obl_received: false,
      doc_iv_received: false,
    },
    { login_id: "HCH", display_name: "현대코퍼레이션H" },
    {
      eta_date: "2026-07-21",
      free_time_days: 3,
      storage_yard: "미정",
      warehouse_expected_date: "",
    },
    {
      eta_date: "2026-07-21",
      free_time_days: 3,
      storage_yard: "강동냉장",
      warehouse_expected_date: "2026-07-24",
    }
  );
  assert.match(mail.subject, /반입예정정보 변경/);
  assert.match(mail.text, /^반입예정정보가 변경되었습니다\./);
  assert.match(mail.text, /ONEYBNEG04197300/);
  assert.match(mail.text, /납품처: 캐틀팜/);
  assert.match(mail.text, /입항예정일: 2026-07-21/);
  assert.match(mail.text, /만기일: 2026-07-23/);
  assert.match(mail.text, /미정 -> 강동냉장/);
  assert.match(mail.text, /반입예정일: 2026-07-24\(예정\)/);
  assert.doesNotMatch(mail.text, /미입력 -> 2026-07-24/);
  assert.match(mail.text, /비고: OBL 원본 미수령, IV 미수취/);
  assert.match(mail.text, /관련하여 수정 및 문의사항이 있으신 경우 jsh@aincustoms\.com 로 메일 부탁드리겠습니다\.$/);
  assert.match(mail.html, /반입예정정보가 변경되었습니다\./);
  assert.match(mail.html, /반입예정구역: 미정 <strong>→ 강동냉장<\/strong>/);
});

test("shows unchanged warehouse values once and arrows only for changed values", () => {
  const yard = "강동냉장(주)보세창고 (02111182/A50101)";
  const mail = buildWarehouseChangeMail(
    { bl_number: "MEDUUL963797", consignee: "현대코퍼레이션H" },
    { login_id: "aincustoms", display_name: "AIN Customs 관리자" },
    {
      eta_date: "2026-08-07",
      free_time_days: 3,
      storage_yard: yard,
      warehouse_expected_date: "2026-08-07",
    },
    {
      eta_date: "2026-08-07",
      free_time_days: 3,
      storage_yard: yard,
      warehouse_expected_date: "2026-08-10",
    }
  );

  assert.match(mail.text, new RegExp(`반입예정구역: ${yard.replace(/[()]/g, "\\$&")}$`, "m"));
  assert.doesNotMatch(mail.text, /반입예정구역: .* -> /);
  assert.match(mail.text, /반입예정일: 2026-08-07 -> 2026-08-10/);
  assert.match(mail.html, new RegExp(`반입예정구역: ${yard.replace(/[()]/g, "\\$&")}<br>`));
  assert.doesNotMatch(mail.html, /<strong>→ .*A50101/);
  assert.match(mail.html, /반입예정일: 2026-08-07 <strong>→ 2026-08-10<\/strong>/);
});

test("excludes missing C/O from poultry notes while retaining other missing documents", () => {
  const mail = buildWarehouseChangeMail(
    {
      bl_number: "MEDUWE188588",
      consignee: "현대코퍼레이션H",
      destination: "다우린_계육_브라질",
      doc_co_received: false,
      doc_pl_received: false,
    },
    { login_id: "aincustoms", display_name: "AIN Customs 관리자" },
    { eta_date: "2026-08-08", free_time_days: 3 },
    {
      eta_date: "2026-08-08",
      free_time_days: 3,
      storage_yard: "삼진냉장",
      warehouse_expected_date: "2026-08-10",
    }
  );

  assert.match(mail.text, /비고: PL 미수취/);
  assert.doesNotMatch(mail.text, /C\/O 미수취/);
});
