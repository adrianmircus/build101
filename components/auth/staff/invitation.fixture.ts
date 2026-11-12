import type { InvitationPublic } from "@/lib/domain/accounts/results";

/** A pending invitation for nobody in particular: tests spread it and change what they need. */
export const PENDING: InvitationPublic = {
  institutionName: "Colegio San José",
  role: "teacher",
  email: "ana.perez@sanjose.edu.uy",
  inviterName: "Marta Rodríguez",
  status: "pending",
  expiresAt: "2026-11-18T15:00:00Z",
  hasAccount: false,
  relation: "none",
};
