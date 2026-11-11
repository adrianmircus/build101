# Avance de la plataforma

Registro de cada ticket de `docs/PLATAFORMA.md`: estado, rama, quién lo hizo, hash de migraciones de su última prueba y hallazgos abiertos. Lo actualiza el orquestador al cerrar cada tanda.

## Fase 0 · Cimientos

Rama: `plataforma/fase-0`, desde `0244c25`.

| Ticket | Estado | Rama | Quién | Migraciones | Hallazgos abiertos |
|---|---|---|---|---|---|
| Base | Hecho | `plataforma/fase-0` | Orquestador | Sin migraciones | |
| T0.1 Vitest | Mergeado | `plataforma/t0-1-vitest` | backend (Sonnet) | Sin migraciones | Umbral de cobertura (80 %) activo, sin archivos todavía en lib/domain y lib/server/services |
| T0.2 ESLint | Mergeado | `plataforma/t0-2-eslint` | backend (Sonnet) | Sin migraciones | 36 archivos viejos en `eslint/legacy.mjs`. Los `import()` dinámicos no los cubre la regla de capas |
| T0.3 Playwright | Mergeado | `plataforma/t0-3-playwright` | frontend (Sonnet) | Sin migraciones | Encontró 4 bugs de la demo (ver abajo). El proyecto celular apaga las transiciones de vista hasta arreglar el bug 1 |
| T0.4 CI | Hecho | `plataforma/fase-0` | Orquestador | Sin migraciones | Sin probar en GitHub hasta el primer push |
| T0.5 Esqueleto de capas | Hecho | `plataforma/fase-0` | Orquestador | Sin migraciones | |
| T0.6 Compuerta de Netlify | Código listo, falta medir | `plataforma/t0-6-netlify-gate` (temporal, no se mergea) | backend (Sonnet), orquestador y usuario | Sin migraciones | Necesita un deploy preview en Netlify |
| T0.7 AGENTS.md y README | Hecho | `plataforma/fase-0` | Orquestador | Sin migraciones | |

### Decisiones de la fase

- `noUncheckedIndexedAccess` rige solo para el código nuevo (`lib/errors.ts`, `lib/domain`, `lib/server`, `lib/client`, `tests`) por `tsconfig.strict.json`. Prenderlo en todo el repo da unos 600 errores en archivos que se van a reescribir; cada archivo viejo entra cuando se migra.
- `@types/node` pasa a 24, la versión de Node de CI, porque Vitest 5 no acepta los tipos de Node 20.
- `defineAction` recibe `{ name, input }` y el handler: el nombre estable sirve para los logs.
- La base de la fase deja fijos los scripts de `package.json` (`typecheck`, `test`, `test:e2e`, `check`, `check:ticket`) para que los tickets no se pisen en ese archivo.
- En los `*.test.ts` no rige el límite de 40 líneas por función: un `describe` junta todos los casos. Sí rige el de 200 por archivo.
- `check:ticket` toma como base la rama de la fase cuando la rama del ticket sigue el nombre `plataforma/t<fase>-<n>-<slug>`.

### Bugs de la demo que encontró T0.3

1. **Celular:** después de entrar a `/grupos/demo` a 412 px, la burbuja «Cada estudiante, su perfil» no aparece nunca. La transición de vista queda en `finished` sin limpiarse y `pageMoving()` (`components/demo/Tour.tsx`) la cuenta como en curso.
2. **Burbuja fuera de pantalla** en pasos con un elemento alto («Cada cambio, con su porqué», «Para responder con la mirada»): a 1280×720 el botón «Seguir» queda debajo. El escritorio de Playwright corre a 1440×900 por eso.
3. **Foco:** en los pasos con elemento resaltado el foco no pasa al título de la burbuja.
4. **Movimiento reducido:** con `prefers-reduced-motion: reduce` el tour se trabó en «Para responder con la mirada» en escritorio.
