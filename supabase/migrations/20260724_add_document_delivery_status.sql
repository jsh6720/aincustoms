alter table public.cargo_card_user_inputs
  add column if not exists docs_delivered_samhyeon boolean not null default false,
  add column if not exists docs_delivered_warehouse boolean not null default false;

alter table public.shipper_accounts
  add column if not exists account_category text not null default 'shipper';

alter table public.shipper_accounts
  drop constraint if exists shipper_accounts_account_category_check;

alter table public.shipper_accounts
  add constraint shipper_accounts_account_category_check
  check (account_category in ('shipper', 'destination'));

update public.shipper_accounts
set account_category = 'shipper'
where account_category is null
   or account_category not in ('shipper', 'destination');

update public.shipper_accounts
set account_category = 'destination',
    updated_at = now()
where lower(login_id) = lower('CTF');

drop function if exists public.verify_shipper_login(text, text);

create function public.verify_shipper_login(p_login_id text, p_password text)
returns table (
  id uuid,
  login_id text,
  display_name text,
  consignee_filter text,
  release_request_to text,
  role text,
  calendar_preferences jsonb,
  account_category text
)
language sql
security definer
set search_path = public
as $$
  select
    a.id,
    a.login_id,
    a.display_name,
    a.consignee_filter,
    a.release_request_to,
    a.role,
    a.calendar_preferences,
    a.account_category
  from public.shipper_accounts a
  where lower(a.login_id) = lower(trim(p_login_id))
    and a.is_active = true
    and a.password_hash = extensions.crypt(p_password, a.password_hash);
$$;

revoke all on function public.verify_shipper_login(text, text) from public;
grant execute on function public.verify_shipper_login(text, text) to service_role;

drop function if exists public.admin_upsert_shipper_account(
  uuid, text, text, text, text, text, boolean, text
);

drop function if exists public.admin_upsert_shipper_account(
  uuid, text, text, text, text, text, boolean, text, text
);

create function public.admin_upsert_shipper_account(
  p_id uuid,
  p_login_id text,
  p_password text,
  p_display_name text,
  p_consignee_filter text,
  p_release_request_to text,
  p_is_active boolean,
  p_role text default 'shipper',
  p_account_category text default 'shipper'
)
returns table (
  id uuid,
  login_id text,
  display_name text,
  consignee_filter text,
  release_request_to text,
  role text,
  account_category text,
  calendar_preferences jsonb,
  is_active boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_role text := case when p_role in ('admin', 'viewer') then p_role else 'shipper' end;
  v_account_category text := case
    when p_account_category = 'destination' then 'destination'
    else 'shipper'
  end;
begin
  if nullif(trim(p_login_id), '') is null then
    raise exception 'login_id is required';
  end if;

  if p_id is null then
    if nullif(p_password, '') is null then
      raise exception 'password is required for a new account';
    end if;

    insert into public.shipper_accounts (
      login_id,
      password_hash,
      display_name,
      consignee_filter,
      release_request_to,
      role,
      account_category,
      is_active
    )
    values (
      trim(p_login_id),
      extensions.crypt(p_password, extensions.gen_salt('bf')),
      coalesce(nullif(trim(p_display_name), ''), trim(p_login_id)),
      coalesce(trim(p_consignee_filter), ''),
      nullif(trim(p_release_request_to), ''),
      v_role,
      v_account_category,
      coalesce(p_is_active, true)
    )
    returning shipper_accounts.id into v_id;
  else
    update public.shipper_accounts
    set login_id = trim(p_login_id),
        display_name = coalesce(nullif(trim(p_display_name), ''), trim(p_login_id)),
        consignee_filter = coalesce(trim(p_consignee_filter), ''),
        release_request_to = nullif(trim(p_release_request_to), ''),
        role = v_role,
        account_category = v_account_category,
        is_active = coalesce(p_is_active, true),
        password_hash = case
          when nullif(p_password, '') is null then password_hash
          else extensions.crypt(p_password, extensions.gen_salt('bf'))
        end,
        updated_at = now()
    where shipper_accounts.id = p_id
    returning shipper_accounts.id into v_id;

    if v_id is null then
      raise exception 'account not found';
    end if;
  end if;

  return query
  select
    a.id,
    a.login_id,
    a.display_name,
    a.consignee_filter,
    a.release_request_to,
    a.role,
    a.account_category,
    a.calendar_preferences,
    a.is_active,
    a.updated_at
  from public.shipper_accounts a
  where a.id = v_id;
end;
$$;

revoke all on function public.admin_upsert_shipper_account(
  uuid, text, text, text, text, text, boolean, text, text
) from public;

grant execute on function public.admin_upsert_shipper_account(
  uuid, text, text, text, text, text, boolean, text, text
) to service_role;
