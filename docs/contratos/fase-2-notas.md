# Fase 2: notas de implementación

## T2.7: `Sb-Forwarded-For` y los límites de Auth

**Qué averiguamos (por documentación y código público, no medido).** Supabase Auth (el servicio `supabase/auth`, antes GoTrue) sumó un encabezado `Sb-Forwarded-For`: cuando está activado, Auth toma el primer valor de ese encabezado como la IP del cliente, tanto para sus límites por IP como para `GetIPAddress`. Si está apagado o el encabezado falta o es inválido, usa la IP de la conexión como hasta ahora. Existe porque `X-Forwarded-For` lo reescriben los proxies y se puede falsificar. Se activa con la variable de entorno `GOTRUE_SECURITY_SB_FORWARDED_FOR_ENABLED` del servicio de Auth. El «cómo» en un proyecto hospedado (si Supabase lo prende por proyecto, si hay que pedirlo, si exige la clave secreta) no lo pudimos confirmar en la documentación pública de límites (`supabase.com/docs/guides/auth/rate-limits`), que no lo menciona.

**Qué no pudimos medir.** No hay proyecto hospedado en esta etapa, y `supabase/config.toml` no tiene una opción para esa variable, así que el Auth local no lo activa. Queda para **T0.6/T1.0, con el usuario**: con un proyecto real, mandar dos pedidos a `/auth/v1/token` con `Sb-Forwarded-For` distintos y ver si el límite se cuenta por separado.

**Qué hicimos mientras tanto (el caso «no lo acepta»).** Nuestro servidor es el único que habla con Auth para los estudiantes (magic link) y para el login del profe, así que Auth ve una sola IP (la de Netlify). En `supabase/config.toml`, `[auth.rate_limit]`:

| Límite | Antes | Ahora | Por qué |
|---|---|---|---|
| `sign_in_sign_ups` (5 min, por IP) | 30 | 300 | un colegio entrando a la vez sale por una IP |
| `token_verifications` (5 min, por IP) | 30 | 300 | cada ingreso de un estudiante es un `verifyOtp` desde nuestro servidor |
| `token_refresh` (5 min, por IP) | 150 | 600 | la renovación de sesiones también sale de nuestro servidor |

Son valores estimados (unas 4 clases de 40 a la vez), sin medir. Si T0.6/T1.0 confirma que Auth acepta `Sb-Forwarded-For`, nuestras llamadas lo mandan y estos tres vuelven a sus valores por defecto. El freno real a adivinar contraseñas es `app.rate_limits` (se cuenta antes de probar), más `minimum_password_length = 10`. Para las llamadas directas a `/auth/v1/token` con la clave pública (solo staff), el límite por IP de Auth sigue siendo la única barrera además de la longitud de la contraseña.

`minimum_password_length` pasó de 6 a 10 en `[auth]`. Con la protección de contraseñas filtradas (solo en proyectos hospedados) queda para T0.6.

## T2.7: `@upstash/*`

`package.json` no tiene `@upstash/*`: `lib/auth/rateLimit.ts` habla con la API REST de Upstash con `fetch`. Sigue ahí y lo usa `lib/auth` (`KV_REST_API_URL` y `KV_REST_API_TOKEN` en `.env.example`): lo borra T2.8.

## T2.7: lo que cambió respecto del contrato

- `clearSubject(kind, subject, ip?)` suma un tercer parámetro opcional. Cada intento cuenta antes de probar, también el que acierta, y la clave `*_pair` lleva la IP: sin la IP, un acierto no puede limpiarla y quien entra seguido desde un lugar se bloquearía solo. Quien llama a `clearSubject` (T2.3, T2.5b) tiene que pasar `ip`. Sin ella limpia solo `*_subject` y `reset_email`. Nunca limpia `reset_ip` ni `token_ip`.
- El sujeto de un estudiante se pasa como un solo texto, por ejemplo `${código}/${usuario}`; el servicio lo normaliza (NFKC, sin espacios en los bordes, minúsculas).
- `authAdmin(timeoutMs = 5000)`: el parámetro es solo para las pruebas.
- Las RPC rechazan argumentos sin sentido (claves repetidas, que no sean `balde:hex`, topes menores a 1) con `P0004`, como las violaciones de locks: es un bug, no un caso del usuario.
