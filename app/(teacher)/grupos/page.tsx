import { GroupsPanel } from "@/components/groups/GroupsPanel";
import { PageTransition } from "@/components/ui/transitions";

export default function GroupsPage() {
  return (
    <PageTransition>
      <GroupsPanel />
    </PageTransition>
  );
}
