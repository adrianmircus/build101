import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@/components/testing/renderHook";
import type { Accepted } from "@/lib/domain/accounts/results";
import type { Result } from "@/lib/errors";

vi.mock("@/lib/client/callAction", () => ({ callAction: (action: (input: unknown) => unknown, input: unknown) => action(input) }));

const { useInviteSubmit } = await import("./useInviteSubmit");

const ACCEPTED = { institutionName: "Colegio San José" } as unknown as Accepted;

function handlers() {
  return { onAccepted: vi.fn(), onHaveAccount: vi.fn(), onGone: vi.fn(), onReload: vi.fn() };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

// The forms of the invitation are uncontrolled and keyed with `formKey`: a new key empties the password and the «mostrar».
describe("los formularios de la invitación no guardan la contraseña (F2-20)", () => {
  it("al ocultarse (ir a «Olvidé mi contraseña» y volver) se renueva el formulario y se suelta el botón ocupado", () => {
    const hook = renderHook(() => useInviteSubmit("signin", handlers()));
    const key = hook.current.formKey;
    const waiting = deferred<Result<Accepted>>();
    void hook.current.submit(() => waiting.promise);
    expect(hook.current.pending).toBe(true);
    hook.hide();
    expect(hook.current.pending).toBe(false);
    expect(hook.current.formKey).not.toBe(key);
  });

  it("al terminar bien también se renueva: la contraseña no queda en el formulario que sigue vivo", async () => {
    const calls = handlers();
    const hook = renderHook(() => useInviteSubmit("new", calls));
    const key = hook.current.formKey;
    await hook.current.submit(async () => ({ ok: true, data: ACCEPTED }));
    expect(calls.onAccepted).toHaveBeenCalledWith(ACCEPTED);
    expect(hook.current.pending).toBe(false);
    expect(hook.current.formKey).not.toBe(key);
  });

  it("si falla, el formulario se queda como está para corregir (no se renueva)", async () => {
    const hook = renderHook(() => useInviteSubmit("new", handlers()));
    const key = hook.current.formKey;
    await hook.current.submit(async () => ({ ok: false, code: "UNAVAILABLE", message: "No pudimos conectarnos." }) as Result<Accepted>);
    expect(hook.current.pending).toBe(false);
    expect(hook.current.formKey).toBe(key);
  });
});
