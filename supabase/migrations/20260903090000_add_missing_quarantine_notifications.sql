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
    'quarantine_declaration_missing',
    'manual_mail'
  ));

update public.cargo_card_user_inputs
set animal_quarantine_override = null,
    updated_at = pg_catalog.now()
where animal_quarantine_override = 'O';

update public.cargo_card_user_inputs
set food_quarantine_override = null,
    updated_at = pg_catalog.now()
where food_quarantine_override = 'O';

insert into public.cargo_system_metadata as m (
  component,
  schema_version,
  migration_name,
  updated_at
)
values (
  'cargo_dashboard',
  '20260903090000',
  '20260903090000_add_missing_quarantine_notifications.sql',
  pg_catalog.now()
)
on conflict (component) do update
set
  schema_version = excluded.schema_version,
  migration_name = excluded.migration_name,
  updated_at = excluded.updated_at;

commit;
