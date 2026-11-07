# Spec: landing pública de Tiza.ai

Estado: **v5, versión final construida en `app/page.tsx` (04/11/2026), sin commitear.** Dirección C. Codex aprobó la v2 con cambios, ya aplicados ([revisiones](revisiones/landing-codex-1.md)); desde la v4 cambió el diseño, no los textos. Antes de publicar: ver *Pendiente antes de publicar*.

## Objetivo
Que un profesor, un colegio o una familia que llega a `/` entienda en 5 segundos qué hace Tiza.ai y quiera probarlo. **Éxito:** el visitante toca *Probar la demo* (conversión principal) y termina el recorrido de `docs/DEMO.md`.

La idea fuerte de la página es una sola: **un práctico que se transforma frente a tus ojos.** Lo más llamativo que podemos mostrar es el producto funcionando, no una imagen.

## Insumos
- **Skill `landing-page-design`** de Elaya ([elayadesign/ai-design-skills](https://github.com/elayadesign/ai-design-skills), MIT), instalada en `.claude/skills/landing-page-design/`. Su alcance está limitado a la landing. La tabla *Qué tomamos de la skill* dice qué reglas valen acá; ante un conflicto, gana este spec.
- **Lista de antipatrones del usuario** (ver *Antipatrones*). Si choca con la skill, gana la lista.
- **Higgsfield** (imágenes y video con IA): descartado para v1.
- El producto actual: `docs/DEMO.md`, `data/profiles/*.md` (fuentes de cada perfil), `lib/agent/prompt.ts` (qué puede cambiar el agente) y `data/demo/limites.json`.

## Decisiones tomadas
| Tema | Decisión |
|---|---|
| Públicos | Profesores (principal), colegios y familias. |
| Acción principal | **Probar la demo**, la misma arriba y al final. Es la única acción grande de la página. |
| Acciones secundarias | Una por público y solo en su sección: *Sumar mi colegio al piloto* (colegios) y *Pasáselo al colegio por WhatsApp* (familias). La única excepción en el primer pantallazo es *Ingresar* en la nav: es para quien ya tiene cuenta y va con un estilo de menos peso que el CTA. |
| Promesas | La landing **puede prometer funciones que todavía no están** (decisión del usuario, 04/11). Cada una va marcada **[P]** y queda en *Funciones prometidas*, como pendiente del equipo. |
| Lo que nunca se dice | Lo que **contradice** cómo funciona hoy el producto. Prometer algo que falta está bien; afirmar como hecho algo falso, no. Tampoco se inventan testimonios, logos de colegios, cifras de uso ni precios (ver *Prueba social*). |
| Tipografía | Lexend, como el resto de la app (ver por qué en `app/layout.tsx`). Se probó Geist, la de la skill, en las direcciones A y B, y quedaba genérica. |
| Identidad | El pizarrón (`indigo-950`), el papel (blanco) y un solo acento, `amber-300`, sobre el pizarrón. El fondo de fórmulas va **quieto** (ver *Movimiento*). |
| Idioma | Español rioplatense, en segunda persona (vos). |
| Proceso | Spec → prototipos → elegir dirección → prototipo de la página entera → aprobar → pasar a `app/page.tsx`, con un commit por sección. |
| Dirección visual | **C, "la frase sobre el pizarrón"** (ver *Dirección visual*). |
| Dominio | `usetiza.app`, pero **todavía no se publica ahí**. El origen sale de la variable `NEXT_PUBLIC_SITE_URL`: hoy, la URL de Netlify; cuando se publique, `https://usetiza.app`. Nada en el código tiene el dominio fijo. |
| Contacto para colegios | `mailto:hola@usetiza.app`, con asunto *Quiero sumar mi colegio al piloto de Tiza.ai*. Sin formulario en v1. |
| Condiciones | Lista para el piloto. La landing no habla de precio. |
| Analítica | **No en v1.** Se publica en Netlify y la medición queda para más adelante. |
| FAQ 2 | Queda como está: describe lo que pasa hoy (con mirada o dictado se evalúa una parte, y los apoyos hacen la versión más guiada). Convive con la frase que se ilumina, que es una promesa **[P]**. Decisión del usuario. |
| Privacidad y términos | Claude escribe un primer borrador con lo que hace la app de verdad (qué datos guarda, qué le llega a la IA, qué proveedores usa). Lo revisa Producto y, si se puede, alguien que conozca la Ley 18.331. |
| Fuentes de Motriz y Disgrafía | No frenan la publicación: la landing atribuye fuentes solo a TDAH, dislexia y TEA. |
| Relación con `docs/DEMO.md` | Este spec reemplaza la sección *Landing (`app/page.tsx`)* de DEMO: *Soy profesor* y *Soy estudiante* salen del hero y pasan a *Ingresar* (nav) y al footer. Lo demás de DEMO no cambia, y *Probar la demo* sigue siendo un `<a href="/demo">` común. |

## Dirección visual
Se probaron tres direcciones como prototipos navegables (`/prototipo/a`, `/b` y `/c`):

| | A. La frase que se adapta | B. Antes y después | C. La frase sobre el pizarrón (elegida) |
|---|---|---|---|
| Idea | El titular es el control: elegís el perfil dentro de la frase y la hoja se reescribe. | Una sola hoja con un deslizador entre el original y la versión adaptada. | El concepto de A sobre la identidad de Tiza. |
| Estética | Clara, Geist, verde pizarra. | Oscura (`#131209`), Geist, amarillo tiza. | Pizarrón índigo con fórmulas, ámbar, Lexend. |
| Por qué no / por qué sí | Genérica. | Genérica, y con el deslizador al medio se leen mitades de línea. | Tiene el concepto y la identidad. |

Antes hubo un primer prototipo con chips de perfil y la hoja original al lado de la adaptada. Se descartó porque repetía la landing de la hackathon.

### Qué hace única a C
- El perfil elegido se subraya con un **trazo de tiza** ámbar, irregular y dibujado a mano, no con una línea recta.
- La versión es una **hoja de papel apoyada sobre el pizarrón**: blanca, con sombra y apenas inclinada (−2°) en pantallas anchas. En el celular va derecha.

## Antipatrones
Lista del usuario (04/11). Valen para toda la página y le ganan a la skill:
- Tags (pills, badges, chips con borde).
- Palabras en itálica.
- Instrument Serif y tracking negativo (`tracking-tight` incluido).
- UI recargada de detalle.
- Divisores entre secciones o entre ítems.
- Muchos tonos y opacidades de color.
- Contenedores con borde.
- Diagramas.
- "Code breadcrumbs" (rutas, `// comentarios` o `~/algo` como decoración).
- Numeración de secciones, y tampoco de pasos ("01", "1.").

Cómo se cumple: dos superficies (pizarrón y papel) y un acento. Los bloques se separan con espacio, no con líneas ni bordes. Los pasos de *Cómo funciona* llevan título, no número. Dos secciones blancas seguidas van en un mismo bloque, porque si no queda una costura de menos de un píxel por donde se ve el pizarrón.

## Estructura
Sigue el orden A2 de la skill (tipo A, *hero más secciones*).

| Sección | Fondo | Contenido |
|---|---|---|
| Nav flotante, fija y centrada | Pizarrón translúcido con blur | Logo · Cómo funciona · Colegios · Familias · Preguntas · *Ingresar* |
| Hero | Pizarrón con fórmulas | La frase con el perfil, la bajada, *Probar la demo* y la hoja (ver *El hero*) |
| Problema → solución | Papel | El mismo práctico no se lee igual en toda la clase |
| Frase que se ilumina (B11) | Pizarrón | Lo que se evalúa no cambia… **[P]** |
| Cómo funciona | Papel | Tres pasos con título, sin número |
| Para el aula, el colegio y la casa | Pizarrón | Tres columnas: título en ámbar, beneficios y la acción de cada público |
| De dónde salen las adaptaciones | Papel | El texto de respaldo y las fuentes con su link |
| Preguntas frecuentes | Papel (mismo bloque) | 9 preguntas en `<details>`; la abierta se pinta de `slate-50` |
| CTA final | Pizarrón con fórmulas | Igual al del hero |
| Footer | Pizarrón | Marca grande, *Soy profesor*, *Soy estudiante* y `hola@usetiza.app` |

*Así suena un práctico* va después de los públicos, sobre el pizarrón. Si existe el audio grabado (`public/landing/consigna.mp3` y `data/landing/audio.json`, de `scripts/landing-audio.ts`), muestra el reproductor del navegador. Si no, un botón *Escuchá el práctico* que lee el mismo texto con la voz del navegador (`browserSpeak` de `lib/speech/voice.ts`), como hace la app cuando no está ElevenLabs. **Hoy no hay audio grabado**, porque la clave de ElevenLabs es inválida. El texto que se lee se muestra siempre debajo.

El footer lleva *Soy profesor*, *Soy estudiante*, `hola@usetiza.app`, *Privacidad* y *Términos*.

### El hero
**Qué muestra**
- **El titular, en tres líneas:** *El mismo práctico, / para quien tiene / [dislexia ⌄].* El perfil va en su propia línea, así al cambiarlo solo cambia esa línea y el resto del titular no se mueve.
- **El selector** es un `<select>` nativo transparente, encima de la palabra visible. Su letra es de tamaño normal, así la lista que se abre no sale gigante. Opciones: *TDAH*, *dislexia*, *TEA*, *una dificultad motriz* y *disgrafía*. Arranca en *dislexia*.
- **La hoja:** dice *Para quien tiene {perfil}* y muestra la versión. Para Motriz son las preguntas de opción múltiple, cada opción como un bloque relleno (sin borde) y con la gráfica dibujada.
- **El selector va fuera del `<h1>`**, encima de la palabra y medido con `ResizeObserver`. Así el texto del titular, para buscadores y lectores de pantalla, es la frase y no la lista de opciones.
- **Debajo de la hoja,** una sola línea con el cambio principal (el primer `change`) y el link *Ver el original*, que alterna la hoja con el práctico tal como lo cargó el profe.
- Sin IA en vivo: lee un dato precalculado (ver *Ejemplo de la landing*).

**Accesibilidad**
- El `<select>` tiene `aria-label` *Perfil del estudiante* y foco visible (`focus-on-dark`).
- Al cambiar de perfil, la hoja nueva sube 8 px y aparece en 500 ms (curva de la skill). Con movimiento reducido, el cambio es instantáneo.
- **Sin JS**, la palabra es texto común (*dislexia*) y la hoja muestra esa versión. El selector y el link *Ver el original* no aparecen, porque no podrían cambiar nada.

**Móvil (390 × 844)**
- Columna única: titular, bajada, *Probar la demo* y después la hoja. *Probar la demo* se ve en la primera pantalla.
- La nav muestra el logo, *Ingresar* y el botón de menú. El menú es de pantalla completa: las dos rayas se convierten en una X, los links entran escalonados, la página de atrás no scrollea, *Esc* lo cierra y el foco entra y vuelve al botón.
- Al tocar un link de la nav, las secciones que todavía no aparecieron se muestran al instante (`revealAll`), para que la sección no quede tapada por la nav.

### Ejemplo de la landing
El práctico de la demo no sirve para la hoja del hero: son tres cálculos sin enunciado, así que la versión de TDAH solo pone el verbo en negrita y la de Disgrafía queda igual. Para la landing hace falta **un problema con enunciado y contexto, con un ítem que pida graficar**. Así cada perfil muestra algo propio **sin forzar al agente a salirse de sus reglas**:

| Perfil | Qué debería verse (según `data/profiles/*.md` y `lib/agent/prompt.ts`) |
|---|---|
| TDAH | Verbo en negrita, un bloque por ejercicio, lista de revisión al final |
| Dislexia | Enunciados partidos en oraciones cortas, voz activa |
| TEA | Lenguaje literal, sin expresiones figuradas |
| Motriz | Opción múltiple con algunas preguntas que cubren el práctico, y la lista de los ejercicios que no entran |
| Disgrafía | *Graficá f* pasa a *Decí las raíces y el vértice*, y la plataforma arma la gráfica |

- Sin preguntas guía ni otros apoyos: en el producto los habilita el profe para un caso puntual, y TDAH y TEA no los permiten. Si se quieren mostrar, va como una opción aparte (*Con apoyos que habilita el profe*), con su configuración guardada en el dato.
- Si se cargan gustos, se usan y quedan registrados en el dato. La tematización no cita fuente porque no es una adaptación de perfil.
- **Ejemplo actual (Producto confirma que entra en el programa de 6.º):** *Una pelota se lanza hacia arriba desde el piso. Su altura, en metros, es $h(t) = -5t^2 + 20t$. a) ¿Cuál es la altura máxima? b) ¿En qué momento vuelve a tocar el piso? c) Graficá $h$.* Sin el 1,5 de la primera propuesta, para que los resultados sean exactos (20 m y 4 s) y las opciones de Motriz se lean bien. Lo revisa un docente antes de publicarlo.

