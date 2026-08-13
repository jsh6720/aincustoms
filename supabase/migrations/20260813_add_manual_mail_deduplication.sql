alter table public.cargo_status_notifications
  drop constraint if exists cargo_status_notifications_event_type_check;

alter table public.cargo_status_notifications
  add constraint cargo_status_notifications_event_type_check
  check (event_type in (
    'import_progress_started',
    'warehouse_arrival_eve',
    'warehouse_arrival_today',
    'manual_mail'
  ));

create or replace function public.claim_cargo_manual_mail(
  p_event_key text,
  p_account_id uuid,
  p_bl_number text,
  p_detected_status text,
  p_card_snapshot jsonb default '{}'::jsonb
)
returns table (id uuid, claimed boolean, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.cargo_status_notifications%rowtype;
begin
  insert into public.cargo_status_notifications (
    event_key, event_type, account_id, bl_number, detected_status,
    status, card_snapshot, attempt_count, last_attempt_at
  ) values (
    p_event_key, 'manual_mail', p_account_id, p_bl_number, p_detected_status,
    'pending', coalesce(p_card_snapshot, '{}'::jsonb), 1, now()
  )
  on conflict (event_key) do nothing
  returning * into v_event;

  if v_event.id is not null then
    return query select v_event.id, true, v_event.status;
    return;
  end if;

  select * into v_event
  from public.cargo_status_notifications n
  where n.event_key = p_event_key
  for update;

  if v_event.status = 'failed' then
    update public.cargo_status_notifications n
    set status = 'pending',
        attempt_count = n.attempt_count + 1,
        last_attempt_at = now(),
        error_message = null,
        card_snapshot = coalesce(p_card_snapshot, n.card_snapshot)
    where n.id = v_event.id
    returning * into v_event;
    return query select v_event.id, true, v_event.status;
    return;
  end if;

  return query select v_event.id, false, v_event.status;
end;
$$;

revoke all on function public.claim_cargo_manual_mail(text, uuid, text, text, jsonb) from public;
grant execute on function public.claim_cargo_manual_mail(text, uuid, text, text, jsonb) to service_role;

