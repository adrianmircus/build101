// Shared classes: large buttons with good contrast for the projector.
// Every interactive target is at least 44px tall (min-h-11).
const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-5 py-3 text-lg font-semibold transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0";

// Disabled: light gray with dark text (5.7:1) instead of white on gray (2.6:1), so it stays legible when projected.
const disabled = "disabled:bg-slate-200 disabled:text-slate-600";

export const primaryButton = `${base} bg-indigo-700 text-white hover:bg-indigo-800 ${disabled}`;
export const secondaryButton = `${base} border-2 border-slate-800 bg-white text-slate-900 hover:bg-slate-100 disabled:border-slate-300 disabled:bg-white disabled:text-slate-600`;
export const approveButton = `${base} bg-emerald-700 text-white hover:bg-emerald-800 ${disabled}`;
export const dangerButton =
  "inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-base font-semibold text-red-800 underline-offset-4 transition-colors hover:bg-red-50 hover:underline";

// Text link with a 44px target, for navigation and secondary actions.
export const textLink =
  "inline-flex min-h-11 items-center rounded-md text-indigo-800 underline underline-offset-4 hover:text-indigo-950";

// Link inside a sentence: stays inline so it wraps with the text (inline links are exempt from target size).
export const inlineLink = "font-semibold text-indigo-800 underline underline-offset-4 hover:text-indigo-950";

export const field =
  "w-full rounded-lg border-2 border-slate-500 bg-white px-4 py-3 text-lg text-slate-900 placeholder:text-slate-500 focus:border-indigo-700 aria-invalid:border-red-700";

export const card = "rounded-2xl border-2 border-slate-200 bg-white p-6";

// Native inputs hidden behind a styled label (chips, radios, file upload): the label shows the focus ring.
export const focusWithin =
  "has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-3 has-[input:focus-visible]:outline-indigo-950";

// Type tag ("Práctico", "Parcial"): sentence case, all-caps is harder to read.
export const typeTag = "rounded-md bg-slate-900 px-2.5 py-0.5 text-base font-semibold text-white";
