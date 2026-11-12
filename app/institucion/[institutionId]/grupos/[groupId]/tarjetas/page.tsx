import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { AccessCardsScreen } from "@/components/access-cards/AccessCardsScreen";
import { Loading } from "@/components/ui/States";
import { Id } from "@/lib/domain/common";
import { AppError } from "@/lib/errors";
import { listGroupAccounts } from "@/lib/server/services/student-accounts";
import { issueAccessCardsAction } from "./actions";

// The list of the group is read on the server, with the session of whoever asks (list_group_accounts). The passwords
// do not come from here: they come back from issueAccessCardsAction and live only in the browser, in the print sheet.
export const metadata: Metadata = { title: "Tarjetas de acceso", robots: { index: false } };

type Props = { params: Promise<{ institutionId: string; groupId: string }> };
type Group = Awaited<ReturnType<typeof listGroupAccounts>> & { canIssueCards?: boolean };

export default function CardsPage({ params }: Props) {
  return (
    // The <main> is the one of app/institucion/layout.tsx: two of them nested would be an invalid structure.
    <div className="mx-auto w-full max-w-6xl print:m-0 print:max-w-none print:p-0">
      <Suspense fallback={<Loading />}>
        <Content params={params} />
      </Suspense>
    </div>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className="max-w-2xl space-y-3 rounded-2xl bg-slate-100 p-6 text-lg" role="status">
      <h1 className="text-2xl font-bold">No pudimos abrir las tarjetas</h1>
      <p>{message}</p>
      <p className="text-slate-700">No se creó ninguna contraseña. Recargá la página para probar de nuevo.</p>
    </div>
  );
}

/** The group, or the neutral text to show when it cannot be read. No access or no group is a 404, as for any page. */
async function load(groupId: string): Promise<{ group: Group } | { message: string }> {
  try {
    return { group: await listGroupAccounts(groupId) };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    return { message: error instanceof AppError ? error.message : "Algo falló de nuestro lado." };
  }
}

async function Content({ params }: Props) {
  const { institutionId, groupId } = await params;
  if (!Id.safeParse(institutionId).success || !Id.safeParse(groupId).success) notFound();
  const loaded = await load(groupId);
  if ("message" in loaded) return <Unavailable message={loaded.message} />;
  const { group } = loaded;
  return (
    <AccessCardsScreen
      institutionId={institutionId}
      groupId={groupId}
      groupName={group.groupName}
      institutionCode={group.institutionCode}
      accounts={group.items}
      // canIssueCards comes from the RPC; until the service type carries it, no answer means «no» (the safe side).
      canIssueCards={group.canIssueCards === true}
      issue={issueAccessCardsAction}
    />
  );
}
