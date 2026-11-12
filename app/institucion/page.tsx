import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Loading } from "@/components/ui/States";
import { textLink } from "@/components/ui/styles";
import { staffOrRedirect } from "./access";

export const metadata: Metadata = { title: "Institución", robots: { index: false } };

// The way in: one school where the person is admin goes straight to it; more than one asks which; none says so.
export default function InstitutionsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Choose />
    </Suspense>
  );
}

async function Choose() {
  const actor = await staffOrRedirect();
  const mine = actor.institutions.filter((institution) => institution.roles.includes("admin"));
  if (mine.length === 1 && mine[0]) redirect(`/institucion/${mine[0].id}`);
  if (mine.length === 0) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-3xl font-bold sm:text-4xl">No sos admin de ningún colegio</h1>
        <p className="text-lg text-slate-700">Esta parte es para quienes administran un colegio. Si te corresponde, pedile a un admin que te sume.</p>
        <Link href="/grupos" className={textLink}>
          Volver a mis grupos
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold sm:text-4xl">¿Qué colegio querés administrar?</h1>
      <ul className="grid max-w-2xl gap-3">
        {mine.map((institution) => (
          <li key={institution.id}>
            <Link href={`/institucion/${institution.id}`} className="block rounded-2xl bg-white p-5 text-xl font-bold shadow-sm hover:shadow-md">
              {institution.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