**Cómo se genera.** `scripts/demo-fixture.ts` suma un **modo landing** sin cambiar el de la demo:
- `npx tsx … scripts/demo-fixture.ts` hace lo mismo que hoy: escribe `data/demo/limites.json` con el grupo demo.
- `npx tsx … scripts/demo-fixture.ts --landing` usa el original de `lib/landing/example.ts`, corre los 5 perfiles por separado (más los gustos y apoyos que diga ese archivo) y escribe `data/landing/ejemplo.json`. Ese dato registra qué gustos y apoyos se usaron.
- Se genera **una vez con el agente real** y se commitea. **No se escribe a mano**: "no inventamos adaptaciones" vale también acá.
- **Hoy es provisorio.** La clave de la API venció, y el usuario pidió (04/11) que Claude escribiera las versiones a mano siguiendo `data/profiles/*.md` y `lib/agent/prompt.ts`. El archivo tiene `"provisional": true`, y mientras tanto la página no dice que las generó el agente. Correr el comando de arriba con la clave nueva lo reemplaza.

## Textos (borrador para Producto)
Sin guiones dentro de las oraciones, sin signos de exclamación, mayúscula solo al principio en títulos y botones. Palabras prohibidas: las de B8 de la skill y sus equivalentes ("revolucionar", "potenciar", "sin esfuerzo", "llevar al siguiente nivel"). Nunca "estado del arte".

