"use client";

import { PROFILES, sortProfiles, type ProfileId } from "@/lib/profiles";

// Native checkboxes shaped like chips: they work with the keyboard (Tab + Space) and with screen readers.
export function ProfileSelector({
  legend,
  selected,
  onChange,
}: {
  legend: string;
  selected: ProfileId[];
  onChange: (profiles: ProfileId[]) => void;
}) {
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {PROFILES.map((profile) => {
          const checked = selected.includes(profile.id);
          return (
            <label
              key={profile.id}
              title={profile.fullName}
              className={`inline-flex cursor-pointer select-none items-center gap-2 rounded-full border-2 px-4 py-1.5 text-base font-semibold has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-amber-500 ${
                checked
                  ? "border-indigo-700 bg-indigo-700 text-white"
                  : "border-slate-400 bg-white text-slate-800 hover:border-slate-700"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() =>
                  onChange(
                    checked
                      ? selected.filter((id) => id !== profile.id)
                      : sortProfiles([...selected, profile.id]),
                  )
                }
              />
              <span aria-hidden="true">{checked ? "✓" : "+"}</span>
              {profile.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
