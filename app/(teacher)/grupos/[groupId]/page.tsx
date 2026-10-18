import type { Metadata } from "next";
import { Suspense } from "react";
import { GroupDetail } from "@/components/groups/GroupDetail";
import { Loading } from "@/components/ui/States";
import { PageTransition } from "@/components/ui/transitions";

export const metadata: Metadata = { title: "Grupo", description: "Los estudiantes del grupo, sus perfiles y sus prácticos." };

export default function GroupPage() {
  return (
    <PageTransition>
      <Suspense fallback={<Loading />}>
        <GroupDetail />
      </Suspense>
    </PageTransition>
  );
}
