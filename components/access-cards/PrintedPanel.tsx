import { cardsLabel, sheetsLabel } from "./cards-state";
import { FocusHeading } from "./FocusHeading";
import { PrinterIcon } from "./icons";
import { primary, paper, quiet } from "./styles";

// What the teacher sees after the cards were made: how many, and the two things they can do. The passwords are not
// here: they are in the print sheet only. «Imprimir de nuevo» does not make new passwords; «Listo» drops them.

type Props = { count: number; onReprint: () => void; onDone: () => void };

export function PrintedPanel({ count, onReprint, onDone }: Props) {
  return (
    <section aria-labelledby="printed-title" className={paper}>
      <FocusHeading id="printed-title">{count === 1 ? "La tarjeta está lista" : `Las ${count} tarjetas están listas`}</FocusHeading>
      <p className="mt-2 text-lg">
        {cardsLabel(count)}, {sheetsLabel(count)}. Las contraseñas no se ven en pantalla: están en la hoja que se mandó a imprimir.
      </p>
      <p className="mt-2 text-lg text-slate-700">
        Si la hoja no salió bien, podés imprimirla de nuevo: no se crean contraseñas nuevas. Cuando termines, tocá «Listo» y las contraseñas se borran de esta página.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className={primary} onClick={onReprint}>
          <PrinterIcon />
          Imprimir de nuevo
        </button>
        <button type="button" className={quiet} onClick={onDone}>
          Listo
        </button>
      </div>
    </section>
  );
}
