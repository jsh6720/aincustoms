const nodemailer = require("nodemailer");
const { requireWritableSession, supabaseFetch } = require("../lib/cargo-auth");
const {
  buildTransportRollbackPayload,
  buildWarehouseChangeMail,
  mergeManualFields,
  warehouseChanges,
} = require("../lib/cargo-mail-utils");
const { normalizeInspectionStatus } = require("../lib/cargo-progress-utils");

const WAREHOUSE_CHANGE_TO = [
  "jsh@aincustoms.com",
  "jhcho@aincustoms.com",
  "bill@aincustoms.com",
  "ain@aincustoms.com",
];

function isValidDate(value) {
  if (!value) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function findOwnedCard(accountId, blNumber) {
  const account = encodeURIComponent(accountId);
  const bl = encodeURIComponent(blNumber);
  const owned = await supabaseFetch(
    `/rest/v1/cargo_cards?select=*&account_id=eq.${account}&bl_number=eq.${bl}&limit=1`
  );
  return owned && owned[0] ? owned[0] : null;
}

async function findManualInput(accountId, blNumber) {
  const account = encodeURIComponent(accountId);
  const bl = encodeURIComponent(blNumber);
  const rows = await supabaseFetch(
    `/rest/v1/cargo_card_user_inputs?select=*&account_id=eq.${account}&bl_number=eq.${bl}&limit=1`
  );
  return rows && rows[0] ? rows[0] : {};
}

async function linkedDocumentDeliveryTargets(card) {
  const accountId = String(card?.account_id || "").trim();
  const blNumber = String(card?.bl_number || "").trim();
  const folderName = String(card?.folder_name || "").trim();
  if (!accountId || !blNumber) return [];
  if (!folderName) {
    return [{ account_id: accountId, bl_number: blNumber }];
  }

  const bl = encodeURIComponent(blNumber);
  const rows = await supabaseFetch(
    `/rest/v1/cargo_cards?select=account_id,bl_number,folder_name&bl_number=eq.${bl}`
  );
  const targets = (rows || []).filter((item) => (
    String(item.folder_name || "").trim() === folderName
  ));
  if (!targets.length) {
    return [{ account_id: accountId, bl_number: blNumber }];
  }
  return Array.from(
    new Map(targets.map((item) => [
      `${item.account_id}|${item.bl_number}`,
      { account_id: item.account_id, bl_number: item.bl_number },
    ])).values()
  );
}

function effectiveWarehouseValues(input, card) {
  return {
    storage_yard: String(input?.storage_yard || card?.storage_yard || card?.shed_name || "").trim(),
    warehouse_expected_date: String(input?.warehouse_expected_date || card?.warehouse_expected_date || "").trim(),
  };
}

async function sendWarehouseChangeMail(card, session, previous, next) {
  const host = process.env.SMTP_HOST || "";
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  if (!host || !user || !pass) {
    throw new Error("메일 환경변수 SMTP_HOST, SMTP_USER, SMTP_PASS를 확인해 주세요.");
  }
  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true").toLowerCase() !== "false",
    auth: { user, pass },
  });
  const mail = buildWarehouseChangeMail(card, session, previous, next);
  await transporter.sendMail({
    from: process.env.MAIL_FROM || user,
    to: WAREHOUSE_CHANGE_TO.join(","),
    subject: mail.subject,
    text: mail.text,
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const session = requireWritableSession(req, res);
    if (!session) return;

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const action = String(body.action || "").trim();
    const blNumber = String(body.bl_number || "").trim();
    const targetAccountId = String(body.account_id || session.account_id || "").trim();
    const isAdmin = (session.role || "shipper") === "admin";

    if (!blNumber) {
      return res.status(400).json({ success: false, message: "BL 번호가 없습니다." });
    }
    if (!targetAccountId) {
      return res.status(400).json({ success: false, message: "화주 계정이 필요합니다." });
    }
    if (!isAdmin && targetAccountId !== session.account_id) {
      return res.status(403).json({ success: false, message: "조회 권한이 없는 BL입니다." });
    }
    const card = await findOwnedCard(targetAccountId, blNumber);
    if (!card) {
      return res.status(404).json({ success: false, message: "대상 카드를 찾을 수 없습니다." });
    }

    if (action === "admin_status") {
      if (!isAdmin) {
        return res.status(403).json({ success: false, message: "관리자만 변경할 수 있습니다." });
      }

      const cleanOX = (value) => {
        const text = String(value || "").trim().toUpperCase();
        return text === "O" || text === "X" ? text : null;
      };
      const payload = {
        account_id: targetAccountId,
        bl_number: blNumber,
      };
      if (Object.prototype.hasOwnProperty.call(body, "animal_quarantine_override")) {
        payload.animal_quarantine_override = normalizeInspectionStatus(body.animal_quarantine_override);
      }
      if (Object.prototype.hasOwnProperty.call(body, "food_quarantine_override")) {
        payload.food_quarantine_override = normalizeInspectionStatus(body.food_quarantine_override);
      }
      if (Object.prototype.hasOwnProperty.call(body, "import_declaration_override")) {
        payload.import_declaration_override = cleanOX(body.import_declaration_override);
      }
      if (Object.prototype.hasOwnProperty.call(body, "distribution_history_override")) {
        payload.distribution_history_override = cleanOX(body.distribution_history_override);
      }
      if (Object.prototype.hasOwnProperty.call(body, "distribution_history_number")) {
        payload.distribution_history_number =
          String(body.distribution_history_number || "").trim() || null;
      }
      if (Object.prototype.hasOwnProperty.call(body, "sticker_requested")) {
        payload.sticker_requested = body.sticker_requested === true;
      }
      const deliveryFields = [
        "docs_delivered_samhyeon",
        "docs_delivered_warehouse",
      ];
      const hasDeliveryChange = deliveryFields.some((field) => (
        Object.prototype.hasOwnProperty.call(body, field)
      ));
      for (const field of deliveryFields) {
        if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
        if (typeof body[field] !== "boolean") {
          return res.status(400).json({
            success: false,
            message: "서류전달 상태는 O 또는 X로 선택해 주세요.",
          });
        }
        payload[field] = body[field];
      }

      if (hasDeliveryChange) {
        const deliveryPayload = {};
        for (const field of deliveryFields) {
          if (Object.prototype.hasOwnProperty.call(payload, field)) {
            deliveryPayload[field] = payload[field];
          }
        }
        const targets = await linkedDocumentDeliveryTargets(card);
        const linkedPayloads = targets.map((target) => ({
          ...target,
          ...deliveryPayload,
        }));
        const rows = await supabaseFetch(
          "/rest/v1/cargo_card_user_inputs?on_conflict=account_id,bl_number",
          {
            method: "POST",
            headers: { Prefer: "resolution=merge-duplicates,return=representation" },
            body: JSON.stringify(linkedPayloads),
          }
        );
        return res.status(200).json({
          success: true,
          input: rows && rows[0] ? rows[0] : null,
          inputs: rows || [],
        });
      }
      const rows = await supabaseFetch(
        "/rest/v1/cargo_card_user_inputs?on_conflict=account_id,bl_number",
        {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify(payload),
        }
      );

      return res.status(200).json({ success: true, input: rows && rows[0] ? rows[0] : null });
    }

    if (action === "obl_carrier_submission") {
      if (!isAdmin) {
        return res.status(403).json({ success: false, message: "관리자만 변경할 수 있습니다." });
      }
      const submitted = body.obl_carrier_submitted === true;
      const submittedDate = String(body.obl_carrier_submitted_date || "").trim();
      if (submitted && !isValidDate(submittedDate)) {
        return res.status(400).json({ success: false, message: "OBL 접수일 형식이 올바르지 않습니다." });
      }
      const rows = await supabaseFetch(
        "/rest/v1/cargo_card_user_inputs?on_conflict=account_id,bl_number",
        {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify({
            account_id: targetAccountId,
            bl_number: blNumber,
            obl_carrier_submitted: submitted,
            obl_carrier_submitted_date: submitted ? submittedDate : null,
            obl_carrier_submitted_by: submitted ? (session.login_id || "admin") : null,
            obl_carrier_submitted_at: submitted ? new Date().toISOString() : null,
          }),
        }
      );
      return res.status(200).json({ success: true, input: rows && rows[0] ? rows[0] : null });
    }

    if (action === "manual_fields") {
      const previousInput = await findManualInput(targetAccountId, blNumber);
      const sendNotification = body.send_notification === true;
      const merged = mergeManualFields(previousInput, body);
      const deliveryTerms = String(merged.delivery_terms || "").trim();
      const etaDate = String(merged.eta_date || "").trim();
      const storageYard = String(merged.storage_yard || "").trim();
      const freeTimeDays = String(merged.free_time_days ?? "3").trim() || "3";
      const freeTimeExpiryDate = String(
        merged.free_time_expiry_override || merged.free_time_expiry_date || ""
      ).trim();
      const warehouseExpectedDate = String(merged.warehouse_expected_date || "").trim();

      if (freeTimeDays && !/^\d+$/.test(freeTimeDays)) {
        return res.status(400).json({ success: false, message: "프리타임 일수는 숫자로 입력해 주세요." });
      }
      for (const value of [etaDate, freeTimeExpiryDate, warehouseExpectedDate]) {
        if (!isValidDate(value)) {
          return res.status(400).json({ success: false, message: "날짜 형식이 올바르지 않습니다." });
        }
      }

      const previousWarehouse = effectiveWarehouseValues(previousInput, card);
      const nextPayload = {
        account_id: targetAccountId,
        bl_number: blNumber,
      };
      const normalizedFields = {
        delivery_terms: deliveryTerms || null,
        eta_date: etaDate || null,
        storage_yard: storageYard || null,
        free_time_days: Number(freeTimeDays),
        free_time_expiry_override: freeTimeExpiryDate || null,
        warehouse_expected_date: warehouseExpectedDate || null,
      };
      for (const [field, value] of Object.entries(normalizedFields)) {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          nextPayload[field] = value;
        }
      }
      if (Object.keys(nextPayload).length === 2) {
        return res.status(400).json({ success: false, message: "저장할 운송정보가 없습니다." });
      }
      const nextInput = { ...previousInput, ...nextPayload };
      const nextWarehouse = effectiveWarehouseValues(nextInput, card);
      const changedFields = !isAdmin ? warehouseChanges(previousWarehouse, nextWarehouse) : [];
      nextPayload.transport_updated_by_role = isAdmin
        ? "admin"
        : (session.account_category === "destination" ? "destination" : "shipper");
      nextPayload.transport_updated_by_login = session.login_id || "";
      nextPayload.transport_updated_at = new Date().toISOString();
      const accountFilter = encodeURIComponent(targetAccountId);
      const blFilter = encodeURIComponent(blNumber);
      const inputExists = !!previousInput?.account_id;
      const previousUpdatedAt = previousInput?.updated_at;
      if (inputExists && !previousUpdatedAt) {
        return res.status(409).json({
          success: false,
          message: "운송정보가 다른 사용자에 의해 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
        });
      }
      const previousUpdatedAtFilter = inputExists
        ? `&updated_at=eq.${encodeURIComponent(previousUpdatedAt)}`
        : "";
      const rows = await supabaseFetch(
        inputExists
          ? `/rest/v1/cargo_card_user_inputs?account_id=eq.${accountFilter}&bl_number=eq.${blFilter}${previousUpdatedAtFilter}`
          : "/rest/v1/cargo_card_user_inputs",
        {
          method: inputExists ? "PATCH" : "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(nextPayload),
        }
      );
      const input = rows && rows[0] ? rows[0] : null;
      if (inputExists && !input) {
        return res.status(409).json({
          success: false,
          message: "운송정보가 다른 사용자에 의해 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
        });
      }
      let emailSent = false;
      let emailMessage = "";
      if (!isAdmin && sendNotification && changedFields.length) {
        try {
          await sendWarehouseChangeMail(card, session, previousWarehouse, nextWarehouse);
          emailSent = true;
        } catch (mailError) {
          emailMessage = mailError.message;
          const savedUpdatedAt = input?.updated_at;
          const rollbackPayload = buildTransportRollbackPayload(previousInput, nextPayload);
          let rolledBack = false;
          if (savedUpdatedAt) {
            try {
              const account = encodeURIComponent(targetAccountId);
              const bl = encodeURIComponent(blNumber);
              const updated = encodeURIComponent(savedUpdatedAt);
              const rollbackRows = await supabaseFetch(
                `/rest/v1/cargo_card_user_inputs?account_id=eq.${account}&bl_number=eq.${bl}&updated_at=eq.${updated}`,
                {
                  method: "PATCH",
                  headers: { Prefer: "return=representation" },
                  body: JSON.stringify(rollbackPayload),
                }
              );
              rolledBack = Array.isArray(rollbackRows) && rollbackRows.length > 0;
            } catch (_) {
              rolledBack = false;
            }
          }
          if (rolledBack) {
            return res.status(502).json({
              success: false,
              message: `메일 발송에 실패하여 반입예정정보 변경을 취소했습니다: ${emailMessage}`,
            });
          }
          let currentInput = null;
          try {
            const latestInput = await findManualInput(targetAccountId, blNumber);
            currentInput = latestInput?.account_id ? latestInput : null;
          } catch (_) {
            currentInput = null;
          }
          return res.status(409).json({
            success: false,
            message: "메일 발송에 실패했고 저장 취소를 확인할 수 없습니다. 최신 정보를 새로고침한 후 다시 시도해 주세요.",
            input: currentInput,
            email_sent: false,
            email_message: emailMessage,
          });
        }
      }

      return res.status(200).json({
        success: true,
        input,
        changed_fields: changedFields,
        email_sent: emailSent,
        email_message: emailMessage,
      });
    }

    const isQuota = !!body.is_quota;
    const quotaPermitDate = String(body.quota_permit_date || "").trim();

    if (!isValidDate(quotaPermitDate)) {
      return res.status(400).json({ success: false, message: "추천서 교부일 형식이 올바르지 않습니다." });
    }

    const rows = await supabaseFetch(
      "/rest/v1/cargo_card_user_inputs?on_conflict=account_id,bl_number",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          account_id: targetAccountId,
          bl_number: blNumber,
          is_quota: isQuota,
          quota_permit_date: isQuota && quotaPermitDate ? quotaPermitDate : null,
        }),
      }
    );

    return res.status(200).json({ success: true, input: rows && rows[0] ? rows[0] : null });
  } catch (error) {
    if (["docs_delivered_samhyeon", "docs_delivered_warehouse", "account_category"].some((name) => String(error.message || "").includes(name))) {
      return res.status(500).json({
        success: false,
        message: "Supabase에서 20260724_add_document_delivery_status.sql을 먼저 실행해 주세요.",
      });
    }
    if (["transport_updated_by_role", "transport_updated_by_login", "transport_updated_at"].some((name) => String(error.message || "").includes(name))) {
      return res.status(500).json({
        success: false,
        message: "Supabase에서 add_progress_request_metadata.sql을 먼저 실행해 주세요.",
      });
    }
    if (["delivery_terms", "eta_date", "storage_yard", "free_time_days", "free_time_expiry_date", "free_time_expiry_override", "warehouse_expected_date", "animal_quarantine_override", "food_quarantine_override", "import_declaration_override", "distribution_history_override", "distribution_history_number", "sticker_requested", "obl_carrier_submitted"].some((name) => String(error.message || "").includes(name))) {
      return res.status(500).json({
        success: false,
        message: "Supabase에서 20260724_add_progress_operations.sql을 먼저 실행해 주세요.",
      });
    }
    if (String(error.message || "").includes("cargo_card_user_inputs")) {
      return res.status(500).json({
        success: false,
        message: "Supabase에 cargo_card_user_inputs 테이블을 먼저 생성해야 합니다.",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};
