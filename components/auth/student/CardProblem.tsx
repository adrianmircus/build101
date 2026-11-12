import Link from "next/link";
import { NeutralMessage } from "./NeutralMessage";
import { primary, quiet } from "./field-styles";

type Props = {
  /** `unusable`: the card does not work (old, replaced, unknown). `unavailable`: something failed on our side. */
  why: "unusable" | "unavailable";
  /** On the scan screen the student can try again; on /t the link is the card's address, so there is nothing to retry. */
  onRetry?: () => void;
};

/** A card that cannot be used: neutral, with the way forward (type the data) and what to ask for. */
export function CardProblem({ why, onRetry }: Props) {
  return (
    <section aria-labelledby="tarjeta-titulo" className="space-y-6">
      <h1 id="tarjeta-titulo" className="text-3xl font-bold">
        No pudimos usar esta tarjeta
      </h1>
      <NeutralMessage>
        {why === "unusable" ? (
          <p>Puede que sea una tarjeta vieja: si tu profe te dio una nueva, usá esa. Mientras tanto, escribí los datos que están en la tarjeta.</p>
        ) : (
          <p>
            <strong>No pudimos conectarnos.</strong> No hiciste nada mal. Podés escribir los datos de la tarjeta o probar de nuevo en un ratito.
          </p>
        )}
      </NeutralMessage>
      <div className="grid gap-2">
        <Link href="/ingresar/estudiante" className={primary}>
          Escribir mis datos
        </Link>
        {onRetry && (
          <button type="button" onClick={onRetry} className={quiet}>
            Escanear de nuevo
          </button>
        )}
      </div>
    </section>
  );
}
