"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { addTransitionType, startTransition, useState, ViewTransition, type KeyboardEvent } from "react";
import { AssessmentList } from "@/components/assessments/AssessmentList";
import { ResultsTab } from "@/components/results/ResultsTab";
import { Breadcrumbs, Loading, NotFound } from "@/components/ui/States";
import { primaryButton } from "@/components/ui/styles";
import { FORWARD, TAB_SLIDE } from "@/components/ui/transitions";
import { useData } from "@/lib/groups/store";
import { groupByProfiles } from "@/lib/groups/versions";
import { ProfileSummary } from "./ProfileSummary";
import { Students } from "./Students";

const TABS = [
  { id: "students", text: "Estudiantes" },
  { id: "assessments", text: "Prácticos y parciales" },
  { id: "results", text: "Resultados" },
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

  // Inside a transition so <ViewTransition> animates the change, toward the side of the chosen tab.
  const select = (next: Tab) => {
    if (next === tab) return;
    const forward = TABS.findIndex((t) => t.id === next) > TABS.findIndex((t) => t.id === tab);
    startTransition(() => {
      addTransitionType(forward ? "tab-forward" : "tab-back");
      setTab(next);
    });
  };

  // WAI-ARIA tabs pattern: left/right arrows move between tabs.
  const withArrows = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const current = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(current + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length];
    select(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  return (
    <>
      <Breadcrumbs items={[{ text: "Mis grupos", href: "/grupos" }, { text: group.name }]} />
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight">{group.name}</h1>
          <p className="text-xl text-slate-700">
            {group.students.length} estudiantes · cada práctico sale en {versions}{" "}
            {versions === 1 ? "versión" : "versiones"}
          </p>
          <ProfileSummary students={group.students} />
        </div>
        <Link href={`/grupos/${group.id}/evaluaciones/nueva`} transitionTypes={FORWARD} className={primaryButton}>
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
              onClick={() => select(t.id)}
              onKeyDown={withArrows}
              className={`relative -mb-0.5 min-h-11 flex-1 px-4 py-3 text-lg font-semibold transition-colors sm:flex-none ${
                active ? "text-indigo-950" : "text-slate-700 hover:bg-slate-100 hover:text-slate-950"
              }`}
            >
              {/* A single underline that glides from the old tab to the new one. */}
              {active && (
                <ViewTransition name="group-tab-indicator" share="tab-indicator" default="none">
                  <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 rounded-full bg-indigo-700" />
                </ViewTransition>
              )}
              {t.text}
              {t.id === "assessments" && assessments.length > 0 && ` (${assessments.length})`}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-6">
        <ViewTransition key={tab} enter={TAB_SLIDE} exit={TAB_SLIDE} default="none">
          <div>
            {tab === "students" ? (
              <Students group={group} />
            ) : tab === "assessments" ? (
              <AssessmentList groupId={group.id} assessments={assessments} />
            ) : (
              <ResultsTab group={group} data={data} />
            )}
          </div>
        </ViewTransition>
      </div>
    </>
  );
}
