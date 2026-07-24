alter table public.cargo_card_user_inputs
  add column if not exists free_time_expiry_override date,
  add column if not exists sticker_requested boolean not null default false,
  add column if not exists obl_carrier_submitted boolean not null default false,
  add column if not exists obl_carrier_submitted_date date,
  add column if not exists obl_carrier_submitted_by text,
  add column if not exists obl_carrier_submitted_at timestamptz;

update public.cargo_card_user_inputs
set free_time_days = 3
where free_time_days is distinct from 3;

alter table public.cargo_card_user_inputs
  alter column free_time_days set default 3;

alter table public.cargo_card_user_inputs
  drop constraint if exists cargo_card_user_inputs_animal_quarantine_override_check;

alter table public.cargo_card_user_inputs
  add constraint cargo_card_user_inputs_animal_quarantine_override_check
  check (animal_quarantine_override is null or animal_quarantine_override in ('O', '△', 'X'));

alter table public.cargo_card_user_inputs
  drop constraint if exists cargo_card_user_inputs_food_quarantine_override_check;

alter table public.cargo_card_user_inputs
  add constraint cargo_card_user_inputs_food_quarantine_override_check
  check (food_quarantine_override is null or food_quarantine_override in ('O', '△', 'X'));

create table if not exists public.cargo_card_lifecycle (
  account_id uuid not null references public.shipper_accounts(id) on delete cascade,
  bl_number text not null,
  source_missing boolean not null default false,
  source_missing_at timestamptz,
  permanently_excluded boolean not null default false,
  permanently_excluded_at timestamptz,
  permanently_excluded_by text,
  restored_at timestamptz,
  restored_by text,
  updated_at timestamptz not null default now(),
  primary key (account_id, bl_number)
);

create index if not exists cargo_card_lifecycle_missing_idx
  on public.cargo_card_lifecycle (source_missing, permanently_excluded);

alter table public.cargo_card_lifecycle enable row level security;

drop policy if exists "deny anonymous cargo lifecycle reads" on public.cargo_card_lifecycle;
create policy "deny anonymous cargo lifecycle reads"
on public.cargo_card_lifecycle
for select
to anon
using (false);

create or replace function public.touch_cargo_card_lifecycle_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cargo_card_lifecycle_touch_updated_at on public.cargo_card_lifecycle;
create trigger cargo_card_lifecycle_touch_updated_at
before update on public.cargo_card_lifecycle
for each row execute function public.touch_cargo_card_lifecycle_updated_at();
