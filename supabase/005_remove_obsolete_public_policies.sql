-- Security cleanup to apply to STAGING first.
-- These permissive policies are currently inert because direct table privileges
-- were revoked by 002_lock_public_access.sql. Removing them prevents a future
-- GRANT from accidentally restoring public writes.
-- No rows, TAGs, PINs, photos or public photo downloads are changed.
begin;

drop policy if exists "allow public read" on public.tags;
drop policy if exists "allow public update" on public.tags;
drop policy if exists "insert_all" on public.tags;

-- Keep the existing public read policy for pet photos. Only obsolete write
-- policies are removed; trackmypet_block_direct_photo_write remains in place.
drop policy if exists "allow public photo uploads" on storage.objects;
drop policy if exists "allow public photo update" on storage.objects;
drop policy if exists "allow public delete pet photos" on storage.objects;

notify pgrst, 'reload schema';
commit;

