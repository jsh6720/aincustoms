const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const handlerPath = path.join(root, "api", "cargo-data.js");

function createResponse() {
  return {
    body: null,
    statusCode: null,
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

function loadHandler(cargoAuth) {
  const originalLoad = Module._load;
  delete require.cache[handlerPath];
  Module._load = function mockedLoad(request, parent, isMain) {
    if (parent?.filename === handlerPath && request === "../lib/cargo-auth") {
      return cargoAuth;
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

test("Samhyeon reads linked document delivery O without copying unrelated account inputs", async () => {
  const folderName = "HCH_BL-1_CIF_DEST";
  const samhyeonCard = {
    account_id: "samhyeon-account",
    bl_number: "BL-1",
    folder_name: folderName,
    stage: "입항전",
    synced_at: "2026-08-03T01:00:00Z",
  };
  const cardRefs = [
    samhyeonCard,
    {
      account_id: "hch-account",
      bl_number: "BL-1",
      folder_name: folderName,
    },
  ];
  const requestedUrls = [];
  const handler = loadHandler({
    canReadAllCargo: () => false,
    verifySession: () => ({
      account_id: "samhyeon-account",
      login_id: "shyun",
      display_name: "삼현",
      role: "shipper",
      account_category: "samhyeon",
    }),
    supabaseFetch: async (url) => {
      requestedUrls.push(url);
      if (url.startsWith("/rest/v1/shipper_accounts?select=calendar_preferences")) {
        return [{ calendar_preferences: null }];
      }
      if (url.startsWith("/rest/v1/cargo_cards?select=*&account_id=")) {
        return [samhyeonCard];
      }
      if (url.startsWith("/rest/v1/cargo_cards?select=account_id,bl_number,folder_name")) {
        return cardRefs;
      }
      if (url.startsWith("/rest/v1/cargo_card_user_inputs?")) {
        if (url.includes("account_id=eq.")) return [];
        return [
          {
            account_id: "hch-account",
            bl_number: "BL-1",
            docs_delivered_samhyeon: true,
            docs_delivered_warehouse: true,
            eta_date: "2099-01-01",
            updated_at: "2026-07-28T01:00:00Z",
          },
          {
            account_id: null,
            bl_number: "BL-1",
            docs_delivered_samhyeon: false,
            docs_delivered_warehouse: false,
            eta_date: "2098-12-31",
            updated_at: "2026-07-27T01:00:00Z",
          },
        ];
      }
      return [];
    },
  });
  const response = createResponse();

  await handler({ method: "GET", headers: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.cards[0].docs_delivered_samhyeon, true);
  assert.equal(response.body.cards[0].docs_delivered_warehouse, true);
  assert.notEqual(response.body.cards[0].eta_date, "2099-01-01");
  assert.notEqual(response.body.cards[0].eta_date, "2098-12-31");
  const inputUrl = requestedUrls.find((url) => url.startsWith("/rest/v1/cargo_card_user_inputs?"));
  assert.ok(inputUrl);
  assert.doesNotMatch(inputUrl, /account_id=eq\./);
});
