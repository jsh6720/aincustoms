alter table public.cargo_import_requests
  add column if not exists requested_import_date date;

alter table public.cargo_card_user_inputs
  add column if not exists transport_updated_by_role text,
  add column if not exists transport_updated_by_login text,
  add column if not exists transport_updated_at timestamptz;
