-- Apply before enabling TRACKMYPET_PROFILE_FIELDS_ENABLED in Vercel.
-- Existing values, PINs, codes, photos and public access rules remain unchanged.
begin;
alter table public.tags
  add column if not exists especie text,
  add column if not exists raza text,
  add column if not exists fecha_nacimiento date,
  add column if not exists info_medica text;
grant select (especie, raza, fecha_nacimiento, info_medica),
  update (especie, raza, fecha_nacimiento, info_medica) on public.tags to service_role;
comment on column public.tags.info_medica is
  'Owner-managed medical notes. Not included in the public TAG response in this version.';
notify pgrst, 'reload schema';
commit;

