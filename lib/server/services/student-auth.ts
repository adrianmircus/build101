import "server-only";
import { normalizePassword, studentSubject } from "@/lib/domain/accounts/normalize";
import type { FoundInstitution, NextStep, SchoolAndUser } from "@/lib/domain/accounts/results";
import { AppError } from "@/lib/errors";
import { DECOY_HASH, verifyPassword } from "../auth/password-hash";
import { hashToken } from "../auth/tokens";
import { log } from "../log";
import { setSessionTokens } from "../repos/auth-session";
import { AuthBusyError, findInstitution as findSchool, type OpenSessionHooks, openStudentSession, resolveAccessCard, studentLogin } from "./admin/student-login";
import { clearSubject, guardAttempt } from "./rate-limit";

// Sign in of students (T2.5b). The login normalizes what is typed (normalize.ts) and never builds anything from the name of
// the student. Every sign in that does not get in takes at least 800 ms and, whether the user or the password is wrong, gives the
// same generic error after the same work: an unknown user is checked against a decoy hash with the same scrypt parameters.
// The only difference allowed is a school code that does not exist: the code is not a secret, so it is said by name.
// Steps of docs/contratos/fase-2.md, «Cómo entra un estudiante». Nothing here logs a password, a token, a username or a hash.

export type SignInStudent = { code: string; username: string; password: string; ip: string };
/** Only for tests: stops the flow between its steps. `afterPasswordCheck` runs after scrypt and before Auth is asked for a session. */
export type SignInHooks = OpenSessionHooks & { afterPasswordCheck?: () => Promise<void> };

const MISMATCH = "El usuario o la contraseña no coinciden. Revisalos y probá de nuevo.";
const NO_SCHOOL = "No encontramos un colegio con ese código. Revisá que esté igual que en la tarjeta.";
const NO_CARD = "Esta tarjeta ya no sirve. Si tu profe te dio una nueva, usá esa.";
const STUDENT_HOME = "/estudiante";
const MIN_ANSWER_MS = 800;

async function waitUntil(startedAt: number, afterMs: number): Promise<void> {
  const left = startedAt + afterMs - Date.now();
  if (left > 0) await new Promise<void>((resolve) => setTimeout(resolve, left));
}

/** Whatever makes this fail answers no sooner than 800 ms after it started: the time says nothing about which failure it was. */
async function slowWhenItFails<T>(startedAt: number, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    await waitUntil(startedAt, MIN_ANSWER_MS);
    throw error;
  }
}

/** The school by its code, for «Colegio recordado»; NOT_FOUND with a neutral message. Only schools, never sandboxes. */
export async function findInstitution(input: { code: string; ip: string }): Promise<FoundInstitution> {
  // The code is not a secret and a screen asks for it while the person types, so no counter of attempts is spent here: the school
  // login (the one that needs a secret) and the cards have theirs, and a whole class shares one IP.
  const school = await findSchool(input.code);
  if (school === null) throw new AppError("NOT_FOUND", NO_SCHOOL);
  return school;
}

type RealAccount = { authUserId: string; version: number };

/**
 * Steps 2 and 3: the data of the login and scrypt against the hash or against the decoy. The work is the same for an unknown school,
 * an unknown user and a wrong password. The decoy never opens a session: without the data of a real account (the three fields come
 * together or none) there is nothing to open, whatever scrypt said.
 */
async function checkCredentials(who: { code: string; username: string; password: string }, hooks?: SignInHooks): Promise<RealAccount> {
  const login = await studentLogin(who.code, who.username);
  const matches = await verifyPassword(normalizePassword(who.password), login.passwordHash ?? DECOY_HASH);
  await hooks?.afterPasswordCheck?.();
  if (!login.institutionFound) throw new AppError("NOT_FOUND", NO_SCHOOL);
  if (!matches || login.passwordHash === null || login.authUserId === null || login.version === null) throw new AppError("FORBIDDEN", MISMATCH);
  return { authUserId: login.authUserId, version: login.version };
}

/** Steps 4 to 6: the session of Supabase with no cookies, the bind, and only then the cookies. */
async function openSession(account: RealAccount, onBusy: () => Promise<void>, hooks?: SignInHooks): Promise<void> {
  let tokens;
  try {
    tokens = await openStudentSession(account.authUserId, account.version, hooks);
  } catch (thrown) {
    // The password was right: a busy Auth counts as a success, so our own counters never block the retry.
    if (thrown instanceof AuthBusyError) await onBusy();
    throw thrown;
  }
  if (tokens === null) throw new AppError("FORBIDDEN", MISMATCH);
  await setSessionTokens(tokens);
}

/**
 * The steps of the contract, in order: limit of attempts (it counts before trying), the data of the login, scrypt against the hash
 * or against the decoy, the session of Supabase with no cookies and the bind, and only then the cookies. A success clears the
 * counters of the subject.
 */
export async function signInStudent(input: SignInStudent, hooks?: SignInHooks): Promise<NextStep> {
  const startedAt = Date.now();
  const code = input.code.trim().toLowerCase();
  const username = input.username.trim().toLowerCase();
  const clear = () => clearAfterSuccess(code, username, input.ip);
  return slowWhenItFails(startedAt, async () => {
    await guardAttempt("student", input.ip, studentSubject(code, username));
    const account = await checkCredentials({ code, username, password: input.password }, hooks);
    await openSession(account, clear, hooks);
    await clear();
    return { next: STUDENT_HOME };
  });
}

/** Failing to clear never blocks a sign in that already worked. */
async function clearAfterSuccess(code: string, username: string, ip: string): Promise<void> {
  await clearSubject("student", studentSubject(code, username), ip).catch(() => log.warn("rate_limit.clear_failed", { limitKind: "student" }));
}

/** The school and username of a current card; every attempt counts against `token_ip`. No name of the student. */
export async function readAccessCard(input: { token: string; ip: string }): Promise<SchoolAndUser> {
  await guardAttempt("token", input.ip, null);
  const card = await resolveAccessCard(hashToken(input.token));
  if (card === null) throw new AppError("NOT_FOUND", NO_CARD);
  return card;
}
