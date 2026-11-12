import Link from "next/link";
import { textLink } from "@/components/ui/styles";

// Signed in, but not an admin of this school (or a link to a school that is not theirs). It does not say whether the
// school exists.
export function NoAccess() {
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-3xl font-bold sm:text-4xl">Esta página es para admins del colegio</h1>
      <p className="text-lg text-slate-700">Con tu cuenta no podés verla. Si necesitás invitar profes o crear cuentas, pedile a un admin de tu colegio que te sume como admin.</p>
      <Link href="/grupos" className={textLink}>
        Volver a mis grupos
      </Link>
    </div>
  );
}
