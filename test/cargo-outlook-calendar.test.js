const {test} = require('node:test');
const assert = require('node:assert/strict');
const {eventPayload,validDate,queueCalendar,syncCalendar} = require('../lib/cargo-outlook-calendar');
const {authorizedCron} = require('../lib/cargo-calendar-cron');
const card={consignee:'현대코퍼레이션H',bl_number:'ONEYSYDG03114800',destination:'캐틀팜_우육_호주'};
const request={requested_receipt_date:'2026-09-09',requester_name:'담당자',created_at:'2026-09-08T01:15:00Z'};
const env={OUTLOOK_TENANT_ID:'tenant',OUTLOOK_CLIENT_ID:'id',OUTLOOK_CLIENT_SECRET:'secret'};
test('receipt date uses 09:00 Korea time and four attendees',()=>{
  const p=eventPayload(card,request);
  assert.equal(p.start.dateTime,'2026-09-09T09:00:00');
  assert.equal(p.end.dateTime,'2026-09-09T09:30:00');
  assert.equal(p.start.timeZone,'Korea Standard Time');
  assert.equal(p.attendees.length,4);
  assert.match(p.body.content,/납품처: 캐틀팜\n/);
  assert.equal(validDate('2026-02-30'),false);
  assert.throws(()=>eventPayload(card,{requested_receipt_date:'2026-13-01'}));
});
test('linked accounts and date changes retain shipment key',async()=>{
  const db=async()=>null;
  assert.equal(await queueCalendar(db,card,request),await queueCalendar(db,card,{...request,account_id:'other',requested_receipt_date:'2026-09-10'}));
});
test('unconfigured Graph does not consume pending work',async()=>{
  assert.deepEqual(await syncCalendar(()=>{throw Error('must not claim');},{env:{}}),{status:'connection_required'});
});
test('new events have stable transaction ID, existing events PATCH',async()=>{
  for (const event_id of [null,'existing']) {
    const calls=[];
    const row={shipment_key:'key',mailbox:'jsh@aincustoms.com',event_id,transaction_id:'stable',lease_token:'lease',payload:eventPayload(card,request)};
    const db=async(path,opts)=>{calls.push({path,body:JSON.parse(opts.body)});return path.includes('claim')?[row]:null;};
    let eventCall;
    const fetcher=async(url,opts)=>{
      if(url.includes('oauth2')) return {ok:true,json:async()=>({access_token:'token'})};
      eventCall={url,opts};
      return {ok:true,json:async()=>({id:'saved'})};
    };
    assert.equal((await syncCalendar(db,{env,fetcher})).status,'synced');
    assert.equal(eventCall.opts.method,event_id?'PATCH':'POST');
    assert.equal(JSON.parse(eventCall.opts.body).transactionId,event_id?undefined:'stable');
    assert.equal(calls.at(-1).body.p_event_id,'saved');
  }
});
test('Graph failure records retry, not success',async()=>{
  const calls=[];
  const db=async(p,o)=>{calls.push(JSON.parse(o.body));return p.includes('claim')?[{shipment_key:'key',mailbox:'jsh@aincustoms.com',transaction_id:'stable',lease_token:'lease',payload:{}}]:null;};
  const fetcher=async(url)=>url.includes('oauth2')?{ok:true,json:async()=>({access_token:'t'})}:{ok:false,status:503};
  assert.equal((await syncCalendar(db,{env,fetcher})).status,'pending');
  assert.equal(calls.at(-1).p_event_id,null);
  assert.equal(calls.at(-1).p_error,'Microsoft calendar HTTP 503');
});
test('cron requires configured matching secret',()=>{
  assert.equal(authorizedCron({headers:{}},{}),false);
  assert.equal(authorizedCron({headers:{authorization:'Bearer wrong'}},{CRON_SECRET:'right'}),false);
  assert.equal(authorizedCron({headers:{authorization:'Bearer right'}},{CRON_SECRET:'right'}),true);
});
test('ambiguous create retry applies latest date to the same event',async()=>{
  const old=eventPayload(card,request);
  const latest=eventPayload(card,{...request,requested_receipt_date:'2026-09-10'});
  const row={shipment_key:'key',mailbox:'jsh@aincustoms.com',transaction_id:'stable',lease_token:'lease',payload:latest,create_payload:old};
  const calls=[];
  const db=async(p)=>p.includes('claim')?[row]:null;
  const fetcher=async(url,o)=>{
    if(url.includes('oauth2')) return {ok:true,json:async()=>({access_token:'t'})};
    calls.push({url,body:JSON.parse(o.body),method:o.method});
    return {ok:true,json:async()=>({id:'same-event'})};
  };
  assert.equal((await syncCalendar(db,{env,fetcher})).status,'synced');
  assert.equal(calls[0].method,'POST');
  assert.equal(calls[0].body.start.dateTime,'2026-09-09T09:00:00');
  assert.equal(calls[1].method,'PATCH');
  assert.match(calls[1].url,/same-event$/);
  assert.equal(calls[1].body.start.dateTime,'2026-09-10T09:00:00');
});
