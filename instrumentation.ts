import { assertStartupConfig } from "@/lib/server/startup-config";

// Next calls this once when a server instance starts, and the server does not take requests until it returns (F2-10): a
// production deploy without its mail, rate-limit or site configuration stops here with a clear message, not on the first
// invitation. Development, tests and the demo's build are not affected (the check only applies to NODE_ENV=production).
export function register(): void {
  assertStartupConfig(process.env);
}
