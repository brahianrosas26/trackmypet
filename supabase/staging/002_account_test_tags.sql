-- Run only in the separate trackmypet-staging project mdssoloncjsexuulgqeq.
-- Creates fictional records only; never resets or overwrites existing TAGs.
begin;
insert into public.tags (codigo,pin,activo,nombre,sexo,telefono,zona,info)
values
  ('000001','0123',false,null,null,null,null,null),
  ('000002','0456',true,'Mascota ficticia de auditoría','hembra','099000000','Staging','Datos ficticios para probar cuentas.'),
  ('000003','0789',false,null,null,null,null,null)
on conflict (codigo) do nothing;
commit;

