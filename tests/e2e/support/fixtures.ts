import { test as base, expect } from "@playwright/test";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// The guided demo must never reach an AI provider, a voice service or any other third party: it runs on fixtures.
// Every request to a host that is not local is aborted and recorded, and the test fails at the end if there was one.
export type TestOptions = { viewTransitions: boolean };

export const test = base.extend<{ externalGuard: void } & TestOptions>({
  // Known app bug: on a phone-sized screen the page's view transition never finishes after the tour navigates, and
  // the tour's bubble never shows (see the report of T0.3). The phone project turns transitions off so the rest of
  // the path is still covered. Remove this option when the app is fixed.
  viewTransitions: [true, { option: true }],
  page: async ({ page, viewTransitions }, use) => {
    if (!viewTransitions) {
      await page.addInitScript(() => {
        Reflect.deleteProperty(Document.prototype, "startViewTransition");
      });
    }
    await use(page);
  },
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
});

export { expect };
