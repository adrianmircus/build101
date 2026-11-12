import Link from "next/link";
import { CameraIcon } from "./CameraIcon";
import { linkClass, primary } from "./field-styles";

/** The camera is opened by a tap, not on arrival: the browser's permission question comes when the student chose it. */
export function ScanIntro({ onOpen }: { onOpen: () => void }) {
  return (
    <section aria-labelledby="escanear-titulo">
      <h1 id="escanear-titulo" className="text-3xl font-bold">
        Escanear mi tarjeta
      </h1>
      <p className="mt-2 mb-7 text-lg text-slate-700">
        La cámara lee el código de tu tarjeta y completa el colegio y el usuario. Después solo escribís la contraseña. La imagen no se guarda ni se envía.
      </p>
      <div className="grid gap-2">
        <button type="button" onClick={onOpen} className={primary}>
          <CameraIcon className="size-6" />
          Abrir la cámara
        </button>
        <p className="flex justify-center">
          <Link href="/ingresar/estudiante" className={linkClass}>
            Prefiero escribir mis datos
          </Link>
        </p>
      </div>
    </section>
  );
}
