-- Apply before enabling TRACKMYPET_LOST_STATUS_ENABLED in Vercel.
-- Existing TAGs remain active and are initialized as not lost.
begin;
alter table public.tags
  add column if not exists perdida boolean not null default false,
  add column if not exists zona_perdida text,
  add column if not exists mensaje_perdida text;
grant select (perdida, zona_perdida, mensaje_perdida),
  update (perdida, zona_perdida, mensaje_perdida) on public.tags to service_role;
comment on column public.tags.perdida is
  'Owner-controlled lost status. False means the pet is not currently reported lost.';
comment on column public.tags.zona_perdida is 'Area where the pet was reported lost.';
comment on column public.tags.mensaje_perdida is 'Public message shown while the pet is reported lost.';
notify pgrst, 'reload schema';
commit;

