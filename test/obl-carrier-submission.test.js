const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const handlerPath = path.join(root, "api", "cargo-quota.js");

function loadHandler(supabaseFetch) {
  const originalLoad = Module._load;
  delete require.cache[handlerPath];
  Module._load = function mockedLoad(request, parent, isMain) {
    if (parent?.filename === handlerPath && request === "../lib/cargo-auth") {
      return {
        requireWritableSession: () => ({
          account_id: "admin-account",
          login_id: "aincustoms",
          role: "admin",
        }),
        supabaseFetch,
      };
    }
    if (parent?.filename === handlerPath && request === "nodemailer") {
      return {
        createTransport: () => ({ sendMail: async () => {} }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(handlerPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[handlerPath];
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

test("OBL carrier submission propagates to every linked account row", { concurrency: false }, async () => {
  let savedPayload = null;
  const handler = loadHandler(async (url, options = {}) => {
    if (url.includes("cargo_cards?select=*&")) {
      return [{
        account_id: "hch-account",
        bl_number: "ONEYBNEG04197300",
        folder_name: "현대코퍼레이션H_ONEYBNEG04197300_CIF_캐틀팜_우육_호주",
      }];
    }
    if (url.includes("cargo_cards?select=account_id,bl_number,folder_name")) {
      return [
        {
          account_id: "hch-account",
          bl_number: "ONEYBNEG04197300",
          folder_name: "현대코퍼레이션H_ONEYBNEG04197300_CIF_캐틀팜_우육_호주",
        },
        {
          account_id: "ctf-account",
          bl_number: "ONEYBNEG04197300",
          folder_name: "현대코퍼레이션H_ONEYBNEG04197300_CIF_캐틀팜_우육_호주",
        },
      ];
    }
    if (url.includes("cargo_card_user_inputs?on_conflict=")) {
      savedPayload = JSON.parse(options.body);
      return savedPayload;
    }
    throw new Error(`Unexpected Supabase call: ${url}`);
  });
  const response = responseFixture();

  await handler({
    method: "POST",
    body: {
      action: "obl_carrier_submission",
      account_id: "hch-account",
      bl_number: "ONEYBNEG04197300",
      obl_carrier_submitted: true,
      obl_carrier_submitted_date: "2026-07-22",
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(savedPayload.length, 2);
  assert.deepEqual(
    savedPayload.map((item) => item.account_id).sort(),
    ["ctf-account", "hch-account"]
  );
  savedPayload.forEach((item) => {
    assert.equal(item.bl_number, "ONEYBNEG04197300");
    assert.equal(item.obl_carrier_submitted, true);
    assert.equal(item.obl_carrier_submitted_date, "2026-07-22");
    assert.equal(item.obl_carrier_submitted_by, "aincustoms");
    assert.match(item.obl_carrier_submitted_at, /^\d{4}-\d{2}-\d{2}T/);
  });
});
