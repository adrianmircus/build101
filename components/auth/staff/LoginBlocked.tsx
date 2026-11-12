import Link from "next/link";
import { primaryButton } from "@/components/ui/styles";
import { StatusMessage } from "./StatusMessage";

// Too many tries (maqueta login-profe-b, «bloqueado»): neutral, with the hour to come back and a way out right now.
// `when` is already a phrase in local time («a las 10:42»); without it we only say «en unos minutos».
export function LoginBlocked({ when }: { when: string | null }) {
  return (
    <div className="mt-6 space-y-6">
      <StatusMessage tone="neutral">
        <p>
          Probaste varias veces con esta cuenta. Para cuidarla, vas a poder volver a intentar{" "}
          <strong>{when ?? "en unos minutos"}</strong>. Si no te acordás de la contraseña, podés crear una nueva ahora.
        </p>
      </StatusMessage>
      <Link href="/ingresar/profesor/olvide" className={primaryButton}>
        Crear una contraseña nueva
      </Link>
    </div>
  );
}
