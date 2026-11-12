import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SetAll = (toSet: { name: string; value: string; options: object }[], headers: Record<string, string>) => void;
const supabase = vi.hoisted(() => {
  const setAll: { current: SetAll | undefined } = { current: undefined };
  return { setAll, getClaims: vi.fn() };
});

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, config: { cookies: { setAll: SetAll } }) => {
    supabase.setAll.current = config.cookies.setAll;
    return { auth: { getClaims: supabase.getClaims } };
  },
}));
vi.mock("@/lib/server/db/env", () => ({ readPublicDbEnv: () => ({ url: "http://localhost:54321", publishableKey: "pk" }) }));

import { applyRefresh, applyTokenPageHeaders, refreshSession, shouldRefresh } from "./session-proxy";

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie } : undefined });

beforeEach(() => {
  supabase.getClaims.mockReset();
  supabase.getClaims.mockResolvedValue({ data: null, error: null });
});

describe("shouldRefresh", () => {
  it("no toca los trabajos, lo interno de Next ni los estáticos", () => {
    for (const path of ["/api/jobs/run", "/api/jobs", "/_next/static/a.js", "/logo.svg"]) expect(shouldRefresh(path)).toBe(false);
  });
  it("refresca páginas y APIs", () => {
    for (const path of ["/", "/grupos", "/api/generate", "/api/jobsx", "/invitacion"]) expect(shouldRefresh(path)).toBe(true);
  });
});

describe("refreshSession", () => {
  it("sin cookie de Supabase no llama a Auth (la demo y los visitantes no cuestan)", async () => {
    expect(await refreshSession(request("/grupos", "tiza_session=x"))).toBeNull();
    expect(supabase.getClaims).not.toHaveBeenCalled();
  });

  it("no llama a Auth en un camino salteado", async () => {
    expect(await refreshSession(request("/api/jobs/run", "sb-x-auth-token=a"))).toBeNull();
    expect(supabase.getClaims).not.toHaveBeenCalled();
  });

  it("devuelve las cookies nuevas y las deja también en el pedido", async () => {
    supabase.getClaims.mockImplementation(async () => {
      supabase.setAll.current?.([{ name: "sb-x-auth-token", value: "nuevo", options: { path: "/" } }], { "Cache-Control": "no-store" });
      return { data: null, error: null };
    });
    const req = request("/grupos", "sb-x-auth-token=viejo");
    const refresh = await refreshSession(req);
    expect(refresh?.cookies).toEqual([{ name: "sb-x-auth-token", value: "nuevo", options: { path: "/" } }]);
    expect(req.cookies.get("sb-x-auth-token")?.value).toBe("nuevo");

    const response = NextResponse.next();
    if (refresh) applyRefresh(response, refresh);
    expect(response.cookies.get("sb-x-auth-token")?.value).toBe("nuevo");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("una cookie borrada se borra también del pedido", async () => {
    supabase.getClaims.mockImplementation(async () => {
      supabase.setAll.current?.([{ name: "sb-x-auth-token", value: "", options: { maxAge: 0 } }], {});
      return { data: null, error: null };
    });
    const req = request("/grupos", "sb-x-auth-token=viejo");
    await refreshSession(req);
    expect(req.cookies.has("sb-x-auth-token")).toBe(false);
  });

  it("si Auth falla, el pedido sigue sin sesión y no se corta", async () => {
    supabase.getClaims.mockRejectedValue(new Error("sin red"));
    expect(await refreshSession(request("/grupos", "sb-x-auth-token=a"))).toBeNull();
  });
});

describe("applyTokenPageHeaders", () => {
  it.each(["/invitacion", "/t", "/ingresar/profesor/nueva"])("%s sale sin caché y sin Referer", (path) => {
    const response = NextResponse.next();
    applyTokenPageHeaders(path, response);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it.each(["/tarjetas", "/ingresar/profesor", "/invitaciones"])("%s no lleva los encabezados", (path) => {
    const response = NextResponse.next();
    applyTokenPageHeaders(path, response);
    expect(response.headers.get("referrer-policy")).toBeNull();
  });
});
