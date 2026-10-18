"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GazeChoice, GazeTargets, GazeYesNo } from "@/components/student/gaze/GazeChoice";
import { useGazeZone } from "@/components/student/gaze/GazeSession";
import { useVoiceCommands } from "@/components/student/voice/VoiceCommands";
import { MathText } from "@/components/ui/MathText";
import { Loading } from "@/components/ui/States";
import { approveButton, primaryButton, secondaryButton, textLink, typeTag } from "@/components/ui/styles";
import { BACK } from "@/components/ui/transitions";
import { versionOf } from "@/lib/groups/grades";
import { saveAnswer, saveChoice, submitAssessment, useData } from "@/lib/groups/store";
import type { Submission } from "@/lib/groups/types";
import { TYPE_LABEL } from "@/lib/groups/versions";
import { isAnswered, stepsOf, type Step } from "@/lib/solve/steps";
import { speechText } from "@/lib/speech/latexSpeech";
import { speak } from "@/lib/speech/useDictation";
import type { VoiceCommand } from "@/lib/voice/commands";
import { DictationAnswer } from "./DictationAnswer";
import { AudioHelps, ListenButton } from "./Listen";
import { TypedAnswer } from "./TypedAnswer";

// The student solves their version on the platform, one exercise per screen. Everything saves on each change;
// submitting is the only step that can't be undone, so it asks for confirmation.
// Like MyAssignments, it never shows profiles or version labels.
export function SolveAssessment({ studentId, groupId }: { studentId: string; groupId: string }) {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const data = useData();
  const [current, setCurrent] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  // Bumped on each move between exercises: then focus goes to the new heading (not on the first render).
  const [moved, setMoved] = useState(0);

  useEffect(() => {
    if (moved === 0) return;
    const heading = document.getElementById(reviewing ? "review-heading" : "step-heading");
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "nearest" });
  }, [moved, reviewing]);

  if (!data) return <Loading />;
  const assessment = data.assessments.find((a) => a.id === assessmentId && a.groupId === groupId);
  const version = assessment && versionOf(assessment, studentId);
  if (!assessment || !version) {
    return (
      <div className="max-w-2xl space-y-4 py-8">
        <h1 className="text-4xl font-bold">No encontramos ese práctico</h1>
        <p className="text-xl text-slate-700">Puede que tu profesor todavía no lo haya publicado.</p>
        <BackLink />
      </div>
    );
  }

  const steps = stepsOf(version, assessment.original);
  const submission = assessment.submissions?.[studentId];
  // Once submitted or graded (the sample exam was corrected on paper) it's read-only.
  const graded = Boolean(assessment.grades?.[studentId]);
  const closed = graded || Boolean(submission?.submittedAt);
  const title = `${TYPE_LABEL[assessment.type]}: ${assessment.topic}`;
  const answered = steps.filter((s) => isAnswered(s, submission)).length;
  const missing = steps.filter((s) => !isAnswered(s, submission));
  const index = Math.min(current, steps.length - 1);
  const step = steps[index];

  // Students who answer with eye gaze can't press buttons: choosing moves on by itself, and submitting asks with gaze.
  const gaze = steps[0]?.kind === "choice";
  const firstMissing = missing.length > 0 ? steps.indexOf(missing[0]) : 0;

  // Students who answer with eye gaze don't use the keyboard and their screen is laid out for the gaze: focus stays put.
  const move = () => {
    if (!gaze) setMoved((m) => m + 1);
  };
  const go = (i: number) => {
    setReviewing(false);
    setCurrent(i);
    move();
  };
  const review = () => {
    setReviewing(true);
    move();
  };
  const next = () => (index < steps.length - 1 ? go(index + 1) : review());
  const submit = () => submitAssessment(assessment.id, studentId);

  const solving = (
    <>
      {/* Students who navigate by voice: the buttons of this screen, said aloud. Nothing with eye gaze. */}
      {!gaze && (
        <SolveVoiceCommands
          steps={steps}
          index={index}
          reviewing={reviewing}
          go={go}
          review={review}
          back={() => go(missing.length > 0 ? firstMissing : index)}
          submit={submit}
        />
      )}
      <nav aria-label="Ejercicios" className="space-y-3">
        <p className="text-lg text-slate-700">
          Respondiste {answered} de {steps.length}. Se guarda solo: podés salir y seguir después.
        </p>
        {/* With eye gaze there are no buttons to press: choosing moves on by itself. */}
        {!gaze && (
          <ol className="flex flex-wrap gap-2">
            {steps.map((s, i) => {
              const done = isAnswered(s, submission);
              const active = i === index && !reviewing;
              return (
                <li key={`${s.kind}-${s.index}`}>
                  <button
                    type="button"
                    aria-current={active ? "step" : undefined}
                    aria-label={`${s.label}${done ? ", respondido" : ""}`}
                    onClick={() => go(i)}
                    className={`min-h-11 min-w-11 rounded-lg border-2 px-3 text-lg font-bold transition-colors ${
                      active
                        ? "border-indigo-700 bg-indigo-700 text-white"
                        : done
                          ? "border-emerald-700 bg-emerald-50 text-emerald-900"
                          : "border-slate-400 bg-white text-slate-900 hover:border-slate-800"
                    }`}
                  >
                    {done && !active ? "✓" : i + 1}
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                aria-current={reviewing ? "step" : undefined}
                onClick={review}
                className={`${reviewing ? primaryButton : secondaryButton} min-h-11 py-1`}
              >
                Entregar
              </button>
            </li>
          </ol>
        )}
      </nav>

      {reviewing ? (
        <section aria-labelledby="review-heading" className="rounded-2xl border-2 border-amber-600 bg-amber-50 p-4 sm:p-6">
          <h2 id="review-heading" tabIndex={-1} className="scroll-mt-24 text-2xl font-bold text-amber-950 outline-offset-4">
            ¿Entregás el {TYPE_LABEL[assessment.type].toLowerCase()}?
          </h2>
          {missing.length > 0 ? (
            <p className="mt-2 text-lg">
              Te {missing.length === 1 ? "falta" : "faltan"}: {missing.map((s) => s.label).join(", ")}. Podés
              volver a responder{missing.length === 1 ? "lo" : "los"} antes de entregar.
            </p>
          ) : (
            <p className="mt-2 text-lg">Respondiste todos los ejercicios.</p>
          )}
          <p className="mt-2 text-lg font-semibold">Después de entregar ya no vas a poder cambiar tus respuestas.</p>
          {gaze ? (
            <div className="mt-5">
              <GazeYesNo
                prompt={`¿Entregás el ${TYPE_LABEL[assessment.type].toLowerCase()}?`}
                yes="Entregar"
                no="Revisar"
                onYes={submit}
                onNo={() => go(firstMissing)}
              />
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" className={approveButton} onClick={submit}>
                ✓ Sí, entregar
              </button>
              <button type="button" className={secondaryButton} onClick={() => go(missing.length > 0 ? firstMissing : index)}>
                {missing.length > 0 ? `Ir al ${missing[0].label.toLowerCase()}` : "Volver"}
              </button>
            </div>
          )}
        </section>
      ) : step ? (
        <section
          key={`${step.kind}-${step.index}`}
          aria-labelledby="step-heading"
          className="rounded-2xl border-2 border-slate-200 bg-white p-4 sm:p-6"
        >
          <p className="text-base font-semibold text-slate-700">
            {index + 1} de {steps.length}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="step-heading" tabIndex={-1} className="scroll-mt-24 text-2xl font-bold outline-offset-4">
              {step.label}
            </h2>
            {/* Students who answer with eye gaze can't click: the button is for everyone else. */}
            {!gaze && <ListenButton text={step.text} />}
          </div>
          <MathText text={step.text} className="mt-3 mb-6 text-2xl leading-relaxed" />
          {/* Reduced reasoning: the statement and each support can be listened to on their own. */}
          {!gaze && (version.supports ?? []).length > 0 && <AudioHelps text={step.text} />}
          <StepAnswer
            step={step}
            submission={submission}
            assessmentId={assessment.id}
            studentId={studentId}
            onChosen={next}
          />
          {!gaze && (
            <div className="mt-8 flex flex-wrap gap-3">
              {index > 0 && (
                <button type="button" className={secondaryButton} onClick={() => go(index - 1)}>
                  ← Anterior
                </button>
              )}
              <span className="flex-1" />
              {index < steps.length - 1 ? (
                <button type="button" className={primaryButton} onClick={() => go(index + 1)}>
                  Siguiente →
                </button>
              ) : (
                <button type="button" className={primaryButton} onClick={review}>
                  Revisar y entregar
                </button>
              )}
            </div>
          )}
        </section>
      ) : (
        <p className="text-lg text-slate-700">Este práctico no tiene ejercicios para responder.</p>
      )}
    </>
  );

  return (
    <div className="space-y-6">
      <BackLink />
      <div>
        <span className={typeTag}>{TYPE_LABEL[assessment.type]}</span>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">{assessment.topic}</h1>
      </div>

      {closed ? (
        <Submitted steps={steps} submission={submission} title={title} graded={graded} />
      ) : (
        solving
      )}
    </div>
  );
}

// Renders nothing: it only registers the commands (a hook can't go after SolveAssessment's early returns).
function SolveVoiceCommands({
  steps,
  index,
  reviewing,
  go,
  review,
  back,
  submit,
}: {
  steps: Step[];
  index: number;
  reviewing: boolean;
  go: (i: number) => void;
  review: () => void;
  back: () => void;
  submit: () => void;
}) {
  const step = steps[index];
  // Going back to the list is a global command ("inicio", "volver a mis prácticos").
  const commands: VoiceCommand[] = steps.map((s, i) => ({ id: `step-${i}`, label: s.label, phrases: [s.label], run: () => go(i) }));
  if (reviewing) {
    // Submitting by voice is the student's confirmation, like the "Sí, entregar" button: only while reviewing.
    commands.push(
      { id: "submit-yes", label: "Sí, entregar", phrases: ["si entregar", "si entrego", "confirmo", "si quiero entregar"], run: submit },
      { id: "submit-no", label: "Revisar", phrases: ["revisar", "volver", "no entregar", "todavia no"], run: back },
    );
  } else {
    if (index < steps.length - 1) commands.push({ id: "next", label: "Siguiente", phrases: ["siguiente", "proximo", "que sigue", "adelante"], run: () => go(index + 1) });
    if (index > 0) commands.push({ id: "previous", label: "Anterior", phrases: ["anterior", "atras", "el de antes"], run: () => go(index - 1) });
    if (step) commands.push({ id: "read", label: "Leer el ejercicio", phrases: ["leer el ejercicio", "leer", "leeme el ejercicio", "que dice"], run: () => speak(speechText(step.text)) });
    commands.push({ id: "review", label: "Entregar", phrases: ["entregar", "revisar y entregar", "terminar el practico"], run: review });
  }
  useVoiceCommands(commands);
  return null;
}

function StepAnswer({
  step,
  submission,
  assessmentId,
  studentId,
  onChosen,
}: {
  step: Step;
  submission: Submission | undefined;
  assessmentId: string;
  studentId: string;
  onChosen: () => void;
}) {
  const id = `answer-${step.index}`;
  if (step.kind === "choice") {
    return (
      // It calls onChoose once the student confirms with gaze (or a click): then it moves to the next step.
      <GazeChoice
        question={step.question}
        value={submission?.choices?.[step.index] ?? null}
        onChoose={(choice) => {
          saveChoice(assessmentId, studentId, step.index, choice);
          onChosen();
        }}
      />
    );
  }
  const saved = submission?.answers[step.index] ?? null;
  if (step.kind === "voice") {
    return (
      <DictationAnswer
        id={id}
        exercise={step.text}
        saved={saved}
        onSave={(answer) => saveAnswer(assessmentId, studentId, step.index, answer)}
      />
    );
  }
  return (
    <TypedAnswer
      id={id}
      value={saved?.text ?? ""}
      onChange={(text) => saveAnswer(assessmentId, studentId, step.index, text ? { text, mode: "typed" } : null)}
    />
  );
}

// After submitting: the answers as they were sent, read-only.
function Submitted({
  steps,
  submission,
  title,
  graded,
}: {
  steps: Step[];
  submission?: Submission;
  title: string;
  graded: boolean;
}) {
  const router = useRouter();
  const gaze = useGazeZone() !== null;
  const [showAnswers, setShowAnswers] = useState(!gaze);
  const date = submission?.submittedAt
    ? new Date(submission.submittedAt).toLocaleDateString("es-UY", { day: "numeric", month: "long" })
    : "";
  return (
    <>
      <p role="status" className="rounded-2xl border-2 border-emerald-700 bg-emerald-50 px-5 py-4 text-xl font-semibold text-emerald-900">
        {graded
          ? "✓ Tu profesor ya lo corrigió: la nota está en tu inicio."
          : `✓ Entregaste el ${date}. Cuando tu profesor lo corrija, la nota aparece en tu inicio.`}
      </p>
      {gaze && (
        // Students who answer with eye gaze leave with their eyes too: two halves, like every other choice.
        <GazeTargets
          label="Qué hacés ahora"
          items={[
            {
              key: "back",
              spoken: "Volver a tus prácticos",
              content: <span className="text-4xl font-bold">← Volver a tus prácticos</span>,
              tone: "yes",
            },
            {
              key: "answers",
              spoken: showAnswers ? "Ocultar tus respuestas" : "Ver tus respuestas",
              content: <span className="text-4xl font-bold">{showAnswers ? "Ocultar tus respuestas" : "Ver tus respuestas"}</span>,
              tone: "no",
            },
          ]}
          onSelect={(i) => (i === 0 ? router.push("/estudiante", { transitionTypes: BACK }) : setShowAnswers((v) => !v))}
        />
      )}
      {showAnswers && (
        <section aria-labelledby="answers-heading">
          <h2 id="answers-heading" className="mb-4 text-2xl font-bold">
            Tus respuestas
          </h2>
          <ol className="space-y-4" aria-label={title}>
            {steps.map((s) => (
              <li key={`${s.kind}-${s.index}`} className="rounded-2xl border-2 border-slate-200 bg-white p-4 sm:p-5">
                <p className="text-lg font-bold">{s.label}</p>
                <MathText text={s.text} className="mt-1 text-lg text-slate-700" />
                <p className="mt-3 whitespace-pre-wrap text-xl leading-relaxed">
                  {s.kind === "choice" ? (
                    // The options come from the agent, with LaTeX; what the student typed or dictated stays as is.
                    <MathText inline text={answerText(s, submission) ?? "Sin responder"} />
                  ) : (
                    (answerText(s, submission) ?? "Sin responder")
                  )}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

function answerText(step: Step, submission?: Submission): string | null {
  if (step.kind === "choice") {
    const choice = submission?.choices?.[step.index];
    const option = step.question.options.find((o) => o.id === choice);
    return option ? `${option.id}) ${option.text}` : null;
  }
  return submission?.answers[step.index]?.text || null;
}

function BackLink() {
  return (
    <Link href="/estudiante" transitionTypes={BACK} className={`${textLink} text-lg font-semibold`}>
      ← Tus prácticos
    </Link>
  );
}
