// Client-side store. For the hackathon there is no database: everything lives in
// the teacher's browser localStorage (the UI promises the data stays on their device).
import { useSyncExternalStore } from "react";
import type { ProfileId } from "@/lib/profiles";
import { seed } from "./seed";
import type { Assessment, Data, Group, Version } from "./types";

const KEY = "build101:data:v2";

let cache: Data | null = null;
const listeners = new Set<() => void>();

function load(): Data {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw) as Data;
      // After a reload no generation is running: anything left halfway goes back to pending.
      for (const a of data.assessments) {
        for (const v of a.versions) if (v.status === "generating") v.status = "pending";
      }
      return data;
    }
  } catch {
    // localStorage blocked or corrupt data: start with the sample data.
  }
  return seed();
}

function read(): Data {
  return (cache ??= load());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function save(update: (data: Data) => Data) {
  cache = update(read());
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
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

export function resetDemo() {
  save(() => seed());
}
