const { mergeRecipients, parseRecipientList } = require("./cargo-mail-utils");

const MAIL_SETTING_KEYS = Object.freeze([
  "ain_default",
  "shipper_default",
  "destination_default",
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
    ain_default: { to: [...OPERATIONS_MAIL_TO], cc: [] },
    shipper_default: { to: [...ORIGINAL_DOC_RECEIPT_TO], cc: [] },
    destination_default: { to: [], cc: [] },
    original_doc_request: { to: requestFallback, cc: [] },
    import_request: { to: requestFallback, cc: [] },
    release_request: { to: requestFallback, cc: [] },
    warehouse_change: { to: [...OPERATIONS_MAIL_TO], cc: [] },
    arrival_schedule_change: { to: [], cc: [] },
    original_doc_receipt: { to: receiptTo, cc: receiptCc },
    obl_carrier_receipt: { to: [...receiptTo], cc: [...receiptCc] },
  };
}

function roleRecipients(settings, key) {
  const setting = settings?.[key] || {};
  return mergeRecipients(
    safeRecipientList(setting.to_recipients || setting.to),
    safeRecipientList(setting.cc_recipients || setting.cc)
  );
}

function normalizePartyName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_()*·,./\\-]+/g, "");
}

function accountAliases(account) {
  return [account?.display_name, account?.consignee_filter]
    .flatMap((value) => String(value || "").split(/[,;\n\r]+/))
    .map(normalizePartyName)
    .filter(Boolean);
}

function accountMatchesParty(account, partyName) {
  const target = normalizePartyName(partyName);
  if (!target) return false;
  return accountAliases(account).some((alias) =>
    alias === target || alias.includes(target) || target.includes(alias)
  );
}

function accountRecipients(account) {
  try {
    return safeRecipientList(account?.release_request_to);
  } catch {
    return [];
  }
}

function resolveAccountDirectoryNoticeRecipients({ accounts, card, ainRecipients } = {}) {
  const destination = String(card?.destination || "").split(/[_*]/)[0].trim();
  const shipperAccounts = (accounts || []).filter((account) =>
    String(account?.account_category || "shipper").toLowerCase() === "shipper"
      && accountMatchesParty(account, card?.consignee)
  );
  const destinationAccounts = (accounts || []).filter((account) =>
    String(account?.account_category || "shipper").toLowerCase() === "destination"
      && accountMatchesParty(account, destination)
  );
  const to = mergeRecipients(
    shipperAccounts.flatMap(accountRecipients),
    destinationAccounts.flatMap(accountRecipients)
  );
  const toKeys = new Set(to.map((email) => email.toLowerCase()));
  const cc = safeRecipientList(ainRecipients)
    .filter((email) => !toKeys.has(email.toLowerCase()));
  return { to, cc };
}

function resolveRoleMailRecipients({
  settings,
  direction = "request",
  extraTo,
  extraCc,
} = {}) {
  const ain = roleRecipients(settings, "ain_default");
  const shipper = roleRecipients(settings, "shipper_default");
  const destination = roleRecipients(settings, "destination_default");
  const notice = direction === "notice";
  const to = mergeRecipients(
    notice ? mergeRecipients(shipper, destination) : ain,
    safeRecipientList(extraTo)
  );
  const toKeys = new Set(to.map((email) => email.toLowerCase()));
  const cc = mergeRecipients(
    notice ? ain : mergeRecipients(shipper, destination),
    safeRecipientList(extraCc)
  ).filter((email) => !toKeys.has(email.toLowerCase()));
  return { to, cc };
}

async function fetchEffectiveRoleMailSettings(supabaseFetch, featureKey, direction, env = process.env) {
  const keys = ["ain_default", "shipper_default", "destination_default", featureKey];
  const rows = (await Promise.all(keys.map((key) => fetchMailSetting(supabaseFetch, key))))
    .filter(Boolean);
  const configured = normalizeMailSettings(rows);
  const defaults = defaultMailSettings(env);
  const feature = configured[featureKey] || defaults[featureKey] || { to: [], cc: [] };
  const roleSettings = {
    ain_default: configured.ain_default,
    shipper_default: configured.shipper_default,
    destination_default: configured.destination_default,
  };

  if (!roleSettings.ain_default) {
    roleSettings.ain_default = direction === "notice"
      ? { to: feature.cc.length ? feature.cc : defaults.ain_default.to, cc: [] }
      : { to: feature.to.length ? feature.to : defaults.ain_default.to, cc: [] };
  }
  if (!roleSettings.shipper_default) {
    roleSettings.shipper_default = direction === "notice" && feature.to.length
      ? { to: feature.to, cc: [] }
      : defaults.shipper_default;
  }
  if (!roleSettings.destination_default) {
    roleSettings.destination_default = defaults.destination_default;
  }
  return roleSettings;
}

async function fetchMailDirectoryAccounts(supabaseFetch) {
  return await supabaseFetch(
    "/rest/v1/shipper_accounts?select=id,login_id,display_name,consignee_filter,release_request_to,account_category,is_active&is_active=eq.true"
  );
}

async function resolveDirectoryNoticeRecipients({
  supabaseFetch,
  settings,
  card,
} = {}) {
  const fallback = resolveRoleMailRecipients({ settings, direction: "notice" });
  try {
    const accounts = await fetchMailDirectoryAccounts(supabaseFetch);
    const matched = resolveAccountDirectoryNoticeRecipients({
      accounts,
      card,
      ainRecipients: roleRecipients(settings, "ain_default"),
    });
    return matched.to.length ? matched : fallback;
  } catch {
    return fallback;
  }
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
  fetchMailDirectoryAccounts,
  fetchEffectiveRoleMailSettings,
  fetchMailSetting,
  normalizeMailSettings,
  resolveAccountDirectoryNoticeRecipients,
  resolveDirectoryNoticeRecipients,
  resolveMailRecipients,
  resolveRoleMailRecipients,
};
