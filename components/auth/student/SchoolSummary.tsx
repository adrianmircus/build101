import { linkClass } from "./field-styles";

type Props = {
  name: string;
  /** The line under the name: «Recordado en este dispositivo», or the username of a scanned card. */
  caption: string;
  actionLabel: string;
  /** Said to a screen reader after the visible label: «Cambiar» + « de colegio». */
  actionHint: string;
  onAction: () => void;
};

/** The school (and, with a card, the username) already known: read-only, with the way out right next to it. */
export function SchoolSummary({ name, caption, actionLabel, actionHint, onAction }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl bg-slate-100 px-4 py-3">
      <div>
        <p className="text-xl font-semibold text-slate-900">{name}</p>
        <p className="text-base text-slate-700">{caption}</p>
      </div>
      <button type="button" onClick={onAction} className={linkClass}>
        {actionLabel}
        <span className="sr-only"> {actionHint}</span>
      </button>
    </div>
  );
}
