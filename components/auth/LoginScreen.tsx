import Link from "next/link";
import { card } from "@/components/ui/styles";
import type { LoginState } from "@/lib/auth/actions";
import { LoginForm } from "./LoginForm";

type Props = {
  title: string;
  subtitle: string;
  action: (previous: LoginState, formData: FormData) => Promise<LoginState>;
  other: { text: string; href: string };
};

export function LoginScreen({ title, subtitle, action, other }: Props) {
  return (
    <main id="main-content" className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-16">
      <Link href="/" className="text-lg font-semibold text-indigo-800 underline-offset-4 hover:underline">
        Prácticos accesibles
      </Link>
      <div className={card}>
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="mt-2 mb-6 text-lg text-slate-700">{subtitle}</p>
        <LoginForm action={action} />
      </div>
      <Link href={other.href} className="text-lg font-medium text-indigo-800 underline underline-offset-4">
        {other.text}
      </Link>
    </main>
  );
}
