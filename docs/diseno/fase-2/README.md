# Fase 2: opciones de diseño

Maquetas estáticas de las pantallas nuevas de la fase 2 (cuentas reales), para elegir antes de escribir código. Son HTML con el CSS adentro y usan la misma identidad que la app: Lexend (`lexend-latin.woff2`, en esta carpeta), el pizarrón `indigo-950`, papel blanco y un solo acento ámbar.

- Abrí `index.html` en el navegador. Cada maqueta tiene abajo una barra oscura para recorrer sus estados (error, olvidé, enviado…). Esa barra no es parte del diseño.
- Las capturas están en `capturas/`: `<opción>-1280.png` y `<opción>-390.png` muestran el estado inicial, y `<opción>--<estado>-390.png` los demás. Las tarjetas tienen además `--impresion.png` y `--impresion.pdf`, cómo sale la hoja A4.
- Todas pasan axe (WCAG 2.2 AA) en cada estado a 390 px. Tienen foco visible, campos con etiqueta, errores con `role="alert"` y foco en el mensaje, y nunca usan solo el color.

## Login del profe y del admin

| | Qué la distingue | A favor | En contra |
|---|---|---|---|
| **A** · la hoja sobre el pizarrón | Es el login de hoy sin las pestañas. El error aparece arriba del botón, con un enlace a «creá una contraseña nueva». | Continuidad con la demo y la landing. Es la más simple. | El fondo animado de fórmulas compite un poco en pantallas chicas. |
| **B** · mitad pizarrón, mitad hoja | Tiene un pizarrón con el mensaje del producto. Los errores siguen el patrón de formulario largo: un resumen arriba con enlaces a cada campo y el error repetido al lado del campo. Suma el estado «esperá unos minutos». | Es la que mejor maneja varios errores a la vez. Se ve más «producto» en escritorio. | El mensaje de la izquierda es marketing para alguien que entra todos los días. En el celular se reduce a una franja. |
| **C** · primero el correo | Una pregunta por pantalla: correo, después contraseña. «No me acuerdo» manda el enlace en un toque al correo ya escrito. | Es la que tiene menos carga por pantalla. Queda lista para sumar «Entrar con Google o Microsoft» si un colegio lo pide. | Suma un paso. Para no revelar quién tiene cuenta, el paso 2 aparece siempre, aunque el correo no exista. |

**Recomiendo A**, con dos cosas de B: el error al lado del campo cuando falta un dato y el estado de demasiados intentos. Es lo que menos cambia para quien ya usa la demo y lo más rápido de construir. C conviene recién si llega el login con Google o Microsoft.

## Aceptar una invitación

Las dos cubren los mismos seis casos: sin cuenta, con cuenta y sin sesión, con sesión y el mismo correo, con sesión y otro correo, vencida, y aceptada.

| | Qué la distingue | A favor | En contra |
|---|---|---|---|
| **A** · la carta | Una columna: «Marta Rodríguez te invitó a sumarte a Colegio San José», y debajo la única acción que corresponde. | Se lee como una frase y anda igual en el celular. | Si el correo no coincide, la explicación depende del texto. |
| **B** · los datos en el pizarrón | Los datos de la invitación (colegio, rol, quién invitó, para qué correo, vencimiento) quedan fijos a la izquierda y la hoja cambia según el caso. Si el correo no coincide, el pizarrón lo marca con texto. | Se escanea rápido y el choque de correos se ve. | En el celular el pizarrón ocupa media pantalla antes del formulario. |

**Recomiendo A**, sumando de B la marca «No es el correo con el que entraste» junto al correo de la invitación.

## Login del estudiante

Las tres se ven igual para todos los estudiantes. No hay nada de perfiles, de adaptaciones ni de formas de responder. Los errores son neutros: ícono de idea, fondo gris, una pista concreta («la contraseña lleva guiones, como sol-mesa-24»), nada en rojo y lo escrito no se borra. Se puede pegar y usar el gestor de contraseñas (WCAG 3.3.8).

| | Qué la distingue | A favor | En contra |
|---|---|---|---|
| **A** · igual que tu tarjeta | Una pantalla con los tres datos, en el mismo orden y con los mismos nombres que la tarjeta. El colegio queda recordado en el dispositivo, así que desde la segunda vez son dos campos. Tiene un enlace a escanear. | Pocos toques (importa con motriz y con mirada) y el gestor de contraseñas funciona bien. | Son tres campos juntos la primera vez. |
| **B** · de a un dato | Una pregunta grande por pantalla, «Paso 2 de 3» y «Volver». El error se queda en el paso. | Es la que tiene menos carga por pantalla (TDAH, TEA). | Triplica los toques y las esperas. El gestor de contraseñas lo maneja peor. |
| **C** · primero la tarjeta | La puerta principal es escanear el QR. La cámara completa el colegio y el usuario, y queda solo la contraseña con «¡Hola, Lucía!». La otra puerta es escribir los datos. | Es la que menos hay que recordar o copiar. | Depende de la cámara: las compus de escritorio del colegio muchas veces no tienen, y hay que pedir permiso. |

