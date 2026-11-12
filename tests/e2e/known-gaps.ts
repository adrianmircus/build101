// Gaps of the app that exist today and that demo.spec.ts tolerates. BOTH LISTS ONLY SHRINK: never add an entry to
// make a red test green, fix the app instead and delete the entry in the same change.

// console.error messages and page errors the demo path may print. The path should be silent: this list is the debt.
export const ALLOWED_CONSOLE_ERRORS: RegExp[] = [];
