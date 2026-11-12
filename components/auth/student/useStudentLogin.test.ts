import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@/components/testing/renderHook";
import type { LoginOutcome } from "./login-flow";

// The real hook, with its dependencies simulated: the login answers when the test says so (a delayed answer).
const push = vi.fn();
const signOut = vi.fn();
const runLogin = vi.fn<(values: { code: string; username: string; password: string }) => Promise<LoginOutcome>>();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/app/ingresar/estudiante/actions", () => ({ findInstitutionAction: vi.fn() }));
vi.mock("@/app/salir/actions", () => ({ signOutAction: (input: unknown) => signOut(input) }));
vi.mock("@/lib/client/callAction", () => ({ callAction: (action: (input: unknown) => unknown, input: unknown) => action(input) }));
vi.mock("@/lib/client/remembered-school", () => ({ rememberSchool: vi.fn(), forgetSchool: vi.fn() }));
vi.mock("./useSchoolLookup", () => ({ useSchoolLookup: () => ({ state: { kind: "none" }, lookupNow: vi.fn() }) }));
vi.mock("./login-flow", () => ({ runLogin: (values: { code: string; username: string; password: string }) => runLogin(values) }));

const { useStudentLogin } = await import("./useStudentLogin");
const { supersedeLogins, hasUnclosed, markClosed } = await import("./login-guard");
const { closePreviousSession } = await import("./login-attempt");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const SCHOOL = { code: "sanjose", name: "Colegio San José" };

function screen() {
  const hook = renderHook(() => useStudentLogin({ school: SCHOOL, username: "luciaf" }));
  hook.current.edit("password", "secreta");
  return hook;
}

beforeEach(() => {
  push.mockReset();
  signOut.mockReset();
  signOut.mockResolvedValue({ ok: true, data: { next: "/ingresar/estudiante" } });
  runLogin.mockReset();
  markClosed();
});

describe("el login de la tarjeta (F2-21)", () => {
  it("sin otra tarjeta, un login que sale bien navega", async () => {
    runLogin.mockResolvedValue({ kind: "in", next: "/estudiante" });
    const hook = screen();
    await hook.current.submit({ preventDefault: vi.fn() } as never);
    expect(push).toHaveBeenCalledWith("/estudiante");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("llega una tarjeta nueva con el login en el aire: si después sale bien, no navega y cierra esa sesión antes de mostrar la nueva", async () => {
    const answer = deferred<LoginOutcome>();
    runLogin.mockReturnValue(answer.promise);
    const hook = screen();
    const submitting = hook.current.submit({ preventDefault: vi.fn() } as never);
    expect(hook.current.state.busy).toBe(true);

    const order: string[] = [];
    // The signOut is slow too: the new card has to wait for it.
    const closing = deferred<{ ok: true; data: { next: string } }>();
    signOut.mockImplementation(() => (order.push("signOut"), closing.promise));
    const newCardMayShow = supersedeLogins().then(() => order.push("nueva tarjeta"));
    hook.unmount(); // the form of card A leaves when card B is read

    answer.resolve({ kind: "in", next: "/estudiante" });
    await flush();
    expect(order).toEqual(["signOut"]);
    expect(push).not.toHaveBeenCalled();

    closing.resolve({ ok: true, data: { next: "/ingresar/estudiante" } });
    await Promise.all([submitting, newCardMayShow]);
    expect(order).toEqual(["signOut", "nueva tarjeta"]);
    expect(push).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("F2-23: si cerrar la sesión vieja falla, la tarjeta nueva no se habilita hasta que un reintento lo confirma", async () => {
    runLogin.mockResolvedValue({ kind: "in", next: "/estudiante" });
    signOut.mockResolvedValue({ ok: false, error: { code: "UNAVAILABLE", message: "No pudimos conectarnos." } });
    const hook = screen();
    const submitting = hook.current.submit({ preventDefault: vi.fn() } as never);
    await Promise.resolve();
    const newCardMayShow = supersedeLogins();
    await Promise.all([submitting, newCardMayShow]);
    expect(push).not.toHaveBeenCalled();
    expect(hasUnclosed()).toBe(true);
    // The retry that fails keeps it blocked; the one that is confirmed lets the card show.
    expect(await closePreviousSession()).toBe(false);
    expect(hasUnclosed()).toBe(true);
    signOut.mockResolvedValue({ ok: true, data: { next: "/ingresar/estudiante" } });
    expect(await closePreviousSession()).toBe(true);
    expect(hasUnclosed()).toBe(false);
  });

  it("si el login viejo termina mal, se descarta: no navega ni cierra nada", async () => {
    const answer = deferred<LoginOutcome>();
    runLogin.mockReturnValue(answer.promise);
    const hook = screen();
    const submitting = hook.current.submit({ preventDefault: vi.fn() } as never);
    const newCardMayShow = supersedeLogins();
    answer.resolve({ kind: "pause", retryAt: undefined });
    await Promise.all([submitting, newCardMayShow]);
    expect(push).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(hook.current.state.pause).toBeNull();
  });

  it("la tarjeta nueva llega entre la respuesta y el final del login: tampoco navega y cierra la sesión", async () => {
    runLogin.mockResolvedValue({ kind: "in", next: "/estudiante" });
    const hook = screen();
    const submitting = hook.current.submit({ preventDefault: vi.fn() } as never);
    await Promise.resolve(); // the answer is in, the school name is being looked for
    const newCardMayShow = supersedeLogins();
    await Promise.all([submitting, newCardMayShow]);
    expect(push).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("un login que sale después de la tarjeta nueva es de esa tarjeta y navega", async () => {
    runLogin.mockResolvedValue({ kind: "in", next: "/estudiante" });
    await supersedeLogins();
    const hook = screen();
    await hook.current.submit({ preventDefault: vi.fn() } as never);
    expect(push).toHaveBeenCalledWith("/estudiante");
  });
});

describe("la contraseña no se queda al ocultar la pantalla (F2-17)", () => {
  it("al ocultarse se borran la contraseña, «mostrar» y el botón ocupado", async () => {
    runLogin.mockReturnValue(new Promise(() => undefined));
    const hook = screen();
    hook.current.toggleReveal();
    void hook.current.submit({ preventDefault: vi.fn() } as never);
    expect(hook.current.state).toMatchObject({ password: "secreta", reveal: true, busy: true });
    hook.hide();
    expect(hook.current.state).toMatchObject({ password: "", reveal: false, busy: false });
  });
});
