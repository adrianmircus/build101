"use server";

import { headers } from "next/headers";
import { RequestResetInput, SetNewPasswordInput, SignInStaffInput, VerifyRecoveryInput } from "@/lib/domain/accounts/inputs";
import { clientIp } from "@/lib/server/auth/request";
import { defineAction } from "@/lib/server/entry/defineAction";
import { publicOrigin } from "@/lib/server/request-origin";
import { requestPasswordReset, setNewPassword, signInStaff, verifyRecovery } from "@/lib/server/services/staff-auth";

// Entries of the staff login (T2.4 builds the screens over them; the services are T2.3).

export const signInStaffAction = defineAction({ name: "staff.signIn", input: SignInStaffInput }, async ({ email, password }) =>
  signInStaff({ email, password, ip: clientIp(await headers()) }),
);

export const requestResetAction = defineAction({ name: "staff.requestReset", input: RequestResetInput }, async ({ email }) =>
  requestPasswordReset({ email, ip: clientIp(await headers()), origin: publicOrigin() }),
);

/** The page of /ingresar/profesor/nueva reads the hash from the fragment and sends it here (a POST, never in a URL). */
export const verifyRecoveryAction = defineAction({ name: "staff.verifyRecovery", input: VerifyRecoveryInput }, async ({ tokenHash }) =>
  verifyRecovery({ tokenHash }),
);

export const setNewPasswordAction = defineAction({ name: "staff.setNewPassword", input: SetNewPasswordInput }, async ({ password }) =>
  setNewPassword({ password }),
);
