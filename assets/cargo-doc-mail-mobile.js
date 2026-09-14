/* Mobile document batches. Card state never determines the kind of receipt mail. */
let documentBatch = null;
let documentBatchBusy = false;
const documentBatchSent = new Set();
const batchCardKey = card => JSON.stringify([card.account_id, card.bl_number]);
const batchSource = card => JSON.stringify([String(card.bl_number).toUpperCase(), card.folder_name || card.account_id]);
function batchDocumentSent(card, documentType) {
  return documentBatchSent.has(JSON.stringify([documentBatch.kind, document.getElementById("docBatchDate").value, batchSource(card), documentType]));
}
function batchDefaultDocuments(card) {
  return ["obl"];
}
function batchHasReceiptRequest(card) {
  return !!(card?.last_original_doc_request || card?.last_original_doc_request_id);
}
function openDocumentBatch(kind, index) {
  if (documentBatchBusy) return;
  const seed = Number.isInteger(index) ? visible[index] : null;
  if (seed && !batchHasReceiptRequest(seed)) { alert("서류 수령 요청이 있는 B/L만 묶음 메일로 처리할 수 있습니다."); return; }
  documentBatch = { kind, seed, selected: new Map(), preview: null, returnFocus: document.activeElement, previousOverflow: document.body.style.overflow };

  const date = seed && kind === "receipt" ? shortDate(seed.actual_received_date) : seed && kind === "carrier" ? shortDate(seed.obl_carrier_submitted_date) : "";
  document.getElementById("docBatchDate").value = date || koreaTodayDate();
  if (seed) documentBatch.selected.set(batchCardKey(seed), { card: seed, documents: batchDefaultDocuments(seed), pages: "" });
  document.getElementById("docBatchTitle").textContent = kind === "carrier" ? "선사접수 묶음 메일" : "원본서류 수령 묶음 메일";
  document.getElementById("docBatchDateLabel").textContent = kind === "carrier" ? "선사 접수일" : "실제 수령일";
  document.getElementById("docBatchCarrierFields").hidden = kind !== "carrier";
  for (const id of ["docBatchCarrier", "docBatchGroup", "docBatchMemo", "docBatchExtra", "docBatchSearch"]) document.getElementById(id).value = "";
  const shippers = [...new Set(cards.filter(batchHasReceiptRequest).map(c => c.consignee).filter(Boolean))].sort();
  document.getElementById("docBatchShipper").innerHTML = shippers.map(s => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join("");
  if (seed) document.getElementById("docBatchShipper").value = seed.consignee;
  document.getElementById("docBatchMessage").textContent = "";
  document.getElementById("docBatchSend").hidden = false;
  document.getElementById("docBatchPreview").hidden = true;
  document.getElementById("docBatchEditor").hidden = false;
  document.getElementById("docBatchModal").style.display = "flex";
  document.body.style.overflow = "hidden";
  document.getElementById("docBatchTitle").focus();
  document.getElementById("docBatchDate").max = koreaTodayDate();
  renderDocumentBatch();
}
function closeDocumentBatch() {
  if (documentBatchBusy) return;
  document.getElementById("docBatchModal").style.display = "none";
  document.body.style.overflow = documentBatch?.previousOverflow || "";
  documentBatch?.returnFocus?.focus();
  documentBatch = null;
}
function batchCandidates() {
  if (!documentBatch) return [];
  const date = document.getElementById("docBatchDate").value;
  const shipper = document.getElementById("docBatchShipper").value;
  const query = document.getElementById("docBatchSearch").value.trim().toLowerCase();
  const seen = new Set();
  return cards.filter(card => {
    if (!batchHasReceiptRequest(card)) return false;
    const source = JSON.stringify([String(card.bl_number).toUpperCase(), card.folder_name || card.account_id]);
    if (seen.has(source) || card.consignee !== shipper) return false;
    seen.add(source);
    if (batchDocumentSent(card, "obl")) return false;
    const received = shortDate(card.actual_received_date);
    const submitted = shortDate(card.obl_carrier_submitted_date);
    const eligible = documentBatch.kind === "receipt" ? (!received || received === date || card.obl_received !== true || card.hc_received !== true)
      : (submitted === date || (!submitted && card.obl_received === true));
    return (eligible || batchCardKey(card) === batchCardKey(documentBatch.seed || {})) && (!query || [card.bl_number, card.destination, card.product_name].some(v => String(v || "").toLowerCase().includes(query)));
  }).sort((a, b) => String(a.bl_number).localeCompare(String(b.bl_number)));
}
function resetDocumentBatchSelection() {
  if (!documentBatch || documentBatchBusy) return;
  documentBatch.selected.clear();
  renderDocumentBatch();
}
function renderDocumentBatch() {
  if (!documentBatch) return;
  const rows = batchCandidates();
  document.getElementById("docBatchList").innerHTML = rows.map((card, index) => {
    const key = batchCardKey(card), selected = documentBatch.selected.get(key);
    const docs = selected?.documents || ["obl"];
    return '<div class="batch-item"><label class="batch-pick"><input type="checkbox" aria-label="' + esc(card.bl_number) + ' 선택" ' + (selected ? "checked" : "") + ' onchange="toggleDocumentBatch(' + index + ',this.checked)"><span><strong>' + esc(card.bl_number) + '</strong><small>' + esc(mobileDestinationName(card.destination)) + ' · 수령 ' + esc(shortDate(card.actual_received_date) || "미등록") + '</small></span></label>' +
      (documentBatch.kind === "receipt" && selected ? '<div class="batch-docs"><span>이번 수령:</span><span class="obl-required">✓ OBL 기본·필수</span><label><input type="checkbox" ' + (docs.includes("hc") ? "checked" : "") + ' onchange="setDocumentBatchType(' + index + ',&quot;hc&quot;,this.checked)">H/C 추가</label></div>' : "") + (documentBatch.kind === "receipt" && selected ? '<label class="modal-field">이 B/L 원본서류 페이지<input id="batchPages' + index + '" type="number" inputmode="numeric" min="1" max="99999" step="1" value="' + esc(selected.pages || "") + '" placeholder="예: 9" oninput="setDocumentBatchPages(' + index + ',this.value)"></label>' : "") + '</div>';
  }).join("") || '<p class="batch-help">이 날짜의 대상 B/L이 없습니다.</p>';
  document.getElementById("docBatchCount").textContent = documentBatch.selected.size + "건 선택 · 메일 1통";
  document.getElementById("docBatchHint").textContent = documentBatch.kind === "carrier"
    ? "서류 수령 요청이 있는 B/L만 표시합니다. 선사명을 입력하고 해당 선사의 B/L만 선택하세요. 같은 날에도 일부만 보내고 나머지는 다음 묶음으로 보낼 수 있습니다."
    : "서류 수령 요청이 있는 B/L만 표시합니다. OBL 접수는 항상 포함됩니다. H/C가 함께 도착했다면 추가 선택하세요.";
}
function toggleDocumentBatch(index, checked) {
  const card = batchCandidates()[index];
  if (!card || documentBatchBusy) return;
  const key = batchCardKey(card);
  if (checked) documentBatch.selected.set(key, { card, documents: batchDefaultDocuments(card), pages: "" });
  else documentBatch.selected.delete(key);
  renderDocumentBatch();
}
function selectDocumentBatchAll(checked) {
  if (!documentBatch || documentBatchBusy) return;
  if (!checked) documentBatch.selected.clear();
  else for (const card of batchCandidates()) {
    const key = batchCardKey(card);
    if (!documentBatch.selected.has(key)) documentBatch.selected.set(key, { card, documents: batchDefaultDocuments(card), pages: "" });
  }
  renderDocumentBatch();
}
function setDocumentBatchType(index, doc, checked) {
  const card = batchCandidates()[index];
  const item = card && documentBatch.selected.get(batchCardKey(card));
  if (!item || documentBatchBusy) return;
  if (doc === "obl") return;
  item.documents = ["obl", ...(doc === "hc" && checked ? ["hc"] : [])];
}
function setDocumentBatchPages(index, value) {
  const card = batchCandidates()[index];
  const item = card && documentBatch?.selected.get(batchCardKey(card));
  if (item && !documentBatchBusy) item.pages = value;
}
function documentBatchPayload() {
  return {
    action: documentBatch.kind === "carrier" ? "obl_carrier_batch" : "original_doc_batch",
    date: document.getElementById("docBatchDate").value,
    carrier_name: document.getElementById("docBatchCarrier").value.trim(),
    group_name: document.getElementById("docBatchGroup").value.trim(),
    memo: document.getElementById("docBatchMemo").value,
    additional_recipients: document.getElementById("docBatchExtra").value,
    items: [...documentBatch.selected.values()].map(({card, documents, pages}) => ({ total_pages: pages, account_id: card.account_id, bl_number: card.bl_number, received_documents: ["obl", ...documents.filter(doc => doc === "hc")] }))
  };
}
function setDocumentBatchBusy(busy) {
  documentBatchBusy = busy;
  document.querySelectorAll("#docBatchModal button, #docBatchModal input, #docBatchModal select, #docBatchModal textarea").forEach(el => { el.disabled = busy; });
}
async function previewDocumentBatch() {
  if (!documentBatch || documentBatchBusy) return;
  const payload = documentBatchPayload();
  if (!payload.items.length) {
    document.getElementById("docBatchMessage").textContent = "B/L을 선택해 주세요.";
    document.getElementById("docBatchMessage").scrollIntoView?.({block:"nearest"});
    return;
  }
  const missingPages = documentBatch.kind === "receipt" && payload.items.find(item => !Number.isInteger(Number(item.total_pages)) || Number(item.total_pages) < 1);
  if (missingPages) {
    document.getElementById("docBatchMessage").textContent = missingPages.bl_number + ": 원본서류 페이지 수를 입력해 주세요.";
    document.getElementById("docBatchSearch").value = "";
    renderDocumentBatch();
    const index = batchCandidates().findIndex(card => card.account_id === missingPages.account_id && card.bl_number === missingPages.bl_number);
    const pages = document.getElementById("batchPages" + index);
    pages?.scrollIntoView?.({block:"center"}); pages?.focus();
    return;
  }
  setDocumentBatchBusy(true);
  document.getElementById("docBatchMessage").textContent = "미리보기 준비 중…";
  try {
    const response = await fetch("/api/cargo-original-doc-receipt-mail", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({...payload, preview: true}) });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || "미리보기에 실패했습니다.");
    documentBatch.preview = { payload, token: result.preview_token };
    document.getElementById("docBatchSend").hidden = false;
    document.getElementById("docBatchPreviewText").textContent = "받는 사람: " + result.mail.to.join(", ") + "\n참조: " + result.mail.cc.join(", ") + "\n\n제목: " + result.mail.subject + "\n\n" + result.mail.text;
    document.getElementById("docBatchEditor").hidden = true;
    document.getElementById("docBatchPreview").hidden = false;
    document.getElementById("docBatchTitle").scrollIntoView?.({block:"start"});
    document.getElementById("docBatchSend").textContent = payload.items.length + "건 · 메일 1통 발송";
    document.getElementById("docBatchMessage").textContent = "아직 발송되지 않았습니다. 수신처와 B/L을 확인해 주세요.";
  } catch(error) { document.getElementById("docBatchMessage").textContent = error.message; document.getElementById("docBatchMessage").scrollIntoView?.({block:"nearest"}); }
  finally { setDocumentBatchBusy(false); }
}
function editDocumentBatch() {
  if (!documentBatch || documentBatchBusy) return;
  documentBatch.preview = null;
  document.getElementById("docBatchPreview").hidden = true;
  document.getElementById("docBatchEditor").hidden = false;
  document.getElementById("docBatchMessage").textContent = "";
}
async function sendDocumentBatch() {
  if (!documentBatch?.preview || documentBatchBusy) return;
  const preview = documentBatch.preview;
  setDocumentBatchBusy(true);
  document.getElementById("docBatchMessage").textContent = "메일 1통 발송 중…";
  try {
    const response = await fetch("/api/cargo-original-doc-receipt-mail", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({...preview.payload, preview_token: preview.token}) });
    const result = await response.json();
    if (result.email_sent || result.deduplicated) {
      for (const {card, documents} of documentBatch.selected.values()) {
        const source = JSON.stringify([String(card.bl_number).toUpperCase(), card.folder_name || card.account_id]);
        for (const document of documents) documentBatchSent.add(JSON.stringify([documentBatch.kind, preview.payload.date, source, document]));
      }
      setDocumentBatchBusy(false);
      closeDocumentBatch();
      alert(result.message);
      await load();
      return;
    }
    const blocked = result.blocked?.map(v => v.bl_number + (v.document ? " (" + v.document.toUpperCase() + ")" : "")) || [];
    document.getElementById("docBatchMessage").textContent = (result.message || "발송하지 못했습니다.") + (blocked.length ? "\n확인할 B/L: " + blocked.join(", ") : "");
    if (result.delivery_uncertain) {
      documentBatch.preview = null;
      document.getElementById("docBatchSend").hidden = true;
    }
  } catch(error) {
    document.getElementById("docBatchMessage").textContent = "연결이 끊겨 발송 결과를 확인하지 못했습니다. 같은 내용으로 재확인하면 중복 발송은 차단됩니다.";
  } finally { setDocumentBatchBusy(false); }
}



document.addEventListener("keydown", event => {
  if (!documentBatch) return;
  if (event.key === "Escape") { event.preventDefault(); closeDocumentBatch(); }
  if (event.key === "Tab") {
    const elements = [...document.querySelectorAll("#docBatchModal button:not(:disabled), #docBatchModal input:not(:disabled), #docBatchModal select:not(:disabled), #docBatchModal textarea:not(:disabled)")].filter(el => el.getClientRects().length);
    const first = elements[0], last = elements[elements.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement.id === "docBatchTitle")) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
