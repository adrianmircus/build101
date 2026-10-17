"use client";

import { focusWithin } from "@/components/ui/styles";
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
      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        {PROFILES.map((profile) => {
          const checked = selected.includes(profile.id);
          return (
            <label
              key={profile.id}
              title={profile.fullName}
              className={`inline-flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-full border-2 px-3 text-base font-semibold transition-colors sm:px-4 ${focusWithin} ${
                checked
                  ? "border-indigo-700 bg-indigo-700 text-white"
                  : "border-slate-500 bg-white text-slate-900 hover:border-slate-800 hover:bg-slate-50"
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
