import type { Metadata } from "next";
import { StaffLoginForm } from "@/components/auth/staff/StaffLoginForm";
import { StaffSheet } from "@/components/auth/staff/StaffSheet";
import { signInStaffAction } from "./actions";

export const metadata: Metadata = { title: "Ingreso para profesores" };

export default function TeacherLogin() {
  return (
    <StaffSheet>
      <StaffLoginForm signIn={signInStaffAction} />
    </StaffSheet>
  );
}
