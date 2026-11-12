import { focusWithin } from "@/components/ui/styles";
import type { InvitedRole } from "@/lib/domain/identity/entities";

// «Entran como»: a native radio group, so it works with the keyboard (arrows) and a screen reader out of the box.

const OPTIONS: { role: InvitedRole; name: string; text: string }[] = [
  { role: "teacher", name: "Profe", text: "Arma sus grupos y prácticos." },
  { role: "admin", name: "Admin", text: "Además invita profes y crea cuentas de estudiantes." },
  { role: "inclusion", name: "Inclusión", text: "Acompaña a los grupos del colegio desde inclusión." },
];

type Props = { value: InvitedRole; onChange: (role: InvitedRole) => void; disabled?: boolean };

export function RoleField({ value, onChange, disabled }: Props) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-2 text-lg font-semibold">Entran como</legend>
      {OPTIONS.map((option) => (
        <label key={option.role} className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl bg-white p-4 shadow-sm ${focusWithin}`}>
          <input
            type="radio"
            name="invite-role"
            value={option.role}
            checked={value === option.role}
            onChange={() => onChange(option.role)}
            className="mt-1 size-5 shrink-0 accent-indigo-700"
          />
          <span className="min-w-0">
            <span className="block text-lg font-semibold">{option.name}</span>
            <span className="block text-base text-slate-700">{option.text}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
