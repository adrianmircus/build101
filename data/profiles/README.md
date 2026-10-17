# Datos de los perfiles

El agente adapta cada práctico usando **solo** lo que dice `data/profiles/<perfil>.md`. Si no está ahí, no se aplica: no inventamos adaptaciones. Si un perfil tiene solo la plantilla, la versión sale sin adaptar y con un aviso.

Perfiles: `adhd` (TDAH), `dyslexia` (dislexia), `asd` (TEA), `motor` (motriz), `dysgraphia` (disgrafía).

## Cómo cargar fuentes

1. **Fuentes.** Dejá los documentos en `data/profiles/<perfil>/sources/` (`.pdf`, `.md` o `.txt`). Ejemplo: `data/profiles/adhd/sources/guia.pdf`.
2. **Destilar.** `npm run profiles:distill -- adhd` (o sin argumentos, para todos los perfiles con fuentes). Usa la misma configuración que la app: `OPENROUTER_API_KEY` (y opcionalmente `OPENROUTER_MODEL`) en `.env.local`, o si no, `ANTHROPIC_API_KEY`. Claude lee cada documento y escribe `data/profiles/adhd.draft.md`, con cada adaptación agrupada por tipo y con su fuente, página y cita.
3. **Revisar.** Leé el borrador contra las fuentes: borrá lo que no aplique a una evaluación escrita y corregí lo que haga falta. El agente nunca lee los `.draft.md`.
4. **Aprobar.** Copiá el borrador revisado a `data/profiles/adhd.md`. La próxima generación ya lo usa, sin reiniciar.

El script nunca pisa `<perfil>.md`; si ya hay un borrador, lo reemplaza.

## Licencias

Antes de commitear PDFs de terceros, revisá que la licencia lo permita. Si no, dejalos solo en tu compu y commiteá el `.md` aprobado, que cita la fuente.
