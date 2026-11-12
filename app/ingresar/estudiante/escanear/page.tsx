import type { Metadata } from "next";
import { Suspense } from "react";
import { ScanScreen } from "@/components/auth/student/ScanScreen";
import { LoginGate, type LoginSearchParams } from "../../LoginGate";

export const metadata: Metadata = { title: "Escanear mi tarjeta" };

export default function ScanCardPage({ searchParams }: Readonly<{ searchParams: LoginSearchParams }>) {
  return (
    <>
      <Suspense>
        <LoginGate area="student" searchParams={searchParams} />
      </Suspense>
      <ScanScreen />
    </>
  );
}