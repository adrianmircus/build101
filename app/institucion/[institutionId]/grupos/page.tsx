import type { Metadata } from "next";
import { Suspense } from "react";
import { FlowTop } from "@/components/institution/FlowTop";
import { GroupList } from "@/components/institution/GroupList";
import { LoadError } from "@/components/institution/LoadError";
import { NoAccess } from "@/components/institution/NoAccess";
import { Loading } from "@/components/ui/States";
import { getInstitutionSummary, listGroups } from "@/lib/server/services/institution";
import { adminOrNull, load } from "../../access";

export const metadata: Metadata = { title: "Grupos del colegio", robots: { index: false } };

type Props = { params: Promise<{ institutionId: string }> };

export default function GroupsPage({ params }: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: Props) {
  const { institutionId } = await params;
  if (!(await adminOrNull(institutionId))) return <NoAccess />;
  const data = await load(() => Promise.all([getInstitutionSummary(institutionId), listGroups(institutionId)]));
  if (!data.ok) return <LoadError backHref={`/institucion/${institutionId}`} backLabel="Volver al inicio del panel" />;
  const [summary, groups] = data.data;
  return (
    <div className="space-y-8">
      <FlowTop title="Grupos del colegio" lead="Desde acá imprimís las tarjetas de acceso de cada grupo." back={{ label: summary.name, href: `/institucion/${institutionId}` }} />
      <GroupList institutionId={institutionId} groups={groups} />
    </div>
  );
}
