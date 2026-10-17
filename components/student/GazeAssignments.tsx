"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GazeTargets } from "@/components/student/gaze/GazeChoice";
import { useGazeZone } from "@/components/student/gaze/GazeSession";
import { Loading } from "@/components/ui/States";
import { FORWARD } from "@/components/ui/transitions";
import type { AssessmentType } from "@/lib/contract";
import { assignedTo } from "@/lib/groups/grades";
import { useData } from "@/lib/groups/store";
import { MyAssignments, progress } from "./MyAssignments";

// The student's list: the usual one, or the two-option one for students who answer with eye gaze.
export function Assignments({ studentId, groupId }: { studentId: string; groupId: string }) {
  return useGazeZone() ? (
    <GazeAssignments studentId={studentId} groupId={groupId} />
  ) : (
    <MyAssignments studentId={studentId} groupId={groupId} />
  );
}

const PLURAL: Record<AssessmentType, string> = { worksheet: "Prácticos", exam: "Parciales" };
const TYPES: AssessmentType[] = ["worksheet", "exam"]; // left, right

// Every choice is between two halves of the screen. First the type (prácticos or parciales), then one assessment
// at a time: open it, or see the next one. On the last one, the right half goes back.
function GazeAssignments({ studentId, groupId }: { studentId: string; groupId: string }) {
  const data = useData();
  const router = useRouter();
  const [type, setType] = useState<AssessmentType | null>(null);
  const [index, setIndex] = useState(0);
  if (!data) return <Loading />;

  const assigned = assignedTo(data, studentId, groupId);
  if (assigned.length === 0) {
    return (
      <p className="rounded-2xl border-2 border-dashed border-slate-400 px-6 py-8 text-xl text-slate-700">
        Todavía no tenés prácticos ni parciales. Cuando tu profesor publique uno, aparece acá.
      </p>
    );
  }

  const ofType = (t: AssessmentType) => assigned.filter((a) => a.type === t);
  const available = TYPES.filter((t) => ofType(t).length > 0);
  // With only one type there's nothing to choose: straight to the list.
  const current = available.length === 1 ? available[0] : type;

  if (!current) {
    const typeTarget = (t: AssessmentType) => ({
      key: t,
      spoken: `${PLURAL[t]}: ${ofType(t).length}`,
      content: (
        <>
          <span className="text-4xl font-bold">{PLURAL[t]}</span>
          <span className="text-2xl text-slate-700">{ofType(t).length}</span>
        </>
      ),
    });
    return (
      <GazeTargets
        label="Qué querés ver"
        items={[typeTarget("worksheet"), typeTarget("exam")]}
        onSelect={(i) => {
          setType(i === 0 ? "worksheet" : "exam");
          setIndex(0);
        }}
      />
    );
  }

  const list = ofType(current);
  const i = Math.min(index, list.length - 1);
  const assessment = list[i];
  const status = progress(assessment, studentId);
  const last = i === list.length - 1;
  const back = available.length > 1 ? "Volver" : "Volver al primero";

  return (
    <div>
      <p className="mb-4 text-xl font-semibold text-slate-700">
        {PLURAL[current]}: {i + 1} de {list.length}
      </p>
      <GazeTargets
        label={PLURAL[current]}
        items={[
          {
            key: `open-${assessment.id}`,
            spoken: `Abrir ${assessment.topic}. ${status.text}`,
            content: (
              <>
                <span className="text-2xl font-semibold">Abrir</span>
                <span className="text-4xl font-bold">{assessment.topic}</span>
                <span className={`text-xl font-semibold ${status.className}`}>{status.text}</span>
              </>
            ),
            tone: "yes",
          },
          {
            key: last ? "back" : "next",
            spoken: last ? back : "Ver otro",
            content: <span className="text-4xl font-bold">{last ? `← ${back}` : "Ver otro →"}</span>,
            tone: "no",
          },
        ]}
        onSelect={(choice) => {
          if (choice === 0) router.push(`/estudiante/${assessment.id}`, { transitionTypes: FORWARD });
          else if (!last) setIndex(i + 1);
          else if (available.length > 1) setType(null);
          else setIndex(0);
        }}
      />
    </div>
  );
}
