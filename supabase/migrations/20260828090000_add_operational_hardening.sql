begin;

alter table public.cargo_status_notifications
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz;

alter table public.cargo_status_notifications
  drop constraint if exists cargo_status_notifications_status_check;

alter table public.cargo_status_notifications
  add constraint cargo_status_notifications_status_check
  check (
    status in (
      'pending',
      'sending',
      'sent',
      'failed',
      'delivery_uncertain'
    )
  );

create index if not exists cargo_status_notifications_retry_claim_idx
  on public.cargo_status_notifications (created_at, id)
  where status in ('pending', 'failed');

alter table public.cargo_status_notifications enable row level security;
revoke all on table public.cargo_status_notifications
  from public, anon, authenticated;
grant select, insert, update on table public.cargo_status_notifications
  to service_role;

drop function if exists public.claim_cargo_automatic_mail(uuid, text[]);
create function public.claim_cargo_automatic_mail(
  p_event_id uuid,
  p_allowed_event_types text[]
)
returns table (
  id uuid,
  claimed boolean,
  status text,
  claim_token uuid,
  event_type text,
  card_snapshot jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_claim_token uuid;
  v_claimed_at timestamptz;
  v_event_type text;
  v_card_snapshot jsonb;
begin
  select
    n.id,
    n.status,
    n.claim_token,
    n.claimed_at,
    n.event_type,
    n.card_snapshot
  into
    v_id,
    v_status,
    v_claim_token,
    v_claimed_at,
    v_event_type,
    v_card_snapshot
  from public.cargo_status_notifications as n
  where n.id = p_event_id
  for update;

  if not found then
    return;
  end if;

  if p_allowed_event_types is null
     or not (v_event_type = any(p_allowed_event_types)) then
    return query
    select v_id, false, v_status, v_claim_token, v_event_type, v_card_snapshot;
    return;
  end if;

  if v_status = 'sending'
     and (
       v_claimed_at is null
       or v_claimed_at < pg_catalog.now() - interval '15 minutes'
     ) then
    update public.cargo_status_notifications as n
    set
      status = 'delivery_uncertain',
      error_message = 'stale sending claim requires manual delivery review'
    where n.id = v_id
    returning
      n.status,
      n.claim_token,
      n.event_type,
      n.card_snapshot
    into
      v_status,
      v_claim_token,
      v_event_type,
      v_card_snapshot;

    return query
    select v_id, false, v_status, v_claim_token, v_event_type, v_card_snapshot;
    return;
  end if;

  if v_status in ('pending', 'failed') then
    v_claim_token := pg_catalog.gen_random_uuid();
    update public.cargo_status_notifications as n
    set
      status = 'sending',
      claim_token = v_claim_token,
      claimed_at = pg_catalog.now(),
      attempt_count = n.attempt_count + 1,
      last_attempt_at = pg_catalog.now(),
      error_message = null
    where n.id = v_id
      and n.status in ('pending', 'failed')
    returning
      n.status,
      n.event_type,
      n.card_snapshot
    into
      v_status,
      v_event_type,
      v_card_snapshot;

    return query
    select v_id, true, v_status, v_claim_token, v_event_type, v_card_snapshot;
    return;
  end if;

  return query
  select v_id, false, v_status, v_claim_token, v_event_type, v_card_snapshot;
end;
$$;

revoke all on function public.claim_cargo_automatic_mail(uuid, text[])
  from public, anon, authenticated;
grant execute on function public.claim_cargo_automatic_mail(uuid, text[])
  to service_role;

drop function if exists public.claim_cargo_manual_mail(text, uuid, text, text, jsonb);
create function public.claim_cargo_manual_mail(
  p_event_key text,
  p_account_id uuid,
  p_bl_number text,
  p_detected_status text,
  p_card_snapshot jsonb
)
returns table (
  id uuid,
  claimed boolean,
  status text,
  claim_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_claim_token uuid := pg_catalog.gen_random_uuid();
  v_claimed_at timestamptz;
  v_account_id uuid;
  v_bl_number text;
begin
  insert into public.cargo_status_notifications as n (
    event_key,
    event_type,
    account_id,
    bl_number,
    detected_status,
    status,
    card_snapshot,
    claim_token,
    claimed_at,
    attempt_count,
    last_attempt_at
  )
  values (
    p_event_key,
    'manual_mail',
    p_account_id,
    p_bl_number,
    p_detected_status,
    'sending',
    coalesce(p_card_snapshot, '{}'::pg_catalog.jsonb),
    v_claim_token,
    pg_catalog.now(),
    1,
    pg_catalog.now()
  )
  on conflict (event_key) do nothing
  returning n.id, n.status, n.claim_token
  into v_id, v_status, v_claim_token;

  if v_id is not null then
    return query select v_id, true, v_status, v_claim_token;
    return;
  end if;

  select
    n.id,
    n.status,
    n.claim_token,
    n.claimed_at,
    n.account_id,
    n.bl_number
  into
    v_id,
    v_status,
    v_claim_token,
    v_claimed_at,
    v_account_id,
    v_bl_number
  from public.cargo_status_notifications as n
  where n.event_key = p_event_key
  for update;

  if not found then
    return;
  end if;

  if v_account_id <> p_account_id or v_bl_number <> p_bl_number then
    raise exception 'manual mail event identity mismatch';
  end if;

  if v_status = 'sending'
     and (
       v_claimed_at is null
       or v_claimed_at < pg_catalog.now() - interval '15 minutes'
     ) then
    update public.cargo_status_notifications as n
    set
      status = 'delivery_uncertain',
      error_message = 'stale sending claim requires manual delivery review'
    where n.id = v_id
    returning n.status, n.claim_token
    into v_status, v_claim_token;

    return query select v_id, false, v_status, v_claim_token;
    return;
  end if;

  if v_status in ('pending', 'failed') then
    v_claim_token := pg_catalog.gen_random_uuid();
    update public.cargo_status_notifications as n
    set
      status = 'sending',
      claim_token = v_claim_token,
      claimed_at = pg_catalog.now(),
      detected_status = p_detected_status,
      card_snapshot = coalesce(
        p_card_snapshot,
        n.card_snapshot,
        '{}'::pg_catalog.jsonb
      ),
      attempt_count = n.attempt_count + 1,
      last_attempt_at = pg_catalog.now(),
      error_message = null
    where n.id = v_id
      and n.status in ('pending', 'failed')
    returning n.status
    into v_status;

    return query select v_id, true, v_status, v_claim_token;
    return;
  end if;

  return query select v_id, false, v_status, v_claim_token;
end;
$$;

revoke all on function public.claim_cargo_manual_mail(text, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_cargo_manual_mail(text, uuid, text, text, jsonb)
  to service_role;

drop function if exists public.settle_cargo_mail(uuid, uuid, text, text);
create function public.settle_cargo_mail(
  p_event_id uuid,
  p_claim_token uuid,
  p_status text,
  p_error_message text default null
)
returns table (
  id uuid,
  settled boolean,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
begin
  if p_status not in ('sent', 'failed', 'delivery_uncertain') then
    raise exception 'invalid cargo mail settlement status';
  end if;

  update public.cargo_status_notifications as n
  set
    status = p_status,
    sent_at = case
      when p_status = 'sent' then pg_catalog.now()
      else n.sent_at
    end,
    error_message = p_error_message
  where n.id = p_event_id
    and n.claim_token = p_claim_token
    and n.status = 'sending'
  returning n.id, n.status
  into v_id, v_status;

  if v_id is not null then
    return query select v_id, true, v_status;
    return;
  end if;

  select n.id, n.status
  into v_id, v_status
  from public.cargo_status_notifications as n
  where n.id = p_event_id;

  if v_id is not null then
    return query select v_id, false, v_status;
  end if;
end;
$$;

revoke all on function public.settle_cargo_mail(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.settle_cargo_mail(uuid, uuid, text, text)
  to service_role;

create table if not exists public.cargo_system_metadata (
  component text primary key,
  schema_version text not null,
  migration_name text not null,
  updated_at timestamptz not null default pg_catalog.now()
);

alter table public.cargo_system_metadata enable row level security;
revoke all on table public.cargo_system_metadata
  from public, anon, authenticated;
grant select, insert, update on table public.cargo_system_metadata
  to service_role;

insert into public.cargo_system_metadata as m (
  component,
  schema_version,
  migration_name,
  updated_at
)
values (
  'cargo_dashboard',
  '20260828090000',
  '20260828090000_add_operational_hardening.sql',
  pg_catalog.now()
)
on conflict (component) do update
set
  schema_version = excluded.schema_version,
  migration_name = excluded.migration_name,
  updated_at = excluded.updated_at;

commit;
