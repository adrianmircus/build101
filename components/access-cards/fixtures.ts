import type { AccessCard, AccountRow } from "@/lib/domain/accounts/entities";
import { initialState, type State } from "./cards-state";

// Data for the tests of the cards page. Names and passwords are made up.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const ACCOUNTS: AccountRow[] = [
  { studentId: id(1), displayName: "Lucía Fernández", username: "luciaf", accountStatus: "active", hasSignedIn: true, lastCardAt: "2026-11-03T13:00:00+00:00" },
  { studentId: id(2), displayName: "Mateo Silva", username: "mateos", accountStatus: "pending", hasSignedIn: false, lastCardAt: null },
  { studentId: id(3), displayName: "Valentina Rodríguez", username: "valentinar", accountStatus: "failed", hasSignedIn: false, lastCardAt: null },
  { studentId: id(4), displayName: "Joaquín Martínez", username: "joaquinm", accountStatus: "active", hasSignedIn: true, lastCardAt: "2026-11-03T13:00:00+00:00" },
  { studentId: id(5), displayName: "Sofía González", username: "sofiag", accountStatus: "active", hasSignedIn: false, lastCardAt: "2026-11-03T13:00:00+00:00" },
];

export const PASSWORDS = ["nube-tigre-47", "rio-gato-25", "sol-pera-83", "faro-oso-36", "luna-mate-12"];
export const TOKEN = "Zk3_9aQ-0123456789012345678901234567890123";

export function cardFor(row: AccountRow, index: number): AccessCard {
  return {
    studentId: row.studentId,
    displayName: row.displayName,
    username: row.username,
    institutionCode: "sanjose",
    institutionName: "Colegio San José",
    password: PASSWORDS[index]!,
    qrUrl: `https://tiza.ai/t#${TOKEN}`,
  };
}

export function stateWith(patch: Partial<State> = {}): State {
  return { ...initialState(ACCOUNTS), ...patch };
}

export const noop = () => {};
