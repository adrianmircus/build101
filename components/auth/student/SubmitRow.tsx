import Link from "next/link";
import { CameraIcon } from "./CameraIcon";
import { linkClass, primary } from "./field-styles";

type Props = { busy: boolean; tryAgain: boolean; fromCard: boolean };

/** «Entrar», or «Probar de nuevo» after a notice; and the second door, scanning, unless the card was already scanned. */
export function SubmitRow({ busy, tryAgain, fromCard }: Props) {
  return (
    <div className="grid gap-2">
      <button type="submit" disabled={busy} className={primary}>
        {busy ? "Entrando…" : tryAgain ? "Probar de nuevo" : "Entrar"}
      </button>
      {!fromCard && (
        <p className="flex justify-center">
          <Link href="/ingresar/estudiante/escanear" className={linkClass}>
            <CameraIcon className="size-6" />
            Escanear el código de la tarjeta
          </Link>
        </p>
      )}
    </div>
  );
}
