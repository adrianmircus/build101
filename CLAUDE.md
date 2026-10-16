@AGENTS.md

# build 101: proyecto del equipo

Hackathon de IA en Montevideo (FIUM/LATU). Sábado 17/10 de 9:00 a 21:00 y domingo 18/10 de 9:00 a 16:00. Equipos de 3 personas.
La consigna se revela en el kickoff. Se evalúa **el producto funcionando y el pitch en vivo** frente al jurado.
Lema del evento: "no alcanza con usar IA. construí un producto de IA."

Roles y horarios: `docs/PLAN.md`. Idea elegida y guión de demo: `docs/IDEAS.md`. Pitch: `docs/PITCH.md` (los dos los escribe Producto).

## Qué gana (dossier de 31 ganadores de hackathones de IA)
1. El problema entra en una frase, con un usuario concreto.
2. La IA **actúa** (hace la tarea), no solo conversa. Evitar el "wrapper de chat".
3. Usa canales que la gente ya tiene (WhatsApp, SMS, voz).
4. La demo se ve: algo visual, voz o cámara.
5. Encaja con lo que buscan el jurado y los sponsors (fintech, logística, delivery, salud, HR/payroll).
6. Responde "¿y si la IA se equivoca?": límites y aprobación humana.
7. Es local: un problema de Uruguay.
8. Alcance chico y **terminado**.

## Jurado
Fundadores y CTOs del ecosistema uruguayo: PedidosYa, Nowports, Akua, Pento, Lynk Markets, Picante, BigCheese, InGenia, Promtior, odev.tech, Instituto Vidart y el decano de la FIUM.
Sponsors gold: Toyota, Pento, Santander, Nowports, odev.tech, Lynk Markets, Mozart, Instituto Vidart, entre otros.

## Stack
Scaffold de Next.js (App Router, TypeScript, Tailwind), todavía sin código propio. La IA va con la API de Claude (`@anthropic-ai/sdk`, modelo `claude-opus-5-5`), que se instala el sábado.
Esta versión de Next.js trae cambios: ante la duda, revisar `node_modules/next/dist/docs/`.

## Estructura y dueños (se crea el sábado; sirve para trabajar en paralelo sin pisarse)
| Carpeta | Dueño |
|---|---|
| `app/` (páginas), `components/` | Dev A (front) |
| `app/api/`, `lib/agent/`, `data/` | Dev B (agente) |
| Contrato front↔agente (formato de request y eventos) | **compartido**; se define entre las 10:45 y las 11:15, y cambiarlo exige avisar al otro dev |
| `docs/` | Producto |

## Reglas
- La UI y los textos van en español rioplatense.
- Toda acción de la IA con efecto real (enviar, pagar, reservar, publicar) lleva aprobación humana visible.
- Antes de pushear: `npx tsc --noEmit && npm run lint`.
- Prioridad absoluta: que **el camino de la demo** funcione siempre. No refactorizar lo que ya anda.
