import type { Metadata } from "next";
import { GroupsPanel } from "@/components/groups/GroupsPanel";
import { PageTransition } from "@/components/ui/transitions";

export const metadata: Metadata = { title: "Mis grupos", description: "Tus grupos y los perfiles de aprendizaje de cada estudiante." };

export default function GroupsPage() {
  return (
    <PageTransition>
      <GroupsPanel />
    </PageTransition>
  );
}
