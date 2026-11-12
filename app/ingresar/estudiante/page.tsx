import type { Metadata } from "next";
import { StudentLoginScreen } from "@/components/auth/student/StudentLoginScreen";

export const metadata: Metadata = { title: "Entrá con tu tarjeta" };

// The three data of the card (school, username, password). The screen is a Client Component: the school
// remembered on the device lives in the browser, and nothing about the student is rendered on the server.
export default function StudentLogin() {
  return <StudentLoginScreen />;
}
