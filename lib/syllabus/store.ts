// The teacher's course syllabus. Like the groups, it lives in the browser's localStorage.
// Of the syllabus PDF only the id returned by /api/syllabus/pdf is stored, not the file.
import { useSyncExternalStore } from "react";
import type { SyllabusForAI } from "@/lib/contract";

export type Unit = {
  id: string;
  title: string;
  contents: string;
};

export type Syllabus = {
  subject: string;
  course: string;
  units: Unit[];
  pdf?: { fileId: string; name: string };
};

const KEY = "build101:syllabus:v2";

// Starts with no units: the official syllabus is loaded by the teacher, we don't invent it.
const EMPTY: Syllabus = { subject: "Matemática", course: "6.º de bachillerato", units: [] };

let cache: Syllabus | null = null;
const listeners = new Set<() => void>();

function load(): Syllabus {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Syllabus;
  } catch {
    // localStorage blocked or corrupt data: start empty.
  }
  return structuredClone(EMPTY);
}

function read(): Syllabus {
  return (cache ??= load());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function save(update: (syllabus: Syllabus) => Syllabus) {
  cache = update(read());
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Without localStorage the changes stay in memory only.
  }
  listeners.forEach((listener) => listener());
}

// Returns null on the server: screens show "Cargando…" until hydration.
export function useSyllabus(): Syllabus | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

const newId = () => Math.random().toString(36).slice(2, 10);

export function setCourseInfo(changes: Partial<Pick<Syllabus, "subject" | "course">>) {
  save((s) => ({ ...s, ...changes }));
}

export function addUnit(): string {
  const id = newId();
  save((s) => ({ ...s, units: [...s.units, { id, title: "", contents: "" }] }));
  return id;
}

export function updateUnit(id: string, changes: Partial<Omit<Unit, "id">>) {
  save((s) => ({ ...s, units: s.units.map((u) => (u.id === id ? { ...u, ...changes } : u)) }));
}

export function removeUnit(id: string) {
  save((s) => ({ ...s, units: s.units.filter((u) => u.id !== id) }));
}

export function setPdf(pdf: { fileId: string; name: string }) {
  save((s) => ({ ...s, pdf }));
}

export function removePdf() {
  save((s) => ({ ...s, pdf: undefined }));
}

export function isSyllabusLoaded(syllabus: Syllabus): boolean {
  return syllabus.pdf !== undefined || syllabus.units.some((u) => u.title.trim() || u.contents.trim());
}

// What travels to the AI on each request. Without a loaded syllabus nothing is sent.
export function syllabusForAI(): SyllabusForAI | undefined {
  const syllabus = read();
  if (!isSyllabusLoaded(syllabus)) return undefined;
  return {
    subject: syllabus.subject.trim(),
    course: syllabus.course.trim(),
    units: syllabus.units
      .filter((u) => u.title.trim() || u.contents.trim())
      .map((u) => ({ title: u.title.trim(), contents: u.contents.trim() })),
    pdfFileId: syllabus.pdf?.fileId,
  };
}
