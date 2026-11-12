import {
  loginGate,
  CLEANED_FLAG,
  type LoginArea,
} from "@/lib/server/auth/login-gate";

export type LoginSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

// What a login does with someone who already has a session: it goes home only if the database recognizes the session
// (F2-5; proxy.ts no longer decides it by the claims). It renders nothing: the login below is the page. Always inside a
// <Suspense>, because it reads the session.
export async function LoginGate({
  area,
  searchParams,
}: Readonly<{ area: LoginArea; searchParams: LoginSearchParams }>) {
  await loginGate(area, {
    cleaned: (await searchParams)[CLEANED_FLAG] === "1",
  });
  return null;
}
