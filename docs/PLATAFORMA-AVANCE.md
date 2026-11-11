# Avance de la plataforma

Registro de cada ticket de `docs/PLATAFORMA.md`: estado, rama, quién lo hizo, hash de migraciones de su última prueba y hallazgos abiertos. Lo actualiza el orquestador al cerrar cada tanda.

## Fase 0 · Cimientos

Rama: `plataforma/fase-0`, desde `0244c25`.

| Ticket | Estado | Rama | Quién | Migraciones | Hallazgos abiertos |
|---|---|---|---|---|---|
| Base | Hecho | `plataforma/fase-0` | Orquestador | Sin migraciones | |
| T0.1 Vitest | En curso | `plataforma/t0-1-vitest` | backend (Sonnet) | Sin migraciones | |
| T0.2 ESLint | Hecho, a revisar | `plataforma/t0-2-eslint` | backend (Sonnet) | Sin migraciones | `lib/errors.ts:56` viola la regla de `as` (`ERROR_CODES as readonly string[]`); lo arregla quien toque `lib/errors.ts`, con `ERROR_CODES.some((c) => c === value)`. Hasta entonces `npm run lint` falla ahí |
| T0.3 Playwright | En curso | `plataforma/t0-3-playwright` | frontend (Sonnet) | Sin migraciones | |
| T0.4 CI | Pendiente | | | | |
| T0.5 Esqueleto de capas | Hecho | `plataforma/fase-0` | Orquestador | Sin migraciones | |
| T0.6 Compuerta de Netlify | Pendiente | | Orquestador y usuario | | |
| T0.7 AGENTS.md y README | Pendiente | | Orquestador | | |

### Decisiones de la fase

- `noUncheckedIndexedAccess` rige solo para el código nuevo (`lib/errors.ts`, `lib/domain`, `lib/server`, `lib/client`, `tests`) por `tsconfig.strict.json`. Prenderlo en todo el repo da unos 600 errores en archivos que se van a reescribir; cada archivo viejo entra cuando se migra.
- `@types/node` pasa a 24, la versión de Node de CI, porque Vitest 5 no acepta los tipos de Node 20.
- `defineAction` recibe `{ name, input }` y el handler: el nombre estable sirve para los logs.
- La base de la fase deja fijos los scripts de `package.json` (`typecheck`, `test`, `test:e2e`, `check`, `check:ticket`) para que los tickets no se pisen en ese archivo.
