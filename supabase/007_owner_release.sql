-- Server-only release of an existing owner/TAG relationship.
-- The authenticated browser still has no direct table access.
begin;

revoke all privileges on table public.tag_owners from public, anon, authenticated;
grant select, insert, delete on table public.tag_owners to service_role;

-- The dashboard can link a TAG using only its printed PIN. Returning at most
-- two matches lets the API fail closed if historical PINs are duplicated.
create or replace function public.tmp_tag_by_pin(p_pin text)
returns table (id uuid, codigo text, activo boolean)
language sql
security definer
set search_path = public, pg_temp
as $$
  select t.id, t.codigo, t.activo
  from public.tags t
  where t.pin = p_pin
  order by t.id
  limit 2;
$$;

revoke all on function public.tmp_tag_by_pin(text) from public, anon, authenticated;
grant execute on function public.tmp_tag_by_pin(text) to service_role;

notify pgrst, 'reload schema';
commit;
