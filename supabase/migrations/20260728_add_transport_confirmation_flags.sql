alter table public.cargo_card_user_inputs
  add column if not exists eta_date_confirmed boolean not null default false,
  add column if not exists storage_yard_confirmed boolean not null default false,
  add column if not exists warehouse_expected_date_confirmed boolean not null default false;