Las marcas **[P]** son promesas: funciones que todavía no existen (ver *Funciones prometidas*).

### Hero
- **Titular:** *El mismo práctico, / para quien tiene / [perfil].* El perfil se elige ahí mismo (ver *El hero*).
- **Bajada:** *Cargás tu práctico de matemática una vez. Tiza.ai arma una versión para cada estudiante del grupo, y vos aprobás cada una antes de que llegue a la clase.*
- **CTA:** *Probar la demo* · debajo: *Sin cuenta · 3 minutos*
- **Línea de confianza:** *Adaptaciones para TDAH, dislexia y TEA basadas en guías publicadas. Para dificultades motrices y de escritura, se responde con la mirada o dictando. Hecho en Montevideo.*

### Problema → solución
- **Título:** *El mismo práctico no se lee igual en toda la clase*
- *En un mismo grupo conviven estudiantes con TDAH, con dislexia o con TEA, alguien que no puede escribir a mano y alguien que responde mejor hablando. Adaptar cada práctico para cada uno lleva un tiempo que casi nunca hay, y muchas veces esto implica una misma versión para todos.*
- **Solución (destacada):** *Tiza.ai hace ese trabajo: arma una versión del práctico para cada perfil del grupo y te muestra cada cambio con su porqué.*

### Frase que se ilumina
*Lo que se evalúa no cambia. / Cambia cómo se presenta y cómo se responde, y vos ves cada cambio.* **[P]**

