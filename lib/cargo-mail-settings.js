const { mergeRecipients, parseRecipientList } = require("./cargo-mail-utils");

const MAIL_SETTING_KEYS = Object.freeze([
  "original_doc_request",
  "import_request",
  "release_request",
  "warehouse_change",
  "arrival_schedule_change",
  "original_doc_receipt",
  "obl_carrier_receipt",
]);

const OPERATIONS_MAIL_TO = Object.freeze([
  "jsh@aincustoms.com",
  "jhcho@aincustoms.com",
  "bill@aincustoms.com",
  "ain@aincustoms.com",
]);

const ORIGINAL_DOC_RECEIPT_TO = Object.freeze([
  "dmswk@hyundaicorp.com",
  "ye25@hyundaicorp.com",
]);

const ORIGINAL_DOC_RECEIPT_CC = Object.freeze([
  "jsh@aincustoms.com",
  "jhcho@aincustoms.com",
  "bill@aincustoms.com",
]);

function safeRecipientList(value) {
  if (Array.isArray(value)) {
    return mergeRecipients([], value.map((item) => String(item || "").trim()));
  }
  const text = String(value || "").trim();
  return text ? parseRecipientList(text) : [];
}

function normalizeMailSettings(rows) {
  const result = {};
  for (const row of rows || []) {
    const key = String(row?.setting_key || "").trim();
    if (!MAIL_SETTING_KEYS.includes(key)) continue;
    result[key] = {
      to: safeRecipientList(row?.to_recipients),
      cc: safeRecipientList(row?.cc_recipients),
    };
  }
  return result;
}

function defaultMailSettings(env = process.env) {
  const requestFallback = safeRecipientList([
    env?.RELEASE_REQUEST_TO,
    env?.NOTIFY_TO,
    env?.SMTP_USER,
  ].filter(Boolean).join(","));
  const receiptTo = [...ORIGINAL_DOC_RECEIPT_TO];
  const receiptCc = [...ORIGINAL_DOC_RECEIPT_CC];
  return {
    original_doc_request: { to: requestFallback, cc: [] },
    import_request: { to: requestFallback, cc: [] },
    release_request: { to: requestFallback, cc: [] },
    warehouse_change: { to: [...OPERATIONS_MAIL_TO], cc: [] },
    arrival_schedule_change: { to: [], cc: [] },
    original_doc_receipt: { to: receiptTo, cc: receiptCc },
    obl_carrier_receipt: { to: [...receiptTo], cc: [...receiptCc] },
  };
}

function effectiveMailSettings(rows, env = process.env) {
  const configured = normalizeMailSettings(rows);
  const defaults = defaultMailSettings(env);
  const result = {};
  for (const key of MAIL_SETTING_KEYS) {
    const setting = configured[key] || { to: [], cc: [] };
    result[key] = {
      to: setting.to.length ? setting.to : defaults[key].to,
      cc: setting.cc.length ? setting.cc : defaults[key].cc,
    };
  }
  return result;
}

function resolveMailRecipients({
  accountOverride,
  setting,
  fallbackTo,
  fallbackCc,
  extraTo,
  extraCc,
} = {}) {
  const override = safeRecipientList(accountOverride);
  const configuredTo = safeRecipientList(setting?.to_recipients || setting?.to);
  const configuredCc = safeRecipientList(setting?.cc_recipients || setting?.cc);
  const baseTo = override.length
    ? override
    : (configuredTo.length ? configuredTo : safeRecipientList(fallbackTo));
  const baseCc = configuredCc.length ? configuredCc : safeRecipientList(fallbackCc);
  const to = mergeRecipients(baseTo, safeRecipientList(extraTo));
  const toKeys = new Set(to.map((email) => email.toLowerCase()));
  const cc = mergeRecipients(baseCc, safeRecipientList(extraCc))
    .filter((email) => !toKeys.has(email.toLowerCase()));
  return { to, cc };
}

async function fetchMailSetting(supabaseFetch, settingKey) {
  if (!MAIL_SETTING_KEYS.includes(settingKey)) {
    throw new Error(`Unsupported mail setting: ${settingKey}`);
  }
  try {
    const key = encodeURIComponent(settingKey);
    const rows = await supabaseFetch(
      `/rest/v1/cargo_mail_settings?select=setting_key,to_recipients,cc_recipients&setting_key=eq.${key}&limit=1`
    );
    return rows && rows[0] ? rows[0] : null;
  } catch {
    return null;
  }
}

module.exports = {
  MAIL_SETTING_KEYS,
  defaultMailSettings,
  effectiveMailSettings,
  fetchMailSetting,
  normalizeMailSettings,
  resolveMailRecipients,
};
