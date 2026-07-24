alter table public.shipper_accounts
  add column if not exists calendar_preferences jsonb not null
  default '{"import_request": true, "warehouse_expected": true}'::jsonb;

alter table public.shipper_accounts
  alter column calendar_preferences
  set default '{"import_request": true, "warehouse_expected": true}'::jsonb;

update public.shipper_accounts
set calendar_preferences = '{"import_request": true, "warehouse_expected": true}'::jsonb
where calendar_preferences is null;

alter table public.shipper_accounts
  alter column calendar_preferences set not null;

drop function if exists public.verify_shipper_login(text, text);

create function public.verify_shipper_login(p_login_id text, p_password text)
returns table (
  id uuid,
  login_id text,
  display_name text,
  consignee_filter text,
  release_request_to text,
  role text,
  calendar_preferences jsonb
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
    a.calendar_preferences
  from public.shipper_accounts a
  where lower(a.login_id) = lower(trim(p_login_id))
    and a.is_active = true
    and a.password_hash = extensions.crypt(p_password, a.password_hash);
$$;

revoke all on function public.verify_shipper_login(text, text) from public;
grant execute on function public.verify_shipper_login(text, text) to service_role;

update public.shipper_accounts
set login_id = 'CTF',
    password_hash = extensions.crypt('ctf1234', extensions.gen_salt('bf')),
    display_name = '캐틀팜',
    consignee_filter = '캐틀팜',
    role = 'shipper',
    is_active = true,
    updated_at = now()
where lower(login_id) = lower('CTF');

insert into public.shipper_accounts (
  login_id,
  password_hash,
  display_name,
  consignee_filter,
  role,
  is_active
)
select
  'CTF',
  extensions.crypt('ctf1234', extensions.gen_salt('bf')),
  '캐틀팜',
  '캐틀팜',
  'shipper',
  true
where not exists (
  select 1
  from public.shipper_accounts
  where lower(login_id) = lower('CTF')
)
on conflict (login_id) do update
set password_hash = excluded.password_hash,
    display_name = excluded.display_name,
    consignee_filter = excluded.consignee_filter,
    role = excluded.role,
    is_active = excluded.is_active,
    updated_at = now();
