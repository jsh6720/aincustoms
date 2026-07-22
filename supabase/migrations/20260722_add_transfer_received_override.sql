alter table public.cargo_original_docs
  add column if not exists transfer_received_override boolean;

comment on column public.cargo_original_docs.transfer_received_override is
  'NULL=automatic scanner result, TRUE=admin O override, FALSE=admin X override';
