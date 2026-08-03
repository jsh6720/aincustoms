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

test("document delivery retries without date columns when the migration is missing", { concurrency: false }, async () => {
  const savedPayloads = [];
  const handler = loadHandler(async (url, options = {}) => {
    if (url.includes("cargo_cards?select=*&")) {
      return [{
        account_id: "hch-account",
        bl_number: "ONEYBNEG04197300",
        folder_name: "HCH_ONEYBNEG04197300_CIF_CTF",
      }];
    }
    if (url.includes("cargo_cards?select=account_id,bl_number,folder_name")) {
      return [{
        account_id: "hch-account",
        bl_number: "ONEYBNEG04197300",
        folder_name: "HCH_ONEYBNEG04197300_CIF_CTF",
      }];
    }
    if (url.includes("cargo_card_user_inputs?select=*&account_id=")) {
      return [];
    }
    if (url.includes("cargo_card_user_inputs?on_conflict=")) {
      const payload = JSON.parse(options.body);
      savedPayloads.push(payload);
      if (savedPayloads.length === 1) {
        throw new Error(
          'Could not find the "docs_delivered_samhyeon_date" column of "cargo_card_user_inputs"'
        );
      }
      return payload;
    }
    throw new Error(`Unexpected Supabase call: ${url}`);
  });
  const response = responseFixture();

  await handler({
    method: "POST",
    body: {
      action: "admin_status",
      account_id: "hch-account",
      bl_number: "ONEYBNEG04197300",
      docs_delivered_samhyeon: true,
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.delivery_dates_saved, false);
  assert.equal(savedPayloads.length, 2);
  assert.equal(savedPayloads[0][0].docs_delivered_samhyeon, true);
  assert.match(savedPayloads[0][0].docs_delivered_samhyeon_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(savedPayloads[0][0].docs_delivered_samhyeon_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(savedPayloads[1][0].docs_delivered_samhyeon, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(savedPayloads[1][0], "docs_delivered_samhyeon_date"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(savedPayloads[1][0], "docs_delivered_samhyeon_at"),
    false
  );
});

test("document delivery retries without timestamp columns while retaining dates", { concurrency: false }, async () => {
  const savedPayloads = [];
  const handler = loadHandler(async (url, options = {}) => {
    if (url.includes("cargo_cards?select=*&")) {
      return [{
        account_id: "hch-account",
        bl_number: "BL-TS",
        folder_name: "HCH_BL-TS_CIF_CTF",
      }];
    }
    if (url.includes("cargo_cards?select=account_id,bl_number,folder_name")) {
      return [{
        account_id: "hch-account",
        bl_number: "BL-TS",
        folder_name: "HCH_BL-TS_CIF_CTF",
      }];
    }
    if (url.includes("cargo_card_user_inputs?select=*&account_id=")) return [];
    if (url.includes("cargo_card_user_inputs?on_conflict=")) {
      const payload = JSON.parse(options.body);
      savedPayloads.push(payload);
      if (savedPayloads.length === 1) {
        throw new Error(
          'Could not find the "docs_delivered_samhyeon_at" column of "cargo_card_user_inputs"'
        );
      }
      return payload;
    }
    throw new Error(`Unexpected Supabase call: ${url}`);
  });
  const response = responseFixture();

  await handler({
    method: "POST",
    body: {
      action: "admin_status",
      account_id: "hch-account",
      bl_number: "BL-TS",
      docs_delivered_samhyeon: true,
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.delivery_dates_saved, true);
  assert.equal(response.body.delivery_timestamps_saved, false);
  assert.match(savedPayloads[1][0].docs_delivered_samhyeon_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal("docs_delivered_samhyeon_at" in savedPayloads[1][0], false);
});

test("document delivery preserves the first O timestamp and clears it with X", { concurrency: false }, async () => {
  const existingAt = "2026-08-03T05:25:30.000Z";
  const savedPayloads = [];
  let currentInput = {
    docs_delivered_samhyeon: true,
    docs_delivered_samhyeon_date: "2026-08-03",
    docs_delivered_samhyeon_at: existingAt,
  };
  const handler = loadHandler(async (url, options = {}) => {
    if (url.includes("cargo_cards?select=*&")) {
      return [{ account_id: "hch-account", bl_number: "BL-KEEP", folder_name: "HCH_BL-KEEP" }];
    }
    if (url.includes("cargo_cards?select=account_id,bl_number,folder_name")) {
      return [{ account_id: "hch-account", bl_number: "BL-KEEP", folder_name: "HCH_BL-KEEP" }];
    }
    if (url.includes("cargo_card_user_inputs?select=*&account_id=")) return [currentInput];
    if (url.includes("cargo_card_user_inputs?on_conflict=")) {
      const payload = JSON.parse(options.body);
      savedPayloads.push(payload);
      return payload;
    }
    throw new Error(`Unexpected Supabase call: ${url}`);
  });

  const enabledResponse = responseFixture();
  await handler({
    method: "POST",
    body: {
      action: "admin_status",
      account_id: "hch-account",
      bl_number: "BL-KEEP",
      docs_delivered_samhyeon: true,
    },
  }, enabledResponse);
  assert.equal(savedPayloads[0][0].docs_delivered_samhyeon_at, existingAt);
  assert.equal(savedPayloads[0][0].docs_delivered_samhyeon_date, "2026-08-03");

  currentInput = { ...currentInput, docs_delivered_samhyeon: true };
  const disabledResponse = responseFixture();
  await handler({
    method: "POST",
    body: {
      action: "admin_status",
      account_id: "hch-account",
      bl_number: "BL-KEEP",
      docs_delivered_samhyeon: false,
    },
  }, disabledResponse);
  assert.equal(savedPayloads[1][0].docs_delivered_samhyeon_at, null);
  assert.equal(savedPayloads[1][0].docs_delivered_samhyeon_date, null);
});
