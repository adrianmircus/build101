import Link from "next/link";
import { primaryButton, textLink } from "@/components/ui/styles";
import { SheetHeading } from "./SheetHeading";

// The recovery link is gone (login-profe-a, #vencido): an hour passed or it was already used.
export function LinkExpired() {
  return (
    <div className="space-y-6">
      <SheetHeading
        title="Este enlace ya no sirve"
        lead="Los enlaces para crear una contraseña duran una hora y se usan una sola vez. Pedí uno nuevo y usalo apenas te llegue."
      />
      <div className="flex flex-col items-stretch gap-3">
        <Link href="/ingresar/profesor/olvide" className={`${primaryButton} w-full`}>
          Pedir un enlace nuevo
        </Link>
        <Link href="/ingresar/profesor" className={`${textLink} self-start`}>
          Volver a ingresar
        </Link>
      </div>
    </div>
  );
}
