
const test = require("node:test");
const assert = require("node:assert/strict");
const {processBatch, prepareBatch, validDate} = require("../lib/cargo-doc-mail-batch");
const date = "2026-09-14";
function harness() {
 const cards = ["A","B","C"].map(bl => ({account_id:"account-1",bl_number:bl,folder_name:"folder-"+bl,consignee:"현대코퍼레이션H",destination:"TEST"}));
 const events = new Map(), writes = [], sent = [];
 const deps = {recipients:{to:["shipper@example.test"],cc:[]}, loginId:"admin",
  async sendMail(mail) {sent.push(mail);return {accepted:["shipper@example.test"]};},
  async supabaseFetch(url, options={}) {
   const body=options.body && JSON.parse(options.body);
   if (url.includes("cargo_cards?")) {
    const bl = decodeURIComponent(url.match(/bl_number=eq\.([^&]+)/)[1]);
    const card=cards.find(c=>c.bl_number===bl);
    return card ? [card] : [];
   }
   if (url.includes("/rpc/claim_cargo_manual_mail")) {
    let event=events.get(body.p_event_key);
    if (event && event.status!=="failed") return [{...event,claimed:false}];
    event={id:body.p_event_key,claim_token:"token-"+Math.random(),status:"sending",claimed:true};
    events.set(body.p_event_key,event); return [event];
   }
   if (url.includes("/rpc/settle_cargo_mail")) {
    const event=events.get(body.p_event_id);assert.equal(event.claim_token,body.p_claim_token);
    event.status=body.p_status; return [{settled:true,status:event.status}];
   }
   if (url.includes("cargo_original_docs?select=")) return [{actual_received_date:"2026-09-13"}];
   if (url.includes("on_conflict=")) {writes.push(body);return [body];}
   throw new Error("Unexpected: "+url);
  }
 };
 const body=(bls=["A","B"], extra={})=>({action:"original_doc_batch",date,total_pages:"4",items:bls.map(bl=>({account_id:"account-1",bl_number:bl,total_pages:"4",received_documents:["obl"]})),...extra});
 async function send(request) {
  const preview=await processBatch({...request,preview:true},deps);
  return processBatch({...request,preview_token:preview.preview_token},deps);
 }
 return {cards,events,writes,sent,deps,body,send};
}
test("strict dates reject impossible days",()=>{assert.equal(validDate("2026-02-30"),false);assert.equal(validDate("2026-09-14"),true);});
test("preview reads only and OBL ignores transfer state",async()=>{
 const h=harness();h.cards[0].doc_transfer_received=true;
 const result=await processBatch({...h.body(),preview:true},h.deps);
 assert.match(result.mail.subject,/OBL 원본서류/);assert.doesNotMatch(result.mail.text,/양도증/);
 assert.equal(h.writes.length,0);assert.equal(h.events.size,0);assert.equal(h.sent.length,0);
 assert.match(result.mail.text,/B\/L: A/);assert.match(result.mail.text,/B\/L: B/);
});
test("two B/L send one mail and only selected receipts change; old dates preserved",async()=>{
 const h=harness();const result=await h.send(h.body());
 assert.equal(result.success,true);assert.equal(h.sent.length,1);assert.equal(h.writes.length,2);
 for(const write of h.writes){assert.equal(write.obl_received,true);assert.ok(!("hc_received" in write));assert.ok(!("transfer_received_override" in write));assert.ok(!("actual_received_date" in write));}
});
test("H/C-only receipt is rejected because OBL is mandatory",async()=>{
 const h=harness(),request=h.body(["A"]);request.items[0].received_documents=["hc"];
 await assert.rejects(h.send(request),e=>e.httpStatus===400 && /OBL/.test(e.message));
 assert.equal(h.sent.length,0);assert.equal(h.writes.length,0);
});
test("mixed shipper, transfer selection, duplicate B/L and invalid pages rejected before claim",async()=>{
 for(const kind of ["shipper","transfer","duplicate","pages"]){
  const h=harness(),request=h.body();
  if(kind==="shipper")h.cards[1].consignee="Other";
  if(kind==="transfer")request.items[0].received_documents=["transfer"];
  if(kind==="duplicate")request.items.push(request.items[0]);
  if(kind==="pages")request.items[0].total_pages="1.5";
  await assert.rejects(h.send(request));assert.equal(h.events.size,0);assert.equal(h.sent.length,0);
 }
});
test("preview token binds recipients and content",async()=>{
 const h=harness(),request=h.body();const preview=await processBatch({...request,preview:true},h.deps);
 await assert.rejects(processBatch({...request,memo:"changed",preview_token:preview.preview_token},h.deps),e=>e.httpStatus===409);
 assert.equal(h.events.size,0);
});
test("repeat or reordered batch does not send again even with new memo and group",async()=>{
 const h=harness();await h.send(h.body());const result=await h.send(h.body(["B","A"],{memo:"edited"}));
 assert.equal(result.deduplicated,true);assert.equal(h.sent.length,1);assert.equal(h.writes.length,2);
});
test("overlap blocks whole batch and releases unsent claims; remaining B/L can form another batch",async()=>{
 const h=harness();await h.send(h.body(["A"]));
 await assert.rejects(h.send(h.body(["A","B"])),e=>e.httpStatus===409 && e.blocked[0].bl_number==="A");
 assert.equal(h.sent.length,1);await h.send(h.body(["B"]));assert.equal(h.sent.length,2);
});
test("same day carrier batches can be split by selected B/L and carrier name",async()=>{
 const h=harness();
 await h.send(h.body(["A"],{action:"obl_carrier_batch",carrier_name:"MSC",group_name:"오전"}));
 await h.send(h.body(["B"],{action:"obl_carrier_batch",carrier_name:"ONE",group_name:"오후"}));
 assert.equal(h.sent.length,2);assert.match(h.sent[0].subject,/MSC/);assert.match(h.sent[1].subject,/ONE/);
 assert.ok(h.writes.every(w=>w.obl_carrier_submitted===true && !("obl_received" in w)));
});
test("SMTP uncertainty blocks repeat and never saves receipt",async()=>{
 const h=harness();h.deps.sendMail=async()=>{throw Object.assign(new Error("timeout"),{code:"ETIMEDOUT"});};
 await assert.rejects(h.send(h.body()),e=>e.deliveryUncertain===true);
 assert.ok([...h.events.values()].every(e=>e.status==="delivery_uncertain"));assert.equal(h.writes.length,0);
 await assert.rejects(h.send(h.body()),e=>e.httpStatus===409);
});
test("known pre-send failure allows retry",async()=>{
 const h=harness();h.deps.sendMail=async()=>{throw Object.assign(new Error("bad auth"),{code:"EAUTH"});};
 await assert.rejects(h.send(h.body()),e=>!e.deliveryUncertain);
 h.deps.sendMail=async mail=>{h.sent.push(mail);return {};};
 assert.equal((await h.send(h.body())).success,true);assert.equal(h.sent.length,1);
});
test("partial recipient rejection and settlement failure remain blocked without status writes",async()=>{
 for(const failure of ["recipient","settlement"]){
  const h=harness();
  if(failure==="recipient")h.deps.sendMail=async()=>({accepted:["a@example.test"],rejected:["b@example.test"]});
  else {const fetch=h.deps.supabaseFetch;h.deps.supabaseFetch=async(url,opt)=>{if(url.includes("settle_cargo_mail"))throw new Error("lost");return fetch(url,opt);};}
  const result=await h.send(h.body());assert.equal(result.delivery_uncertain,true);assert.equal(h.writes.length,0);
  await assert.rejects(h.send(h.body()),e=>e.httpStatus===409);
 }
});
test("sent mail with state-save failure reports B/L and blocks resend",async()=>{
 const h=harness(),fetch=h.deps.supabaseFetch;h.deps.supabaseFetch=async(url,opt)=>{if(url.includes("on_conflict="))throw new Error("write unavailable");return fetch(url,opt);};
 const result=await h.send(h.body());assert.equal(result.email_sent,true);assert.equal(result.success,false);assert.equal(result.failed_bl_numbers.length,2);
 const repeat=await h.send(h.body());assert.equal(repeat.deduplicated,true);assert.equal(h.sent.length,1);
});
test("simultaneous overlapping batches never send duplicate B/L",async()=>{
 const h=harness();const results=await Promise.allSettled([h.send(h.body(["A","B"])),h.send(h.body(["B","C"]))]);
 const shipped=h.sent.flatMap(mail=>[...mail.text.matchAll(/B\/L: ([ABC])/g)].map(m=>m[1]));
 assert.equal(shipped.filter(bl=>bl==="B").length,1);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
});


