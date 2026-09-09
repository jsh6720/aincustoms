begin;
create table if not exists public.cargo_receipt_calendar (
  shipment_key text primary key,
  mailbox text not null default 'jsh@aincustoms.com',
  payload jsonb not null,
  create_payload jsonb,
  requested_at timestamptz not null,
  transaction_id uuid not null default gen_random_uuid(),
  event_id text,
  status text not null default 'pending' check(status in ('pending','synced')),
  lease_token uuid,
  lease_until timestamptz,
  lease_payload jsonb,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.cargo_receipt_calendar enable row level security;
revoke all on public.cargo_receipt_calendar from public,anon,authenticated;
grant select,insert,update on public.cargo_receipt_calendar to service_role;

create or replace function public.cargo_queue_receipt_calendar(p_key text,p_payload jsonb,p_requested_at timestamptz)
returns void language sql security invoker set search_path=public as $$
 insert into public.cargo_receipt_calendar(shipment_key,payload,requested_at)
 values(p_key,p_payload,p_requested_at)
 on conflict(shipment_key) do update
 set payload=excluded.payload,requested_at=excluded.requested_at,
     status=case when cargo_receipt_calendar.payload=excluded.payload then cargo_receipt_calendar.status else 'pending' end,
     updated_at=now()
 where excluded.requested_at>=cargo_receipt_calendar.requested_at;
$$;

create or replace function public.cargo_claim_receipt_calendar(p_key text default null)
returns setof public.cargo_receipt_calendar language sql security invoker set search_path=public as $$
 update public.cargo_receipt_calendar c set
 lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',
 lease_payload=c.payload,create_payload=coalesce(c.create_payload,c.payload),updated_at=now()
 where c.shipment_key in (
   select shipment_key from public.cargo_receipt_calendar
   where status='pending' and (p_key is null or shipment_key=p_key)
     and (lease_until is null or lease_until<now())
   order by updated_at for update skip locked limit 1
 )
 returning c.*;
$$;

create or replace function public.cargo_finish_receipt_calendar(p_key text,p_lease uuid,p_event_id text,p_error text)
returns void language sql security invoker set search_path=public as $$
 update public.cargo_receipt_calendar set
 event_id=coalesce(p_event_id,event_id),
 status=case when p_error is null and payload=lease_payload then 'synced' else 'pending' end,
 last_error=p_error,lease_token=null,
 lease_until=case when p_error is null then null else now()+interval '5 minutes' end,
 updated_at=now()
 where shipment_key=p_key and lease_token=p_lease;
$$;
revoke all on function public.cargo_queue_receipt_calendar(text,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.cargo_claim_receipt_calendar(text) from public,anon,authenticated;
revoke all on function public.cargo_finish_receipt_calendar(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.cargo_queue_receipt_calendar(text,jsonb,timestamptz) to service_role;
grant execute on function public.cargo_claim_receipt_calendar(text) to service_role;
grant execute on function public.cargo_finish_receipt_calendar(text,uuid,text,text) to service_role;
commit;
