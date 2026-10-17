import Link from "next/link";
import { textLink } from "./styles";
import { BACK } from "./transitions";

export function Loading() {
  return (
    <p role="status" className="py-8 text-xl text-slate-700">
      Cargando…
    </p>
  );
}

export function NotFound({ what }: { what: string }) {
  return (
    <div className="max-w-2xl space-y-4 py-8">
      <h1 className="text-4xl font-bold">No encontramos {what}</h1>
      <p className="text-xl text-slate-700">Puede que lo hayan borrado o que el enlace esté incompleto.</p>
      <Link href="/grupos" transitionTypes={BACK} className={`${textLink} text-lg font-semibold`}>
        Volver a mis grupos
      </Link>
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { text: string; href?: string }[] }) {
  return (
    <nav aria-label="Ubicación" className="mb-2 text-lg text-slate-700">
      <ol className="flex flex-wrap items-center gap-x-2">
        {items.map((item, i) => (
          <li key={item.text} className="flex items-center gap-2">
            {i > 0 && (
              <span aria-hidden="true" className="text-slate-500">
                /
              </span>
            )}
            {item.href ? (
              <Link href={item.href} transitionTypes={BACK} className={`${textLink} font-medium`}>
                {item.text}
              </Link>
            ) : (
              <span aria-current="page" className="py-2">
                {item.text}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
