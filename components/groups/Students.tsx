"use client";

import { useRef, useState } from "react";
import { dangerButton, field, secondaryButton } from "@/components/ui/styles";
import { addStudent, removeStudent, setInterests, setProfiles, setSupports } from "@/lib/groups/store";
import type { Group, Student } from "@/lib/groups/types";
import { topInterests } from "@/lib/groups/versions";
import type { ProfileId } from "@/lib/profiles";
import { supportLabel } from "@/lib/supports";
import { InterestsEditor } from "./InterestsEditor";
import { ProfileSelector } from "./ProfileSelector";
import { SupportsEditor } from "./SupportsEditor";

export function Students({ group }: { group: Group }) {
  const suggestions = topInterests(group.students, Infinity);
  return (
    <div className="space-y-6">
      <AddStudentForm groupId={group.id} />
      {group.students.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-slate-400 px-6 py-8 text-lg text-slate-700">
          Este grupo todavía no tiene estudiantes. Agregá el primero arriba.
        </p>
      ) : (
        <ul data-tour="group-profiles" className="divide-y-2 divide-slate-100 rounded-2xl border-2 border-slate-200 bg-white">
          {group.students.map((student) => (
            <StudentRow key={student.id} group={group} student={student} suggestions={suggestions} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StudentRow({ group, student, suggestions }: { group: Group; student: Student; suggestions: string[] }) {
  const [open, setOpen] = useState(false);
  const panelId = `extra-${student.id}`;
  const interests = student.interests ?? [];
  const supports = student.supports ?? [];

  return (
    // Mobile: name and the buttons on the first row, chips below. From sm up: one row.
    // Same DOM order everywhere (name, profiles, buttons, panel), so the tab order doesn't change.
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-3 py-3 sm:flex sm:flex-wrap sm:px-6 sm:py-4">
      <div className="min-w-40 sm:flex-1">
        <span className="text-lg font-semibold">{student.name}</span>
        {interests.length > 0 && <p className="text-base text-slate-700">Gustos: {interests.join(", ")}</p>}
        {supports.length > 0 && (
          <p className="text-base text-slate-700">Razonamiento disminuido: {supports.map(supportLabel).join(", ").toLowerCase()}</p>
        )}
      </div>
      <div className="col-span-2 row-start-2">
        <ProfileSelector
          legend={`Perfiles de ${student.name}`}
          selected={student.profiles}
          onChange={(profiles) => setProfiles(group.id, student.id, profiles)}
        />
      </div>
      <div className="col-start-2 row-start-1 flex justify-self-end">
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 py-2 text-base font-semibold text-indigo-800 underline-offset-4 transition-colors hover:bg-indigo-50 hover:underline"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`Datos adicionales de ${student.name}`}
          onClick={() => setOpen(!open)}
        >
          Datos adicionales
          <span aria-hidden="true">{open ? "▴" : "▾"}</span>
        </button>
        <button
          type="button"
          className={dangerButton}
          aria-label={`Quitar a ${student.name} del grupo`}
          onClick={() => {
            if (confirm(`¿Quitar a ${student.name} de ${group.name}?`)) {
              removeStudent(group.id, student.id);
            }
          }}
        >
          Quitar
        </button>
      </div>
      {open && (
        <div id={panelId} className="col-span-2 space-y-6 rounded-xl bg-slate-50 p-4 sm:basis-full">
          <InterestsEditor
            studentName={student.name}
            interests={interests}
            suggestions={suggestions}
            onChange={(next) => setInterests(group.id, student.id, next)}
          />
          <SupportsEditor
            studentName={student.name}
            supports={supports}
            onChange={(next) => setSupports(group.id, student.id, next)}
          />
        </div>
      )}
    </li>
  );
}

function AddStudentForm({ groupId }: { groupId: string }) {
  const [name, setName] = useState("");
  const [profiles, setProfiles] = useState<ProfileId[]>([]);
  const input = useRef<HTMLInputElement>(null);

  return (
    <form
      className="flex flex-wrap items-end gap-4 rounded-2xl border-2 border-slate-200 bg-white p-4 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        addStudent(groupId, trimmed, profiles);
        setName("");
        setProfiles([]);
        input.current?.focus();
      }}
    >
      <div className="min-w-60 flex-1">
        <label htmlFor="student-name" className="mb-1 block text-lg font-semibold">
          Agregar estudiante
        </label>
        <p id="name-help" className="mb-2 text-base text-slate-700">
          Nombre de pila e inicial alcanzan.
        </p>
        <input
          id="student-name"
          ref={input}
          className={field}
          placeholder="Ej.: Sofía R."
          aria-describedby="name-help"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div>
        <ProfileSelector legend="Perfiles del estudiante nuevo" selected={profiles} onChange={setProfiles} />
      </div>
      <button type="submit" className={secondaryButton}>
        Agregar
      </button>
    </form>
  );
}
