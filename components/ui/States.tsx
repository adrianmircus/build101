import Link from "next/link";

export function Loading() {
  return (
    <p role="status" className="text-lg text-slate-600">
      Cargando…
    </p>
  );
}

export function NotFound({ what }: { what: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">No encontramos {what}</h1>
      <Link href="/groups" className="text-lg font-semibold text-indigo-800 underline">
        Volver a mis grupos
      </Link>
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { text: string; href?: string }[] }) {
  return (
    <nav aria-label="Ubicación" className="mb-4 text-base text-slate-600">
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, i) => (
          <li key={item.text} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true">/</span>}
            {item.href ? (
              <Link href={item.href} className="font-medium text-indigo-800 underline-offset-4 hover:underline">
                {item.text}
              </Link>
            ) : (
              <span aria-current="page">{item.text}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
