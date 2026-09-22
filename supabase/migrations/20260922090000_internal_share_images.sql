begin;

-- This is a NEW dedicated bucket. A name collision deliberately fails instead
-- of changing a preexisting bucket or adopting unaccounted stored objects.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('internal-note-images', 'internal-note-images', false, 2097152, array['image/png']);

-- Existing permissive policies elsewhere must not expose this private bucket.
-- Restrictive guards affect only this bucket and leave every other bucket's
-- policy result unchanged. The server uses service_role (BYPASSRLS).
create policy internal_note_images_server_only
  on storage.objects as restrictive for all to anon, authenticated
  using (bucket_id <> 'internal-note-images')
  with check (bucket_id <> 'internal-note-images');
create policy internal_note_images_bucket_server_only
  on storage.buckets as restrictive for all to anon, authenticated
  using (id <> 'internal-note-images')
  with check (id <> 'internal-note-images');

create table public.internal_share_images (
  id text primary key check (id ~ '^[a-f0-9]{64}$'),
  bytes integer not null check (bytes between 57 and 2097152),
  mime text not null default 'image/png' check (mime = 'image/png'),
  width integer not null check (width between 1 and 2560),
  height integer not null check (height between 1 and 2560),
  ready boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.internal_share_images enable row level security;
revoke all on table public.internal_share_images from public, anon, authenticated, service_role;

create function public.internal_share_image_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Image reservations are immutable';
  end if;
  if new.id is distinct from old.id or new.bytes is distinct from old.bytes
      or new.mime is distinct from old.mime or new.width is distinct from old.width
      or new.height is distinct from old.height or new.created_at is distinct from old.created_at
      or (old.ready and not new.ready) then
    raise exception using errcode = '42501', message = 'Image reservations are immutable';
  end if;
  return new;
end;
$$;
create trigger internal_share_image_immutable before update or delete
  on public.internal_share_images for each row execute function public.internal_share_image_immutable();

-- Every reservation, including an interrupted upload, counts toward both
-- quotas. A single transaction lock serializes concurrent different hashes.
create function public.internal_share_image_reserve(p_id text, p_bytes integer, p_width integer, p_height integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.internal_share_images%rowtype;
  v_count bigint;
  v_bytes bigint;
begin
  if p_id is null or p_id !~ '^[a-f0-9]{64}$' or p_bytes is null or p_bytes not between 57 and 2097152
      or p_width is null or p_width not between 1 and 2560 or p_height is null or p_height not between 1 and 2560 then
    raise exception using errcode = '22023', message = 'Invalid image metadata';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(1936287847, 1768776039);
  select * into v_row from public.internal_share_images where id = p_id;
  if found then
    if v_row.bytes <> p_bytes or v_row.width <> p_width or v_row.height <> p_height then
      raise exception using errcode = 'PT409', message = 'Image metadata conflict';
    end if;
  else
    select count(*), coalesce(sum(bytes), 0) into v_count, v_bytes from public.internal_share_images;
    if v_count >= 1000 or v_bytes + p_bytes > 104857600 then
      raise exception using errcode = 'PT413', message = 'Image storage quota exceeded';
    end if;
    insert into public.internal_share_images (id, bytes, width, height)
      values (p_id, p_bytes, p_width, p_height) returning * into v_row;
  end if;
  return jsonb_build_object('id', v_row.id, 'bytes', v_row.bytes, 'mime', v_row.mime,
    'width', v_row.width, 'height', v_row.height, 'ready', v_row.ready);
end;
$$;

create function public.internal_share_image_complete(p_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.internal_share_images%rowtype;
begin
  if p_id is null or p_id !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid image id';
  end if;
  update public.internal_share_images set ready = true where id = p_id returning * into v_row;
  if not found then raise exception using errcode = '22023', message = 'Image reservation missing'; end if;
  return jsonb_build_object('id', v_row.id, 'bytes', v_row.bytes, 'mime', v_row.mime,
    'width', v_row.width, 'height', v_row.height, 'ready', v_row.ready);
end;
$$;

create function public.internal_share_image_read(p_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_row public.internal_share_images%rowtype;
begin
  if p_id is null or p_id !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid image id';
  end if;
  select * into v_row from public.internal_share_images where id = p_id and ready;
  if not found then return null; end if;
  return jsonb_build_object('id', v_row.id, 'bytes', v_row.bytes, 'mime', v_row.mime,
    'width', v_row.width, 'height', v_row.height, 'ready', v_row.ready);
end;
$$;

revoke all on function public.internal_share_image_immutable() from public, anon, authenticated, service_role;
revoke all on function public.internal_share_image_reserve(text, integer, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.internal_share_image_complete(text) from public, anon, authenticated, service_role;
revoke all on function public.internal_share_image_read(text) from public, anon, authenticated, service_role;
grant execute on function public.internal_share_image_reserve(text, integer, integer, integer) to service_role;
grant execute on function public.internal_share_image_complete(text) to service_role;
grant execute on function public.internal_share_image_read(text) to service_role;
comment on table public.internal_share_images is 'Private immutable content-addressed PNG metadata; conservative 100 MiB / 1000 reservation quota; bytes stored only in private Storage';
commit;
