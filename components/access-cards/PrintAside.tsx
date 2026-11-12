import type { AccountRow } from "@/lib/domain/accounts/entities";
import { countText, MAX_PER_REQUEST, TOO_MANY } from "./cards-state";
import { PrinterIcon } from "./icons";
import { SampleCard } from "./SampleCard";
import { primary } from "./styles";

// The right column: how a card looks, how many will come out and the button that asks to make them.

type Props = {
  sample: AccountRow;
  schoolCode: string;
  groupName: string;
  chosen: string[];
  running: boolean;
  onAsk: (ids: string[]) => void;
};

export function PrintAside({ sample, schoolCode, groupName, chosen, running, onAsk }: Props) {
  const tooMany = chosen.length > MAX_PER_REQUEST;
  return (
    <aside aria-label="Tarjeta de muestra y botón de imprimir" className="grid gap-4 lg:sticky lg:top-6">
      <SampleCard displayName={sample.displayName} username={sample.username} schoolCode={schoolCode} groupName={groupName} />
      <p id="count" role="status" className="text-lg text-slate-700">
        {countText(chosen.length)}
      </p>
      {tooMany && <p className="text-lg text-slate-900">{TOO_MANY}</p>}
      <button
        type="button"
        className={`${primary} w-full`}
        disabled={running || chosen.length === 0 || tooMany}
        aria-describedby="count"
        aria-busy={running}
        onClick={() => onAsk(chosen)}
      >
        <PrinterIcon />
        {running ? "Creando las tarjetas…" : "Crear contraseñas e imprimir"}
      </button>
    </aside>
  );
}
