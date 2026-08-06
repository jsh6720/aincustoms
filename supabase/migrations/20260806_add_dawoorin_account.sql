create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
declare
  v_id uuid;
begin
  select id
    into v_id
  from public.shipper_accounts
  where lower(login_id) = lower('DWR')
  order by updated_at desc nulls last
  limit 1;

  if v_id is null then
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
      'DWR',
      extensions.crypt('dwr1234', extensions.gen_salt('bf')),
      '다우린',
      '다우린',
      'ocm3800@hyundaicorp.com',
      'shipper',
      'destination',
      true
    );
  else
    update public.shipper_accounts
    set login_id = 'DWR',
        display_name = '다우린',
        consignee_filter = '다우린',
        release_request_to = 'ocm3800@hyundaicorp.com',
        role = 'shipper',
        account_category = 'destination',
        is_active = true,
        updated_at = now()
    where id = v_id;
  end if;
end;
$$;
