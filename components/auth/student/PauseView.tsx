import { NeutralMessage } from "./NeutralMessage";
import { quiet } from "./field-styles";
import { describeRetry } from "./retry-time";

type Props = {
  retryAt: string | undefined;
  /** When the pause started (ms): the minutes left are counted from here. */
  at: number;
  onBack: () => void;
};

/** Too many tries: a pause without blame, with the time from which it can be tried again. */
export function PauseView({ retryAt, at, onBack }: Props) {
  const retry = describeRetry(retryAt, at);
  return (
    <section aria-labelledby="pausa-titulo" className="space-y-6">
      <h1 id="pausa-titulo" className="text-3xl font-bold">
        Tomemos una pausa
      </h1>
      <NeutralMessage>
        <p>
          Probaste varias veces. Para cuidar tu cuenta, {retry ? <RetryClause clock={retry.clock} minutes={retry.minutes} iso={retry.iso} /> : "en unos minutos podés volver a intentar"}.
          {" "}Si no encontrás tu tarjeta, pedile una nueva a tu profe.
        </p>
      </NeutralMessage>
      <button type="button" onClick={onBack} className={quiet}>
        Volver
      </button>
    </section>
  );
}

function RetryClause({ clock, minutes, iso }: { clock: string; minutes: number; iso: string }) {
  return (
    <>
      podés volver a intentar a las <time dateTime={iso} className="font-bold">{clock}</time> (en {minutes === 1 ? "1 minuto" : `${minutes} minutos`})
    </>
  );
}
