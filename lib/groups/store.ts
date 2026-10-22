// Client-side store. For the hackathon there is no database: everything lives in
// the teacher's browser localStorage (the UI promises the data stays on their device).
import { useSyncExternalStore } from "react";
import type { ProfileId } from "@/lib/profiles";
import type { Support } from "@/lib/supports";
import { isDemo } from "@/lib/demo/mode";
import { demoGroup, seed } from "./seed";
import type { OptionId } from "@/lib/contract";
import type { Answer, Assessment, Data, ExerciseResult, Grade, Group, GroupAnalysis, Submission, Version } from "./types";

const KEY = "build101:data:v2";
// The demo from the landing keeps its own data: entering it never touches what the teacher created.
const DEMO_KEY = "build101:data:demo";
const currentKey = () => (isDemo() ? DEMO_KEY : KEY);

// Tied to its key: if the demo flag changes (entering or leaving the demo), the next read loads the other data.
let cache: { key: string; data: Data } | null = null;
const listeners = new Set<() => void>();

function load(key: string): Data {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const data = JSON.parse(raw) as Data;
      // After a reload no generation is running: anything left halfway goes back to pending.
      for (const a of data.assessments) {
        for (const v of a.versions) if (v.status === "generating") v.status = "pending";
      }
      // Data saved before the demo group existed: it's added first, without touching anything else.
      if (!data.groups.some((g) => g.id === "demo")) {
        data.groups.unshift(demoGroup());
        localStorage.setItem(key, JSON.stringify(data));
      }
      return data;
    }
  } catch {
    // localStorage blocked or corrupt data: start with the sample data.
  }
  return seed();
}

function read(): Data {
  const key = currentKey();
  if (cache?.key !== key) cache = { key, data: load(key) };
  return cache.data;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function save(update: (data: Data) => Data) {
  cache = { key: currentKey(), data: update(read()) };
  try {
    localStorage.setItem(cache.key, JSON.stringify(cache.data));
  } catch {
    // Without localStorage the changes stay in memory only.
  }
  listeners.forEach((listener) => listener());
}

// Returns null on the server: screens show "Cargando…" until hydration.
export function useData(): Data | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

export function getData(): Data {
  return read();
}

const newId = () => Math.random().toString(36).slice(2, 10);

function updateGroup(groupId: string, update: (group: Group) => Group) {
  save((d) => ({ ...d, groups: d.groups.map((g) => (g.id === groupId ? update(g) : g)) }));
}

export function createGroup(name: string): string {
  const id = newId();
  save((d) => ({ ...d, groups: [...d.groups, { id, name, students: [] }] }));
  return id;
}

export function addStudent(groupId: string, name: string, profiles: ProfileId[]) {
  updateGroup(groupId, (g) => ({ ...g, students: [...g.students, { id: newId(), name, profiles }] }));
}

export function setProfiles(groupId: string, studentId: string, profiles: ProfileId[]) {
  updateGroup(groupId, (g) => ({
    ...g,
    students: g.students.map((s) => (s.id === studentId ? { ...s, profiles } : s)),
  }));
}

export function setInterests(groupId: string, studentId: string, interests: string[]) {
  updateGroup(groupId, (g) => ({
    ...g,
    students: g.students.map((s) => (s.id === studentId ? { ...s, interests } : s)),
  }));
}

export function setSupports(groupId: string, studentId: string, supports: Support[]) {
  updateGroup(groupId, (g) => ({
    ...g,
    students: g.students.map((s) => (s.id === studentId ? { ...s, supports } : s)),
  }));
}

export function removeStudent(groupId: string, studentId: string) {
  updateGroup(groupId, (g) => ({ ...g, students: g.students.filter((s) => s.id !== studentId) }));
}

export function createAssessment(assessment: Omit<Assessment, "id" | "createdAt">): string {
  const id = newId();
  save((d) => ({
    ...d,
    assessments: [...d.assessments, { ...assessment, id, createdAt: new Date().toISOString() }],
  }));
  return id;
}

export function updateVersion(assessmentId: string, index: number, changes: Partial<Version>) {
  save((d) => ({
    ...d,
    assessments: d.assessments.map((a) =>
      a.id === assessmentId
        ? { ...a, versions: a.versions.map((v, i) => (i === index ? { ...v, ...changes } : v)) }
        : a,
    ),
  }));
}

// null removes the grade. Students see the change right away: there is no publish step.
export function setGrade(assessmentId: string, studentId: string, grade: Grade | null) {
  save((d) => ({
    ...d,
    assessments: d.assessments.map((a) => {
      if (a.id !== assessmentId) return a;
      const grades = { ...a.grades };
      if (grade) grades[studentId] = grade;
      else delete grades[studentId];
      return { ...a, grades };
    }),
  }));
}

function updateAssessment(assessmentId: string, update: (assessment: Assessment) => Assessment) {
  save((d) => ({ ...d, assessments: d.assessments.map((a) => (a.id === assessmentId ? update(a) : a)) }));
}

export function setExerciseCount(assessmentId: string, count: number) {
  updateAssessment(assessmentId, (a) => ({ ...a, exerciseCount: count }));
}

// null clears the mark. Exercise results are for the teacher's metrics: students don't see them.
export function setExerciseResult(
  assessmentId: string,
  studentId: string,
  index: number,
  result: ExerciseResult | null,
) {
  updateAssessment(assessmentId, (a) => {
    const row = [...(a.exerciseResults?.[studentId] ?? [])];
    while (row.length <= index) row.push(null);
    row[index] = result;
    return { ...a, exerciseResults: { ...a.exerciseResults, [studentId]: row } };
  });
}

// Changes a student's submission. Once submitted it doesn't change anymore.
function updateSubmission(assessmentId: string, studentId: string, update: (submission: Submission) => Submission) {
  updateAssessment(assessmentId, (a) => {
    const current = a.submissions?.[studentId] ?? { answers: [] };
    if (current.submittedAt) return a;
    return { ...a, submissions: { ...a.submissions, [studentId]: update(current) } };
  });
}

function setAt<T>(row: (T | null)[], index: number, value: T | null): (T | null)[] {
  const next = [...row];
  while (next.length <= index) next.push(null);
  next[index] = value;
  return next;
}

// null clears the answer. It saves on every change: there is no "save" button.
export function saveAnswer(assessmentId: string, studentId: string, index: number, answer: Answer | null) {
  updateSubmission(assessmentId, studentId, (s) => ({ ...s, answers: setAt(s.answers, index, answer) }));
}

export function saveChoice(assessmentId: string, studentId: string, index: number, choice: OptionId | null) {
  updateSubmission(assessmentId, studentId, (s) => ({ ...s, choices: setAt(s.choices ?? [], index, choice) }));
}

export function submitAssessment(assessmentId: string, studentId: string) {
  updateSubmission(assessmentId, studentId, (s) => ({ ...s, submittedAt: new Date().toISOString() }));
}

export function saveAnalysis(groupId: string, analysis: GroupAnalysis) {
  save((d) => ({ ...d, analyses: { ...d.analyses, [groupId]: analysis } }));
}

export function resetDemo() {
  save(() => seed());
}
