import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FlowTop } from "@/components/institution/FlowTop";
import { InvitationList } from "@/components/institution/InvitationList";
import { LoadError } from "@/components/institution/LoadError";
import { NoAccess } from "@/components/institution/NoAccess";
import { StaffList } from "@/components/institution/StaffList";
import { Loading } from "@/components/ui/States";
import { primaryButton } from "@/components/ui/styles";
import { getInstitutionSummary, listInvitations, listStaff } from "@/lib/server/services/institution";
import { adminOrNull, load } from "../../access";
import { resendInvitationAction, revokeInvitationAction } from "../actions";

export const metadata: Metadata = { title: "Profes e invitaciones", robots: { index: false } };

type Props = { params: Promise<{ institutionId: string }> };

export default function StaffPage({ params }: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: Props) {
  const { institutionId } = await params;
  const admin = await adminOrNull(institutionId);
  if (!admin) return <NoAccess />;
  const data = await load(() => Promise.all([getInstitutionSummary(institutionId), listStaff(institutionId), listInvitations(institutionId)]));
  if (!data.ok) return <LoadError backHref={`/institucion/${institutionId}`} backLabel="Volver al inicio del panel" />;
  const [summary, staff, invitations] = data.data;
  return (
    <div className="space-y-10">
      <FlowTop
        title="Profes e invitaciones"
        lead="Quiénes están en el colegio y quiénes todavía no respondieron. Solo vos y los otros admins ven esta página."
        back={{ label: summary.name, href: `/institucion/${institutionId}` }}
      />
      <Link href={`/institucion/${institutionId}/invitar`} className={primaryButton}>
        Invitar profes
      </Link>
      <InvitationList institutionId={institutionId} items={invitations} actions={{ resend: resendInvitationAction, revoke: revokeInvitationAction }} />
      <StaffList rows={staff} youId={admin.userId} />
    </div>
  );
}
