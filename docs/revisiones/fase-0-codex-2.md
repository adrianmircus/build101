# Revisión de Codex de la fase 0, ronda 2

| ID | Estado | Motivo |
|---|---|---|
| R1 | resuelto | Los errores ajenos ya no registran mensajes arbitrarios. Los ejemplos con datos personales quedan omitidos. |
| R2 | parcial | Normaliza `..`, pero otros aliases válidos para TypeScript siguen esquivando las reglas. |
| R3 | parcial | Detecta templates y destinos dinámicos en `.ts`, pero dominio en `.tsx` queda fuera de la nueva restricción. |
| R4 | resuelto | Exige el import de efecto; rechaza imports de tipo, vacíos y con bindings. |
| R5 | resuelto | Preparación y guards fallan normalmente; el defecto conocido se comprueba explícitamente sin `test.fail()`. |
| R6 | resuelto | El bypass original con referencias a nodos ocultos queda cubierto mediante nombres y descripciones resueltos. Hay otro canal omitido, descrito en N1. |
| R7 | resuelto | Las excepciones del esquema devuelven `INTERNAL` correlacionado; la validación habitual conserva `INVALID` y las excepciones de Next se propagan. |

Persisten estos bloqueantes:

- **R2 — Media — [eslint/rules/imports.mjs:13](eslint/rules/imports.mjs:13).** Desde dominio, `import * as x from "@//lib/server/log"` pasa ESLint sin avisos y TypeScript resuelve al módulo del servidor. También comprobé el bypass hacia código viejo con `@///lib/groups/store` y con barras invertidas. **Arreglo:** canonicalizar los aliases conforme a la resolución de TypeScript, incluyendo separadores repetidos y de Windows, y agregar regresiones.

- **R3 — Media — [eslint/newCode.mjs:7](eslint/newCode.mjs:7).** `lib/domain/**/*.ts` excluye `.tsx`. Reproduje cero avisos para `const name = "react"; export const load = () => import(name)` como archivo de dominio `.tsx`; el mismo destino dinámico en `.ts` se rechaza. **Arreglo:** cubrir `.tsx` o prohibir esa extensión explícitamente en dominio, alineando también el chequeo estricto.

Hallazgo nuevo:

- **N1 — Media — [tests/e2e/support/a11y-tree.ts:60](tests/e2e/support/a11y-tree.ts:60).** Solo extrae `name` y `description`; omite propiedades anunciadas como `roledescription` y `valuetext`. Un control con nombre inocuo y perfil en `aria-roledescription` o `aria-valuetext` puede escapar del chequeo. Con una respuesta CDP simulada, comprobé que ambos textos se descartan; no lo ejecuté en navegador. **Arreglo:** inspeccionar esas propiedades y los valores accesibles pertinentes, y agregar casos de regresión.

No encontré otros hallazgos de severidad alta o media en el diff completo de la fase.

Pasaron **397 pruebas**, lint y ambos chequeos de tipos, con cachés e incremental desactivados. No ejecuté Playwright ni modifiqué archivos; el árbol quedó limpio.

Veredicto: no listo (bloqueantes: R2, R3, N1).
