import type { ReactNode } from "react";

// The face of an access card: the same for every student, with the same data in the same order (name, QR, school,
// user, password). Nothing on it tells anything about the student beyond their name. Two sizes: the sample on the
// screen, and the A6 paper (105 x 148 mm) that prints four to the A4 sheet, with the data at 16 pt.

type Props = {
  variant: "screen" | "paper";
  hello: string;
  qr: ReactNode;
  /** The address to type when the QR is not an option, e.g. tiza.ai/ingresar/estudiante. */
  address: string;
  schoolCode: string;
  username: string;
  password: ReactNode;
  footer: string;
};

const SIZES = {
  screen: {
    hello: "text-2xl",
    sub: "text-base",
    qr: "my-4 size-36",
    hint: "text-base",
    or: "mt-4 text-base",
    dt: "text-sm",
    dd: "text-xl",
    foot: "text-sm",
  },
  paper: {
    hello: "text-[22pt]",
    sub: "text-[11pt]",
    qr: "mt-[5mm] mb-[2mm] size-[38mm]",
    hint: "text-[11pt]",
    or: "mt-[4mm] text-[10.5pt]",
    dt: "text-[9.5pt]",
    dd: "text-[16pt]",
    foot: "text-[9pt]",
  },
} as const;

export function CardFace({ variant, hello, qr, address, schoolCode, username, password, footer }: Props) {
  const size = SIZES[variant];
  return (
    <div className="flex h-full flex-col items-start text-slate-900">
      <p className={`font-bold leading-tight ${size.hello}`}>Hola, {hello}</p>
      <p className={`mt-0.5 text-slate-700 ${size.sub}`}>Así entrás a Tiza.ai</p>
      <div className={size.qr}>{qr}</div>
      <p className={`font-semibold ${size.hint}`}>Escaneá este código con la cámara.</p>
      <p className={`text-slate-700 ${size.or}`}>
        O entrá en <b className="text-slate-900 [overflow-wrap:anywhere]">{address}</b> y escribí:
      </p>
      <dl className="mt-2 grid w-full gap-1.5">
        <div>
          <dt className={`text-slate-700 ${size.dt}`}>Código del colegio</dt>
          <dd className={`font-bold leading-tight tracking-wider [overflow-wrap:anywhere] ${size.dd}`}>{schoolCode}</dd>
        </div>
        <div>
          <dt className={`text-slate-700 ${size.dt}`}>Usuario</dt>
          <dd className={`font-bold leading-tight tracking-wider [overflow-wrap:anywhere] ${size.dd}`}>{username}</dd>
        </div>
        <div>
          <dt className={`text-slate-700 ${size.dt}`}>Contraseña</dt>
          <dd className={`font-bold leading-tight tracking-wider [overflow-wrap:anywhere] ${size.dd}`}>{password}</dd>
        </div>
      </dl>
      <p className={`mt-auto pt-3 text-slate-700 ${size.foot}`}>{footer}</p>
    </div>
  );
}
