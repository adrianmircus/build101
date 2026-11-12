import { describe, expect, it } from "vitest";
import { EDGE, TOP, placeBubble, type Layout } from "./bubblePosition";

const size = { width: 384, height: 340 };
const layout = (hole: Layout["hole"], vw = 1280, vh = 720): Layout => ({ hole, size, vw, vh });

function expectInside(p: { top: number; left: number }, vw: number, vh: number) {
  expect(p.top).toBeGreaterThanOrEqual(TOP);
  expect(p.top + size.height).toBeLessThanOrEqual(vh - EDGE);
  expect(p.left).toBeGreaterThanOrEqual(EDGE);
  expect(p.left + size.width).toBeLessThanOrEqual(vw - EDGE);
}

describe("placeBubble", () => {
  it("va debajo del elemento si entra", () => {
    const p = placeBubble(layout({ top: 100, left: 400, width: 300, height: 80 }));
    expect(p.side).toBe("below");
    expect(p.top).toBe(100 + 80 + 16);
    expectInside(p, 1280, 720);
  });

  it("pasa arriba si abajo no entra", () => {
    const p = placeBubble(layout({ top: 500, left: 400, width: 300, height: 100 }));
    expect(p.side).toBe("above");
    expectInside(p, 1280, 720);
  });

  it("pasa al costado con un elemento alto y angosto", () => {
    const p = placeBubble(layout({ top: 80, left: 100, width: 300, height: 600 }));
    expect(p.side).toBe("right");
    expectInside(p, 1280, 720);
  });

  it("con un elemento tan grande que no entra al lado, queda entera en la pantalla (nunca debajo del borde)", () => {
    const hole = { top: 72, left: 8, width: 1264, height: 900 };
    for (const [vw, vh] of [[1280, 720], [1024, 600]]) {
      const p = placeBubble({ hole, size, vw, vh });
      expect(p.side).toBe("over");
      expectInside(p, vw, vh);
    }
  });

  it("conserva el lado mientras siga entrando y cambia cuando ya no entra", () => {
    const hole = { top: 450, left: 400, width: 300, height: 40 };
    expect(placeBubble(layout(hole, 1280, 1000)).side).toBe("below");
    expect(placeBubble(layout(hole, 1280, 1000), "above").side).toBe("above");
    expect(placeBubble(layout({ ...hole, top: 100 }, 1280, 1000), "above").side).toBe("below");
  });

  it("no se sale por los costados con un elemento pegado al borde", () => {
    const p = placeBubble(layout({ top: 100, left: 1200, width: 70, height: 60 }));
    expectInside(p, 1280, 720);
  });
});
