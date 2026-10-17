"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { FunctionGraph } from "@/components/ui/FunctionGraph";
import { Breadcrumbs, Loading, NotFound } from "@/components/ui/States";
import { field, focusWithin, secondaryButton } from "@/components/ui/styles";
import type { OptionId, Question } from "@/lib/contract";
import { GRADE_MAX, GRADE_MIN, parseScore } from "@/lib/groups/grades";
import { setExerciseCount, setExerciseResult, setGrade, useData } from "@/lib/groups/store";
import type { Answer, Assessment, ExerciseResult, ExerciseStatus, Student } from "@/lib/groups/types";
import { TYPE_LABEL } from "@/lib/groups/versions";
import { canHaveErrors, ERROR_TAGS, STATUS_CHIP, STATUSES } from "@/lib/results/catalog";
import { exercisesOf, shorten, splitExercises, type Exercise } from "@/lib/results/exercises";
import { studentsWithVersion } from "@/lib/results/metrics";

// The teacher reads what each student answered on the platform and marks each exercise. It saves on every change.
export function GradeExercises() {
  const { groupId, assessmentId } = useParams<{ groupId: string; assessmentId: string }>();
  const data = useData();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!data) return <Loading />;
  const group = data.groups.find((g) => g.id === groupId);
  const assessment = data.assessments.find((a) => a.id === assessmentId && a.groupId === groupId);
  if (!group || !assessment) return <NotFound what="ese práctico" />;

  const students = studentsWithVersion(assessment, group);
  const exercises = exercisesOf(assessment);
  const detected = splitExercises(assessment.original).length;
  const selected = students.find((s) => s.id === selectedId) ?? students[0];
  const index = selected ? students.indexOf(selected) : -1;
  const title = `${TYPE_LABEL[assessment.type]}: ${assessment.topic}`;
  const markedCount = (id: string) =>
    (assessment.exerciseResults?.[id] ?? []).slice(0, exercises.length).filter(Boolean).length;

  return (
    <>
      <Breadcrumbs
        items={[
          { text: "Mis grupos", href: "/grupos" },
          { text: group.name, href: `/grupos/${group.id}` },
          { text: title, href: `/grupos/${group.id}/evaluaciones/${assessment.id}` },
          { text: "Corregir" },
        ]}
      />
      <h1 className="text-4xl font-bold tracking-tight">Corregir por ejercicio</h1>
      <p className="mt-2 max-w-3xl text-xl text-slate-700">
        {title}. Leé lo que respondió cada estudiante y marcá cómo le fue en cada ejercicio. Se guarda solo. Los
        estudiantes ven la nota, no esta corrección.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3 text-lg">
        <span>
          {exercises.length} {exercises.length === 1 ? "ejercicio" : "ejercicios"}
          {assessment.exerciseCount === undefined && " (detectados en el original)"}
        </span>
        <button
          type="button"
          className={`${secondaryButton} px-4`}
          aria-label="Un ejercicio menos"
          disabled={exercises.length <= 1}
          onClick={() => setExerciseCount(assessment.id, exercises.length - 1)}
        >
          −
        </button>
        <button
          type="button"
          className={`${secondaryButton} px-4`}
          aria-label="Un ejercicio más"
          disabled={exercises.length >= 30}
          onClick={() => setExerciseCount(assessment.id, exercises.length + 1)}
        >
          +
        </button>
        {assessment.exerciseCount !== undefined && assessment.exerciseCount !== detected && (
          <span className="text-base text-slate-700">En el original detectamos {detected}.</span>
        )}
      </div>

      {students.length === 0 || !selected ? (
        <p className="mt-8 text-lg text-slate-700">Ningún estudiante del grupo tiene este práctico.</p>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[18rem_1fr]">
          <nav aria-label="Estudiantes" className="h-fit">
            <ul className="divide-y-2 divide-slate-100 rounded-2xl border-2 border-slate-200 bg-white">
              {students.map((s) => {
                const active = s.id === selected.id;
                const marked = markedCount(s.id);
                const grade = assessment.grades?.[s.id];
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => setSelectedId(s.id)}
                      className={`flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left text-lg transition-colors ${
                        active ? "bg-indigo-50 font-semibold text-indigo-950" : "hover:bg-slate-50"
                      }`}
                    >
                      <span>{s.name}</span>
                      <span className="shrink-0 text-base text-slate-700">
                        {marked === exercises.length ? "✓ " : ""}
                        {marked}/{exercises.length}
                        {grade && <span className="ml-2 font-bold text-slate-900">· {grade.score}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <StudentCorrection
            key={selected.id}
            assessment={assessment}
            student={selected}
            exercises={exercises}
            previous={students[index - 1]}
            next={students[index + 1]}
            onSelect={setSelectedId}
          />
        </div>
      )}
    </>
  );
}

function StudentCorrection({
  assessment,
  student,
  exercises,
  previous,
  next,
  onSelect,
}: {
  assessment: Assessment;
  student: Student;
  exercises: Exercise[];
  previous?: Student;
  next?: Student;
  onSelect: (id: string) => void;
}) {
  const grade = assessment.grades?.[student.id];
  const row = assessment.exerciseResults?.[student.id] ?? [];
  // The typed text lives here so an out-of-range value can be shown and fixed without being saved.
  const [text, setText] = useState(grade ? String(grade.score) : "");
  const invalid = text.trim() !== "" && parseScore(text) === null;
  const missing = exercises.some((_, i) => !row[i]);
  const submission = assessment.submissions?.[student.id];
  const questions = assessment.versions.find((v) => v.studentIds.includes(student.id))?.questions ?? [];

  return (
    <section aria-labelledby="student-heading" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id="student-heading" className="text-3xl font-bold tracking-tight">
          {student.name}
        </h2>
        <div>
          <label htmlFor="score" className="mb-1 block text-lg font-semibold">
            Nota ({GRADE_MIN} a {GRADE_MAX})
          </label>
          <input
            id="score"
            type="number"
            inputMode="numeric"
            min={GRADE_MIN}
            max={GRADE_MAX}
            step={1}
            className={`${field} w-28 text-center text-xl font-bold`}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? "score-error" : undefined}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value.trim() === "") return setGrade(assessment.id, student.id, null);
              const score = parseScore(e.target.value);
              if (score !== null) setGrade(assessment.id, student.id, { ...grade, score, gradedAt: new Date().toISOString() });
            }}
          />
        </div>
      </div>
      <p className="text-lg text-slate-700">
        {submission?.submittedAt
          ? `Entregó el ${new Date(submission.submittedAt).toLocaleDateString("es-UY", { day: "numeric", month: "long" })}.`
          : submission
            ? "Todavía no entregó: ves lo que lleva respondido."
            : "Todavía no respondió en la plataforma."}
      </p>
      {invalid && (
        <p id="score-error" role="alert" className="text-base font-semibold text-red-800">
          Tiene que ser un número entero del {GRADE_MIN} al {GRADE_MAX}.
        </p>
      )}

      <ol className="space-y-4">
        {exercises.map((exercise, i) => (
          <li key={i}>
            <ExerciseMark
              exercise={exercise}
              answer={submission?.answers[i] ?? null}
              choices={questions
                .map((q, qi) => ({ question: q, choice: submission?.choices?.[qi] ?? null }))
                .filter(({ question }) => question.exercise === exercise.number)}
              result={row[i] ?? null}
              onChange={(result) => setExerciseResult(assessment.id, student.id, i, result)}
            />
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        {missing && (
          <button
            type="button"
            className={secondaryButton}
            onClick={() =>
              exercises.forEach((_, i) => {
                if (!row[i]) setExerciseResult(assessment.id, student.id, i, { status: "correct", errors: [] });
              })
            }
          >
            Marcar lo que falta como ✓ Bien
          </button>
        )}
        <span className="flex-1" />
        {previous && (
          <button type="button" className={secondaryButton} onClick={() => onSelect(previous.id)}>
            ← {previous.name}
          </button>
        )}
        {next && (
          <button type="button" className={secondaryButton} onClick={() => onSelect(next.id)}>
            {next.name} →
          </button>
        )}
      </div>
    </section>
  );
}

// Native radios and checkboxes shaped like chips: keyboard (Tab, arrows, Space) and screen readers work.
function ExerciseMark({
  exercise,
  answer,
  choices,
  result,
  onChange,
}: {
  exercise: Exercise;
  answer: Answer | null;
  choices: { question: Question; choice: OptionId | null }[];
  result: ExerciseResult | null;
  onChange: (result: ExerciseResult | null) => void;
}) {
  const name = `status-${exercise.label}`;
  const setStatus = (status: ExerciseStatus) =>
    onChange({ status, errors: canHaveErrors(status) ? (result?.errors ?? []) : [] });

  return (
    <fieldset className="rounded-2xl border-2 border-slate-200 bg-white p-4 sm:p-5">
      <legend className="sr-only">
        {exercise.label}: {shorten(exercise.text, 120)}
      </legend>
      <p className="text-lg">
        <span className="font-bold">{exercise.label}</span>
        {exercise.text && <span className="text-slate-700"> · {shorten(exercise.text)}</span>}
      </p>
      <StudentAnswer answer={answer} choices={choices} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => {
          const checked = result?.status === s.id;
          return (
            <label
              key={s.id}
              className={`inline-flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-lg border-2 px-4 text-lg font-semibold transition-colors ${focusWithin} ${
                checked ? STATUS_CHIP[s.id] : "border-slate-400 bg-white text-slate-800 hover:border-slate-700"
              }`}
            >
              <input type="radio" name={name} className="sr-only" checked={checked} onChange={() => setStatus(s.id)} />
              <span aria-hidden="true">{s.symbol}</span>
              {s.label}
            </label>
          );
        })}
        {result && (
          <button
            type="button"
            className="min-h-11 rounded-lg px-3 text-base text-slate-700 underline underline-offset-4 hover:bg-slate-100"
            onClick={() => onChange(null)}
          >
            Borrar
          </button>
        )}
      </div>

      {result && canHaveErrors(result.status) && (
        <fieldset className="mt-4">
          <legend className="mb-2 text-base font-semibold text-slate-800">¿Qué tipo de error? (opcional)</legend>
          <div className="flex flex-wrap gap-2">
            {ERROR_TAGS.map((tag) => {
              const checked = result.errors.includes(tag.id);
              return (
                <label
                  key={tag.id}
                  className={`inline-flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-full border-2 px-4 text-base font-semibold transition-colors ${focusWithin} ${
                    checked ? "border-indigo-700 bg-indigo-700 text-white" : "border-slate-400 bg-white text-slate-900 hover:border-slate-700"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() =>
                      onChange({
                        ...result,
                        errors: checked ? result.errors.filter((e) => e !== tag.id) : [...result.errors, tag.id],
                      })
                    }
                  />
                  <span aria-hidden="true">{checked ? "✓" : "+"}</span>
                  {tag.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
    </fieldset>
  );
}

// What the student answered on the platform. The teacher decides whether it's right: the AI doesn't grade.
function StudentAnswer({
  answer,
  choices,
}: {
  answer: Answer | null;
  choices: { question: Question; choice: OptionId | null }[];
}) {
  if (choices.length > 0) {
    return (
      <ul className="mt-3 space-y-2">
        {choices.map(({ question, choice }, i) => {
          const option = question.options.find((o) => o.id === choice);
          const correct = choice === question.answer;
          return (
            <li key={i} className="rounded-lg bg-slate-50 px-4 py-3 text-lg">
              <span className="mr-2 rounded-md bg-slate-200 px-2 py-0.5 text-base font-semibold text-slate-800">
                Opción múltiple
              </span>
              {option ? (
                <>
                  Eligió <span className="font-bold">{option.id}) {option.text}</span>
                  <span className={`ml-2 font-semibold ${correct ? "text-emerald-800" : "text-red-800"}`}>
                    {correct ? "· es la correcta" : `· la correcta es ${question.answer}`}
                  </span>
                  {option.graph && (
                    <div className="mt-2">
                      <FunctionGraph spec={option.graph} size="sm" />
                    </div>
                  )}
                </>
              ) : (
                <span className="text-slate-700">Sin responder</span>
              )}
            </li>
          );
        })}
      </ul>
    );
  }
  if (!answer) return <p className="mt-3 rounded-lg bg-slate-50 px-4 py-3 text-lg text-slate-700">Sin responder</p>;
  return (
    <div className="mt-3 rounded-lg bg-slate-50 px-4 py-3">
      <span className="rounded-md bg-slate-200 px-2 py-0.5 text-base font-semibold text-slate-800">
        {answer.mode === "voice" ? "Dictada" : "Escrita"}
      </span>
      <p className="mt-2 whitespace-pre-wrap text-xl leading-relaxed">{answer.text}</p>
      {answer.graph && (
        <div className="mt-2">
          <p className="text-base font-semibold text-slate-700">Gráfica armada con lo que dictó</p>
          <FunctionGraph spec={answer.graph} size="sm" />
        </div>
      )}
      {answer.transcript && (
        <details className="mt-2 text-base text-slate-700">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">Ver lo que dictó, tal cual</summary>
          <p className="whitespace-pre-wrap">{answer.transcript}</p>
        </details>
      )}
    </div>
  );
}
