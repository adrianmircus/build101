# Avance de la plataforma

Registro de cada ticket de `docs/PLATAFORMA.md`: estado, rama, quién lo hizo, hash de migraciones de su última prueba y hallazgos abiertos. Lo actualiza el orquestador al cerrar cada tanda.

## Fase 0 · Cimientos

Rama: `plataforma/fase-0`, desde `0244c25`.

| Ticket | Estado | Rama | Quién | Migraciones | Hallazgos abiertos |
|---|---|---|---|---|---|
| Base | Hecho | `plataforma/fase-0` | Orquestador | Sin migraciones | |
| T0.1 Vitest | Mergeado | `plataforma/t0-1-vitest` | backend (Sonnet) | Sin migraciones | Umbral de cobertura (80 %) activo, sin archivos todavía en lib/domain y lib/server/services |
| T0.2 ESLint | Mergeado | `plataforma/t0-2-eslint` | backend (Sonnet) | Sin migraciones | 34 archivos viejos en `eslint/legacy.mjs`, congelados en su tamaño |
| T0.3 Playwright | Mergeado | `plataforma/t0-3-playwright` | frontend (Sonnet) | Sin migraciones | Encontró bugs de la demo (ver abajo) |
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

### Revisión independiente de la fase

Un revisor que no vio el código encontró 1 hallazgo alto, 9 medios y 8 bajos. Se arreglaron en tres tickets en paralelo:

| Ticket | Qué arregló |
|---|---|
| T0.8a entradas y logs | `callAction` deja pasar `redirect()`; logs con lista de permitidos y sin valores entre comillas en los mensajes de error; mensajes de validación en español; `defineRoute` con `params`; pruebas que fallan si se saca `unstable_rethrow` |
| T0.8b ESLint | Capas que resuelven el archivo real (barrels, `import()`, rutas raras); excepciones congeladas en su tamaño de hoy, con prueba de que cada una sigue haciendo falta (quedan 34); código nuevo sin `!` ni `@ts-*`; `check:ticket` corre las pruebas de lint |
| T0.8c Playwright | Bugs conocidos como pruebas que se ponen rojas al arreglarse; puerto por `E2E_PORT`; falla con errores de consola; el chequeo de que el estudiante no ve su perfil mira también nombres accesibles |
| Orquestador | CI una vez por PR; `CLAUDE.md` pide `npm run check` antes de pushear |

### Bugs de la demo

1. **Arreglado.** En el celular el recorrido se trababa después de entrar al grupo: `pageMoving()` (`components/demo/Tour.tsx`) contaba una transición de página ya terminada. Ahora cuenta solo las que corren y espera como mucho 1,5 s. También trababa el escritorio en máquinas cargadas.
2. **Abierto.** Burbuja fuera de pantalla en pasos con un elemento alto («Cada cambio, con su porqué», «Para responder con la mirada»): a 1280×720 el botón «Seguir» queda debajo. Lo fija un `test.fail()` en `tests/e2e/known-bugs.spec.ts`.
3. **Abierto.** En los pasos con elemento resaltado el foco no pasa al título de la burbuja.
4. **Ya no se reproduce** con el arreglo del 1: con movimiento reducido el recorrido llega al final. Queda como prueba normal.
5. **Abierto.** En el celular, una transición de vista abortada por un cambio de tamaño de pantalla deja una promesa rechazada sin atrapar («Transition was aborted because of invalid state»). Es la única entrada permitida en `ALLOWED_CONSOLE_ERRORS`.

### Cierre

`npm run check` en verde sobre `plataforma/fase-0`: tipos (con el chequeo estricto), lint, 372 pruebas, build y Playwright en escritorio y celular. Falta T0.6, que necesita un deploy en Netlify.
