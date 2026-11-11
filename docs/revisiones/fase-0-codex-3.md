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
