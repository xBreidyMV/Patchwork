Lee `AGENTS.md` completo. Ese archivo contiene el contexto maestro del producto Patchwork y las decisiones que debes respetar.

Quiero que trabajes sobre el repositorio actual de forma incremental.

Primero inspecciona:
- La estructura de archivos.
- `package.json`.
- La configuración de Vite, TypeScript y Tailwind.
- El estado de la integración con Supabase.
- Los componentes y páginas existentes.
- Los scripts de pruebas, lint y build.
- La configuración de Git y los cambios pendientes, sin sobrescribirlos.

Después, entrega un diagnóstico con tres categorías:
1. Ya implementado y verificado.
2. Incompleto o incorrecto.
3. Pendiente de implementar.

A continuación, propone un plan ordenado que preserve el alcance original de Patchwork, incluida la integración con GitHub y la relación entre eventos y decisiones técnicas.

Implementa únicamente los cambios iniciales que sean necesarios y seguros. No reescribas el proyecto entero, no inventes credenciales, no simules funcionalidades, no realices operaciones destructivas y no modifiques una base de datos de producción sin autorización.

Ejecuta las comprobaciones disponibles e informa con precisión de sus resultados.

No marques como completado nada que no hayas verificado. Antes de avanzar a cambios importantes en el esquema de datos, las políticas RLS o los permisos de GitHub, presenta el diseño para revisión.