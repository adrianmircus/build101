import Link from "next/link";
import { Icon, type IconName } from "./Icon";

type Task = { href: string; icon: IconName; title: string; text: string };

// The two things an admin comes to do, as big targets: easy with the keyboard, with a finger, with the eyes or the voice.
export function HomeActions({ institutionId }: { institutionId: string }) {
  const base = `/institucion/${institutionId}`;
  const tasks: Task[] = [
    { href: `${base}/invitar`, icon: "mail", title: "Invitar profes", text: "Les llega un correo con un enlace que dura 7 días." },
    { href: `${base}/crear-cuentas`, icon: "cards", title: "Crear cuentas de estudiantes", text: "Pegás los nombres, revisás los usuarios e imprimís las tarjetas." },
  ];
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {tasks.map((task) => (
        <li key={task.href}>
          <Link
            href={task.href}
            className="grid h-full gap-1 rounded-2xl bg-white p-6 shadow-sm transition-shadow hover:shadow-md focus-visible:shadow-md"
          >
            <Icon name={task.icon} className="mb-2 size-8 text-indigo-700" />
            <span className="text-xl font-bold">{task.title}</span>
            <span className="text-lg text-slate-700">{task.text}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
