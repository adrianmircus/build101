# Revisión de Codex de la fase 0, ronda 3

| ID | Estado | Motivo |
|---|---|---|
| R2 | parcial | Bloquea separadores repetidos y de Windows, pero permite aliases que salen del repositorio y vuelven a entrar. |
| R3 | resuelto | `.tsx` recibe las reglas nuevas, se prohíbe en dominio y queda incluido en el chequeo estricto. Los intentos con imports dinámicos fallan también en subdirectorios. |
| N1 | resuelto | Recoge `roledescription`, `valuetext`, valores accesibles y atributos DOM. Los casos originales funcionan con CDP simulado. |

**R2 — Media — [imports.mjs:16](eslint/rules/imports.mjs:16).** Desde dominio, `import * as x from "@/../fase-0/lib/server/log"` produce **cero avisos de ESLint** y compila sin errores. TypeScript resuelve al archivo real del servidor. También escapa `@/../fase-0/lib/groups/store`. El resolver descarta el destino por comenzar con `../` sin comprobar que vuelve al repositorio. Debe resolver el alias contra `cwd` antes de evaluar sus límites.

No confirmé otros hallazgos nuevos de severidad alta o media introducidos por el diff.

Pasaron **416 pruebas**, lint y ambos chequeos de tipos. N1 se comprobó con CDP simulado; Chromium no pudo arrancar por `EPERM`, por lo que el intento adicional con Shadow DOM quedó sin confirmar. No modifiqué archivos; el árbol sigue limpio.

Veredicto: no listo (bloqueantes: R2).

## Ronda 4 (confirmación de R2)

**R2: parcial.** El escape `@/../fase-0/...` quedó corregido, pero encontré otro bypass de severidad **media** en [imports.mjs:16](eslint/rules/imports.mjs:16): las rutas absolutas se descartan sin comprobar las capas.

Desde `lib/domain/probe.ts`, importar `C:/Users/adrim/build101/.claude/worktrees/fase-0/lib/server/log` produce **cero avisos de ESLint y cero errores de TypeScript**, comprobado en memoria.

Lint y las **217 pruebas** de ESLint pasan. Árbol limpio.

Veredicto: no listo

## Ronda 5

R2 sigue abierto. Reproduje tres bypasses **P1 (alta)** desde `lib/domain`: ESLint sin mensajes y TypeScript resuelve el módulo.

- Mayúsculas: `@/LIB/server/log` y `@/Lib/groups/store`.
- Rutas Windows con prefijos `//?/C:/…` y `//./C:/…`, hacia `lib/server/log` y `lib/groups/store`.
- Ruta corta 8.3: `C:/Users/adrim/build101/.claude/WORKTR~1/fase-0/lib/server/log` y su equivalente hacia `lib/groups/store`.

`lint` y los 219 tests de ESLint pasan pese a estos bypasses. Sin cambios en archivos.

Veredicto: no listo

## Ronda 6

**R2 sigue abierto — severidad alta.** Bypasses reproducidos desde `lib/domain`:

- `@/LIB/server/log.js` → `lib/server/log.ts`.
- `@/Lib/groups/store.js` → `lib/groups/store.ts`.

En ambos, TypeScript resuelve y ESLint devuelve cero mensajes. También reproduje variantes con `.jsx`, `.d.ts`, rutas relativas, absolutas y prefijos `//?/` y `//./`.

La sustitución de extensiones de TypeScript evita que `realFile` encuentre el archivo; conserva las mayúsculas y elude las reglas.

Lint y las 224 pruebas existentes pasan.

Veredicto: no listo

## Ronda 7

R2 sigue abierto. **P2: bypass mediante rutas de paquete con `../`**, reproducido desde `lib/domain`:

- `typescript/../../lib/server/log`
- `typescript/../../lib/groups/store`
- `@types/node/../../../lib/server/log`
- `typescript/../../LIB/SERVER/LOG.js`

ESLint queda sin mensajes y TypeScript resuelve los archivos reales. Los dos primeros también compilan sin diagnósticos. El resolver descarta estos specifiers como paquetes antes de normalizarlos.

`npm run lint` y las 230 pruebas de ESLint pasan pese al bypass. Sin cambios en archivos.

