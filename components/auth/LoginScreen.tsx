import Link from "next/link";
import { ViewTransition } from "react";
import { Logo } from "@/components/ui/Logo";
import type { LoginState } from "@/lib/auth/actions";
import type { Role } from "@/lib/auth/signing";
import { LoginForm } from "./LoginForm";

type Props = {
  role: Role;
  title: string;
  subtitle: string;
  action: (previous: LoginState, formData: FormData) => Promise<LoginState>;
};

const TABS: { role: Role; text: string; href: string }[] = [
  { role: "teacher", text: "Soy profesor", href: "/ingresar/profesor" },
  { role: "student", text: "Soy estudiante", href: "/ingresar/estudiante" },
];

// Switching between the two logins doesn't fade the page: the card morphs and the indicator slides.
const SWITCH = ["login-switch"];
const PAGE = { "login-switch": "none", default: "page-fade" };

export function LoginScreen({ role, title, subtitle, action }: Props) {
  return (
    <ViewTransition enter={PAGE} exit={PAGE} default="none">
      <main id="main-content" className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 px-4 py-12">
        <Link
          href="/"
          className="focus-on-dark inline-flex min-h-11 items-center self-start rounded-md text-2xl"
        >
          <Logo tone="dark" />
        </Link>
        <ViewTransition name="login-card" share="login-card" default="none">
          <div className="rounded-2xl bg-white p-6 shadow-2xl shadow-black/40 sm:p-8">
            <nav aria-label="Tipo de ingreso" className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
              {TABS.map((tab) => {
                const active = tab.role === role;
                return (
                  <Link
                    key={tab.role}
                    href={tab.href}
                    transitionTypes={SWITCH}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex min-h-11 items-center justify-center rounded-lg px-3 py-2 text-center text-lg font-semibold transition-colors ${
                      active ? "text-indigo-950" : "text-slate-700 hover:text-slate-950"
                    }`}
                  >
                    {active && (
                      <ViewTransition name="login-tab-indicator" share="tab-indicator" default="none">
                        <span aria-hidden="true" className="absolute inset-0 rounded-lg border-2 border-indigo-700 bg-white" />
                      </ViewTransition>
                    )}
                    <span className="relative">{tab.text}</span>
                  </Link>
                );
              })}
            </nav>
            <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
            <p className="mt-2 mb-6 text-lg text-slate-700">{subtitle}</p>
            <LoginForm action={action} />
          </div>
        </ViewTransition>
        {/* Only for teachers: on the student side nothing hints that there are adapted versions. */}
        {role === "teacher" && (
          <p className="text-lg text-indigo-100">Un práctico, una versión para cada estudiante del grupo.</p>
        )}
      </main>
    </ViewTransition>
  );
}
