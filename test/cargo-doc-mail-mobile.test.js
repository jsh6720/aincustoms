
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"../cargo-docs-mobile.html"),"utf8");
const script=fs.readFileSync(path.join(__dirname,"../assets/cargo-doc-mail-mobile.js"),"utf8");
function ui() {
 const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{id,value:"",textContent:"",innerHTML:"",style:{},hidden:false,disabled:false,focus(){},getClientRects(){return[{}];}});return elements.get(id);};
 const date="2026-09-14",cards=["A","B","C"].map(bl=>({account_id:"account",bl_number:bl,folder_name:"folder-"+bl,consignee:"현대코퍼레이션H",destination:"TEST",obl_received:true,hc_received:false,actual_received_date:date,doc_transfer_received:true,last_original_doc_request_id:"request-"+bl}));
 const context={console,Map,Set,JSON,Number,String,Intl,Date,cards,visible:cards,esc:String,shortDate:v=>v?String(v).slice(0,10):"",koreaTodayDate:()=>date,mobileDestinationName:String,
  document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){},body:{style:{}},activeElement:{focus(){}}},
  fetch:async()=>{throw new Error("unexpected network");},alert(){},load:async()=>{},
 };
 vm.createContext(context);
 vm.runInContext(script+"\nthis.state=()=>documentBatch;this.setBusy=setDocumentBatchBusy;",context);
 return {context,element,cards};
}
test("mobile HTML and external script parse",()=>{
 assert.doesNotThrow(()=>new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
 assert.doesNotThrow(()=>new vm.Script(script));
 assert.match(html,/openDocumentBatch\('receipt', \$\{index\}\)/);
 assert.match(html,/minmax\(0,1fr\)/);
});
test("receipt defaults to explicit OBL even if only transfer is marked received",()=>{
 const {context:c,element,cards}=ui();cards[0].obl_received=false;
 c.openDocumentBatch("receipt",0);
 assert.deepEqual(Array.from(c.state().selected.values())[0].documents,vm.runInContext('["obl"]',c));
 assert.equal(element("docBatchTitle").textContent,"원본서류 수령 묶음 메일");
});
test("same day filter supports additional H/C after earlier OBL",()=>{
 const {context:c,element,cards}=ui();cards[0].actual_received_date="2026-09-13";
 c.openDocumentBatch("receipt");element("docBatchShipper").value=cards[0].consignee;
 assert.equal(c.batchCandidates().length,3);
});
test("search retains selected B/L, date or shipper change clears selection",()=>{
 const {context:c,element,cards}=ui();c.openDocumentBatch("receipt");element("docBatchShipper").value=cards[0].consignee;
 c.selectDocumentBatchAll(true);element("docBatchSearch").value="A";c.renderDocumentBatch();
 assert.equal(c.batchCandidates().length,1);assert.equal(c.state().selected.size,3);
 c.resetDocumentBatchSelection();assert.equal(c.state().selected.size,0);
});
test("carrier selection allows separate same-day groups",()=>{
 const {context:c,element,cards}=ui();c.openDocumentBatch("carrier");element("docBatchShipper").value=cards[0].consignee;
 c.toggleDocumentBatch(0,true);element("docBatchCarrier").value="MSC";element("docBatchGroup").value="오전";
 const payload=c.documentBatchPayload();assert.equal(payload.items.length,1);assert.equal(payload.carrier_name,"MSC");assert.equal(payload.group_name,"오전");
});
test("busy modal cannot close or change selected entries",()=>{
 const {context:c,element,cards}=ui();c.openDocumentBatch("receipt");element("docBatchShipper").value=cards[0].consignee;
 c.selectDocumentBatchAll(true);c.setBusy(true);c.closeDocumentBatch();c.selectDocumentBatchAll(false);
 assert.equal(c.state().selected.size,3);c.setBusy(false);c.closeDocumentBatch();assert.equal(c.state(),null);
});
test("closing preview never sends mail or saves state",async()=>{
 const {context:c,element,cards}=ui();let calls=0;
 c.fetch=async()=>{calls++;return {ok:true,json:async()=>({success:true,preview_token:"test",mail:{to:[],cc:[],subject:"OBL",text:"TEST"}})};};
 c.openDocumentBatch("receipt");element("docBatchShipper").value=cards[0].consignee;c.selectDocumentBatchAll(true);
 for(const item of c.state().selected.values()) item.pages="9";await c.previewDocumentBatch();assert.equal(calls,1);
 c.closeDocumentBatch();assert.equal(calls,1);
});


test("a new preview restores the send button after a prior uncertain batch",async()=>{
 const {context:c,element,cards}=ui();
 c.fetch=async()=>({ok:true,json:async()=>({success:true,preview_token:"test",mail:{to:[],cc:[],subject:"OBL",text:"TEST"}})});
 c.openDocumentBatch("receipt");element("docBatchShipper").value=cards[0].consignee;c.selectDocumentBatchAll(true);
 for(const item of c.state().selected.values()) item.pages="9";element("docBatchSend").hidden=true;await c.previewDocumentBatch();
 assert.equal(element("docBatchSend").hidden,false);
});


test("OBL cannot be unchecked and HC is optional",()=>{
 const {context:c,element,cards}=ui();c.openDocumentBatch("receipt",0);
 element("docBatchShipper").value=cards[0].consignee;
 c.setDocumentBatchType(0,"obl",false);
 assert.deepEqual(Array.from(c.state().selected.values())[0].documents,vm.runInContext('["obl"]',c));
 c.setDocumentBatchType(0,"hc",true);
 assert.deepEqual(Array.from(c.state().selected.values())[0].documents,vm.runInContext('["obl","hc"]',c));
 c.setDocumentBatchType(0,"hc",false);
 assert.deepEqual(Array.from(c.state().selected.values())[0].documents,vm.runInContext('["obl"]',c));
});

test("both batch lists exclude B/L without a receipt request",()=>{
 const {context:c,element,cards}=ui();cards[1].last_original_doc_request_id=null;
 for(const kind of ["receipt","carrier"]){
  c.openDocumentBatch(kind);element("docBatchShipper").value=cards[0].consignee;
  assert.deepEqual(Array.from(c.batchCandidates(),v=>v.bl_number),["A","C"]);
  c.selectDocumentBatchAll(true);assert.equal(c.state().selected.size,2);c.closeDocumentBatch();
 }
});
test("missing page count focuses the input without making a preview request",async()=>{
 const {context:c,element}=ui();c.openDocumentBatch("receipt",0);
 let focused=false;element("batchPages0").focus=()=>{focused=true;};
 await c.previewDocumentBatch();assert.equal(focused,true);assert.match(element("docBatchMessage").textContent,/페이지/);
});

test("per-B/L pages survive search and are sent with their own B/L",()=>{
 const {context:c,element,cards}=ui();c.openDocumentBatch("receipt");element("docBatchShipper").value=cards[0].consignee;c.selectDocumentBatchAll(true);
 [9,10,12].forEach((pages,index)=>c.setDocumentBatchPages(index,String(pages)));
 element("docBatchSearch").value="B";c.renderDocumentBatch();
 assert.deepEqual(Array.from(c.documentBatchPayload().items,item=>[item.bl_number,item.total_pages]),[["A","9"],["B","10"],["C","12"]]);
});
