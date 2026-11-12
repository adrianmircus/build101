import type { Metadata } from "next";
import { RecoveryFlow } from "@/components/auth/staff/RecoveryFlow";
import { StaffSheet } from "@/components/auth/staff/StaffSheet";
import { setNewPasswordAction, verifyRecoveryAction } from "../actions";

// The token is in the fragment (#<token_hash>), which the server never sees: RecoveryFlow, a Client Component,
// reads it. This page stays a Server Component only so it can set the title and keep the page out of search engines.
export const metadata: Metadata = { title: "Contraseña nueva", robots: { index: false } };

export default function NewPasswordPage() {
  return (
    <StaffSheet>
      <RecoveryFlow verifyRecovery={verifyRecoveryAction} setNewPassword={setNewPasswordAction} />
    </StaffSheet>
  );
}
