"use client";

import { useRef, useState } from "react";
import { dangerButton, field, secondaryButton } from "@/components/ui/styles";
import { addStudent, removeStudent, setProfiles } from "@/lib/groups/store";
import type { Group } from "@/lib/groups/types";
import type { ProfileId } from "@/lib/profiles";
import { ProfileSelector } from "./ProfileSelector";

export function Students({ group }: { group: Group }) {
  return (
    <div className="space-y-6">
      <AddStudentForm groupId={group.id} />
      {group.students.length === 0 ? (
        <p className="text-lg text-slate-700">Este grupo todavía no tiene estudiantes. Agregá el primero arriba.</p>
      ) : (
        <ul className="divide-y-2 divide-slate-100 rounded-2xl border-2 border-slate-200 bg-white">
          {group.students.map((student) => (
            <li key={student.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
              <span className="min-w-40 text-lg font-semibold">{student.name}</span>
              <div className="flex flex-1 flex-wrap items-center justify-end gap-4">
                <ProfileSelector
                  legend={`Perfiles de ${student.name}`}
                  selected={student.profiles}
                  onChange={(profiles) => setProfiles(group.id, student.id, profiles)}
                />
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddStudentForm({ groupId }: { groupId: string }) {
  const [name, setName] = useState("");
  const [profiles, setProfiles] = useState<ProfileId[]>([]);
  const input = useRef<HTMLInputElement>(null);

  return (
    <form
      className="flex flex-wrap items-end gap-4 rounded-2xl border-2 border-slate-200 bg-white p-6"
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
        <p id="name-help" className="mb-2 text-base text-slate-600">
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
      <div className="pb-2">
        <ProfileSelector legend="Perfiles del estudiante nuevo" selected={profiles} onChange={setProfiles} />
      </div>
      <button type="submit" className={secondaryButton}>
        Agregar
      </button>
    </form>
  );
}
