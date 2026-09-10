# Protección del PIN de TrackMyPet

Estado: propuesta preparada sobre `9fc70be85a54dcfff6446a77825cc965b0d9e0b0`.
No cambiar `main` ni revocar accesos antes de verificar el servidor.

## Comportamiento

- Las rutas numéricas y el diseño existente permanecen iguales.
- El navegador deja de consultar directamente Supabase. `GET /api/tag?code=...`
  entrega una lista explícita de campos públicos. Un TAG inactivo solo revela su código y estado.
- El PIN ingresado por el dueño se envía por HTTPS en el cuerpo de `POST /api/tag`.
  Nunca se devuelve el PIN almacenado al navegador.
- El servidor valida el PIN y expide una autorización firmada de 30 minutos, restringida
  a un TAG y a activación o edición. Solo se guarda en memoria de la página; al recargar se pide PIN.
- Cada guardado/subida comprueba firma, vencimiento, TAG, estado y si cambió el PIN.
- Intentos de PIN: máximo 10 por TAG y 40 por IP en 15 minutos, incluyendo los correctos.
  Los contadores se actualizan atómicamente en PostgreSQL. No hay contador en memoria de Vercel.
- Datos validados con límites de longitud y campos permitidos. Conflictos de edición se
  detectan mediante `updated_at` para evitar sobrescribir silenciosamente cambios concurrentes.
- Las fotos nuevas se comprimen como antes y se suben mediante el servidor, con tamaño máximo
  de 512 KiB y nombres aleatorios dentro de la carpeta del TAG autorizado.
- Quitar/reemplazar una foto cambia la ficha, pero no elimina el archivo anterior durante
  este despliegue. Evita pérdidas ante fallos o ediciones simultáneas; queda pendiente una
  limpieza con período de gracia y comprobación de referencias. No se borran fotos existentes.
- Las fotos públicas siguen accesibles por sus URLs actuales.
- Preview permite consultar fichas, pero bloquea verificación y cambios a TAGs reales.
  `TRACKMYPET_PREVIEW_TEST_CODE` habilita únicamente un TAG de prueba aislado si se prepara uno.

## Variables de Vercel (solo servidor)

- `SUPABASE_URL`: URL del proyecto.
- `SUPABASE_SERVICE_ROLE_KEY`: credencial privilegiada existente de Supabase. Nunca en GitHub,
  HTML, capturas, logs, chat ni variables `PUBLIC`/`NEXT_PUBLIC`.
- Preview: restringir la variable secreta a la rama revisada. No habilitarla para todas las ramas
  de un repositorio público. Production: configurar al momento del despliegue.

## Orden de implementación

1. Ejecutar `npm test` y revisar el diff de la rama.
2. Confirmar la autorización para conectar la credencial de Supabase al servidor Vercel y
   conceder los permisos del siguiente paso.
3. Aplicar `supabase/001_pin_rate_limit.sql`: agrega un esquema privado y contadores de intentos,
   una RPC invocable solo por `service_role` y permisos por columna de SELECT/UPDATE a ese rol.
   No cambia datos de `tags`, PINs, URLs ni permisos del cliente actual.
4. Configurar las variables exclusivamente en Preview para la rama revisada. Desplegar Preview.
5. Verificar ficha activa/inactiva, código inexistente, ausencia de PIN en respuestas,
   rechazos de operaciones sin sesión y bloqueo de cambios a TAGs reales en Preview.
   Probar activación/edición/fotos con fixtures locales y, si se dispone, un TAG desechable
   en una base de prueba separada. No usar PINs de clientes ni editar sus fichas para probar.
6. Informar al propietario del cambio de producción: desplegar frontend/API, luego revocar el
   acceso directo de `anon`/`authenticated`/`PUBLIC` a `tags` y bloquear acceso directo a
   `pet-photos` mediante la política restrictiva de `002_lock_public_access.sql`.
7. Configurar variables de Production, publicar la rama revisada en `main`, esperar Ready y
   verificar la API antes de ejecutar `002`. Ejecutar `002` inmediatamente después del smoke test.
8. Verificar SELECT/UPDATE directos bloqueados, subida anónima bloqueada, ficha pública y URLs
   de fotos existentes operativas; confirmar que los datos y PINs no cambiaron.

## Recuperación

Antes de `002`, una Preview fallida no afecta la aplicación anterior. Después de `002`, **no**
restaurar la versión antigua por sí sola: necesita el acceso público inseguro. Corregir o
redeplegar la versión segura manteniendo los bloqueos. Cualquier restauración de permisos
anteriores requiere autorización explícita porque vuelve a exponer el PIN y las escrituras.
No hay instrucciones de borrado de tablas, fotos ni PINs en estas migraciones.

## Alcance

Este cambio solo protege PIN, datos y fotos. No incorpora todavía estado de pérdida,
geolocalización ni WhatsApp. La clave pública `anon` anterior no es secreta; lo que protege
la base son los permisos y el servidor, no ocultar esa clave.
