# Patchwork

Patchwork conserva el contexto detrás de los cambios de software: problemas, decisiones técnicas, alternativas, riesgos y referencias vinculadas a repositorios.

## Estado del MVP

El cliente web de Patchwork usa Supabase Auth, PostgreSQL y RLS. El flujo principal permite:

- Registrarse, iniciar y cerrar sesión, y recuperar la contraseña por correo.
- Crear, listar y cambiar entre espacios de trabajo personales.
- Añadir repositorios manualmente o conectar una GitHub App.
- Crear, consultar, editar y eliminar decisiones técnicas.
- Asociar decisiones a repositorios y referencias de commits, pull requests o issues.
- Buscar decisiones y filtrarlas por estado.
- Consultar una cronología combinada de decisiones y eventos de GitHub cuando la App está instalada.

Las migraciones SQL y las Edge Functions están versionadas en este repositorio. En el proyecto Supabase de Patchwork, las tres migraciones locales coinciden con las remotas y las funciones `github-connect-start` y `github-gateway` están desplegadas. La GitHub App debe instalarse desde Patchwork y el usuario debe seleccionar qué repositorios compartir antes de que aparezcan repositorios sincronizados y eventos.

## Stack

- React, Vite y TypeScript.
- Tailwind CSS v4 y Lucide React.
- Supabase Auth, PostgreSQL, Data API y Edge Functions.
- GitHub App y webhooks firmados.

El navegador usa la clave publicable de Supabase y las políticas RLS. Las operaciones privilegiadas de GitHub se ejecutan en Edge Functions.

## Requisitos

- Node.js 22 o posterior.
- npm.
- Un proyecto de Supabase.

## Preparación local

```powershell
npm install
Copy-Item .env.example .env
```

Configura en `.env` la URL y la clave publicable del proyecto Supabase:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

No uses una clave `service_role` ni una clave secreta en variables `VITE_*`. `.env` está excluido de Git. `DATABASE_URL` es opcional y solo se usa en tareas administrativas del CLI.

En Supabase, habilita **Authentication → Providers → Email**. Para desarrollo, configura **Authentication → URL Configuration** con `http://localhost:5173` como Site URL y URL permitida.

Inicia la aplicación:

```powershell
npm run dev
```

## Base de datos

Las migraciones bajo `supabase/migrations/` crean perfiles, espacios de trabajo, membresías, repositorios, decisiones, referencias, instalaciones de GitHub y la cronología de webhooks. RLS está habilitado en todas las tablas expuestas.

Para enlazar otro proyecto Supabase y aplicar sus migraciones:

```powershell
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

No ejecutes `db push` sobre producción sin revisar primero el plan de migraciones.

## Integración con GitHub

La configuración de la GitHub App, sus secretos de servidor, permisos mínimos y despliegue de Edge Functions está en [`docs/github-app-setup.md`](docs/github-app-setup.md). No guardes secretos de GitHub en `.env`, en `VITE_*` ni en el código cliente.

Las funciones actuales sincronizan los repositorios autorizados al completar la instalación y reciben eventos de push, pull requests e issues. GitHub envía automáticamente a las GitHub Apps los eventos `installation` e `installation_repositories`.

## Comandos de calidad

```powershell
npm run typecheck
npm run build
npm run preview
```

## Seguridad

- Las claves publicables se limitan mediante RLS; no se usan claves `service_role` en el navegador.
- Los secretos de GitHub se guardan en **Supabase → Edge Functions → Secrets**.
- Los webhooks verifican la firma HMAC de GitHub y deduplican entregas.
- El acceso a decisiones, repositorios y actividad se limita a miembros del espacio.

La URL de inicio de la GitHub App actualmente apunta a `localhost` para desarrollo. Antes de publicar Patchwork, configura el dominio definitivo en GitHub, Supabase Auth y `PATCHWORK_ALLOWED_ORIGINS`.
