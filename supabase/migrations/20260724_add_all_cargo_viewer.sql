alter table public.shipper_accounts
  drop constraint if exists shipper_accounts_role_check;

alter table public.shipper_accounts
  add constraint shipper_accounts_role_check
  check (role in ('shipper', 'viewer', 'admin'));

drop function if exists public.admin_upsert_shipper_account(uuid, text, text, text, text, text, boolean, text);

create or replace function public.admin_upsert_shipper_account(
  p_id uuid,
  p_login_id text,
  p_password text,
  p_display_name text,
  p_consignee_filter text,
  p_release_request_to text,
  p_is_active boolean,
  p_role text default 'shipper'
)
returns table (
  id uuid,
  login_id text,
  display_name text,
  consignee_filter text,
  release_request_to text,
  role text,
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
      is_active
    )
    values (
      trim(p_login_id),
      extensions.crypt(p_password, extensions.gen_salt('bf')),
      coalesce(nullif(trim(p_display_name), ''), trim(p_login_id)),
      coalesce(trim(p_consignee_filter), ''),
      nullif(trim(p_release_request_to), ''),
      v_role,
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
    a.is_active,
    a.updated_at
  from public.shipper_accounts a
  where a.id = v_id;
end;
$$;

revoke all on function public.admin_upsert_shipper_account(uuid, text, text, text, text, text, boolean, text) from public;
grant execute on function public.admin_upsert_shipper_account(uuid, text, text, text, text, text, boolean, text) to service_role;
