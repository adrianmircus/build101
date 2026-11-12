import { CardFace } from "./CardFace";
import { firstName } from "./cards-state";

// The sample card: how every card looks, with a student of the list. The password and the QR do not exist yet: they
// are made when the teacher confirms and prints, so there is nothing secret here to show. The QR is a plain drawing
// that cannot be scanned.

type Props = { displayName: string; username: string; schoolCode: string; groupName: string };

function PlaceholderQr() {
  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
      <rect width="7" height="7" rx="1" fill="#cbd5e1" />
      <rect x="1.5" y="1.5" width="4" height="4" fill="#fff" />
      <rect x="2.5" y="2.5" width="2" height="2" fill="#cbd5e1" />
    </g>
  );
  return (
    <svg viewBox="0 0 21 21" aria-hidden="true" focusable="false" className="size-full">
      <rect width="21" height="21" fill="#f1f5f9" />
      {[finder(0, 0), finder(14, 0), finder(0, 14)]}
      <path d="M9 1h3M9 3h2M8 6h4M1 9h2M5 9h3M10 9h2M14 9h3M18 9h2M9 12h2M13 12h3M17 12h3M9 15h3M14 15h2M18 16h2M9 18h2M13 18h3M17 19h3" stroke="#cbd5e1" strokeWidth="1.2" />
    </svg>
  );
}

export function SampleCard({ displayName, username, schoolCode, groupName }: Props) {
  return (
    <article aria-label="Tarjeta de muestra" className="rounded-2xl bg-white p-5 shadow-sm shadow-slate-900/10">
      <CardFace
        variant="screen"
        hello={firstName(displayName)}
        qr={<PlaceholderQr />}
        address="tiza.ai/ingresar/estudiante"
        schoolCode={schoolCode}
        username={username}
        password={<span className="text-base font-semibold tracking-normal text-slate-700">Se crea al imprimir</span>}
        footer={`${displayName} · ${groupName}`}
      />
    </article>
  );
}
