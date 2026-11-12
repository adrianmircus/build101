import type { InvitationView } from "@/lib/domain/accounts/entities";
import { InvitationRow } from "./InvitationRow";
import { waitingInvitations } from "./listText";
import { WAITING_TITLE, type InvitationActions } from "./useInvitationRow";

type Props = { institutionId: string; items: InvitationView[]; actions: InvitationActions };

// Invitations waiting for an answer. Each one can be sent again or revoked; the closed ones (accepted, revoked) are not here.
export function InvitationList({ institutionId, items, actions }: Props) {
  const waiting = waitingInvitations(items);
  return (
    <section aria-labelledby={WAITING_TITLE} className="space-y-3">
      <h2 id={WAITING_TITLE} tabIndex={-1} className="text-2xl font-bold outline-none">
        Esperando respuesta
      </h2>
      {waiting.length === 0 ? (
        <p className="text-lg text-slate-700">No hay invitaciones esperando respuesta.</p>
      ) : (
        <ul className="space-y-3">
          {waiting.map((item) => (
            <InvitationRow key={item.id} institutionId={institutionId} item={item} actions={actions} />
          ))}
        </ul>
      )}
    </section>
  );
}
