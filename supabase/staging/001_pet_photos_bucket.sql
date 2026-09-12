-- STAGING ONLY. The public QR profile needs public image downloads.
-- Uploads remain server-only after 002_lock_public_access.sql.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pet-photos', 'pet-photos', true, 524288, array['image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;

