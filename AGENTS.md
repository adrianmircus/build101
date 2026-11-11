<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Arquitectura de la plataforma

El plan completo está en `docs/PLATAFORMA.md` y el avance en `docs/PLATAFORMA-AVANCE.md`. Lo de producto y roadmap está en `CLAUDE.md`; esto es cómo se escribe el código nuevo. El código del hackathon (`lib/groups/`, `lib/agent/`, el `localStorage`) se va migrando a estas capas: un archivo viejo entra a las reglas cuando un ticket lo toca.

**Capas.** Cada una importa solo de las de abajo, y ESLint lo hace cumplir.

| Capa | Dónde | Hace |
|---|---|---|
| Páginas y componentes | `app/`, `components/` | Mostrar y capturar. Los Server Components leen llamando a servicios; los Client Components mutan con Server Actions |
| Entradas | `app/**/actions.ts` con `defineAction`, `app/**/route.ts` con `defineRoute` (`lib/server/entry/`) | Validar con zod, llamar a un servicio, devolver `Result`. Unas pocas líneas |
| Servicios | `lib/server/services/` | Casos de uso. No deciden permisos: la autoridad es la base |
| Repos | `lib/server/repos/` y `repos/admin/` | El único lugar que habla con Supabase |
| Base | `supabase/migrations/` | Tablas, RLS, privilegios, RPC. Acá viven los permisos |
| Dominio | `lib/domain/` | Tipos, esquemas zod y reglas puras. Sin IO, sin React, Next ni Supabase |
| IA | `lib/server/ai/` | Proveedores, presupuesto y una carpeta por materia. No sabe quién es el estudiante |

**Reglas.**

- `components/` y `lib/client/` no importan `lib/server/`, y todo `lib/server/` arranca con `import "server-only"`. `app/` importa servicios, nunca repos.
- Archivo de hasta 200 líneas, componente de hasta 150, función de hasta 40, complejidad 10, anidamiento 3, parámetros 3. Los archivos viejos que pasan el límite están en `eslint/legacy.mjs`: esa lista solo achica, y el ticket que toca uno lo parte.
- Un componente por archivo, exports con nombre, TypeScript estricto (el código nuevo con `noUncheckedIndexedAccess` vía `tsconfig.strict.json`), sin `any` ni `as` para tapar tipos.
- zod en todo borde: input de entradas, salida de la IA, `jsonb` leído de la base y respuesta de cada RPC.
- Errores esperados con `AppError(code, mensaje)` de `lib/errors.ts`; lo inesperado lo loguea la entrada con un id de pedido y el usuario ve un mensaje genérico. En el cliente, `callAction` (`lib/client/`) convierte una Server Action vieja después de un deploy en «Se actualizó Tiza. Recargá la página.».
- Logs con `lib/server/log.ts`: solo ids seudónimos, códigos y cuentas. Nunca nombres, perfiles, respuestas ni prompts.
- Filas editables con `revision`: la edición manda la que leyó y un cambio ajeno da `CONFLICT`.
- Escrituras y lecturas sensibles solo por RPC que sacan el actor de la sesión. A la IA nunca le llegan nombres ni ids de estudiantes, y al estudiante nunca le llega su perfil ni algo que permita deducirlo.
- La materia es un parámetro: nada de «matemática» fijo en el código nuevo.
- No entra una dependencia sin que el ticket la nombre.

**Compuertas.** `npm run check:ticket` mientras se trabaja (tipos, lint y pruebas de lo tocado) y `npm run check` antes de pushear. Ningún test automático llama a la IA real.

**Si sos un implementador.** Leé tu ticket y las secciones del spec que nombra, tocá solo los archivos del ticket (si necesitás otro, respondé `BLOQUEADO: <qué y por qué>`), escribí las pruebas junto con el código, nunca edites una migración ya commiteada ni corras `db reset`, y cerrá con un commit en español que diga qué cambia para el usuario.