test("OBL is mandatory and neither combined nor HC-only retries bypass deduplication",async()=>{
 const h=harness();await h.send(h.body(["A"]));
 const combined=h.body(["A"]);combined.items[0].received_documents=["obl","hc"];
 await assert.rejects(h.send(combined),e=>e.blocked.some(v=>v.document==="obl"));
 const hc=h.body(["A"]);hc.items[0].received_documents=["hc"];
 await assert.rejects(h.send(hc),e=>e.httpStatus===400);assert.equal(h.sent.length,1);
});
test("stable event key survives additional linked accounts",async()=>{
 const h=harness(),fetch=h.deps.supabaseFetch,request=h.body(["A"]);
 const before=await prepareBatch(request,h.deps);
 h.deps.supabaseFetch=async(url,opt)=> {
  const rows=await fetch(url,opt);
  return url.includes("cargo_cards?select=account_id") ? [...rows,{...rows[0],account_id:"000-added"}] : rows;
 };
 const after=await prepareBatch(request,h.deps);
 assert.deepEqual(after.items[0].keys,before.items[0].keys);
});
test("linked accounts receive only selected document fields",async()=>{
 const h=harness(),fetch=h.deps.supabaseFetch;
 h.deps.supabaseFetch=async(url,opt)=> {
  const rows=await fetch(url,opt);
  return url.includes("cargo_cards?select=account_id") ? [...rows,{...rows[0],account_id:"linked"}] : rows;
 };
 await h.send(h.body(["A"]));assert.equal(h.writes.length,2);
 assert.deepEqual(h.writes.map(v=>v.account_id).sort(),["account-1","linked"]);
 assert.ok(h.writes.every(v=>!("hc_received" in v)));
});


