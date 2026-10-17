import "server-only";
import { seed } from "@/lib/groups/seed";
import type { Role } from "./signing";

// Demo accounts. Plain-text passwords because the login is simulated: don't do this in production.
// Students come from lib/groups/seed.ts; no profile is stored or returned here.
const ACCOUNTS: { username: string; password: string; role: Role; id: string }[] = [
  { username: "profe", password: "demo123", role: "teacher", id: "teacher" },
  { username: "ana", password: "demo123", role: "student", id: "6a-s1" },
  { username: "bruno", password: "demo123", role: "student", id: "6a-s2" },
  { username: "camila", password: "demo123", role: "student", id: "6a-s3" },
  { username: "facundo", password: "demo123", role: "student", id: "6a-s6" },
  { username: "belen", password: "demo123", role: "student", id: "6b-s2" },
];

export function findAccount(username: string, password: string, role: Role) {
  const account = ACCOUNTS.find((a) => a.username === username.trim().toLowerCase() && a.role === role);
  return account && account.password === password ? { id: account.id, role: account.role } : null;
}

export type PublicStudent = { id: string; name: string; groupId: string; groupName: string };

// The only thing a student sees about themselves: name and group. Never the profile.
export function getStudent(id: string): PublicStudent | null {
  for (const group of seed().groups) {
    const student = group.students.find((s) => s.id === id);
    if (student) return { id, name: student.name, groupId: group.id, groupName: group.name };
  }
  return null;
}
