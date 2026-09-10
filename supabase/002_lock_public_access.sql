-- Apply ONLY after the secured deployment has been verified and promoted.
-- No data or PIN changes. Old clients must reload after cutover.
begin;
revoke all privileges on table public.tags from public, anon, authenticated;
-- Table-level REVOKE does not remove independently granted column privileges.
do $$ declare c record; begin
  for c in select column_name from information_schema.columns where table_schema='public' and table_name='tags' loop
    execute format('revoke select (%1$I), insert (%1$I), update (%1$I), references (%1$I) on public.tags from public, anon, authenticated', c.column_name);
  end loop;
end $$;
alter table public.tags enable row level security;
-- Restrictive AND policy protects this bucket even if existing permissive policies allow writes.
-- Public image URLs keep working because the public bucket download route does not need these writes.
create policy trackmypet_block_direct_photo_write on storage.objects as restrictive
  for all to anon, authenticated
  using (bucket_id <> 'pet-photos') with check (bucket_id <> 'pet-photos');
notify pgrst, 'reload schema';
commit;
