// The teacher's course syllabus. Like the groups, it lives in the browser's localStorage.
// Of the syllabus PDF only the id returned by /api/syllabus/pdf is stored, not the file.
// The units come from the agent (one per section of the PDF); the teacher edits them and confirms.
// Only a confirmed syllabus travels to the agent.
import { useSyncExternalStore } from "react";
import type { SyllabusForAI, SyllabusUnit } from "@/lib/contract";

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
  confirmed: boolean;
};

const KEY = "build101:syllabus:v3";

// Starts with no units: they come from the official syllabus PDF, we don't invent them.
const EMPTY: Syllabus = { subject: "Matemática", course: "6.º de bachillerato", units: [], confirmed: false };

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

// Any edit leaves the syllabus unconfirmed: the teacher has to look at it again before the agent uses it.
export function setCourseInfo(changes: Partial<Pick<Syllabus, "subject" | "course">>) {
  save((s) => ({ ...s, ...changes, confirmed: false }));
}

export function updateUnit(id: string, changes: Partial<Omit<Unit, "id">>) {
  save((s) => ({
    ...s,
    units: s.units.map((u) => (u.id === id ? { ...u, ...changes } : u)),
    confirmed: false,
  }));
}

// A new PDF replaces everything generated from the previous one.
export function setPdf(pdf: { fileId: string; name: string }) {
  save((s) => ({ ...s, pdf, units: [], confirmed: false }));
}

export function setGeneratedUnits(units: SyllabusUnit[]) {
  save((s) => ({ ...s, units: units.map((u) => ({ ...u, id: newId() })), confirmed: false }));
}

export function confirmSyllabus() {
  save((s) => ({ ...s, confirmed: true }));
}

export function isSyllabusConfirmed(syllabus: Syllabus): boolean {
  return syllabus.confirmed && syllabus.pdf !== undefined && syllabus.units.length > 0;
}

// What travels to the AI on each request. Without a confirmed syllabus nothing is sent.
export function syllabusForAI(): SyllabusForAI | undefined {
  const syllabus = read();
  if (!isSyllabusConfirmed(syllabus)) return undefined;
  return {
    subject: syllabus.subject.trim(),
    course: syllabus.course.trim(),
    units: syllabus.units
      .filter((u) => u.title.trim() || u.contents.trim())
      .map((u) => ({ title: u.title.trim(), contents: u.contents.trim() })),
    pdfFileId: syllabus.pdf?.fileId,
  };
}
