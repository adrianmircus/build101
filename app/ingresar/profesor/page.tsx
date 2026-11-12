import type { Metadata } from "next";
import { Suspense } from "react";
import { StaffLoginForm } from "@/components/auth/staff/StaffLoginForm";
import { StaffSheet } from "@/components/auth/staff/StaffSheet";
import { LoginGate, type LoginSearchParams } from "../LoginGate";
import { signInStaffAction } from "./actions";

export const metadata: Metadata = { title: "Ingreso para profesores" };

export default function TeacherLogin({ searchParams }: Readonly<{ searchParams: LoginSearchParams }>) {
  return (
    <>
      <Suspense>
        <LoginGate area="staff" searchParams={searchParams} />
      </Suspense>
      <StaffSheet>
        <StaffLoginForm signIn={signInStaffAction} />
      </StaffSheet>
    </>
  );
}