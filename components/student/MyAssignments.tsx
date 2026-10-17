"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useVoiceCommands } from "@/components/student/voice/VoiceCommands";
import { Loading } from "@/components/ui/States";
import { typeTag } from "@/components/ui/styles";
import { FORWARD } from "@/components/ui/transitions";
import { assignedTo, versionOf } from "@/lib/groups/grades";
import { useData } from "@/lib/groups/store";
import type { Assessment } from "@/lib/groups/types";
import { TYPE_LABEL } from "@/lib/groups/versions";
import { isAnswered, stepsOf } from "@/lib/solve/steps";
import { topicPhrases, type VoiceCommand } from "@/lib/voice/commands";

// Where the student is with an assessment: not started, how many they answered, or submitted.
export function progress(assessment: Assessment, studentId: string): { text: string; className: string } {
  const submission = assessment.submissions?.[studentId];
  if (assessment.grades?.[studentId]) return { text: "✓ Corregido", className: "text-emerald-800" };
  if (submission?.submittedAt) return { text: "✓ Entregado", className: "text-emerald-800" };
  const version = versionOf(assessment, studentId);
  const steps = version ? stepsOf(version, assessment.original) : [];
  const answered = steps.filter((s) => isAnswered(s, submission)).length;
  if (answered === 0) return { text: "Sin empezar", className: "text-amber-900" };
  return { text: `En curso: ${answered} de ${steps.length}`, className: "text-indigo-800" };
}

// Only lists what the teacher already approved. Shows no profiles or version labels:
// the student doesn't need to know their assessment is adapted.
export function MyAssignments({ studentId, groupId }: { studentId: string; groupId: string }) {
  const data = useData();
  const router = useRouter();
  const assigned = data ? assignedTo(data, studentId, groupId) : [];

  // For students who navigate by voice: open each assessment by its topic, or the first one still open.
  const pending = assigned.find((a) => !a.grades?.[studentId] && !a.submissions?.[studentId]?.submittedAt);
  const open = (a: Assessment) => () => router.push(`/estudiante/${a.id}`);
  const commands: VoiceCommand[] = assigned.map((a) => ({
    id: `open-${a.id}`,
    label: `Abrir ${TYPE_LABEL[a.type].toLowerCase()}: ${a.topic}`,
    phrases: [...topicPhrases(a.topic), `${TYPE_LABEL[a.type]} de ${a.topic}`],
    run: open(a),
  }));
  if (pending) {
    commands.push({
      id: "open-pending",
      label: "El primero sin entregar",
      phrases: ["el primero sin entregar", "sin entregar", "el que me falta", "lo que tengo que hacer"],
      run: open(pending),
    });
  }
  useVoiceCommands(commands);

  if (!data) return <Loading />;

  if (assigned.length === 0) {
    return (
      <p className="rounded-2xl border-2 border-dashed border-slate-400 px-6 py-8 text-lg text-slate-700">
        Todavía no tenés prácticos ni parciales. Cuando tu profesor publique uno, aparece acá.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {assigned.map((a) => {
        const status = progress(a, studentId);
        return (
          <li key={a.id}>
            <Link
              href={`/estudiante/${a.id}`}
              transitionTypes={FORWARD}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border-2 border-slate-200 bg-white px-4 py-4 transition-colors hover:border-slate-800 sm:px-6"
            >
              <span className={typeTag}>{TYPE_LABEL[a.type]}</span>
              <span className="text-lg font-semibold underline-offset-4">{a.topic}</span>
              <span className="text-base text-slate-700">
                {new Date(a.createdAt).toLocaleDateString("es-UY", { day: "numeric", month: "long" })}
              </span>
              <span className={`ml-auto text-lg font-semibold ${status.className}`}>{status.text} →</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
