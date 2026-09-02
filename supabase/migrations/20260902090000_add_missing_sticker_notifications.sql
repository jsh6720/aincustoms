begin;

alter table public.cargo_status_notifications
  drop constraint if exists cargo_status_notifications_event_type_check;

alter table public.cargo_status_notifications
  add constraint cargo_status_notifications_event_type_check
  check (event_type in (
    'import_progress_started',
    'warehouse_arrival_eve',
    'warehouse_arrival_today',
    'warehouse_plan_missing',
    'sticker_action_missing',
    'manual_mail'
  ));

insert into public.cargo_system_metadata as m (
  component,
  schema_version,
  migration_name,
  updated_at
)
values (
  'cargo_dashboard',
  '20260902090000',
  '20260902090000_add_missing_sticker_notifications.sql',
  pg_catalog.now()
)
on conflict (component) do update
set
  schema_version = excluded.schema_version,
  migration_name = excluded.migration_name,
  updated_at = excluded.updated_at;

commit;
