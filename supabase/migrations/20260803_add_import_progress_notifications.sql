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

