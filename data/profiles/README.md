# Datos de los perfiles

El agente adapta cada práctico usando **solo** lo que dice `data/profiles/<perfil>.md`. Si no está ahí, no se aplica: no inventamos adaptaciones. Si un perfil tiene solo la plantilla, la versión sale sin adaptar y con un aviso.

Perfiles: `adhd` (TDAH), `dyslexia` (dislexia), `asd` (TEA), `motor` (motriz), `dysgraphia` (disgrafía).

## Cómo cargar fuentes

1. **Fuentes.** Dejá los documentos en `data/profiles/<perfil>/sources/` (`.pdf`, `.md` o `.txt`). Ejemplo: `data/profiles/adhd/sources/guia.pdf`.
2. **Destilar.** `npm run profiles:distill -- adhd` (o sin argumentos, para todos los perfiles con fuentes). Usa la misma configuración que la app: `OPENROUTER_API_KEY` (y opcionalmente `OPENROUTER_MODEL`) en `.env.local`, o si no, `ANTHROPIC_API_KEY`. Claude lee cada documento y escribe `data/profiles/adhd.draft.md`, con cada adaptación agrupada por tipo y con su fuente, página y cita.
3. **Revisar.** Leé el borrador contra las fuentes: borrá lo que no aplique a una evaluación escrita y corregí lo que haga falta. El agente nunca lee los `.draft.md`.
4. **Aprobar.** Copiá el borrador revisado a `data/profiles/adhd.md`. La próxima generación ya lo usa, sin reiniciar.

El script nunca pisa `<perfil>.md`; si ya hay un borrador, lo reemplaza.

Si ya existe `<perfil>.md`, el borrador marca con ⚠ lo que contradice algo aprobado y lo junta en una sección al principio. Un especialista decide cuál queda.

Para otra materia: `npm run profiles:distill -- adhd --materia fisica` (opciones: `matematica`, `fisica`, `quimica`; por defecto `matematica`).

## Buscar fuentes con el agente investigador

En vez de buscar los documentos a mano, el agente los puede buscar en la web:

```
npm run profiles:research -- adhd --materia matematica
```

1. **Buscar.** Claude busca y lee páginas **solo** de los sitios de `research-sites.json`, con un tope de búsquedas y de lecturas (`--max-busquedas`, 5 por defecto; `--max-lecturas`, 8 por defecto). La búsqueda lleva solo el nombre del perfil y la materia, nunca nada de un estudiante.
2. **Guardar.** Cada página leída queda en `data/profiles/adhd/sources/web/`, con su URL en `fuentes.json`. Esa carpeta no se commitea (son textos de terceros).
3. **Destilar.** Después destila todas las fuentes del perfil, las del equipo y las de la web, en `adhd.draft.md`. Las fuentes web aparecen con su URL.
4. **Revisar y aprobar.** Igual que antes: un especialista revisa el borrador contra las fuentes y lo copia a `adhd.md`. Hasta entonces, nada de esto llega a un estudiante.

La búsqueda usa Claude Sonnet 5.5, que alcanza para elegir y leer páginas y cuesta la mitad. El destilado sigue con Opus 5.5, porque saca las citas textuales que después se citan en público. Cada llamada imprime los tokens y la cantidad de búsquedas y lecturas, que se cobran aparte. Necesita `ANTHROPIC_API_KEY`: la búsqueda web no pasa por OpenRouter.

La lista de sitios arranca como borrador (`"estado": "borrador"`) y el script avisa hasta que el equipo la apruebe con especialistas.

## Licencias

Antes de commitear PDFs de terceros, revisá que la licencia lo permita. Si no, dejalos solo en tu compu y commiteá el `.md` aprobado, que cita la fuente.
