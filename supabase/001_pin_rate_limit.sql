-- Additive preparation. Does not alter TAGs, PINs, photos or existing permissions.
begin;
create schema if not exists trackmypet_private;
revoke all on schema trackmypet_private from public, anon, authenticated;
create table if not exists trackmypet_private.pin_attempts (
  key text primary key,
  window_start timestamptz not null,
  attempts integer not null check (attempts > 0)
);
create index if not exists pin_attempts_window_idx on trackmypet_private.pin_attempts(window_start);
revoke all on trackmypet_private.pin_attempts from public, anon, authenticated;

-- The inspected project does not currently grant service_role SELECT/UPDATE on tags.
-- Grant only columns this backend reads/writes. PIN, code and id cannot be updated by it.
grant select (id,codigo,pin,activo,nombre,sexo,telefono,zona,info,foto1,foto2,foto3,updated_at)
  on public.tags to service_role;
grant update (activo,nombre,sexo,telefono,zona,info,foto1,foto2,foto3,updated_at)
  on public.tags to service_role;

create or replace function public.tmp_pin_attempt(p_code text, p_ip_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n integer;
  started timestamptz;
  allowed boolean := true;
  retry integer := 0;
  item record;
begin
  if p_code !~ '^[0-9]{4,10}$' or p_ip_hash !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('allowed',false,'retry_after',900);
  end if;
  delete from trackmypet_private.pin_attempts where window_start < now() - interval '1 day';
  -- Stable lock order, atomic upserts: limits also hold across concurrent server instances.
  for item in select * from (values ('ip:' || p_ip_hash, 40), ('tag:' || p_code, 10)) as limits(k, cap) order by k loop
    insert into trackmypet_private.pin_attempts as a (key,window_start,attempts)
    values (item.k,now(),1)
    on conflict (key) do update set
      attempts = case when a.window_start <= now() - interval '15 minutes' then 1 else least(a.attempts + 1,1000000) end,
      window_start = case when a.window_start <= now() - interval '15 minutes' then now() else a.window_start end
    returning attempts,window_start into n,started;
    if n > item.cap then
      allowed := false;
      retry := greatest(retry,ceil(extract(epoch from started + interval '15 minutes' - now()))::integer);
    end if;
  end loop;
  return jsonb_build_object('allowed',allowed,'retry_after',greatest(retry,1));
end;
$$;
revoke all on function public.tmp_pin_attempt(text,text) from public,anon,authenticated;
grant execute on function public.tmp_pin_attempt(text,text) to service_role;
notify pgrst, 'reload schema';
commit;
