import type { Metadata } from "next";
import { ScanScreen } from "@/components/auth/student/ScanScreen";

export const metadata: Metadata = { title: "Escanear mi tarjeta" };

export default function ScanCardPage() {
  return <ScanScreen />;
}
