# Idea elegida: prácticos de matemática accesibles

> Borrador. Lo revisa y completa Producto.

## El problema en una frase
Un profesor de matemática de bachillerato tiene en la misma clase alumnos con TDAH, dislexia o TEA, y adaptar cada práctico a mano le lleva un tiempo que no tiene. *(Hipótesis a validar con profesores.)*

## Usuario
Profesor de matemática de bachillerato en Uruguay.

## Qué hace la app
1. **Landing pública:** el problema, la propuesta de valor y un botón para ingresar.
2. **Login del profesor.**
3. **Crear un práctico:** el profesor elige el tema y el año, y marca las dificultades del estudiante (ninguna, una o varias).
4. **La IA genera el práctico adaptado** y muestra qué cambió respecto del original y por qué.
5. **El profesor revisa, edita y aprueba.** Sin su aprobación no hay PDF.
6. **Descarga el PDF** para imprimir o compartir.

## Decisiones tomadas
| Tema | Decisión |
|---|---|
| Usuario | Profesores |
| Nivel | 6.º de bachillerato, matemática |
| Adaptaciones por perfil | Las resuelven agentes especializados por perfil, con datos cargados (en preparación) |
| Salida | PDF |
| Stack | Next.js + API de Claude (ver `CLAUDE.md`) |
| Idioma | Español rioplatense |
| Perfiles v1 | TDAH, dislexia, TEA, combinables |
| Perfiles futuros | Dificultades motrices y otras; los perfiles se definen como datos, no en el código |

## Pendiente
- **Tema de la demo:** elegir uno solo de 6.º y confirmarlo contra el programa oficial vigente.
- **Datos de los agentes por perfil:** **no inventamos adaptaciones**. Los datos tienen que salir de una fuente que podamos citar en el pitch.
- **Autenticación:** para la demo alcanza con un login simple. Decidir si es real o simulado.
- **Cómo se arma el PDF:** lo deciden los devs. Opciones: hoja de estilos de impresión + "Guardar como PDF" del navegador (lo más rápido), o un PDF generado en el servidor (lo más prolijo). Las fórmulas tienen que verse bien en los dos casos.
- **Accesibilidad del PDF:** un PDF también tiene que ser accesible (texto seleccionable, orden de lectura, tipografía). Validar qué hace falta.

## Cómo cumple lo que gana
| Criterio del dossier | Cómo lo cubrimos |
|---|---|
| Problema en una frase, usuario concreto | Profesor de matemática de bachillerato |
| La IA actúa | Reescribe el práctico, no conversa |
| La demo se ve | Original y versión adaptada, lado a lado |
| ¿Y si la IA se equivoca? | El profesor revisa y aprueba antes del PDF |
| Local | Programa de 6.º de bachillerato de Uruguay |
| Alcance chico | 6.º, un tema, tres perfiles |

## Guión de demo (borrador)
1. Landing: el problema en una frase (15 s).
2. El profesor entra y carga un práctico del tema elegido.
3. Marca dos perfiles combinados, por ejemplo TDAH y dislexia.
4. La IA genera la versión adaptada; se ve lado a lado con el original y con la lista de cambios.
5. El profesor corrige algo a mano y aprueba.
6. Descarga el PDF y se muestra impreso o en pantalla.
7. Cierre: los perfiles son datos, así que sumar uno nuevo (por ejemplo, dificultades motrices) no requiere reescribir la app.
