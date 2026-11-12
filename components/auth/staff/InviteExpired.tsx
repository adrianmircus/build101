import Link from "next/link";
import { secondaryButton } from "@/components/ui/styles";
import { InvitationLetter } from "./InvitationLetter";

type Props = {
  /** «expired» says it ran out; the others (used, cancelled) say it no longer works. Without the invitation (no token), a neutral text. */
  status?: "expired" | "accepted" | "revoked" | "pending";
  inviterName?: string | null;
  institutionName?: string;
};

// Case «vencida, usada o cancelada» (invitacion-a, #vencida). It never shows who the invitation was for.
export function InviteExpired({ status, inviterName, institutionName }: Props) {
  const title = status === "expired" ? "Esta invitación venció" : "Esta invitación ya no sirve";
  const asks = inviterName ? `Pedile a ${inviterName}, o a quien administra ${institutionName ?? "el colegio"},` : "Pedile a quien administra tu colegio";
  return (
    <>
      <InvitationLetter title={title}>
        <p>Las invitaciones duran 7 días y se usan una vez. {asks} que te mande otra.</p>
      </InvitationLetter>
      <div className="mt-8">
        <Link href="/ingresar/profesor" className={secondaryButton}>
          Ir a ingresar
        </Link>
      </div>
    </>
  );
}
