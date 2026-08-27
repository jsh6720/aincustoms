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

create table if not exists public.cargo_login_rate_limits (
  client_key text primary key,
  failure_count integer not null default 0,
  window_started_at timestamptz not null default pg_catalog.now(),
  locked_until timestamptz,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint cargo_login_rate_limits_client_key_check
    check (client_key ~ '^[0-9a-f]{64}$'),
  constraint cargo_login_rate_limits_failure_count_check
    check (failure_count >= 0)
);

alter table public.cargo_login_rate_limits enable row level security;
revoke all on table public.cargo_login_rate_limits
  from public, anon, authenticated;
grant select, insert, update, delete on table public.cargo_login_rate_limits
  to service_role;

drop function if exists public.verify_shipper_login_guarded(text, text, text);
create function public.verify_shipper_login_guarded(
  p_login_id text,
  p_password text,
  p_client_key text
)
returns table (
  id uuid,
  login_id text,
  display_name text,
  consignee_filter text,
  release_request_to text,
  role text,
  calendar_preferences jsonb,
  account_category text,
  login_allowed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_client_key text := pg_catalog.lower(pg_catalog.btrim(p_client_key));
  v_account public.shipper_accounts%rowtype;
  v_rate public.cargo_login_rate_limits%rowtype;
  v_compare_hash text;
  v_password_matches boolean := false;
  v_failure_count integer;
  v_window_started_at timestamptz;
  v_locked_until timestamptz;
begin
  if v_client_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid login client key';
  end if;

  insert into public.cargo_login_rate_limits as r (
    client_key,
    failure_count,
    window_started_at,
    locked_until,
    updated_at
  )
  values (v_client_key, 0, v_now, null, v_now)
  on conflict (client_key) do nothing;

  select r.*
  into v_rate
  from public.cargo_login_rate_limits as r
  where r.client_key = v_client_key
  for update;

  select a.*
  into v_account
  from public.shipper_accounts as a
  where pg_catalog.lower(a.login_id) = pg_catalog.lower(pg_catalog.btrim(p_login_id))
  order by a.updated_at desc nulls last, a.id
  limit 1
  for update;

  if v_account.password_hash is null then
    v_compare_hash := extensions.crypt(
      pg_catalog.gen_random_uuid()::text,
      extensions.gen_salt('bf', 10)
    );
  else
    v_compare_hash := v_account.password_hash;
  end if;
  v_password_matches := (
    extensions.crypt(coalesce(p_password, ''), v_compare_hash) = v_compare_hash
    and v_account.id is not null
    and v_account.is_active = true
  );

  if v_rate.locked_until is not null and v_rate.locked_until > v_now then
    return query
    select
      null::uuid,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      null::pg_catalog.jsonb,
      null::text,
      false;
    return;
  end if;

  if v_password_matches then
    update public.cargo_login_rate_limits as r
    set
      failure_count = 0,
      window_started_at = v_now,
      locked_until = null,
      updated_at = v_now
    where r.client_key = v_client_key;

    return query
    select
      v_account.id,
      v_account.login_id,
      v_account.display_name,
      v_account.consignee_filter,
      v_account.release_request_to,
      v_account.role,
      v_account.calendar_preferences,
      v_account.account_category,
      true;
    return;
  end if;

  if v_rate.window_started_at < v_now - interval '15 minutes' then
    v_failure_count := 1;
    v_window_started_at := v_now;
  else
    v_failure_count := v_rate.failure_count + 1;
    v_window_started_at := v_rate.window_started_at;
  end if;
  v_locked_until := case
    when v_failure_count >= 5 then v_now + interval '15 minutes'
    else null
  end;

  update public.cargo_login_rate_limits as r
  set
    failure_count = v_failure_count,
    window_started_at = v_window_started_at,
    locked_until = v_locked_until,
    updated_at = v_now
  where r.client_key = v_client_key;

  return query
  select
    null::uuid,
    null::text,
    null::text,
    null::text,
    null::text,
    null::text,
    null::pg_catalog.jsonb,
    null::text,
    false;
end;
$$;

revoke all on function public.verify_shipper_login_guarded(text, text, text)
  from public, anon, authenticated;
grant execute on function public.verify_shipper_login_guarded(text, text, text)
  to service_role;

-- Close execute privileges that were inherited from legacy migrations.
-- Existing function bodies already schema-qualify protected tables, so fixing
-- the search path does not change their business behavior.
alter function public.admin_upsert_shipper_account(
  uuid, text, text, text, text, text, boolean, text, text
) set search_path = '';
revoke all on function public.admin_upsert_shipper_account(
  uuid, text, text, text, text, text, boolean, text, text
) from public, anon, authenticated;
grant execute on function public.admin_upsert_shipper_account(
  uuid, text, text, text, text, text, boolean, text, text
) to service_role;

alter function public.verify_shipper_login(text, text)
  set search_path = '';
revoke all on function public.verify_shipper_login(text, text)
  from public, anon, authenticated;
grant execute on function public.verify_shipper_login(text, text)
  to service_role;

alter function public.touch_cargo_card_lifecycle_updated_at()
  set search_path = '';
revoke all on function public.touch_cargo_card_lifecycle_updated_at()
  from public, anon, authenticated;

alter function public.rls_auto_enable()
  set search_path = 'pg_catalog';
revoke all on function public.rls_auto_enable()
  from public, anon, authenticated;

alter function public.touch_updated_at()
  set search_path = '';
revoke all on function public.touch_updated_at()
  from public, anon, authenticated;

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