Veredicto: no listo

## Ronda 8

**Media: persiste un bypass** en [imports.mjs:94](/C:/Users/adrim/build101/.claude/worktrees/fase-0/eslint/rules/imports.mjs:94): los visitantes omiten `TSImportType`.

Desde `lib/domain/r2-probe.ts`:

```ts
export type Probe =
  import("typescript/../../lib/server/log").LogFields;
```

TypeScript resuelve `lib/server/log.ts`, compila sin diagnósticos con `strict` y `noUncheckedIndexedAccess`, y ESLint devuelve **cero mensajes**. El resolver nuevo no llega a ejecutarse para ese nodo.

Las variantes de rutas probadas en imports convencionales fueron detectadas. No reproduje falsos positivos ni crashes introducidos por el cambio.

- `npm run lint`: correcto, **15,53 s**.
- `npx vitest run eslint`: **234 pruebas aprobadas**.
- Sin cambios en archivos.

Veredicto: no listo

## Ronda 9

R2 sigue abierto. Reproduje tres escapes en memoria, sin modificar archivos. En todos, TypeScript cargó `lib/server/log.ts` sin errores y ESLint devolvió **cero mensajes**:

- En `lib/domain/probe.ts`: `/// <reference preserve="true" path="../server/log.ts" />`
- En ese mismo archivo: `/// <reference PATH="../server/log.ts" />`

  La [expresión regular](eslint/rules/imports.mjs:94) omite ambos formatos, que TypeScript acepta.

- En `lib/domain/probe.mts`: `export type P = import("@/lib/server/log").LogFields;`

  `tsconfig.json` incluye `.mts`, pero las [reglas de capas](eslint/layers.mjs:7) solo cubren `.ts` y `.tsx`.

Veredicto: no listo

## Ronda 10

R2 sigue abierto. Reproducido en un archivo virtual `lib/domain/probe.ts`, sin escribir al disco:

```ts
/// <reference preserve=">" path="../server/log.ts" />
export const probe = 1;
```

TypeScript carga `lib/server/log.ts`, sin diagnósticos en el archivo de prueba; ESLint devuelve **cero mensajes**. El `>` entre comillas corta la búsqueda de `path` en la regex de `eslint/rules/imports.mjs:95`.

Árbol de trabajo limpio.

Veredicto: no listo

## Ronda 11

**R2 sigue parcialmente abierto.**

- **Media:** [imports.mjs:100](/C:/Users/adrim/build101/.claude/worktrees/fase-0/eslint/rules/imports.mjs:100) omite `typeReferenceDirectives`. En dominio, esto pasa ESLint y TypeScript estricto sin mensajes:

  ```ts
  /// <reference types="react" />
  export type View = React.ReactNode;
  ```

  También pasa `types="next"`. Es sintaxis habitual, plausible para un implementador honesto. Falta comprobar esas directivas mediante `ts.resolveTypeReferenceDirective`.

- **Baja:** `import("../../node_modules/@types/react/index").ReactNode` también evade la prohibición de React en dominio; requiere una ruta inusual.

No encontré otros problemas nuevos de alta/media fuera de las revisiones anteriores. Pasaron lint, **445 pruebas** y ambos chequeos de tipos. Árbol limpio.

Veredicto: no listo

## Ronda 12

**R2 sigue abierto.**

- **Media — [layers.mjs:9](/C:/Users/adrim/build101/.claude/worktrees/fase-0/eslint/rules/layers.mjs:9):** desde `lib/domain/probe.ts`, este código pasa ESLint y TypeScript estricto sin diagnósticos:

  ```ts
  /// <reference types="@types/react" />
  export type View = React.ReactNode;
  ```

  También pasa `types="@types/react-dom"`. Son nombres normales de paquetes instalados, plausibles para un implementador honesto. La regla reconoce `react`, pero omite `@types/react`.

- **Baja, no bloqueante:** reproduje el escape ya aceptado mediante `import("../../node_modules/@types/react/index").ReactNode`.

No confirmé otros problemas nuevos de alta/media fuera de las revisiones anteriores.

Pasaron lint, **447 pruebas** y ambos chequeos de tipos. Sin modificaciones; árbol limpio.

Veredicto: no listo
