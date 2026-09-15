-- Additive, staging-first sightings for pets currently marked as lost.
begin;

create table if not exists public.tag_sightings (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null references public.tags(id) on delete restrict,
  reported_at timestamptz not null default now(),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters real not null check (accuracy_meters >= 0 and accuracy_meters <= 100000)
);
create index if not exists tag_sightings_tag_reported_idx on public.tag_sightings(tag_id, reported_at desc);
alter table public.tag_sightings enable row level security;
revoke all privileges on public.tag_sightings from public, anon, authenticated;
grant select, insert on public.tag_sightings to service_role;

create or replace function public.tmp_sighting_attempt(p_code text, p_ip_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n integer; started timestamptz;
begin
  if p_code !~ '^[0-9]{4,10}$' or p_ip_hash !~ '^[A-Za-z0-9_-]{43}$' then return jsonb_build_object('allowed',false,'retry_after',900); end if;
  insert into trackmypet_private.pin_attempts as a (key,window_start,attempts)
  values ('sighting:' || p_code || ':' || p_ip_hash,now(),1)
  on conflict (key) do update set attempts=case when a.window_start <= now()-interval '15 minutes' then 1 else least(a.attempts+1,1000000) end, window_start=case when a.window_start <= now()-interval '15 minutes' then now() else a.window_start end
  returning attempts,window_start into n,started;
  return jsonb_build_object('allowed',n <= 1,'retry_after',greatest(1,ceil(extract(epoch from started+interval '15 minutes'-now()))::integer));
end;
$$;
revoke all on function public.tmp_sighting_attempt(text,text) from public, anon, authenticated;
grant execute on function public.tmp_sighting_attempt(text,text) to service_role;
notify pgrst, 'reload schema';
commit;
