"use server";

import { z } from "zod";
import { defineAction } from "@/lib/server/entry/defineAction";
import { signOut } from "@/lib/server/services/staff-auth";

// Sign out, from the header of the teacher and from the one of the student (T2.4).

export const signOutAction = defineAction({ name: "session.signOut", input: z.object({}).strict() }, async () => signOut());
