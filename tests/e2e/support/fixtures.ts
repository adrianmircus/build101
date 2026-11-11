import { test as base, expect } from "@playwright/test";
import { ALLOWED_CONSOLE_ERRORS } from "../known-gaps";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const test = base.extend<{ externalGuard: void; consoleGuard: void }>({
  // The guided demo must never reach an AI provider, a voice service or any other third party: it runs on fixtures.
  // Every request to a host that is not local is aborted and recorded, and the test fails at the end if there was one.
  externalGuard: [
    async ({ context }, use) => {
      const blocked: string[] = [];
      await context.route(
        (url) => !LOCAL_HOSTS.has(url.hostname),
        (route) => {
          blocked.push(route.request().url());
          return route.abort("blockedbyclient");
        },
      );
      await use();
      expect(blocked, "The demo tried to reach an external host").toEqual([]);
    },
    { auto: true },
  ],
  // A page error or a console.error on the path is a bug, unless it is on the (empty) allowed list.
  consoleGuard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      const record = (text: string) => {
        if (!ALLOWED_CONSOLE_ERRORS.some((allowed) => allowed.test(text))) errors.push(text);
      };
      page.on("pageerror", (error) => record(`pageerror: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") record(`console.error: ${message.text()}`);
      });
      await use();
      expect(errors, "Errores en la consola o de la página").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
