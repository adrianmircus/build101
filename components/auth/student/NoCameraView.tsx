import Link from "next/link";
import { NeutralMessage } from "./NeutralMessage";
import { primary } from "./field-styles";

/** No QR reader here, or no camera, or no permission: the phone's own camera does the same, or the data can be typed. */
export function NoCameraView({ denied }: { denied: boolean }) {
  return (
    <section aria-labelledby="sin-camara-titulo" className="space-y-6">
      <h1 id="sin-camara-titulo" className="text-3xl font-bold">
        {denied ? "No pudimos usar la cámara" : "Escanear desde el celular"}
      </h1>
      <NeutralMessage takeFocus={denied}>
        <p>
          {denied
            ? "Puede que este dispositivo no tenga cámara o que no tenga permiso. No pasa nada."
            : "Desde esta pantalla no podemos leer el código."}
        </p>
        <p>
          Podés abrir la cámara de tu celular y apuntarla al cuadrado con puntitos de la tarjeta: te lleva a Tiza con tus datos puestos. O escribí
          los datos de la tarjeta.
        </p>
      </NeutralMessage>
      <Link href="/ingresar/estudiante" className={primary}>
        Escribir mis datos
      </Link>
    </section>
  );
}
