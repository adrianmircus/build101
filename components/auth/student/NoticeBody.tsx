import type { Notice } from "./failure-view";

const EXAMPLE = "sol-nube-tigre-47";

/** The words of each notice: what happened, without blame, and one concrete thing to try. */
export function NoticeBody({ notice, withCard = false }: { notice: Notice; withCard?: boolean }) {
  switch (notice.kind) {
    case "wrong":
      return withCard ? (
        <p>
          <strong>Probemos de nuevo.</strong> Esa no es la contraseña. En la tarjeta las palabras van unidas con guiones, como <strong>{EXAMPLE}</strong>.
        </p>
      ) : (
        <p>
          <strong>Probemos de nuevo.</strong> El usuario o la contraseña no coinciden. Una pista: en la tarjeta, la contraseña lleva guiones entre las
          palabras, como <strong>{EXAMPLE}</strong>.
        </p>
      );
    case "missing":
      return <p>{MISSING[notice.field]}</p>;
    case "unavailable":
      return (
        <p>
          <strong>No pudimos conectarnos.</strong> No hiciste nada mal. Probá de nuevo en un ratito: lo que escribiste sigue acá.
        </p>
      );
    case "stale":
      return (
        <>
          <p>
            <strong>Tiza se actualizó.</strong> Recargá la página para seguir.
          </p>
          <button type="button" onClick={() => location.reload()} className="min-h-11 rounded-md font-semibold text-indigo-800 underline underline-offset-4">
            Recargar la página
          </button>
        </>
      );
  }
}

const MISSING = {
  code: "Falta el código del colegio. Está en la tarjeta.",
  username: "Falta tu usuario. Está en la tarjeta.",
  password: "Falta la contraseña. Está en la tarjeta, abajo de tu usuario.",
} as const;