Decisión del usuario (04/11). Hoy es una promesa: la versión con mirada o dictado se queda con algunos ejercicios, y los apoyos hacen la versión más guiada (`lib/agent/prompt.ts`). Ver *Funciones prometidas*.

### Cómo funciona
1. **Marcás los perfiles de tu grupo.** Se pueden combinar distintas necesidades específicas de aprendizaje. Además podés agregar tópicos de su preferencia y los problemas con contexto hablan de lo que les interesa.
2. **Cargás el práctico como siempre.** Lo escribís o subís el PDF o unas fotos. Sale una versión por cada combinación de perfiles y apoyos del grupo, no una por alumno.
3. **Revisás y aprobás.** Ves cada cambio con su porqué y editás lo que no te convenza. Sin tu aprobación no llega a nadie.

### Para profes
- **Un práctico, todas las versiones.** Lo cargás una vez y salen las versiones que tu grupo necesita.
- **La última palabra es tuya.** Cada cambio viene explicado y aprobás versión por versión.
- **Ves dónde se trabó cada uno.** Cargás la corrección por ejercicio y el análisis te marca qué repasar.

### Para colegios · acción: *Sumar mi colegio al piloto* (abre el mail a `hola@usetiza.app`)
- **Un perfil, todos sus profes. [P]** El equipo de inclusión educativa carga el perfil del estudiante una vez y lo usan todos sus profesores.
- **Todo el colegio a la vista. [P]** La coordinación ve qué prácticos se adaptaron en cada grupo y quién los aprobó.
- **Adaptaciones con respaldo.** Las de TDAH, dislexia y TEA salen de guías publicadas, entre ellas el protocolo de educación inclusiva del MEC (Decreto 350/022).

### Para familias · acción: *Pasáselo al colegio por WhatsApp*
- **Lo puede escuchar.** Con un botón, el práctico se lee en voz alta, fórmulas incluidas.
- **Responde a su manera.** Escribiendo, dictando o con la mirada en casos de estudiantes con dificultad motriz.
- **Sin etiquetas.** En su pantalla no aparece la adaptación según el perfil.
- **Sabés qué tiene para hacer. [P]** Ves los prácticos pendientes de tu hijo o hija y cómo le fue, sin ver los de nadie más.

El botón de WhatsApp abre `https://wa.me/?text=` con un texto armado (*Mirá Tiza.ai, arma los prácticos de matemática para cada estudiante: {NEXT_PUBLIC_SITE_URL}*). No lleva datos de nadie.

### Escuchalo
- **Título:** *Así suena un práctico*
- Un `<audio controls preload="none">` con un audio **pregrabado** de una consigna del ejemplo (ElevenLabs, con `lib/speech/latexSpeech.ts`), en `public/landing/`. No llama a la API desde la landing. Tiene los controles del navegador (reproducir, pausa, volumen), anda sin JS y no arranca solo.
- Debajo, la transcripción exacta de lo que se escucha.

### Con respaldo
- **Título:** *De dónde salen las adaptaciones*
- *Las adaptaciones de TDAH, dislexia y TEA están escritas a partir de guías publicadas y las revisó el equipo docente. Para esos perfiles, el agente se basa en esas guías y cada cambio te dice de cuál salió. Lo que no sale de una guía, como responder con la mirada o dictando, usar los gustos del grupo o los apoyos que habilitás vos, también aparece en la lista de cambios, con su motivo.*
- Lista con link (las URLs exactas salen de `data/profiles/*.md`, no de memoria):
  - MEC Uruguay (2022). Protocolo de educación inclusiva, Decreto 350/022
  - CAST (2024). Pautas de Diseño Universal para el Aprendizaje 3.0
  - Ofqual (2022). Guía para diseñar evaluaciones accesibles
  - British Dyslexia Association (2023). Dyslexia Style Guide
  - IFLA (2010). Pautas para materiales de lectura fácil
  - Lovett y Nelson (2021). Revisión sistemática de adecuaciones para estudiantes con TDAH

