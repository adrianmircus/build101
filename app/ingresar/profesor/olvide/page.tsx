import type { Metadata } from "next";
import { ForgotPassword } from "@/components/auth/staff/ForgotPassword";
import { StaffSheet } from "@/components/auth/staff/StaffSheet";
import { requestResetAction } from "../actions";

export const metadata: Metadata = { title: "Contraseña nueva" };

export default function ForgotPage() {
  return (
    <StaffSheet>
      <ForgotPassword requestReset={requestResetAction} />
    </StaffSheet>
  );
}
