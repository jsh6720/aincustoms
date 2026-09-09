const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const real=require('../lib/cargo-outlook-calendar');
test('only confirmed mail delivery queues a calendar event',async()=>{
  for(const delivery of [{sent:true},{deduplicated:true,status:'sent'},{deduplicated:true,status:'pending'},{sent:false},{deduplicated:true,status:'delivery_uncertain',deliveryUncertain:true}]) {
    let queued=0;
    const session={account_id:'account',role:'shipper'};
    const db=async(p)=>p.includes('shipper_accounts')?[{}]:p.includes('cargo_cards')?[{bl_number:'TEST',consignee:'Test',obl_received:false}]:[{id:'request',created_at:'2026-09-09T00:00:00Z'}];
    const context={
      module:{exports:{}},process:{env:{SMTP_HOST:'test',SMTP_USER:'test',SMTP_PASS:'test'}},console,
      require:(name)=>{
        if(name==='nodemailer') return {createTransport:()=>({sendMail:async()=>({})})};
        if(name.endsWith('cargo-auth')) return {requireWritableSession:()=>session,supabaseFetch:db};
        if(name.endsWith('cargo-mail-utils')) return {mailTextToHtml:x=>x};
        if(name.endsWith('cargo-mail-settings')) return {fetchEffectiveRoleMailSettings:async()=>({}),resolveRoleMailRecipients:()=>({to:['test@example.com'],cc:[]})};
        if(name.endsWith('cargo-mail-dedupe')) return {deliverManualMailOnce:async()=>delivery};
        if(name.endsWith('cargo-outlook-calendar')) return {validDate:real.validDate,queueCalendar:async()=>{queued++;return 'key';},syncCalendar:async()=>({status:'synced'})};
        throw Error(name);
      },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../api/cargo-original-doc-request.js'),'utf8'),context);
    let result;
    const res={status(){return this;},json(data){result=data;}};
    await context.module.exports({method:'POST',body:{bl_number:'TEST',requester_name:'Test',requested_receipt_date:'2026-09-10'}},res);
    assert.equal(result.success,true);
    assert.equal(queued,delivery.sent || delivery.status==='sent'?1:0);
  }
});
