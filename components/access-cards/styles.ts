// Classes of the cards page. Large targets (44 px at least), no decorative borders: the white paper over the grey
// ground separates the blocks, and the focus ring is the one of the app (globals.css).

const base =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-3 text-lg font-semibold transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0";

export const primary = `${base} bg-indigo-700 text-white hover:bg-indigo-800 disabled:bg-slate-200 disabled:text-slate-600`;
export const quiet = `${base} bg-slate-100 text-slate-900 hover:bg-slate-200 disabled:bg-slate-100 disabled:text-slate-600`;
export const paper = "rounded-2xl bg-white p-5 shadow-sm shadow-slate-900/10 sm:p-6";