### Preguntas frecuentes
1. **¿Y si la IA se equivoca?** Por eso nada sale sin tu aprobación. Ves cada cambio con su porqué y lo editás si no te convence. En las versiones escritas que mantienen los datos del original, además, un control automático sin IA te avisa si en algún ejercicio falta un número del original. No revisa si la matemática está bien: eso lo revisás vos.
2. **¿La versión adaptada es más fácil?** Sin apoyos, el nivel es el mismo: cambia la presentación (enunciados más cortos, el verbo resaltado, un bloque por ejercicio). Si el estudiante responde con la mirada o dictando, cambia cómo responde y tiene menos ejercicios, así que se evalúa una parte del práctico. Si vos habilitás apoyos para un estudiante que los necesita, la versión sí es más guiada. Todo eso aparece en la lista de cambios para que lo revises.
3. **¿A la IA le llegan datos de mis estudiantes?** Los nombres de la lista del grupo no le llegan nunca, y en el análisis de resultados cada estudiante figura como E1, E2 y así. Si subís un PDF o fotos, la IA los lee completos, así que conviene que no tengan datos personales. **[P]** Pronto los vamos a borrar automáticamente antes de que lleguen a la IA.
4. **¿Qué perfiles cubre?** TDAH, dislexia, TEA, dificultad motriz (responde con la mirada) y disgrafía (responde dictando). Un estudiante puede tener más de uno.
5. **¿Para qué materias y años sirve?** Arrancamos con matemática de bachillerato, con el programa de Uruguay. **[P]** Después vienen el resto de los años y otras materias.
6. **¿El estudiante ve su diagnóstico?** En su pantalla no aparece el nombre de su perfil. **[P]** Y el texto de su versión tampoco lo menciona.
7. **¿Se puede imprimir?** Las versiones escritas aprobadas se imprimen o se guardan en PDF desde el navegador. Las de mirada y dictado se resuelven en pantalla, desde la cuenta del estudiante.
8. **¿Qué hace falta para responder con la mirada o dictando?** Para la mirada, una computadora con cámara: antes de empezar se calibra mirando unos puntos en la pantalla, y hay un modo práctica con el mouse. Para dictar, un navegador con dictado, como Chrome o Edge. Si no lo tiene, puede escribir la respuesta.
9. **¿Cómo lo pruebo?** Con la demo, sin cuenta y en unos 3 minutos: armás las versiones de un grupo de ejemplo, aprobás una y ves el práctico como lo ve la estudiante. Las versiones de la demo las generó antes el agente de Tiza.ai con ese mismo práctico.

### CTA final
- **Título:** *Probá Tiza.ai con un práctico de verdad*
- *Armás las versiones de un grupo, revisás cada cambio y ves el práctico como lo ve una estudiante.*
- *Probar la demo* · *Sin cuenta · 3 minutos*

### Prueba social
La skill pide testimonios y logos. **Hoy no hay ninguno real**, así que la sección no existe en v1: la reemplazan *Con respaldo* y la demo. Cuando haya un piloto, se suma con citas y nombres reales, con permiso por escrito. Nunca con marcadores visibles como `{{testimonio}}`.

## Funciones prometidas
Lo que la landing promete y todavía no existe. Cada fila es trabajo pendiente del equipo.

| Promesa | Dónde aparece | Qué haría falta |
|---|---|---|
| Perfil del estudiante compartido entre todos sus profes | Colegios | Cuentas de colegio, con estudiantes a nivel colegio y no por grupo |
| Panel de coordinación: qué se adaptó y quién aprobó | Colegios | Rol "coordinación" y una vista de todos los grupos del colegio |
| Seguimiento para familias | Familias | Rol "familia" vinculado a un estudiante, de solo lectura |
| Lo que se evalúa no cambia en ninguna versión | Frase que se ilumina | Que la mirada y el dictado cubran todos los ejercicios del original (hoy `lib/agent/prompt.ts` limita la cantidad), y definir cómo conviven los apoyos con esa promesa |
| Otros años y materias | FAQ 5 | Perfiles y prompts por materia, y programas cargados |
| Borrar los datos personales de PDF y fotos antes de mandarlos a la IA | FAQ 3 | Detectar y tapar nombres y encabezados en la lectura, antes de la llamada a la IA |
| Ninguna versión menciona el perfil en el texto | FAQ 6 | Una regla general en `lib/agent/prompt.ts` (hoy solo la tiene dislexia en `data/profiles/dyslexia.md`) y un control antes de aprobar |
| Piloto para colegios | Colegios | Que alguien del equipo responda `hola@usetiza.app` y acompañe a los colegios que se sumen |

