import type { Metadata } from "next";
import { Suspense } from "react";
import { ForgotPassword } from "@/components/auth/staff/ForgotPassword";
import { StaffSheet } from "@/components/auth/staff/StaffSheet";
import { LoginGate, type LoginSearchParams } from "../../LoginGate";
import { requestResetAction } from "../actions";

export const metadata: Metadata = { title: "Contraseña nueva" };

export default function ForgotPage({ searchParams }: Readonly<{ searchParams: LoginSearchParams }>) {
  return (
    <>
      <Suspense>
        <LoginGate area="staff" searchParams={searchParams} />
      </Suspense>
      <StaffSheet>
        <ForgotPassword requestReset={requestResetAction} />
      </StaffSheet>
    </>
  );
}