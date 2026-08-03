create table if not exists public.cargo_status_notifications (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null
    check (event_type in ('import_progress_started')),
  account_id uuid not null
    references public.shipper_accounts(id) on delete cascade,
  bl_number text not null,
  detected_status text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),
  card_snapshot jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cargo_status_notifications_retry_idx
  on public.cargo_status_notifications (status, created_at)
  where status in ('pending', 'failed');

create or replace function public.touch_cargo_status_notification_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cargo_status_notifications_touch_updated_at
  on public.cargo_status_notifications;
create trigger cargo_status_notifications_touch_updated_at
before update on public.cargo_status_notifications
for each row execute function public.touch_cargo_status_notification_updated_at();

alter table public.cargo_status_notifications enable row level security;

revoke all on table public.cargo_status_notifications from anon, authenticated;
grant all on table public.cargo_status_notifications to service_role;

-- Baseline cards already in progress at rollout so historical mail is not sent.
-- New HCH cards first observed in progress after this migration remain eligible.
insert into public.cargo_status_notifications (
  event_key,
  event_type,
  account_id,
  bl_number,
  detected_status,
  status,
  card_snapshot,
  sent_at,
  error_message
)
select
  'hch:import_progress_started:' || upper(regexp_replace(c.bl_number, '\s+', '', 'g')),
  'import_progress_started',
  c.account_id,
  upper(regexp_replace(c.bl_number, '\s+', '', 'g')),
  c.prgs_stts,
  'sent',
  jsonb_build_object('rollout_baseline', true),
  now(),
  'rollout baseline: historical mail suppressed'
from public.cargo_cards c
join public.shipper_accounts a on a.id = c.account_id
where upper(trim(a.login_id)) = 'HCH'
  and c.prgs_stts in ('수입신고', '수입(사용소비) 심사진행')
  and nullif(trim(c.bl_number), '') is not null
on conflict (event_key) do nothing;
