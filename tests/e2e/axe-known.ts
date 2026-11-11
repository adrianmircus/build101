// Accessibility violations (serious or critical) that exist today and are tolerated by the e2e safety net.
//
// THIS LIST ONLY SHRINKS. Never add an entry to make a red test green: fix the screen instead. When a fix lands,
// delete its entry in the same change. Each entry says which axe rule fails, on which screen of the demo's
// path, and why it is tolerated for now.
export type KnownViolation = {
  // axe rule id, e.g. "color-contrast".
  rule: string;
  // Screen name used by demo.spec.ts when it calls checkAccessibility.
  screen: string;
  reason: string;
};

export const KNOWN_VIOLATIONS: KnownViolation[] = [];
