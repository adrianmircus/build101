import type { Metadata } from "next";
import { Suspense } from "react";
import { StudentLoginScreen } from "@/components/auth/student/StudentLoginScreen";
import { LoginGate, type LoginSearchParams } from "../LoginGate";

export const metadata: Metadata = { title: "Entrá con tu tarjeta" };

// The three data of the card (school, username, password). The screen is a Client Component: the school
// remembered on the device lives in the browser, and nothing about the student is rendered on the server.
// The gate sends home whoever has a live session (the database decides, not the claims: F2-5).
export default function StudentLogin({ searchParams }: Readonly<{ searchParams: LoginSearchParams }>) {
  return (
    <>
      <Suspense>
        <LoginGate area="student" searchParams={searchParams} />
      </Suspense>
      <StudentLoginScreen />
    </>
  );
}