begin;

-- Independent shared-document storage. No cargo tables, policies or functions change.
create table public.internal_share_heads (
  document_id text primary key check (document_id = 'team'),
  last_seq bigint not null default 0 check (last_seq >= 0),
  total_bytes bigint not null default 0 check (total_bytes >= 0)
);

insert into public.internal_share_heads (document_id) values ('team');

create table public.internal_share_updates (
  document_id text not null references public.internal_share_heads (document_id),
  seq bigint not null check (seq > 0),
  op_id uuid not null,
  update_base64 text not null,
  update_bytes integer not null check (update_bytes between 1 and 524288),
  author text check (char_length(author) <= 80 and author !~ '[[:cntrl:]]'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (document_id, seq),
  unique (document_id, op_id),
  check (octet_length(decode(update_base64, 'base64')) = update_bytes)
);

create table public.internal_share_login_attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  client_key text not null check (client_key ~ '^[0-9a-f]{64}$'),
  attempted_at timestamptz not null default clock_timestamp(),
  succeeded boolean not null default false
);

create index internal_share_login_window_idx
  on public.internal_share_login_attempts (client_key, attempted_at desc)
  where succeeded = false;

alter table public.internal_share_heads enable row level security;
alter table public.internal_share_updates enable row level security;
alter table public.internal_share_login_attempts enable row level security;

revoke all on table public.internal_share_heads, public.internal_share_updates,
  public.internal_share_login_attempts from public, anon, authenticated, service_role;
grant select on table public.internal_share_updates to service_role;

create function public.internal_share_keep_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Shared document history is immutable';
end;
$$;

create trigger internal_share_updates_immutable
  before update or delete on public.internal_share_updates
  for each row execute function public.internal_share_keep_history();

-- The pending reservation counts before expensive password verification. Successful
-- logins release only their own reservation, so office users do not consume failures.
create function public.internal_share_login_guard(p_client_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_oldest timestamptz;
  v_now timestamptz;
  v_attempt_id uuid;
begin
  if p_client_key is null or p_client_key !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid client key';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('internal-share-login:' || p_client_key, 0));
  v_now := clock_timestamp();
  select count(*)::integer, min(a.attempted_at)
    into v_count, v_oldest
    from public.internal_share_login_attempts as a
    where a.client_key = p_client_key and a.succeeded = false
      and a.attempted_at > v_now - interval '15 minutes';
  if v_count >= 8 then
    return jsonb_build_object('allowed', false, 'retry_after',
      greatest(1, ceil(extract(epoch from (v_oldest + interval '15 minutes' - v_now)))::integer));
  end if;
  insert into public.internal_share_login_attempts (client_key, attempted_at)
    values (p_client_key, v_now) returning attempt_id into v_attempt_id;
  return jsonb_build_object('allowed', true, 'attempt_id', v_attempt_id);
end;
$$;

create function public.internal_share_login_complete(p_client_key text, p_attempt_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_client_key is null or p_client_key !~ '^[0-9a-f]{64}$' or p_attempt_id is null then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('internal-share-login:' || p_client_key, 0));
  update public.internal_share_login_attempts as a set succeeded = true
    where a.attempt_id = p_attempt_id and a.client_key = p_client_key
      and a.attempted_at > clock_timestamp() - interval '15 minutes'
      and a.succeeded = false;
  return found;
end;
$$;

-- The head row lock is held until commit. A later append cannot publish a higher
-- sequence before this transaction is visible to a polling client.
create function public.internal_share_append(p_op_id uuid, p_update_base64 text, p_author text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_head public.internal_share_heads%rowtype;
  v_existing public.internal_share_updates%rowtype;
  v_bytes bytea;
  v_canonical text;
  v_size integer;
  v_seq bigint;
begin
  if p_op_id is null or p_update_base64 is null or char_length(p_update_base64) > 699052 or
      p_author is not null and (char_length(p_author) > 80 or p_author ~ '[[:cntrl:]]') then
    raise exception using errcode = '22023', message = 'Invalid update';
  end if;
  v_bytes := decode(p_update_base64, 'base64');
  v_size := octet_length(v_bytes);
  if v_size < 1 or v_size > 524288 then
    raise exception using errcode = 'PT413', message = 'Update limit exceeded';
  end if;
  v_canonical := replace(encode(v_bytes, 'base64'), E'\n', '');
  if p_update_base64 <> v_canonical then
    raise exception using errcode = '22023', message = 'Invalid update encoding';
  end if;

  select * into strict v_head from public.internal_share_heads
    where document_id = 'team' for update;

  select * into v_existing from public.internal_share_updates
    where document_id = 'team' and op_id = p_op_id;
  if found then
    if v_existing.update_base64 <> v_canonical then
      raise exception using errcode = 'PT409', message = 'Operation payload differs';
    end if;
    return jsonb_build_object('seq', v_existing.seq);
  end if;

  -- Fail closed at the storage ceiling. No automatic deletion, pruning, snapshot
  -- replacement or history rewriting is permitted by this function.
  if v_head.total_bytes + v_size > 67108864 or v_head.last_seq >= 1000000 then
    raise exception using errcode = 'PT413', message = 'Document storage limit exceeded';
  end if;
  v_seq := v_head.last_seq + 1;
  insert into public.internal_share_updates
    (document_id, seq, op_id, update_base64, update_bytes, author)
    values ('team', v_seq, p_op_id, v_canonical, v_size, nullif(p_author, ''));
  update public.internal_share_heads set last_seq = v_seq, total_bytes = total_bytes + v_size
    where document_id = 'team';
  return jsonb_build_object('seq', v_seq);
end;
$$;

revoke all on function public.internal_share_keep_history() from public, anon, authenticated, service_role;
revoke all on function public.internal_share_login_guard(text) from public, anon, authenticated;
revoke all on function public.internal_share_login_complete(text, uuid) from public, anon, authenticated;
revoke all on function public.internal_share_append(uuid, text, text) from public, anon, authenticated;
grant execute on function public.internal_share_login_guard(text) to service_role;
grant execute on function public.internal_share_login_complete(text, uuid) to service_role;
grant execute on function public.internal_share_append(uuid, text, text) to service_role;

comment on table public.internal_share_updates is 'Append-only Yjs updates for the password-protected internal shared document';
comment on function public.internal_share_append(uuid, text, text) is 'Idempotent append serialized by the document head row; never prunes history';

commit;
