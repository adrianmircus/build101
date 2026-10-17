"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loading } from "@/components/ui/States";
import { field, secondaryButton } from "@/components/ui/styles";
import { FORWARD } from "@/components/ui/transitions";
import { createGroup, useData } from "@/lib/groups/store";
import { GroupCard } from "./GroupCard";

export function GroupsPanel() {
  const data = useData();
  if (!data) return <Loading />;

  const latestOf = (groupId: string) =>
    data.assessments.filter((a) => a.groupId === groupId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  return (
    <>
      <h1 className="text-4xl font-bold tracking-tight">Mis grupos</h1>
      <p className="mt-2 text-xl text-slate-700">Elegí un grupo para ver a sus estudiantes o crear un práctico.</p>
      <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {data.groups.map((group) => (
          <li key={group.id}>
            <GroupCard group={group} latest={latestOf(group.id)} />
          </li>
        ))}
        <li>
          <NewGroupForm />
        </li>
      </ul>
    </>
  );
}

function NewGroupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  return (
    <form
      className="flex h-full flex-col justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-500 bg-white/60 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        router.push(`/grupos/${createGroup(trimmed)}`, { transitionTypes: FORWARD });
      }}
    >
      <label htmlFor="group-name" className="text-xl font-bold">
        Nuevo grupo
      </label>
      <input
        id="group-name"
        className={field}
        placeholder="Ej.: 6.º C"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <button type="submit" className={secondaryButton}>
        Crear grupo
      </button>
    </form>
  );
}
