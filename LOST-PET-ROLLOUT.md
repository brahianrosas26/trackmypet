# Primera versión de Mascota Perdida

## Comportamiento preparado

- El dueño entra a Editar con el PIN actual y elige `Está perdida` o `No está perdida`.
- Mientras está perdida, puede guardar una zona y un mensaje específicos de la búsqueda.
- La ficha pública conserva fotos, teléfono, WhatsApp, zona e información general.
- El aviso de pérdida, la zona de búsqueda y el mensaje aparecen solamente mientras el estado está activo.
- Marcar `No está perdida` devuelve la ficha a su presentación normal sin borrar los datos anteriores.

## Cambio de base de datos pendiente de autorización

`supabase/003_lost_pet_status.sql` agrega tres columnas a `public.tags`:

- `perdida boolean not null default false`
- `zona_perdida text`
- `mensaje_perdida text`

Las 107 filas existentes reciben `perdida = false`. No cambia `id`, `codigo`, `pin`, `activo`,
fotos ni ningún dato actual. Solo `service_role` recibe lectura y actualización de las tres
columnas nuevas; `anon` y `authenticated` continúan bloqueados.

## Activación

El código usa `TRACKMYPET_LOST_STATUS_ENABLED=true` únicamente después de aplicar la migración.
Sin esa variable, puede mostrar las fichas existentes de forma compatible, pero rechaza guardar
el estado nuevo. Preview sigue bloqueando cualquier modificación de TAGs reales.

