import type { OtherCard } from "@/lib/domain/accounts/results";
import { OTHER_REASON } from "./cards-state";
import { FocusHeading } from "./FocusHeading";
import { InfoIcon } from "./icons";
import { paper, quiet } from "./styles";

// The students who got no card in the last request, each with why. Nothing here is a verdict about the student: it is
// about their account, and it can be tried again.

type Props = { others: readonly OtherCard[]; names: ReadonlyMap<string, string>; disabled: boolean; takeFocus: boolean; onRetry: () => void };

export function NotIssued({ others, names, disabled, takeFocus, onRetry }: Props) {
  return (
    <section aria-labelledby="others-title" className={paper}>
      <FocusHeading id="others-title" takeFocus={takeFocus}>
        {others.length === 1 ? "Una tarjeta no salió" : `${others.length} tarjetas no salieron`}
      </FocusHeading>
      <ul className="mt-3 grid gap-2">
        {others.map((other) => (
          <li key={other.studentId} className="flex items-start gap-2.5 text-lg">
            <InfoIcon className="mt-1 size-5 text-slate-700" />
            <span className="[overflow-wrap:anywhere]">
              <span className="font-semibold">{names.get(other.studentId) ?? "Un estudiante"}</span>
              {": "}
              {OTHER_REASON[other.outcome]}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <button type="button" className={quiet} disabled={disabled} onClick={onRetry}>
          Probar de nuevo
        </button>
      </div>
    </section>
  );
}
