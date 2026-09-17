begin;

-- A stable statement sees one snapshot of the immutable history. Read only
-- bounded metadata before choosing rows; oversized payloads are never fetched
-- merely to discover whether another page exists.
create function public.internal_share_read_page(p_after bigint)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_after is null or p_after < 0 or p_after > 9007199254740991 then
    raise exception using errcode = '22023', message = 'Invalid update cursor';
  end if;

  return (
    with metadata as materialized (
      select u.seq, u.update_bytes
      from public.internal_share_updates as u
      where u.document_id = 'team' and u.seq > p_after
      order by u.seq
      limit 257
    ), budgeted as materialized (
      select m.seq,
        row_number() over (order by m.seq) as row_position,
        sum(4 * ((m.update_bytes + 2) / 3) + 256)
          over (order by m.seq rows between unbounded preceding and current row) as serialized_bytes
      from metadata as m
    ), chosen as materialized (
      select b.seq
      from budgeted as b
      where b.row_position <= 256 and b.serialized_bytes <= 3 * 1024 * 1024
      order by b.seq
    ), page_cursor as (
      select coalesce(max(c.seq), p_after) as cursor
      from chosen as c
    )
    select jsonb_build_object(
      'updates', coalesce((
        select jsonb_agg(jsonb_build_object(
          'seq', u.seq, 'op_id', u.op_id, 'update_base64', u.update_base64
        ) order by u.seq)
        from chosen as c
        join public.internal_share_updates as u
          on u.document_id = 'team' and u.seq = c.seq
      ), '[]'::jsonb),
      'cursor', pc.cursor,
      'has_more', exists (
        select 1 from metadata as m where m.seq > pc.cursor
      )
    )
    from page_cursor as pc
  );
end;
$$;

-- The largest permitted update needs 699,308 estimated bytes, so every
-- nonempty metadata page advances the cursor within the 3 MiB page budget.
revoke all on function public.internal_share_read_page(bigint) from public, anon, authenticated, service_role;
grant execute on function public.internal_share_read_page(bigint) to service_role;

comment on function public.internal_share_read_page(bigint) is 'Service-role-only bounded read of immutable updates; at most 256 rows and 3 MiB estimated serialized payload';

commit;
