"use server";

import { headers } from "next/headers";
import { FindInstitutionInput, ReadAccessCardInput, SignInStudentInput } from "@/lib/domain/accounts/inputs";
import { clientIp } from "@/lib/server/auth/request";
import { defineAction } from "@/lib/server/entry/defineAction";
import { findInstitution, readAccessCard, signInStudent } from "@/lib/server/services/student-auth";

// Entries of the student login (T2.6a builds the screens over them; the services are T2.5b).

export const findInstitutionAction = defineAction({ name: "student.findInstitution", input: FindInstitutionInput }, async ({ code }) =>
  findInstitution({ code, ip: clientIp(await headers()) }),
);

export const signInStudentAction = defineAction({ name: "student.signIn", input: SignInStudentInput }, async ({ code, username, password }) =>
  signInStudent({ code, username, password, ip: clientIp(await headers()) }),
);

/** /t reads the token from the fragment and sends it here (a POST). The answer has the school and the username, never a name. */
export const readAccessCardAction = defineAction({ name: "student.readAccessCard", input: ReadAccessCardInput }, async ({ token }) =>
  readAccessCard({ token, ip: clientIp(await headers()) }),
);
