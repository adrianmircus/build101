import type { Metadata } from "next";
import { Suspense } from "react";
import { HomeActions } from "@/components/institution/HomeActions";
import { LoadError } from "@/components/institution/LoadError";
import { NoAccess } from "@/components/institution/NoAccess";
import { SummaryBlock } from "@/components/institution/SummaryBlock";
import { Loading } from "@/components/ui/States";
import { getInstitutionSummary } from "@/lib/server/services/institution";
import { adminOrNull, load } from "../access";

export const metadata: Metadata = { title: "Institución", robots: { index: false } };

type Props = { params: Promise<{ institutionId: string }> };

// The start of the panel: first the two things to do, then how the school looks. params is a Promise and dynamic data,
// so everything is read inside the Suspense.
export default function InstitutionHome({ params }: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: Props) {
  const { institutionId } = await params;
  if (!(await adminOrNull(institutionId))) return <NoAccess />;
  const summary = await load(() => getInstitutionSummary(institutionId));
  if (!summary.ok) return <LoadError />;
  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold sm:text-4xl">{summary.data.name}</h1>
        <p className="text-lg text-slate-700">¿Qué querés hacer?</p>
      </header>
      <HomeActions institutionId={institutionId} />
      <SummaryBlock summary={summary.data} />
    </div>
  );
}
