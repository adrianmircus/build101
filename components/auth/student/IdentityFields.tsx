import type { Field } from "./failure-view";
import { MissingNotice } from "./MissingNotice";
import { SchoolCodeField } from "./SchoolCodeField";
import { SchoolSummary } from "./SchoolSummary";
import { StudentField } from "./StudentField";
import type { KnownSchool } from "./StudentLoginForm";
import type { StudentLoginController } from "./useStudentLogin";

type Props = {
  login: StudentLoginController;
  school: KnownSchool;
  fromCard: boolean;
  missing: Field | null;
  /** A general notice is under the form: the fields point to it. */
  general: boolean;
  onChangeSchool: () => void;
  onNotMe: () => void;
};

/** School and username. Known school: a summary with «Cambiar». Scanned card: the username goes along, hidden, for the password manager. */
export function IdentityFields({ login, school, fromCard, missing, general, onChangeSchool, onNotMe }: Props) {
  const { state } = login;
  return (
    <>
      {school ? (
        <SchoolSummary
          name={school.name}
          caption={fromCard ? `Usuario ${state.username}` : "Recordado en este dispositivo"}
          actionLabel={fromCard ? "No soy yo" : "Cambiar"}
          actionHint={fromCard ? "(escribir otros datos)" : "de colegio"}
          onAction={fromCard ? onNotMe : onChangeSchool}
        />
      ) : (
        <SchoolCodeField value={state.code} onChange={(e) => login.edit("code", e.target.value)} onBlur={login.lookup.lookupNow} lookup={login.lookup.state} missing={missing === "code"} />
      )}
      {fromCard ? (
        <input type="text" name="username" autoComplete="username" value={state.username} readOnly tabIndex={-1} aria-hidden="true" className="sr-only" />
      ) : (
        <StudentField
          id="usuario"
          label="Usuario"
          value={state.username}
          autoComplete="username"
          onChange={(e) => login.edit("username", e.target.value)}
          describedBy={missing === "username" ? "usuario-falta" : general ? "aviso-ingreso" : undefined}
        >
          {missing === "username" && <MissingNotice id="usuario-falta" field="username" />}
        </StudentField>
      )}
    </>
  );
}
