import type { Metadata } from "next";
import { Suspense } from "react";
import { InviteFlow } from "@/components/institution/InviteFlow";
import { LoadError } from "@/components/institution/LoadError";
import { NoAccess } from "@/components/institution/NoAccess";
import { Loading } from "@/components/ui/States";
import { getInstitutionSummary, listInvitations, listStaff } from "@/lib/server/services/institution";
import { adminOrNull, load } from "../../access";
import { inviteStaffAction } from "../actions";

export const metadata: Metadata = { title: "Invitar profes", robots: { index: false } };

type Props = { params: Promise<{ institutionId: string }> };

export default function InvitePage({ params }: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Content params={params} />
    </Suspense>
  );
}

// The lists are read so the review can say «ya está en el colegio» or «ya tiene una invitación» before sending.
async function Content({ params }: Props) {
  const { institutionId } = await params;
  if (!(await adminOrNull(institutionId))) return <NoAccess />;
  const data = await load(() => Promise.all([getInstitutionSummary(institutionId), listStaff(institutionId), listInvitations(institutionId)]));
  if (!data.ok) return <LoadError backHref={`/institucion/${institutionId}`} backLabel="Volver al inicio del panel" />;
  const [summary, members, invitations] = data.data;
  return <InviteFlow institutionId={institutionId} institutionName={summary.name} members={members} invitations={invitations} invite={inviteStaffAction} />;
}
