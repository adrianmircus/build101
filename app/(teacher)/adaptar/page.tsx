import { PracticeAdapter } from "@/components/adapter/PracticeAdapter";
import { PageTransition } from "@/components/ui/transitions";

export default function AdaptPage() {
  return (
    <PageTransition>
      <h1 className="text-4xl font-bold tracking-tight print:hidden">Adaptar un práctico</h1>
      <p className="mt-2 mb-8 max-w-3xl text-xl text-slate-700 print:hidden">
        Subí tu práctico de matemática y salen tres versiones: lectura fácil, dislexia y lector de pantalla. La
        matemática no cambia: un verificador la controla en cada ejercicio, y vos aprobás cada versión.
      </p>
      <PracticeAdapter />
    </PageTransition>
  );
}
