import { Suspense } from "react";
import { GroupDetail } from "@/components/groups/GroupDetail";
import { Loading } from "@/components/ui/States";

export default function GroupPage() {
  return (
    <Suspense fallback={<Loading />}>
      <GroupDetail />
    </Suspense>
  );
}