## Qué tomamos de la skill
| Regla | Decisión | Por qué |
|---|---|---|
| A1 a A8 (estrategia, copy, orden de construcción) | **Sí** | |
| A2 "un solo público" | **Adaptada** | Tres públicos, pero un público principal (profes) y una sola acción grande. Los otros tienen su sección. |
| A2.9 prueba social | **Adaptada** | No hay testimonios reales: van las fuentes (ver *Prueba social*). |
| A4 sin acciones que compitan en el primer pantallazo | **Sí, con una excepción** | *Ingresar* en la nav (ver *Decisiones tomadas*). |
| A4 reducción de riesgo | **Sí** | *Sin cuenta · 3 minutos* y *nada sale sin tu aprobación*. Para colegios, además, *Sumar mi colegio al piloto*, sin precio. |
| B1 tipografías permitidas (Geist, Manrope, Poppins) | **No** | Lexend se eligió por legibilidad (el cero no se confunde con ∅) y es parte de la identidad. Con Geist (direcciones A y B), la página quedó genérica. |
| B1 sin itálicas, sin pesos 900, sin guiones, sin palabras huérfanas | **Sí** | `text-wrap` ya está en `globals.css`. |
| B1 escala de Tailwind | **Sí** | Todos los tamaños son pasos de la escala (sin valores arbitrarios). |
| B1 estilos de texto con nombre | **No** | Se definieron y se usaron en A y B. C usa los pasos de Tailwind directamente, en pocos tamaños (títulos `text-4xl` a `text-6xl`, texto `text-lg` y `text-xl`). Las utilidades se borraron al quedar sin uso. |
| B1 títulos en semibold | **Sí** | |
| B2 escala de espaciado | **Sí, en pasos relativos** | Se usan los pasos de Tailwind que equivalen a la tabla (0, 0.5, 1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24). La raíz es 18 px por el proyector, así que todo mide 1,125 veces los píxeles de la skill. No se cambia la raíz. |
| B2 botón principal de 8 × 12 px | **No** | Los botones de la app miden 44 px de alto como mínimo (accesibilidad). El CTA de la landing es más grande todavía. |
| B3 radios y fórmula de anidados | **Sí** | |
| B4 sin borde de un solo lado, sin fondos con degradé | **Sí** | |
| B4 paleta oscura (negros y grises) | **No** | El pizarrón índigo es la identidad. |
| B5 titular con degradé de blanco a gris | **No** | Baja el contraste sobre el pizarrón. El titular va en blanco. |
| B5 titular y bajada de 680 px como máximo, con cortes con sentido | **Sí** | |
| B6 íconos Phosphor | **No hacen falta** | La página usa solo dos trazos dibujados a mano (la flecha del selector y el + de la FAQ). Sin dependencia nueva. |
| B7 curva `cubic-bezier(0.22,1,0.36,1)`, duraciones, solo `transform` y `opacity` | **Sí** | Como `--ease-soft` en `@theme`. |
| B7 nav flotante y menú móvil de pantalla completa | **Sí** | La nav ya está. El menú móvil está pendiente: los links del menú entran escalonados, con 400 ms como máximo. |
| B7 secciones que aparecen al scrollear | **Sí, suave** | Ver *Movimiento*. |
| B8 contenido real, nada inventado | **Sí** | |
| B9 estados (hover, activo, foco, error) | **Sí** | |
| B10 requisitos de publicación | **Sí** | Ver *Requisitos de publicación*. |
| B11 frase que se ilumina palabra por palabra | **Sí, suave** | Ver *Movimiento*. |

## Movimiento
El público incluye familias de estudiantes con TDAH o TEA: la página se mueve poco y solo cuando el visitante scrollea o toca algo.
- **Nada se mueve solo.** El fondo de fórmulas va en una variante nueva `MathBackdrop variant="still"`, sin ondas ni símbolos animados. El login conserva el suyo.
- **Secciones que aparecen.** El HTML del servidor las trae **visibles**. Recién cuando el componente está montado y el observador listo, oculta las que todavía no entraron en pantalla, y las muestra al entrar (suben 32 px y aparecen en 700 ms, una sola vez). Si el JS no carga o falla, todo queda visible. Con movimiento reducido no se ocultan nunca.
- **Frase que se ilumina.** Las palabras arrancan en `indigo-400` (`#818cf8`), un color sólido y no una opacidad, por los antipatrones. Da cerca de 5:1 sobre `indigo-950`, por encima del 3:1 que pide el texto grande. Pasan a blanco al cruzar una línea a la altura del 60% de la pantalla. El contraste del estado inicial se mide en la verificación. Con movimiento reducido o sin JS, la frase se ve completa. El lector de pantalla lee la frase entera (`sr-only`) y las palabras sueltas van con `aria-hidden`.
- **Hoja del hero:** sube 8 px y aparece en 500 ms. Instantánea con movimiento reducido.
- Nunca conviven dos animaciones en la misma pantalla.

