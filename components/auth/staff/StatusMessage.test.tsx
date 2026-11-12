import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusMessage } from "./StatusMessage";

describe("StatusMessage", () => {
  it("se anuncia, puede recibir el foco y lleva ícono además del texto", () => {
    const html = renderToStaticMarkup(
      <StatusMessage tone="error">
        <p>Algo para revisar</p>
      </StatusMessage>,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("<svg");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Algo para revisar");
  });
});
