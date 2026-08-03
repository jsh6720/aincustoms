alter table public.cargo_card_user_inputs
  add column if not exists docs_delivered_samhyeon_at timestamptz,
  add column if not exists docs_delivered_warehouse_at timestamptz;
