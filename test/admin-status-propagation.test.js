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

test("sticker status propagates only to linked account rows", { concurrency: false }, async () => {
  let savedPayload = null;
  const handler = loadHandler(async (url, options = {}) => {
    if (url.includes("cargo_cards?select=*&")) {
      return [{
        account_id: "hch-account",
        bl_number: "ONEYBNEG02916700",
        folder_name: "현대코퍼레이션H_ONEYBNEG02916700_CIF_캐틀팜_우육_호주",
      }];
    }
    if (url.includes("cargo_cards?select=account_id,bl_number,folder_name")) {
      return [
        {
          account_id: "hch-account",
          bl_number: "ONEYBNEG02916700",
          folder_name: "현대코퍼레이션H_ONEYBNEG02916700_CIF_캐틀팜_우육_호주",
        },
        {
          account_id: "ctf-account",
          bl_number: "ONEYBNEG02916700",
          folder_name: "현대코퍼레이션H_ONEYBNEG02916700_CIF_캐틀팜_우육_호주",
        },
        {
          account_id: "other-account",
          bl_number: "ONEYBNEG02916700",
          folder_name: "다른화주_ONEYBNEG02916700_CIF_다른납품처_우육_호주",
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
      action: "admin_status",
      account_id: "hch-account",
      bl_number: "ONEYBNEG02916700",
      sticker_requested: true,
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.deepEqual(
    savedPayload.map((item) => item.account_id).sort(),
    ["ctf-account", "hch-account"]
  );
  savedPayload.forEach((item) => {
    assert.equal(item.bl_number, "ONEYBNEG02916700");
    assert.equal(item.sticker_requested, true);
  });
});
