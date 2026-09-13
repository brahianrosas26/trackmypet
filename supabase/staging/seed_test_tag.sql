-- STAGING ONLY. Disposable data for Preview verification.
-- It contains no production TAG, PIN, owner, phone number or photo.
begin;

insert into public.tags (
  codigo, pin, activo, nombre, sexo, telefono, zona, info,
  foto1, foto2, foto3, updated_at,
  perdida, zona_perdida, mensaje_perdida,
  especie, raza, fecha_nacimiento, info_medica
) values (
  '000000', '0123', true, 'Luna de prueba', 'hembra', '099000000', 'Montevideo', 'TAG ficticio de staging.',
  null, null, null, now(),
  false, null, null,
  'Perro', 'Mestiza', date '2021-06-01', 'Dato médico ficticio de prueba.'
)
on conflict (codigo) do update set
  pin = excluded.pin,
  activo = excluded.activo,
  nombre = excluded.nombre,
  sexo = excluded.sexo,
  telefono = excluded.telefono,
  zona = excluded.zona,
  info = excluded.info,
  perdida = excluded.perdida,
  zona_perdida = excluded.zona_perdida,
  mensaje_perdida = excluded.mensaje_perdida,
  especie = excluded.especie,
  raza = excluded.raza,
  fecha_nacimiento = excluded.fecha_nacimiento,
  info_medica = excluded.info_medica,
  updated_at = now();

commit;

