"use strict";

const crypto = require("node:crypto");
const { handleReadRequest } = require("./requirements-read");

// Dispatched by api/cargo-admin.js (?workspace=requirements) to keep the function budget.
// Env: REQUIREMENTS_SHEETS_KEY (read-only service account JSON),
//      REQUIREMENTS_SPREADSHEET_ID, REQUIREMENTS_TOKEN_SECRET (= Apps Script TOKEN_SIGNING_SECRET).

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
let cachedAccess = null;
let cachedTimeZone = null;

async function accessToken(key, fetchImpl) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccess && cachedAccess.exp - 60 > now) return cachedAccess.token;
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = encode({ alg: "RS256", typ: "JWT" }) + "." +
    encode({ iss: key.client_email, scope: SHEETS_SCOPE, aud: key.token_uri, iat: now, exp: now + 3600 });
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), key.private_key).toString("base64url");
  const response = await fetchImpl(key.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error("Google token request failed");
  cachedAccess = { token: body.access_token, exp: now + Number(body.expires_in || 3600) };
  return cachedAccess.token;
}

function createSheetReader({ key, spreadsheetId, fetchImpl = fetch }) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  const getJson = async (url, token) => {
    const response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Sheets API ${response.status}`);
    return response.json();
  };
  return async function readSheets(sheetNames) {
    const token = await accessToken(key, fetchImpl);
    const ranges = sheetNames.map(name => `ranges=${encodeURIComponent(`'${name}'`)}`).join("&");
    const batch = mode => getJson(`${base}/values:batchGet?${ranges}&majorDimension=ROWS` +
      `&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=${mode}`, token);
    const [serial, formatted, timeZone] = await Promise.all([
      batch("SERIAL_NUMBER"),
      batch("FORMATTED_STRING"),
      cachedTimeZone || getJson(`${base}?fields=properties.timeZone`, token).then(meta => meta.properties.timeZone),
    ]);
    cachedTimeZone = timeZone;
    const sheets = {};
    sheetNames.forEach((name, index) => {
      sheets[name] = {
        serial: serial.valueRanges?.[index]?.values || [],
        formatted: formatted.valueRanges?.[index]?.values || [],
      };
    });
    return { timeZone, sheets };
  };
}

function readConfig(env) {
  if (!env.REQUIREMENTS_SHEETS_KEY || !env.REQUIREMENTS_SPREADSHEET_ID || !env.REQUIREMENTS_TOKEN_SECRET) return null;
  return {
    key: JSON.parse(env.REQUIREMENTS_SHEETS_KEY),
    spreadsheetId: env.REQUIREMENTS_SPREADSHEET_ID,
    secret: env.REQUIREMENTS_TOKEN_SECRET,
  };
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  return null;
}

function createRequirementsReadHandler({ env = process.env, fetchImpl = fetch } = {}) {
  let reader = null;
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return res.status(405).json({ success: false, error_code: "METHOD_NOT_ALLOWED" });
    let config;
    try {
      config = readConfig(env);
    } catch (error) {
      config = null;
    }
    // The client falls back to Apps Script on any 5xx, so a missing setup degrades safely.
    if (!config) return res.status(503).json({ success: false, error_code: "NOT_CONFIGURED" });
    let request;
    try {
      request = parseBody(req);
    } catch (error) {
      request = null;
    }
    if (!request) return res.status(400).json({ success: false, error_code: "INVALID_REQUEST" });
    try {
      reader = reader || createSheetReader({ key: config.key, spreadsheetId: config.spreadsheetId, fetchImpl });
      const result = await handleReadRequest(request, { secret: config.secret, readSheets: reader });
      return res.status(200).json(result);
    } catch (error) {
      console.error("requirements read failed:", error && error.message ? error.message : "unknown");
      return res.status(502).json({ success: false, error_code: "UPSTREAM_ERROR" });
    }
  };
}

module.exports = createRequirementsReadHandler();
module.exports.createRequirementsReadHandler = createRequirementsReadHandler;
module.exports.createSheetReader = createSheetReader;
