# Plan del equipo: build 101

**Sábado 17/10, 9:00 a 21:00 · Domingo 18/10, 9:00 a 16:00 · FIUM/LATU.** No se puede quedar a dormir: el lugar cierra a la noche.
La consigna se conoce en el kickoff. Se gana con **producto funcionando + pitch en vivo**.

## Roles

| | Producto (P) | Dev A: front y demo | Dev B: agente y datos |
|---|---|---|---|
| **Es dueño de** | La idea, el usuario, el pitch y el guión de demo | Lo que el jurado *ve* | Lo que la IA *hace* |
| **Carpetas** | `docs/` | `app/` (páginas), `components/` | `app/api/`, `lib/agent/`, `data/` |
| **Agentes de Claude Code** | — | `frontend`, `qa-demo` | `backend`, `qa-demo` |
| **Decide** | Alcance: qué entra y qué no | Cómo se ve | Qué tools y qué datos |
| **Entregable del sábado** | Pitch v1 ensayado, nombre, slides mínimas | UI de la demo pulida y deployada | Agente con 2 a 4 tools y datos realistas |

Regla de oro: **cada uno toca solo sus carpetas.** Lo único compartido es el contrato entre front y agente (formato del request y de los eventos que devuelve la API), que se define entre las 10:45 y las 11:15. Si alguien lo cambia, avisa en voz alta.

### Cómo trabajar en simultáneo con los agentes
Cada dev abre Claude Code en su compu, en el repo, y delega en su agente:
- Dev A: *"usá el agente frontend para armar la pantalla de resultados según el guión de docs/IDEAS.md"*
- Dev B: *"usá el agente backend para crear la tool consultar_stock con aprobación"*

Mientras el agente trabaja, la persona sigue con otra cosa: prueba en el navegador, habla con mentores o prepara datos. Antes de cada merge o checkpoint, cualquiera corre *"usá el agente qa-demo"*.

Como el contrato se acuerda primero, Dev A puede avanzar la UI sin esperar a que el agente de Dev B esté listo. Los dos integran en cada checkpoint.

## Hoy (viernes): preparación
- [ ] Crear el repo en GitHub, pushear el scaffold y sumar a los 3 como colaboradores
- [ ] Conseguir `ANTHROPIC_API_KEY` (o confirmar los créditos que da el evento)
- [ ] Tener cuenta de Vercel y que el proyecto quede conectado al repo
- [ ] Producto: leer el dossier de ganadores y el perfil del jurado (`CLAUDE.md`)
- [ ] Llevar: notebook, cargador, zapatilla/alargue, cédula, adaptador HDMI/USB-C, auriculares

## Sábado 17

| Hora | Producto | Dev A | Dev B |
|---|---|---|---|
| 9:00 | Llegar, wifi, pantallas | Clonar, `npm install`, `npm run dev` andando; deploy inicial en Vercel | Clonar, instalar `@anthropic-ai/sdk`, probar la API key |
| **Kickoff** | Anota la consigna **textual** y las pistas sobre criterios | Igual | Igual |
| Kickoff + 0:45 | Lleva las ideas y modera; los 3 discuten el top 4 | Opina sobre factibilidad de UI | Opina sobre factibilidad de datos y APIs |
| **≈10:45 DECISIÓN** | Idea elegida, frase del problema y guión de demo en 3 pasos en `docs/IDEAS.md` | | |
| 10:45 a 11:15 | Escribe el guión de demo (es la spec) | Bosqueja las pantallas; acuerda el contrato con Dev B | Define las tools (nombre, input, aprobación); acuerda el contrato con Dev A |
| 11:15 a 14:00 | Datos realistas para Dev B; valida el dolor con mentores; pone nombre | Pantallas del guión | Agente, tools, prompt y datos |
| **14:00 CHECKPOINT 1** | ¿Se puede hacer la demo de punta a punta, aunque sea fea? Merge y `qa-demo` | | |
| 14:00 a 18:00 | Pitch v1 en `docs/PITCH.md`; feedback de mentores | El "wow" visual; resultados concretos en pantalla | Robustez; el "wow" del agente (WhatsApp, voz o datos reales) |
| **18:00 CHECKPOINT 2** | Deploy en Vercel; la demo corre sobre la URL deployada | | |
| 18:00 a 20:00 | Slides mínimas; preguntas del jurado | Pulido para proyector y mobile | Casos borde del guión; errores claros en la UI |
| 20:00 a 20:45 | **Ensayo 1 cronometrado** con feedback brutal entre los 3 | | |
| 20:45 a 21:00 | Push de todo; grabar **video de la demo** como plan B; lista de pendientes | | |

## Domingo 18

| Hora | Qué |
|---|---|
| 9:00 | Arreglar lo que falló en el ensayo 1. Confirmar el horario de pitch con la organización. |
| **≈11:30 FEATURE FREEZE** | Después de esto, solo bugs del camino de la demo. Nada nuevo. Ajustar la hora al cronograma real de pitches (freeze unas 2 horas antes). |
| Freeze a pitch | `qa-demo` sobre la URL de producción; 3 ensayos con cronómetro; decidir quién maneja la compu y quién habla; tener abierto el video de plan B. |
| Pitch | Demo en vivo. Si algo falla: pasar al video, sin pedir perdón. |

## Reglas para decidir rápido
- **Una frase.** Si la idea no entra en una frase con un usuario concreto, no es la idea.
- **Demo primero.** El guión de 3 pasos se escribe antes que el código. Lo que no está en el guión no se construye.
- **La IA hace, la persona aprueba.** Toda acción real lleva aprobación humana visible.
- **Cortar alcance > trasnochar.** En el checkpoint 1, si no hay demo de punta a punta, se recorta.
- **Nada de refactors** después del checkpoint 2.
