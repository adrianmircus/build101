"use server";

import { IssueAccessCardsInput } from "@/lib/domain/accounts/inputs";
import { defineAction } from "@/lib/server/entry/defineAction";
import { publicOrigin } from "@/lib/server/request-origin";
import { issueAccessCards } from "@/lib/server/services/student-accounts";

// Printing the cards (T2.6b builds the screen; the service is T2.5b). The answer carries the passwords:
// it is shown only in the print container, never cached and never logged.

export const issueAccessCardsAction = defineAction({ name: "cards.issue", input: IssueAccessCardsInput }, async ({ groupId, studentIds, opKey }) =>
  issueAccessCards({ groupId, studentIds, opKey, origin: publicOrigin() }),
);
