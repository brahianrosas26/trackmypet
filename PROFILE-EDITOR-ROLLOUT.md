# Editor privado del perfil

## Alcance de esta versión

- Cambia solamente la pantalla privada que se abre después de validar el PIN.
- Mantiene el PIN, código, URL, QR, teléfono, zona y fotos existentes.
- Muestra y permite reemplazar únicamente `foto1`. `foto2` y `foto3` se conservan sin mostrarlas en el editor.
- La ficha pública no incorpora los campos nuevos en esta versión.

## Cambio de base de datos pendiente de autorización

`supabase/004_private_profile_fields.sql` agrega cuatro columnas opcionales a `public.tags`:

- `especie text`
- `raza text`
- `fecha_nacimiento date`
- `info_medica text`

Las columnas se crean con `NULL` para todos los TAGs existentes. La migración no actualiza filas ni
modifica `id`, `codigo`, `pin`, `activo`, fotos u otros datos. Solamente `service_role` recibe permisos
de lectura y actualización sobre los cuatro campos; el acceso público de Supabase continúa bloqueado.

## Activación controlada

El servidor consulta y guarda estos campos solamente con `TRACKMYPET_PROFILE_FIELDS_ENABLED=true`.
La variable debe habilitarse primero en Preview después de aplicar la migración y aprobar las pruebas.

