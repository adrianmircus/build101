import { readPublicDbEnv } from "@/lib/server/db/env";
import { accessTokenOf, type World } from "./fixtures";

// The REST side of the matrix: no table of schema app is reachable through PostgREST for anyone.

export type Visitor = { name: string; bearer: string | null };
export type Probe = { status: number; code: string | null };

/** Every way to knock on the API: the publishable key alone, and the session of each logged-in role. */
export async function visitorsOf(world: World): Promise<Visitor[]> {
  const { school, sandbox, outsider } = world;
  const logged = {
    admin: school.admin,
    teacher_of_group: school.owner,
    teacher_other_group: school.otherTeacher,
    inclusion: school.inclusion,
    student: school.learner,
    other_student: school.peer,
    sandbox_anonymous: sandbox.owner,
    other_institution: outsider,
  };
  const visitors: Visitor[] = [{ name: "no_session", bearer: null }];
  for (const [name, who] of Object.entries(logged)) visitors.push({ name, bearer: await accessTokenOf(who) });
  return visitors;
}

/** GET /rest/v1/<table>, optionally asking for another schema with Accept-Profile. */
export async function probeTable(table: string, visitor: Visitor, profile: string | null): Promise<Probe> {
  const { url, publishableKey } = readPublicDbEnv();
  const headers: Record<string, string> = { apikey: publishableKey };
  if (visitor.bearer !== null) headers.Authorization = `Bearer ${visitor.bearer}`;
  if (profile !== null) headers["Accept-Profile"] = profile;
  const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers });
  const body: unknown = await response.json().catch(() => null);
  const code = typeof body === "object" && body !== null ? Reflect.get(body, "code") : null;
  return { status: response.status, code: typeof code === "string" ? code : null };
}
