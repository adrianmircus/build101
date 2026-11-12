// Classes of the student login. Nothing here is red: a message is told by its icon and its words, never by its color.

export const inputClass =
  "min-h-14 w-full rounded-xl border-2 border-slate-500 bg-white px-4 py-3 text-xl text-slate-900 focus:border-indigo-700";

export const labelClass = "text-lg font-semibold text-slate-900";

export const bigButton =
  "inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-xl font-semibold transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-600";

export const primary = `${bigButton} bg-indigo-700 text-white hover:bg-indigo-800`;
export const quiet = `${bigButton} bg-slate-100 text-slate-900 hover:bg-slate-200`;

export const linkClass =
  "inline-flex min-h-11 items-center gap-2 rounded-md text-lg font-semibold text-indigo-800 underline decoration-2 underline-offset-4 hover:text-indigo-950";
