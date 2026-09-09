const crypto = require('node:crypto');
const ATTENDEES = ['jsh@aincustoms.com','jhcho@aincustoms.com','bill@aincustoms.com','ain@aincustoms.com'];
function validDate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d || '') && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d;
}
function configured(env = process.env) {
  return ['OUTLOOK_TENANT_ID','OUTLOOK_CLIENT_ID','OUTLOOK_CLIENT_SECRET'].every(k => !!env[k]);
}
function eventPayload(card, request) {
  const d = request.requested_receipt_date;
  if (!validDate(d)) throw new Error('Invalid receipt date');
  return {
    subject: '[원본서류 도착/수령 요청] ' + card.consignee + ' / ' + card.bl_number,
    start: {dateTime:d+'T09:00:00',timeZone:'Korea Standard Time'},
    end: {dateTime:d+'T09:30:00',timeZone:'Korea Standard Time'},
    showAs:'free',isReminderOn:true,reminderMinutesBeforeStart:15,
    attendees:ATTENDEES.map(address=>({emailAddress:{address},type:'required'})),
    body:{contentType:'Text',content:[
      'OBL 및 H/C(위생증, 검역증) 원본서류 수령 요청입니다.','',
      '화주: '+card.consignee,'B/L: '+card.bl_number,
      '납품처: '+String(card.destination||'').split(/[_*]/)[0],
      '수령요청일: '+d,'요청담당자: '+(request.requester_name||'-'),
      '요청인 메일: '+(request.requester_email||'-'),'요청사항: '+(request.memo||'없음'),
    ].join('\n')},
  };
}
async function queueCalendar(db,card,request) {
  const payload=eventPayload(card,request);
  // Linked accounts share one shipment event.
  const key=crypto.createHash('sha256').update(String(card.consignee).trim()+'\0'+String(card.bl_number).trim().toUpperCase()).digest('hex');
  await db('/rest/v1/rpc/cargo_queue_receipt_calendar',{method:'POST',body:JSON.stringify({
    p_key:key,p_payload:payload,p_requested_at:request.created_at||new Date().toISOString(),
  })});
  return key;
}
async function syncCalendar(db,{key=null,env=process.env,fetcher=fetch}={}) {
  if (!configured(env)) return {status:'connection_required'};
  const auth=await fetcher('https://login.microsoftonline.com/'+encodeURIComponent(env.OUTLOOK_TENANT_ID)+'/oauth2/v2.0/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:env.OUTLOOK_CLIENT_ID,client_secret:env.OUTLOOK_CLIENT_SECRET,scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'}),
    signal:AbortSignal.timeout(10000),
  });
  if (!auth.ok) throw new Error('Microsoft token HTTP '+auth.status);
  const {access_token:token}=await auth.json();
  if (!token) throw new Error('Microsoft token missing');
  const rows=await db('/rest/v1/rpc/cargo_claim_receipt_calendar',{method:'POST',body:JSON.stringify({p_key:key})});
  if (!rows?.length) return {status:'unchanged'};
  const row=rows[0];
  try {
    const base='https://graph.microsoft.com/v1.0/users/'+encodeURIComponent(row.mailbox)+'/events';
    const response=await fetcher(row.event_id?base+'/'+encodeURIComponent(row.event_id):base,{
      method:row.event_id?'PATCH':'POST',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Prefer:'IdType="ImmutableId"'},
      body:JSON.stringify(row.event_id?row.payload:{...(row.create_payload || row.payload),transactionId:row.transaction_id}),
      signal:AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Microsoft calendar HTTP '+response.status);
    const event=await response.json();
    if (!event.id) throw new Error('Microsoft event ID missing');
    // A retried POST may return the first version; apply the latest desired date.
    if (!row.event_id && row.create_payload && JSON.stringify(row.create_payload) !== JSON.stringify(row.payload)) {
      const update = await fetcher(base+'/'+encodeURIComponent(event.id),{
        method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Prefer:'IdType="ImmutableId"'},
        body:JSON.stringify(row.payload),signal:AbortSignal.timeout(15000),
      });
      if (!update.ok) throw new Error('Microsoft calendar HTTP '+update.status);
    }
    await db('/rest/v1/rpc/cargo_finish_receipt_calendar',{method:'POST',body:JSON.stringify({p_key:row.shipment_key,p_lease:row.lease_token,p_event_id:event.id,p_error:null})});
    return {status:'synced'};
  } catch(error) {
    await db('/rest/v1/rpc/cargo_finish_receipt_calendar',{method:'POST',body:JSON.stringify({p_key:row.shipment_key,p_lease:row.lease_token,p_event_id:null,p_error:/^Microsoft /.test(error.message)?error.message:'Calendar synchronization failed'})});
    return {status:'pending'};
  }
}
module.exports={ATTENDEES,validDate,configured,eventPayload,queueCalendar,syncCalendar};
