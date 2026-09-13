-- Additive Stage 1 ownership model. Apply to STAGING first.
-- Existing TAG rows remain unlinked and continue to use their current PIN flow.
begin;

create table if not exists public.tag_owners (
  tag_id uuid primary key references public.tags(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  claimed_at timestamptz not null default now()
);

create index if not exists tag_owners_user_id_idx
  on public.tag_owners(user_id);

alter table public.tag_owners enable row level security;
revoke all privileges on table public.tag_owners from public, anon, authenticated;

-- Stage 1 supports listing and claiming. Unlinking/transfers are intentionally
-- excluded until their authorization rules are designed.
grant select, insert on table public.tag_owners to service_role;

comment on table public.tag_owners is
  'One primary Supabase Auth owner per physical TAG. Absence means the legacy PIN flow remains available.';
comment on column public.tag_owners.tag_id is
  'Internal immutable TAG UUID. The primary key prevents a TAG from having two owners.';
comment on column public.tag_owners.user_id is
  'Verified Supabase Auth user that owns the TAG.';

notify pgrst, 'reload schema';
commit;

