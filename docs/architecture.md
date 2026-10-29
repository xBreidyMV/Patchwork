# Arquitectura de Patchwork

## Stack

- **Frontend:** React, Vite, TypeScript y Tailwind CSS v4.
- **Datos y autenticación:** Supabase Auth, PostgreSQL y Data API.
- **Acceso a datos:** `@supabase/supabase-js` desde el navegador con RLS; no hay API propia.
- **GitHub:** GitHub App mediante Supabase Edge Functions; instalación de repositorios, sincronización inicial y eventos webhook firmados para push, pull requests e issues.
- **Idioma:** español.

## Estructura actual del frontend

- `src/App.tsx` contiene la autenticación de interfaz, navegación y vistas; sigue concentrando la mayor parte de la UI.
- `src/lib/supabase.ts` crea el cliente del navegador.
- `src/services/data.ts` agrupa las consultas y escrituras de la aplicación.
- `src/types/index.ts` contiene los tipos del dominio.
- `src/components/`, `src/hooks/` y `src/pages/` todavía no se han separado; extraerlos debe hacerse gradualmente para preservar el comportamiento.
- `supabase/functions/` contiene las funciones de servidor para GitHub. El directorio local `apps/api/` está vacío y no forma parte de la ejecución actual.

## Flujos implementados

1. Registro, inicio y cierre de sesión con correo y contraseña; recuperación de contraseña por email.
2. Creación, listado y selección de espacios de trabajo.
3. Alta y eliminación de repositorios manuales; búsqueda y filtro por estado de sincronización.
4. Creación, consulta, edición y eliminación de decisiones.
5. Búsqueda de texto, filtros por estado/repositorio y referencias externas.
6. Conexión de GitHub, sincronización de repositorios y cronología combinada de decisiones y eventos (requiere una instalación real para recibir actividad).
7. Recuento de miembros visibles del espacio, limitado por las políticas RLS existentes.
8. Pantalla de configuración con información de cuenta, espacio e instalación de GitHub.

## Modelo de datos

La migración inicial versionada en `supabase/migrations/` crea:

- `profiles`: nombre visible y perfil asociado a `auth.users`.
- `workspaces`: espacios y propietario.
- `workspace_members`: membresía y rol.
- `repositories`: repositorios asociados al espacio.
- `decisions`: contexto, decisión, justificación, alternativas, consecuencias, riesgos y estado.
- `decision_links`: referencias a commits, pull requests, issues o URL externas.

Las relaciones, restricciones e índices se definen en SQL. Todas las tablas públicas tienen RLS habilitado y políticas por usuario/espacio. Las funciones auxiliares de autorización permanecen en el esquema no expuesto `private`.

## Variables de entorno

- `VITE_SUPABASE_URL`: URL del proyecto.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: clave pública para el cliente; RLS limita las operaciones.
- `DATABASE_URL`: opcional para tareas administrativas del CLI. Es una credencial privada, no se usa en el cliente y no debe publicarse.

No se deben incluir claves `service_role`, claves secretas de Supabase ni tokens de GitHub en variables `VITE_*`.

## Estado de GitHub y pendientes de validación

En el panel del proyecto Supabase conectado se verificó que están aplicadas las tres migraciones locales, que existen las funciones `github-connect-start` y `github-gateway`, y que están definidos los nombres de los seis secretos documentados en `docs/github-app-setup.md`. No se inspeccionaron los valores de los secretos. Esto confirma la preparación del entorno, pero no demuestra por sí solo que la conexión funcione de extremo a extremo.

Antes de considerar GitHub listo para usuarios, falta probar con una instalación real que el propietario conecte el espacio, seleccione repositorios, se sincronicen correctamente y lleguen webhooks válidos. También falta comprobar el aislamiento RLS con más de un usuario. Las decisiones pueden guardar una referencia manual a commits, pull requests o issues; la interfaz muestra como relacionados los eventos del mismo repositorio con una URL coincidente, sin guardar una relación explícita entre ambas filas.

Otros pendientes:

- Invitaciones y gestión de miembros del espacio.
- Despliegue y configuración de URLs de Auth para el dominio final.
- Definir y revisar el vínculo persistente entre eventos de repositorio y decisiones antes de ampliar el esquema.