test("slow final claim stops before SMTP and releases acquired claims", {concurrency:false}, async()=>{
 const h=harness(),fetch=h.deps.supabaseFetch,now=Date.now;let elapsed=0;
 Date.now=()=>elapsed;
 try {
  h.deps.supabaseFetch=async(url,opt)=>{const result=await fetch(url,opt);if(url.includes("claim_cargo_manual_mail"))elapsed=40000;return result;};
  await assert.rejects(h.send(h.body(["A"])),e=>e.httpStatus===503);
  assert.equal(h.sent.length,0);assert.ok([...h.events.values()].every(v=>v.status==="failed"));
 }finally{Date.now=now;}
});


test("each B/L keeps its own page count in sorted mail output",async()=>{
 const h=harness(),request=h.body(["C","A","B"]);
 request.items[0].total_pages="12";request.items[1].total_pages="9";request.items[2].total_pages="10";
 const preview=await processBatch({...request,preview:true},h.deps);
 assert.match(preview.mail.text,/9, 10, 12 page/);
 assert.match(preview.mail.text,/B\/L: A[\s\S]*?원본 서류 페이지: 9 page/);
 assert.match(preview.mail.text,/B\/L: B[\s\S]*?원본 서류 페이지: 10 page/);
 assert.match(preview.mail.text,/B\/L: C[\s\S]*?원본 서류 페이지: 12 page/);
});

test("batch subjects list every selected BL in body order and preserve recipients",async()=>{
 for(const action of ["original_doc_batch","obl_carrier_batch"]){
  const h=harness(); h.deps.recipients.cc=["cc@example.test"];
  const result=await prepareBatch(h.body(["C","A","B"],{action,carrier_name:"MSC"}),h.deps);
  assert.ok(result.mail.subject.includes(" / A, B, C / "));
  assert.deepEqual(result.mail.to,["shipper@example.test"]);
  assert.deepEqual(result.mail.cc,["cc@example.test"]);
 }
});
