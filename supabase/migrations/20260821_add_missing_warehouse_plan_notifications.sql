alter table public.cargo_status_notifications
  drop constraint if exists cargo_status_notifications_event_type_check;

alter table public.cargo_status_notifications
  add constraint cargo_status_notifications_event_type_check
  check (event_type in (
    'import_progress_started',
    'warehouse_arrival_eve',
    'warehouse_arrival_today',
    'warehouse_plan_missing',
    'manual_mail'
  ));
