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

-- Reset a TAG atomically when its owner chooses "Eliminar TAG". The identity
-- fields (id, codigo and pin) remain so the physical QR can be reused.
create or replace function public.tmp_reset_tag(p_tag_id uuid, p_user_id uuid)
returns table (codigo text, foto1 text, foto2 text, foto3 text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_codigo text;
  old_foto1 text;
  old_foto2 text;
  old_foto3 text;
begin
  select t.codigo, t.foto1, t.foto2, t.foto3
    into old_codigo, old_foto1, old_foto2, old_foto3
  from public.tags t
  join public.tag_owners o on o.tag_id = t.id and o.user_id = p_user_id
  where t.id = p_tag_id
  for update;

  if old_codigo is null then return; end if;

  update public.tags
  set activo = false, nombre = null, sexo = null, telefono = null, zona = null,
      info = null, foto1 = null, foto2 = null, foto3 = null, updated_at = null,
      perdida = false, zona_perdida = null, mensaje_perdida = null,
      especie = null, raza = null, fecha_nacimiento = null, info_medica = null
  where id = p_tag_id;

  delete from public.tag_owners where tag_id = p_tag_id and user_id = p_user_id;
  return query select old_codigo, old_foto1, old_foto2, old_foto3;
end;
$$;

revoke all on function public.tmp_reset_tag(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tmp_reset_tag(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
