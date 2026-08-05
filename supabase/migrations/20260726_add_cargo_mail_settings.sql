create table if not exists public.cargo_mail_settings (
  setting_key text primary key,
  to_recipients text not null default '',
  cc_recipients text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint cargo_mail_settings_key_check check (
    setting_key in (
      'original_doc_request',
      'import_request',
      'release_request',
      'warehouse_change',
      'arrival_schedule_change',
      'original_doc_receipt',
      'obl_carrier_receipt'
    )
  )
);

-- Older installations used a constraint that did not include
-- arrival_schedule_change. Replacing only the constraint preserves every
-- saved recipient row and makes this migration safe to run again.
alter table public.cargo_mail_settings
  drop constraint if exists cargo_mail_settings_key_check;

alter table public.cargo_mail_settings
  add constraint cargo_mail_settings_key_check check (
    setting_key in (
      'original_doc_request',
      'import_request',
      'release_request',
      'warehouse_change',
      'arrival_schedule_change',
      'original_doc_receipt',
      'obl_carrier_receipt'
    )
  );

alter table public.cargo_mail_settings enable row level security;

revoke all on table public.cargo_mail_settings from anon, authenticated;
grant all on table public.cargo_mail_settings to service_role;

insert into public.cargo_mail_settings (setting_key)
values
  ('original_doc_request'),
  ('import_request'),
  ('release_request'),
  ('warehouse_change'),
  ('arrival_schedule_change'),
  ('original_doc_receipt'),
  ('obl_carrier_receipt')
on conflict (setting_key) do nothing;
