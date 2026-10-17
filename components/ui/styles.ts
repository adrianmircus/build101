// Shared classes: large buttons with good contrast for the projector.
const base =
  "inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-lg font-semibold transition-colors disabled:cursor-not-allowed";

export const primaryButton = `${base} bg-indigo-700 text-white hover:bg-indigo-800 disabled:bg-slate-400`;
export const secondaryButton = `${base} border-2 border-slate-800 bg-white text-slate-900 hover:bg-slate-100 disabled:border-slate-300 disabled:text-slate-400`;
export const approveButton = `${base} bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-slate-400`;
export const dangerButton = "rounded-lg px-3 py-2 text-base font-medium text-red-800 underline-offset-4 hover:bg-red-50 hover:underline";

export const field =
  "w-full rounded-lg border-2 border-slate-500 bg-white px-4 py-3 text-lg text-slate-900 placeholder:text-slate-500 focus:border-indigo-700";

export const card = "rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm";
