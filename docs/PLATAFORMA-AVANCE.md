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
| T0.4 CI | Hecho | `plataforma/fase-0` | Orquestador | Sin migraciones | Corre en los PR y en main: se prueba en GitHub con el primer PR |
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

### Revisión de Codex

Codex revisó la fase en 15 rondas (`docs/revisiones/fase-0-codex-1.md` a `-3.md`):

- **Ronda 1:** 7 hallazgos. Logs que podían llevar datos de estudiantes en el mensaje del error, validación fuera del manejo de errores, alias que esquivaban las capas, `server-only` como import de tipo, y dos pruebas de Playwright demasiado blandas. Los arreglaron T0.9a, T0.9b y T0.9c.
- **Rondas 2 a 14:** cada una encontró otra forma de escribir un import que pasaba las reglas de capas. La solución final no mira el texto: le pregunta a TypeScript qué archivo carga cada import (`ts.resolveModuleName` y `ts.preProcessFile`) y juzga ese archivo o ese paquete.
- **Ronda 15:** pasada sistemática por cada regla de capas con las formas normales de importar. Todas bloqueadas. Veredicto: listo para push.

Quedan como baja, aceptadas: accesos deliberados por cadenas al namespace global de React (`Reflect.get(globalThis, "React")`).

### Cierre

`npm run check` en verde sobre `plataforma/fase-0`: tipos (con el chequeo estricto), lint, 454 pruebas, build y Playwright (19 pasan, 3 salteadas por proyecto). Pusheada al fork el 11/11/2026. Falta T0.6, que necesita un deploy en Netlify.

## Fase 1 · Base: esquema, privilegios, RLS y acceso a datos

Rama: `plataforma/fase-1`, desde `plataforma/fase-0`. Contrato: `docs/contratos/fase-1.md`, aprobado por Codex en la novena ronda (`docs/revisiones/fase-1-contrato-codex.md`). Lecciones para los tickets de base: `docs/contratos/fase-1-lecciones.md`.

| Ticket | Qué | Quién | Revisión de Codex |
|---|---|---|---|
| T1.1a | Supabase local, clientes, privilegios cerrados por defecto y CI con la base | backend (Sonnet) | Con la fase 0 |
| Contrato | 45 tablas en `app`, 73 RPC en `api`, rol `tiza_student`, dominio y matriz | Opus | 9 rondas |
| T1.2a, T1.2b | Identidad, grupos, estudiantes, inscripciones y listados | backend (Sonnet) | Arreglos en T1.2a-fix y T1.2b-fix |
| T1.3a, T1.3b | Perfiles, lecturas auditadas, reconstrucción, notas y consentimientos | backend (Sonnet) | Arreglos en T1.3b y T1.F2 |
| T1.4a a T1.4e | Prácticos, versiones, contenido y aprobación, generaciones y clave | backend (Sonnet) | Arreglos en T1.F3, T1.F4, T1.4c-fix, T1.4d-fix y T1.4e |
| T1.5a a T1.5d | Publicación mínima, intentos, corrección y lo que ve el estudiante | backend (Sonnet) | Arreglos en T1.F5, T1.F6 y T1.F7 |
| T1.6a a T1.6c, T1.7a a T1.7c | `callRpc`, fábricas y todos los repos | backend (Sonnet) | Un arreglo en `callRpc` |
| T1.8 | La matriz de permisos probada rol por rol contra las RPC y REST | backend (Sonnet) | En la revisión de cierre |
| T1.9 | Inventario de datos personales, campo por campo | backend (Sonnet) | Arreglos de la tanda 1 |
| T1.R | Carreras reales con dos conexiones | backend (Sonnet) | Arreglos en T1.F2 |
| T1.F3 | Idempotencia de todas las altas | Opus | Arreglos en T1.F4 |

Además, en esta fase:

- **Demo guiada:** el recorrido ya no se congela en máquinas lentas. La capa del recorrido tenía su propio nombre de transición de vista y el navegador sacaba una foto de unos 20.000 px por lado en cada cambio de página (arreglo: `contain: paint`). La burbuja siempre entra en la pantalla, el foco pasa al título en cada paso, y el nombre del botón va en negrita y no en itálica.
- **Celular:** la pantalla de grupo entra en 320 px sin desborde horizontal (WCAG 1.4.10).
- **Diseño de la fase 2:** opciones en `docs/diseno/fase-2/` (rama `plataforma/f2-diseno`), para que el usuario elija.

### Cierre

Revisión de cierre de Codex en nueve rondas (`docs/revisiones/fase-1-cierre-codex-1.md` y `fase-1-cierre-codex-2.md`), con los arreglos T1.F8 a T1.F15: razones alineadas con el front, guardias de pertenencia e identidad en las 45 tablas, ninguna tabla se trunca y la primera cuenta de un estudiante no se cambia por otra (ni de a pasos ni con dos escrituras a la vez). Veredicto de la novena ronda: «fase lista para push».

Desde cero (`db:reset`) aplican las 44 migraciones y pasan 2806 pruebas pgTAP. Pasan también tipos, lint, 554 pruebas de unidad y 383 de integración (carreras incluidas), build y 26 de punta a punta. Recorrido en el navegador: demo a 1280×720 y en celular, sin errores de consola.

### Decisiones para confirmar con el usuario

- **`students.interface` es un ajuste de accesibilidad que elige el staff (T1.F8).** Dice qué herramientas ofrece la pantalla: estándar, mirada o voz. Ya no se deriva del perfil, porque leerlo dejaba deducir el perfil. Lo cambia `set_student_interface`; la UI de la fase 6 puede sugerir la mirada al marcar motriz, siempre como acción del staff.
- **Lectura en voz alta para todos.** `aids.readAloud` es verdadero en toda publicación, como la app de hoy, que muestra «Escuchar» sin mirar el perfil.

## Fase 2 · Cuentas reales

Rama: `plataforma/fase-2`, desde `plataforma/fase-1`. Contrato: `docs/contratos/fase-2.md`.

El 12/11/2026 el usuario eligió las recomendaciones del diseño (`docs/diseno/fase-2/README.md`): login del profe A con el error por campo y el bloqueo de B, invitación A con la marca de otro correo de B, login del estudiante A con el escaneo de C, tarjetas B con «Tarjeta nueva» de C, y panel B con las listas de A. El QR no alcanza para entrar: siempre se pide la contraseña.

| Ticket | Qué | Quién | Estado |
|---|---|---|---|
| Contrato | Tablas, RPC, servicios, entradas y tickets | Opus | En revisión de Codex |
