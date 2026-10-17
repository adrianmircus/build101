"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type KeyboardEvent } from "react";
import { AssessmentList } from "@/components/assessments/AssessmentList";
import { Breadcrumbs, Loading, NotFound } from "@/components/ui/States";
import { primaryButton } from "@/components/ui/styles";
import { useData } from "@/lib/groups/store";
import { groupByProfiles } from "@/lib/groups/versions";
import { ProfileSummary } from "./ProfileSummary";
import { Students } from "./Students";

const TABS = [
  { id: "students", text: "Estudiantes" },
  { id: "assessments", text: "Prácticos y parciales" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export function GroupDetail() {
  const { groupId } = useParams<{ groupId: string }>();
  const data = useData();
  const [tab, setTab] = useState<Tab>("students");

  if (!data) return <Loading />;
  const group = data.groups.find((g) => g.id === groupId);
  if (!group) return <NotFound what="ese grupo" />;

  const assessments = data.assessments.filter((a) => a.groupId === group.id);
  const versions = groupByProfiles(group.students).length;

  // WAI-ARIA tabs pattern: left/right arrows move between tabs.
  const withArrows = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const current = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(current + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length];
    setTab(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  return (
    <>
      <Breadcrumbs items={[{ text: "Mis grupos", href: "/groups" }, { text: group.name }]} />
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="space-y-3">
          <h1 className="text-4xl font-bold">{group.name}</h1>
          <p className="text-xl text-slate-700">
            {group.students.length} estudiantes · cada práctico sale en {versions}{" "}
            {versions === 1 ? "versión" : "versiones"}
          </p>
          <ProfileSummary students={group.students} />
        </div>
        <Link href={`/groups/${group.id}/assessments/new`} className={primaryButton}>
          Nuevo práctico o parcial
        </Link>
      </div>

      <div role="tablist" aria-label="Secciones del grupo" className="mt-10 flex gap-2 border-b-2 border-slate-200">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`panel-${t.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={withArrows}
              className={`-mb-0.5 border-b-4 px-4 py-3 text-lg font-semibold ${
                active ? "border-indigo-700 text-indigo-900" : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.text}
              {t.id === "assessments" && assessments.length > 0 && ` (${assessments.length})`}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-6">
        {tab === "students" ? (
          <Students group={group} />
        ) : (
          <AssessmentList groupId={group.id} assessments={assessments} />
        )}
      </div>
    </>
  );
}
