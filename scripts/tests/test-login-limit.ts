// Pruebas sin IA del límite de intentos del login (lib/auth/rateLimit.ts).
// Correr con: npx tsx --conditions=react-server scripts/tests/test-login-limit.ts
import {
  isLocked,
  MAX_PER_IP_AND_USER,
  MAX_PER_USER,
  memoryStore,
  recordFailure,
  recordSuccess,
  resilient,
  WINDOW_SECONDS,
  type Store,
} from "../../lib/auth/rateLimit";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) failed++;
  console.log(`${pass ? "OK  " : "FALLA"} ${name}${pass ? "" : `\n      esperado ${JSON.stringify(want)}\n      obtenido ${JSON.stringify(got)}`}`);
}

async function fail(times: number, ip: string, username: string, store: Store) {
  for (let i = 0; i < times; i++) await recordFailure(ip, username, store);
}

async function main() {
  let now = 0;
  const clock = () => now;

  let store = memoryStore(clock);
  await fail(MAX_PER_IP_AND_USER - 1, "1.1.1.1", "ana", store);
  check("con 9 fallos todavía puede intentar", await isLocked("1.1.1.1", "ana", store), false);
  await fail(1, "1.1.1.1", "ana", store);
  check("con 10 fallos el intento 11 queda bloqueado", await isLocked("1.1.1.1", "ana", store), true);
  check("el usuario no distingue mayúsculas ni espacios", await isLocked("1.1.1.1", "  ANA ", store), true);
  check("desde otra IP no queda bloqueado", await isLocked("2.2.2.2", "ana", store), false);
  check("otro usuario desde la misma IP no queda bloqueado", await isLocked("1.1.1.1", "bruno", store), false);
  now += WINDOW_SECONDS * 1000;
  check("pasados 15 minutos se desbloquea", await isLocked("1.1.1.1", "ana", store), false);

  store = memoryStore(clock);
  await fail(5, "1.1.1.1", "camila", store);
  await recordSuccess("1.1.1.1", "camila", store);
  await fail(MAX_PER_IP_AND_USER - 1, "1.1.1.1", "camila", store);
  check("un acierto limpia los fallos anteriores", await isLocked("1.1.1.1", "camila", store), false);

  store = memoryStore(clock);
  for (let i = 0; i < MAX_PER_USER; i++) await recordFailure(`10.0.0.${i}`, "lucas", store);
  check("30 fallos repartidos entre IPs bloquean el usuario", await isLocked("10.0.9.9", "lucas", store), true);

  const broken: Store = {
    get: () => Promise.reject(new Error("caído")),
    increment: () => Promise.reject(new Error("caído")),
    clear: () => Promise.reject(new Error("caído")),
  };
  store = resilient(broken, memoryStore(clock));
  const warn = console.warn;
  console.warn = () => {};
  await fail(MAX_PER_IP_AND_USER, "1.1.1.1", "paula", store);
  check("si el store compartido falla, sigue contando en memoria", await isLocked("1.1.1.1", "paula", store), true);
  check("y el login no se traba", await isLocked("1.1.1.1", "tomas", store), false);
  console.warn = warn;

  // Each failure uses 2 keys (IP + usuario, y usuario): with a cap of 4, two more usernames push "ana" out.
  store = memoryStore(clock, 4);
  await fail(MAX_PER_IP_AND_USER, "1.1.1.1", "ana", store);
  check("antes del tope, el bloqueo está", await isLocked("1.1.1.1", "ana", store), true);
  for (const u of ["b", "c"]) await recordFailure("1.1.1.1", u, store);
  check("con tope, la memoria descarta las claves más viejas", await isLocked("1.1.1.1", "ana", store), false);

  console.log(failed === 0 ? "\nTodo pasa." : `\n${failed} pruebas fallan.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
