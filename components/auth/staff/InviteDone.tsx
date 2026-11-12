import Link from "next/link";
import type { Accepted } from "@/lib/domain/accounts/results";
import { primaryButton } from "@/components/ui/styles";
import { InvitationLetter } from "./InvitationLetter";

// Case «aceptada» (invitacion-a, #listo): role="status" announces it and the title takes the focus.
export function InviteDone({ institutionName, accepted }: { institutionName: string; accepted: Accepted }) {
  return (
    <>
      <div role="status" className="space-y-4">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="size-12 text-emerald-800">
          <circle cx="12" cy="12" r="9.5" />
          <path d="m7.5 12.5 3 3 6-6.5" />
        </svg>
        <InvitationLetter title={`Ya sos parte de ${institutionName}`} focus>
          <p>El próximo paso es armar tu primer grupo: pegás la lista y listo.</p>
        </InvitationLetter>
      </div>
      <div className="mt-8">
        <Link href={accepted.next} className={primaryButton}>
          Ir a mis grupos
        </Link>
      </div>
    </>
  );
}
