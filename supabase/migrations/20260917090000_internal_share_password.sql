begin;

-- The initial NULL hash keeps the existing environment hash authoritative until
-- the first password change. Only the server can read or replace this singleton.
create table public.internal_share_credentials (
  id text primary key check (id = 'team'),
  password_hash text,
  revision bigint not null default 0 check (revision between 0 and 9007199254740991),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (revision = 0 and password_hash is null)
    or (revision > 0 and password_hash is not null
      and password_hash ~ '^scrypt:[A-Za-z0-9_-]{22,86}:[A-Za-z0-9_-]{86}$')
  )
);

insert into public.internal_share_credentials (id) values ('team');

alter table public.internal_share_credentials enable row level security;
revoke all on table public.internal_share_credentials
  from public, anon, authenticated, service_role;

create function public.internal_share_auth_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.internal_share_credentials%rowtype;
begin
  select * into strict v_state from public.internal_share_credentials
    where id = 'team';
  return jsonb_build_object('revision', v_state.revision, 'password_hash', v_state.password_hash);
end;
$$;

-- The row lock and expected revision form one atomic compare-and-swap. A stale
-- request cannot replace a newer hash, including the first environment bootstrap.
create function public.internal_share_password_change(p_expected_revision bigint, p_password_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.internal_share_credentials%rowtype;
  v_revision bigint;
begin
  if p_expected_revision is null or p_expected_revision < 0
      or p_expected_revision > 9007199254740991
      or p_password_hash is null
      or p_password_hash !~ '^scrypt:[A-Za-z0-9_-]{22,86}:[A-Za-z0-9_-]{86}$' then
    raise exception using errcode = '22023', message = 'Invalid password change parameters';
  end if;

  select * into strict v_state from public.internal_share_credentials
    where id = 'team' for update;
  if v_state.revision <> p_expected_revision then
    return jsonb_build_object('changed', false);
  end if;
  if v_state.revision >= 9007199254740991 then
    raise exception using errcode = '54000', message = 'Password revision limit exceeded';
  end if;

  v_revision := v_state.revision + 1;
  update public.internal_share_credentials
    set password_hash = p_password_hash,
        revision = v_revision,
        updated_at = clock_timestamp()
    where id = 'team';
  return jsonb_build_object('changed', true, 'revision', v_revision);
end;
$$;

revoke all on function public.internal_share_auth_state() from public, anon, authenticated, service_role;
revoke all on function public.internal_share_password_change(bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.internal_share_auth_state() to service_role;
grant execute on function public.internal_share_password_change(bigint, text) to service_role;

comment on table public.internal_share_credentials is 'Server RPC-only password hash and session revision; revision zero uses the environment bootstrap hash';
comment on function public.internal_share_auth_state() is 'Service-role-only authentication state; never expose password_hash to clients';
comment on function public.internal_share_password_change(bigint, text) is 'Atomic password hash replacement guarded by the expected revision; increments the session revision';

-- Disposable database verification: apply both internal-share migrations inside
-- a test transaction; assert revision 0/NULL, reject anon/authenticated RPC calls
-- and direct service-role table access, then change revision 0 to 1 through the
-- service-role RPC with a generated test hash. A second revision-0 change must
-- return changed=false and leave revision 1 intact. Reject NULL/malformed hashes,
-- negative/out-of-range revisions and extra singleton rows, then roll back.
-- Concurrent verification uses two sessions: the second revision-0 change waits
-- for the first transaction and returns changed=false after the first commits.

commit;
