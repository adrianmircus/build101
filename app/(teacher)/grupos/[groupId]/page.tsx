import { Suspense } from "react";
import { GroupDetail } from "@/components/groups/GroupDetail";
import { Loading } from "@/components/ui/States";
import { PageTransition } from "@/components/ui/transitions";

export default function GroupPage() {
  return (
    <PageTransition>
      <Suspense fallback={<Loading />}>
        <GroupDetail />
      </Suspense>
    </PageTransition>
  );
}
