-- STAGING ONLY. Bootstrap schema compatible with the production TAG app.
-- Do not apply to production: the production tags table already exists.
begin;

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[0-9]{4,10}$'),
  pin text not null,
  activo boolean default false,
  nombre text,
  sexo text,
  telefono text,
  zona text,
  info text,
  foto1 text,
  foto2 text,
  foto3 text,
  updated_at timestamptz
);

commit;

