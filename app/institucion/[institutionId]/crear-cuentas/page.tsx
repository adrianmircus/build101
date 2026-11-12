import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { CreateFlow } from "@/components/institution/CreateFlow";
import { LoadError } from "@/components/institution/LoadError";
import { NoAccess } from "@/components/institution/NoAccess";
import { Loading } from "@/components/ui/States";
import { getInstitutionSummary, listGroups, listSubjects } from "@/lib/server/services/institution";
import { adminOrNull, load } from "../../access";
import { createGroupAction, createStudentAccountsAction, previewUsernamesAction } from "../actions";

export const metadata: Metadata = { title: "Crear cuentas de estudiantes", robots: { index: false } };

type Props = { params: Promise<{ institutionId: string }> };

export default function CreateAccountsPage({ params }: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: Props) {
  const { institutionId } = await params;
  if (!(await adminOrNull(institutionId))) return <NoAccess />;
  const data = await load(() => Promise.all([getInstitutionSummary(institutionId), listGroups(institutionId), listSubjects()]));
  if (!data.ok) return <LoadError backHref={`/institucion/${institutionId}`} backLabel="Volver al inicio del panel" />;
  const [summary, groups, subjects] = data.data;
  // The year to suggest depends on the day: it is read at request time, never frozen in the prerender.
  await connection();
  return (
    <CreateFlow
      institutionId={institutionId}
      institutionName={summary.name}
      institutionCode={summary.code}
      groups={groups}
      subjects={subjects}
      year={new Date().getFullYear()}
      actions={{ preview: previewUsernamesAction, createGroup: createGroupAction, create: createStudentAccountsAction }}
    />
  );
}
