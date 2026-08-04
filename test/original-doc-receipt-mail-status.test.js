const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const {
  koreaDate,
  markLinkedOriginalDocsReceived,
} = require("../lib/cargo-original-doc-receipt");

const root = path.resolve(__dirname, "..");
const receiptHandlerPath = path.join(root, "api", "cargo-original-doc-receipt-mail.js");

function loadReceiptHandler({ supabaseFetch, sendMail }) {
  const originalLoad = Module._load;
  delete require.cache[receiptHandlerPath];
  Module._load = function mockedLoad(request, parent, isMain) {
    if (parent?.filename === receiptHandlerPath && request === "../lib/cargo-auth") {
      return {
        verifySession: () => ({
          account_id: "admin-account",
          login_id: "aincustoms",
          role: "admin",
        }),
        supabaseFetch,
      };
    }
    if (parent?.filename === receiptHandlerPath && request === "nodemailer") {
      return {
        createTransport: () => ({ sendMail }),
      };
    }
    if (parent?.filename === receiptHandlerPath && request === "../lib/cargo-mail-settings") {
      return {
        defaultMailSettings: () => ({
          original_doc_receipt: {
            to: ["to@example.com"],
            cc: ["cc@example.com"],
          },
          obl_carrier_receipt: {
            to: ["to@example.com"],
            cc: ["cc@example.com"],
          },
        }),
        fetchMailSetting: async () => null,
        resolveMailRecipients: () => ({
          to: ["to@example.com"],
          cc: ["cc@example.com"],
        }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(receiptHandlerPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[receiptHandlerPath];
  }
}

function responseFixture() {
  return {
    statusCode: null,
    body: null,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function withMailEnvironment(action) {
  const names = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_USER = "sender@example.com";
  process.env.SMTP_PASS = "secret";
  try {
    return await action();
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test("Korea receipt date follows Asia/Seoul calendar day", () => {
  assert.equal(koreaDate(new Date("2026-07-27T15:30:00.000Z")), "2026-07-28");
});

test("receipt mail status propagates OBL and H/C receipt to every linked account", async () => {
  const writes = [];
  const sourceCard = {
    account_id: "admin-account",
    bl_number: "ONEYBNEG04197300",
    folder_name: "현대코퍼레이션H_ONEYBNEG04197300_CIF_캐틀팜_우육_호주",
  };
  const supabaseFetch = async (url, options = {}) => {
    if (url.includes("cargo_cards?select=account_id,bl_number,folder_name")) {
      return [
        sourceCard,
        { ...sourceCard, account_id: "hch-account" },
        { ...sourceCard, account_id: "ctf-account" },
        { ...sourceCard, account_id: "ctf-account" },
      ];
    }
    if (url.includes("cargo_original_docs?on_conflict=")) {
      const payload = JSON.parse(options.body);
      writes.push(payload);
      return [payload];
    }
    throw new Error(`Unexpected Supabase call: ${url}`);
  };

  const result = await markLinkedOriginalDocsReceived({
    supabaseFetch,
    card: sourceCard,
    receivedDate: "2026-07-28",
    updatedBy: "aincustoms",
  });

  assert.deepEqual(result.accountIds, [
    "admin-account",
    "ctf-account",
    "hch-account",
  ]);
  assert.equal(result.receivedDate, "2026-07-28");
  assert.equal(writes.length, 3);
  for (const payload of writes) {
    assert.equal(payload.bl_number, "ONEYBNEG04197300");
    assert.equal(payload.obl_received, true);
    assert.equal(payload.hc_received, true);
    assert.equal(payload.actual_received_date, "2026-07-28");
    assert.equal(payload.updated_by, "aincustoms");
  }
});

test("successful H/C receipt mail marks linked OBL and H/C received on the mail date", { concurrency: false }, async () => {
  const writes = [];
  let mailCount = 0;
  let sentMail = null;
  const card = {
    account_id: "admin-account",
    bl_number: "ONEYBNEG04197300",
    folder_name: "현대코퍼레이션H_ONEYBNEG04197300_CIF_캐틀팜_우육_호주",
    consignee: "현대코퍼레이션H",
    destination: "캐틀팜*우육*호주",
  };
  const handler = loadReceiptHandler({
    sendMail: async (mail) => {
      mailCount += 1;
      sentMail = mail;
    },
    supabaseFetch: async (url, options = {}) => {
      if (url.includes("cargo_cards?select=*&")) return [card];
      if (url.includes("cargo_cards?select=account_id,bl_number,folder_name")) {
        return [card, { ...card, account_id: "ctf-account" }];
      }
      if (url.includes("cargo_original_docs?on_conflict=")) {
        const payload = JSON.parse(options.body);
        writes.push(payload);
        return [payload];
      }
      throw new Error(`Unexpected Supabase call: ${url}`);
    },
  });
  const response = responseFixture();

  await withMailEnvironment(() => handler({
    method: "POST",
    body: {
      action: "hc_receipt",
      account_id: "admin-account",
      bl_number: "ONEYBNEG04197300",
      total_pages: "4",
    },
  }, response));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.email_sent, true);
  assert.equal(response.body.receipt_saved, true);
  assert.match(response.body.received_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(mailCount, 1);
  assert.match(sentMail.text, /반출처: 캐틀팜(?:\r?\n|$)/);
  assert.doesNotMatch(sentMail.text, /캐틀팜\*우육\*호주/);
  assert.equal(writes.length, 2);
  writes.forEach((payload) => {
    assert.equal(payload.obl_received, true);
    assert.equal(payload.hc_received, true);
    assert.equal(payload.actual_received_date, response.body.received_date);
  });
});

test("receipt mail names every selected original document", { concurrency: false }, async () => {
  let sentMail = null;
  const card = {
    account_id: "admin-account",
    bl_number: "MEDUUL962799",
    folder_name: "현대코퍼레이션H_MEDUUL962799_CIF_캐틀팜_우육_호주",
    consignee: "현대코퍼레이션H",
    destination: "캐틀팜*우육*호주",
  };
  const handler = loadReceiptHandler({
    sendMail: async (mail) => { sentMail = mail; },
    supabaseFetch: async (url, options = {}) => {
      if (url.includes("cargo_cards?select=*&")) return [card];
      if (url.includes("cargo_cards?select=account_id,bl_number,folder_name")) return [card];
      if (url.includes("cargo_original_docs?on_conflict=")) {
        return [JSON.parse(options.body)];
      }
      throw new Error(`Unexpected Supabase call: ${url}`);
    },
  });
  const response = responseFixture();

  await withMailEnvironment(() => handler({
    method: "POST",
    body: {
      action: "hc_receipt",
      account_id: "admin-account",
      bl_number: "MEDUUL962799",
      total_pages: "11",
      received_documents: ["obl", "hc", "transfer"],
    },
  }, response));

  assert.equal(response.statusCode, 200);
  assert.match(sentMail.subject, /OBL·H\/C·양도증 원본서류 수령 확인/);
  assert.match(sentMail.text, /OBL, H\/C\(위생증, 검역증\), 양도증 원본 서류를 수령하였습니다/);
  assert.match(sentMail.text, /수령한 원본 서류 전체 페이지: 11 page/);
});

test("failed H/C receipt mail never changes original document status", { concurrency: false }, async () => {
  let statusWriteCount = 0;
  const handler = loadReceiptHandler({
    sendMail: async () => { throw new Error("SMTP unavailable"); },
    supabaseFetch: async (url) => {
      if (url.includes("cargo_cards?select=*&")) {
        return [{
          account_id: "admin-account",
          bl_number: "BL-FAIL",
          folder_name: "folder",
        }];
      }
      statusWriteCount += 1;
      return [];
    },
  });
  const response = responseFixture();

  await withMailEnvironment(() => handler({
    method: "POST",
    body: {
      action: "hc_receipt",
      account_id: "admin-account",
      bl_number: "BL-FAIL",
      total_pages: "2",
    },
  }, response));

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.success, false);
  assert.equal(statusWriteCount, 0);
});

test("status failure after H/C mail reports partial success without inviting resend", { concurrency: false }, async () => {
  let mailCount = 0;
  const handler = loadReceiptHandler({
    sendMail: async () => { mailCount += 1; },
    supabaseFetch: async (url) => {
      if (url.includes("cargo_cards?select=*&")) {
        return [{
          account_id: "admin-account",
          bl_number: "BL-PARTIAL",
          folder_name: "folder",
        }];
      }
      if (url.includes("cargo_cards?select=account_id,bl_number,folder_name")) {
        throw new Error("Supabase write unavailable");
      }
      throw new Error(`Unexpected Supabase call: ${url}`);
    },
  });
  const response = responseFixture();

  await withMailEnvironment(() => handler({
    method: "POST",
    body: {
      action: "hc_receipt",
      account_id: "admin-account",
      bl_number: "BL-PARTIAL",
      total_pages: "2",
    },
  }, response));

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.success, false);
  assert.equal(response.body.email_sent, true);
  assert.equal(response.body.receipt_saved, false);
  assert.match(response.body.message, /메일을 다시 보내지 말고/);
  assert.equal(mailCount, 1);
});

test("OBL carrier mail does not mark OBL or H/C received", { concurrency: false }, async () => {
  let statusWriteCount = 0;
  const handler = loadReceiptHandler({
    sendMail: async () => {},
    supabaseFetch: async (url) => {
      if (url.includes("cargo_cards?select=*&")) {
        return [{
          account_id: "admin-account",
          bl_number: "BL-CARRIER",
          folder_name: "folder",
        }];
      }
      statusWriteCount += 1;
      return [];
    },
  });
  const response = responseFixture();

  await withMailEnvironment(() => handler({
    method: "POST",
    body: {
      action: "obl_carrier_submission",
      account_id: "admin-account",
      bl_number: "BL-CARRIER",
      obl_carrier_submitted_date: "2026-07-28",
    },
  }, response));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.email_sent, true);
  assert.notEqual(response.body.receipt_saved, true);
  assert.equal(statusWriteCount, 0);
});
