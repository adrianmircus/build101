import Link from "next/link";
import { textLink } from "@/components/ui/styles";
import { Icon } from "./Icon";

// What a page shows when its data could not be read (the service is down or not ready). Neutral and without a cause the
// person cannot do anything about; the way out is always there.
export function LoadError({ backHref = "/grupos", backLabel = "Volver a mis grupos" }: { backHref?: string; backLabel?: string }) {
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-3xl font-bold sm:text-4xl">No pudimos cargar esto</h1>
      <p role="alert" className="flex gap-3 rounded-xl bg-slate-100 p-4 text-lg text-slate-900">
        <Icon name="idea" className="mt-0.5 size-6" />
        <span>No es por vos: probá de nuevo en un rato. Lo que ya hiciste no se pierde.</span>
      </p>
      <Link href={backHref} className={textLink}>
        {backLabel}
      </Link>
    </div>
  );
}
