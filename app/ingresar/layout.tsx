import { MathBackdrop } from "@/components/auth/MathBackdrop";

// The layout persists between /ingresar/profesor and /ingresar/estudiante: the background doesn't restart.
export default function LoginLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="relative isolate min-h-screen overflow-hidden">
      <MathBackdrop />
      {children}
    </div>
  );
}