**Recomiendo A, con el escaneo de C como segunda puerta** (ya está enlazado). Más adelante se puede poner el escaneo primero en celulares y tablets, donde la cámara anda siempre. B queda como referencia si en las pruebas con estudiantes los tres campos juntos resultan demasiado.

## Tarjetas de acceso

Todas las tarjetas del grupo son idénticas: los mismos datos y el mismo diseño, sin íconos ni colores por estudiante. Como la contraseña se muestra una sola vez y no se guarda, imprimir siempre crea contraseñas nuevas, y eso se confirma antes.

| | Qué la distingue | A favor | En contra |
|---|---|---|---|
| **A** · de bolsillo | 85 × 54 mm, 10 por hoja A4, con marcas de corte. Flujo: elegir «todo el grupo» o «solo algunos», confirmar, ver e imprimir. En pantalla las contraseñas van tapadas, por si se está proyectando, con un botón para mostrarlas. | Gasta poco papel. Entra en la billetera o en la funda del celular. | Letra de 11 pt: es poco para dislexia o baja visión. |
| **B** · grande | A6, 4 por hoja A4. «Hola, Lucía», un QR grande y los datos a 16 pt. Flujo: se elige a quiénes con una lista y se ve la tarjeta con «Se crea al imprimir». Las contraseñas se crean al confirmar y van directo a la impresora. | Es la más legible. Las contraseñas nunca aparecen en pantalla. | Gasta 2,5 veces más papel (7 hojas para 28 estudiantes). |
| **C** · etiqueta para el cuaderno | 70 × 42 mm, 21 por hoja: sirven las hojas de etiquetas comunes o papel. Se arma desde la lista del grupo, con «Etiqueta nueva» por estudiante para quien la perdió. | No se pierde porque vive en el cuaderno. Resuelve bien el caso de una sola tarjeta. | Es la letra más chica (9,5 pt) y necesita hojas de etiquetas para pegar. |

**Recomiendo B** por legibilidad y porque no muestra contraseñas en pantalla. De C tomaría el botón «Tarjeta nueva» por estudiante en la página del grupo. El formato de bolsillo (A) puede quedar como opción de impresión para colegios que cuidan el papel.

## Panel de la institución (admin)

| | Qué la distingue | A favor | En contra |
|---|---|---|---|
| **A** · una página | Dos partes, Profes y Estudiantes. Cada una tiene su formulario corto (invitar, crear cuentas) al lado de su lista: pendientes, en el colegio y grupos. | Todo a la vista, sin navegar. | Es larga y crea las cuentas sin mostrar antes qué usuarios van a quedar. |
| **B** · primero las tareas | Arranca con dos acciones grandes y un resumen. Cada acción tiene dos pasos, pegar y revisar. En la revisión se ve cada usuario que se va a crear (con el «luciaf2» si se repite) y cada correo que no se manda, con el motivo. | Es la aprobación humana visible que pide `CLAUDE.md`, y atrapa repetidos y correos mal escritos antes de que tengan efecto. | Tiene un paso más y las listas quedan en otra pantalla. |

**Recomiendo B**, con las listas de A como pantalla de «Ver profes e invitaciones».

## Para pedirle al backend

Ninguna de estas decisiones toca `lib/contract.ts` todavía, pero el diseño las asume:

1. **QR de la tarjeta.** Lleva un enlace opaco (`usetiza.app/t/K7M2Q9`) que el servidor traduce a colegio y usuario. No lleva la contraseña ni el nombre en la URL (no tiene que quedar en logs), y se invalida al crear una tarjeta nueva. Queda por decidir si el QR, solo, alcanza para entrar (una «tarjeta llave», lo más accesible para motriz) o si siempre se pide la contraseña, como en estas maquetas.
2. **Formato de contraseña inicial.** Dos o tres palabras cortas y un número, en minúscula y unidas con guiones (`nube-tigre-47`), sin 0 ni 1. Propongo que el login acepte espacios en lugar de guiones y que no distinga mayúsculas.
3. **Usuario.** El nombre más la inicial del apellido, sin tildes y en minúscula, con un número si se repite (`luciaf2`).
4. **Errores.** Para usuario y contraseña, un mensaje genérico («no coinciden»). El código de colegio inexistente se puede decir con nombre, porque no es secreto. Para el mensaje de demasiados intentos, la RPC tiene que devolver a qué hora se puede volver a probar.
5. **Colegio recordado.** En el navegador del estudiante solo se guardan el código y el nombre del colegio, nada personal.
6. **Datos de las listas.** Las listas muestran «ya entró alguna vez», «última tarjeta el…» y el vencimiento de cada invitación.
7. **Plazos.** El enlace de contraseña nueva dura una hora y es de un solo uso. La invitación dura 7 días, como dice el spec.
