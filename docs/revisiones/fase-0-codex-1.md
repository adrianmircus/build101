# Revisión de Codex de la fase 0 (código), ronda 1

Revisión de solo lectura de `git diff 0244c25..plataforma/fase-0` antes del push. Pasaron las 372 pruebas, lint y los dos chequeos de tipos.

1. **R1 · Alta — [lib/server/log.ts:42](lib/server/log.ts:42).** La corrección de privacidad sigue incompleta: quitar textos entre comillas deja pasar datos personales sin comillas. Reproduje que `Error("estudiante Ana Pérez: perfil tdah")` conserva todo el contenido en `errorMessage`, que `runEntry` registra automáticamente. **Arreglo:** omitir mensajes arbitrarios; registrar códigos y mensajes de un catálogo controlado, con pruebas de errores que contienen datos sin comillas.

2. **R2 · Media — [eslint/rules/imports.mjs:11](eslint/rules/imports.mjs:11).** Los aliases `@/` no se normalizan. Desde dominio, importar `@/lib/domain/../server/log` pasa ESLint sin avisos; comprobé que TypeScript lo resuelve a `lib/server/log.ts`. También permite disfrazar imports de repos o código viejo. **Arreglo:** normalizar los aliases igual que las rutas relativas antes de comprobar las capas y agregar estas variantes a las pruebas.

3. **R3 · Media — [eslint/rules/imports.mjs:32](eslint/rules/imports.mjs:32).** El visitante ignora templates literales en `import()`. Reproduje que ``export const loadReact = () => import(`react`)`` dentro de dominio pasa todas las reglas, aunque rompe su pureza. **Arreglo:** resolver también templates sin interpolaciones y definir cómo se rechazan destinos dinámicos que no puedan comprobarse.

4. **R4 · Media — [eslint/rules/server-only.mjs:15](eslint/rules/server-only.mjs:15).** `import type {} from "server-only"` satisface la regla pero desaparece al compilar. Lo comprobé además con el compilador de Next instalado: el import normal bloquea la compilación cliente y esta variante pasa. Se pierde la protección ante imports indirectos desde el cliente. **Arreglo:** exigir el import de efecto literal `import "server-only"` y probar expresamente los imports de tipo.

5. **R5 · Media — [tests/e2e/known-bugs.spec.ts:10](tests/e2e/known-bugs.spec.ts:10).** `test.fail()` admite como esperado cualquier fallo del caso, incluidos los de `walkToChanges` y los guards. Una regresión específica de 1280×720 puede dejar verde esta prueba sin llegar siquiera al botón que pretende comprobar. **Arreglo:** hacer obligatoria la preparación y comprobar explícitamente el estado defectuoso conocido, de modo que otros errores fallen normalmente.

6. **R6 · Media — [tests/e2e/support/student.ts:16](tests/e2e/support/student.ts:16).** La corrección no inspecciona los nombres accesibles completos. Por ejemplo, un botón con `aria-labelledby` apuntando a un nodo oculto que diga «Motriz» pasa: el texto no aparece en `innerText` y el selector omite esa relación, aunque el lector de pantalla anuncia el perfil. **Arreglo:** comprobar nombres y descripciones accesibles resueltos, incluyendo referencias a contenido oculto.

7. **R7 · Media — [lib/server/entry/defineAction.ts:22](lib/server/entry/defineAction.ts:22), también [defineRoute.ts:51](lib/server/entry/defineRoute.ts:51).** La validación queda fuera del manejo de excepciones. Reproduje que un esquema con `.transform(JSON.parse)` y JSON inválido rechaza la acción con `SyntaxError`, sin devolver `Result`, registrar el error ni correlacionarlo con el pedido. **Arreglo:** incluir la validación en el manejo común de errores, conservando `INVALID` para errores de esquema y `unstable_rethrow` para Next.

Pasaron las **372 pruebas**, lint y ambos chequeos de tipos; desactivé la caché incremental para evitar escrituras. No ejecuté Playwright. El árbol de trabajo quedó sin cambios.

Veredicto: no listo (bloqueantes: R1, R2, R3, R4, R5, R6, R7).
