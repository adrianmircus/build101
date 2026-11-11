// Gaps of the app that exist today and that demo.spec.ts tolerates. BOTH LISTS ONLY SHRINK: never add an entry to
// make a red test green, fix the app instead and delete the entry in the same change.

// Steps whose bubble button is off screen with a mouse or a finger (the tour places the bubble below the fold).
// tapInBubble falls back to Enter for them; for any other step it fails. Titles are the bubble's heading.
export const KNOWN_UNREACHABLE_BUTTON_STEPS: string[] = ["Cada cambio, con su porqué", "Para responder con la mirada"];

// console.error messages and page errors the demo path may print. The path should be silent: this list is the debt.
export const ALLOWED_CONSOLE_ERRORS: RegExp[] = [
  // Phone screens: the page's view transition is aborted when the viewport changes size and the rejection is not caught.
  /Transition was aborted because of invalid state. Viewport size changed/,
];