## Requisitos de publicación
- `app/page.tsx` sigue siendo un Server Component, con su `metadata`: título, descripción, Open Graph (`es_UY`) y `metadataBase` desde `NEXT_PUBLIC_SITE_URL`. La variable se configura en Netlify y en `.env.example`. La interacción va en componentes de cliente aparte.
- `app/opengraph-image.tsx` con `ImageResponse`, la marca y el titular. Usa la tipografía por defecto de `ImageResponse`: para Lexend haría falta su `.ttf` en el repo, porque `next/font` solo sirve `.woff2`.
- `app/not-found.tsx` con la marca y un link a `/`. **Hoy no existe.**
- `/privacidad` y `/terminos`, linkeadas en el footer. **Hoy no existen.** El texto lo escribe Producto.
- Cookies: la landing solo usa cookies funcionales (`session` y `tiza-demo`), así que no hace falta banner. Sin analítica en v1.
- FAQ con datos estructurados `FAQPage` (JSON-LD).
- Se indexa: es la página principal y no está atada a una campaña.
- **Medición:** no hay en v1 (decisión del usuario). Cuando se sume, empieza por el clic en *Probar la demo*. Medir el recorrido terminado obliga a tocar `components/demo/`.

## Accesibilidad
- Contraste AA o mejor en todo, también sobre el pizarrón, incluido el estado inicial de la frase que se ilumina (al menos 3:1 para texto grande).
- Objetivos de 44 px como mínimo. Foco visible (`focus-on-dark` sobre fondo oscuro).
- El hero, según su contrato en *El hero*.
- El audio no arranca solo y tiene controles y transcripción.
- Todo anda con teclado, con zoom al 200% y con movimiento reducido.

## Archivos
| Archivo | Cambio |
|---|---|
| `app/page.tsx` | La landing, sección por sección (Server Component) |
| `components/landing/*` | `Nav` (nav y menú móvil), `HeroBoard` (titular, selector y hoja), `Sheet`, `Reveal`, `TaglineReveal`, `Listen`, `LegalPage`, `content.ts` (textos) y `example.ts` |
| `components/auth/MathBackdrop.tsx` | Variante `still`, sin animación |
| `app/globals.css` | `--ease-soft` y las animaciones de la landing (secciones, frase, menú y hoja) |
| `lib/landing/example.ts`, `data/landing/ejemplo.json`, `scripts/demo-fixture.ts` | Ejemplo de la hoja y el modo `--landing` |
| `scripts/landing-audio.ts` | Graba `public/landing/consigna.mp3` y `data/landing/audio.json` con ElevenLabs |
| `lib/speech/latexSpeech.ts` | Arreglo: ya no deja puntos dobles ("lanzamiento..", "pelota?.") en el texto que se lee. También le sirve al "Escuchar" de la app |
| `app/opengraph-image.tsx`, `app/not-found.tsx`, `app/privacidad/page.tsx`, `app/terminos/page.tsx` | Requisitos de publicación |
| `tsconfig.json` | Excluye `nocti-*`, `dfa-demo*` y `.claude/worktrees`: son otros proyectos y rompían `npx tsc --noEmit` y `npm run build` |
| `.env.example` | `NEXT_PUBLIC_SITE_URL` |
| `docs/DEMO.md` | Su sección *Landing* pasa a apuntar a este spec |

**No se toca:** `/demo`, `/demo/salir`, el recorrido, `data/demo/limites.json`, `lib/groups/seed.ts` ni las pantallas del profe y del estudiante.

## Estado actual del código
- **La landing nueva está en `app/page.tsx`**, con todas las secciones. Los prototipos (`/prototipo/*`) se borraron.
- Nada está commiteado.

## Pendiente antes de publicar
1. **Claves de la API:** la de OpenRouter venció y la de ElevenLabs es inválida. Con las claves nuevas en `.env.local`:
   - `npx tsx --conditions=react-server --env-file=.env.local scripts/demo-fixture.ts --landing` reemplaza las versiones provisorias de la hoja por las del agente.
   - `npx tsx --conditions=react-server --env-file=.env.local scripts/landing-audio.ts` graba el audio. La página pasa sola a usarlo.
   - Las mismas claves hacen falta en Netlify para que la app genere en vivo.
2. **`SESSION_SECRET` en Netlify:** en producción la app lo exige (`lib/auth/signing.ts`). Sin él, *Probar la demo* da error 500.
3. **Ejemplo de la hoja:** Producto confirma la pelota (o elige otra) y la revisa un docente.
4. **Privacidad y términos:** Producto revisa el borrador, que dice "versión preliminar, en revisión", si se puede con alguien que conozca la Ley 18.331.
5. **`hola@usetiza.app`:** que la casilla exista y que alguien la lea.
6. **Fuentes de Motriz y Disgrafía:** opcional. Si se cargan, la landing también les atribuye fuentes.

## Fuera de alcance (v1)
- Páginas propias para colegios y familias, y las imágenes de Higgsfield (dirección C).
- La sección fija con scroll (dirección B).
- Analítica.
- Probar la IA en vivo desde la landing.
- Responder con la mirada con cámara desde la landing: la hoja del hero solo muestra las opciones y la cámara queda para la demo.
- Medir el recorrido terminado.
- Inglés y portugués.

