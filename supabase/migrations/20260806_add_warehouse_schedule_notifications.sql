alter table public.cargo_status_notifications
  drop constraint if exists cargo_status_notifications_event_type_check;

alter table public.cargo_status_notifications
  add constraint cargo_status_notifications_event_type_check
  check (
    event_type in (
      'import_progress_started',
      'warehouse_arrival_eve',
      'warehouse_arrival_today'
    )
  );

-- Existing rows and sent history are intentionally preserved. New planned-date
-- events are inserted by the NEWMAIN sync only when their 09:00 KST window opens.