## Cómo se verifica
1. `npx tsc --noEmit && npm run lint && npm run build`.
2. A **390 × 844** y a **1280 × 800**: sin scroll horizontal y con *Probar la demo* en el primer pantallazo. También con el menú móvil abierto y con fórmulas largas en la hoja.
3. Zoom al 200%: nada se corta ni se superpone.
4. Solo con teclado: nav, menú móvil, el selector del titular, *Ver el original*, FAQ, audio y los dos CTA.
5. Con lector de pantalla (NVDA o VoiceOver): la frase que se ilumina se lee entera, el selector se anuncia como *Perfil del estudiante*.
6. Con movimiento reducido: no hay subida de secciones, la frase se ve completa, la hoja cambia sin animación y el fondo está quieto.
7. Con JS deshabilitado, y aparte con los chunks de JS bloqueados: todo el contenido se ve, el titular dice *dislexia* sin selector y la hoja muestra esa versión.
8. Contraste medido del estado inicial de la frase: al menos 3:1.
9. En el HTML del build: `<title>`, descripción y Open Graph correctos, `og:image` y las demás URLs absolutas con el origen de `NEXT_PUBLIC_SITE_URL` (lo arma `metadataBase`), y el JSON-LD de la FAQ válido. La imagen de `/opengraph-image` abre con Lexend. Una URL inexistente muestra `not-found`.
10. Regresión de la demo, con los puntos 2 a 4 de *Cómo se verifica* de `docs/DEMO.md`: *Probar la demo* (arriba y abajo) lleva al recorrido completo, *Volver a empezar* y *Salir de la demo* andan, y los datos propios quedan intactos.
11. Generar el ejemplo con `--landing` no cambia `data/demo/limites.json` ni `lib/groups/seed.ts` (`git diff` vacío en esos archivos).
12. Cada link de *Con respaldo* abre la fuente exacta que cita `data/profiles/*.md`.
13. Revisión del checklist de la skill, con las excepciones de *Qué tomamos de la skill*.

### Resultado (04/11/2026, contra `npm run build` + `next start`)
| # | Resultado |
|---|---|
| 1 | `npx tsc --noEmit`, `npm run build` y `npx eslint app components lib scripts proxy.ts next.config.ts` pasan. `npm run lint` a secas se queda sin memoria, porque también revisa las carpetas `nocti-*` con sus `node_modules`. Para eso habría que sumar esas carpetas a los `ignores` de `eslint.config.mjs`. |
| 2 | A 390 × 844: sin desborde, *Probar la demo* termina a 644 px y todos los objetivos miden al menos 44 px. A 1280: titular y hoja en dos columnas. El menú móvil se probó abierto. |
| 3 | **Sin probar:** zoom al 200%. |
| 4 | Teclado: el orden del foco es salto al contenido → logo → *Ingresar* → menú → selector → *Probar la demo* → *Ver el original* → acciones de cada público, todos con anillo visible. El selector cambia de perfil con las flechas y el foco se queda. El menú se cierra con *Esc* y el foco vuelve al botón. |
| 5 | **Sin probar con NVDA ni VoiceOver.** El `<h1>` ya no incluye las opciones, y el selector tiene `aria-label`. |
| 6 | **Sin probar:** el panel del navegador no emula "reducir movimiento". Está cubierto en el código (`Reveal`, `TaglineReveal` y el bloque de `globals.css`). |
| 7 | Sin JS (HTML del servidor): todas las secciones y textos están, el titular dice *dislexia*, la hoja muestra esa versión y no hay `<select>` ni secciones ocultas. |
| 8 | Contraste: palabras apagadas de la frase 5,4:1. Ámbar sobre pizarrón 11,1:1. `indigo-100` sobre pizarrón 13:1. `slate-600` sobre blanco 7,6:1. |
| 9 | Título, descripción, Open Graph y Twitter están bien. `og:image` y `canonical` son absolutas con `https://usetiza.app`. El JSON-LD `FAQPage` tiene las 9 preguntas. `/opengraph-image` devuelve un PNG de 1200 × 630, con la tipografía por defecto. `/esto-no-existe` devuelve 404 con la página propia. |
| 10 | Demo de punta a punta: *Probar la demo* (hero) → los 14 pasos → vista de Paula, sin etiqueta de perfil → *Eso es Tiza.ai* → *Salir de la demo* vuelve a `/` y borra la cookie. Con la vista emulada a 1280 en el panel, el globo del paso 11 no apareció; sin emulación, sí. |
| 11 | No se corrió: el script no pudo generar por la clave vencida. |
| 12 | Las 6 fuentes responden 200. |
| — | Los 4 links de la nav dejan la sección justo debajo de la nav (108 px, con la nav terminando en 86). El selector queda alineado con la palabra en los 5 perfiles. *Ver el original* va y vuelve. Las 9 preguntas abren y cierran. El botón de audio pasa a *Parar*, habla y se detiene. `mailto` y WhatsApp están bien armados. |
