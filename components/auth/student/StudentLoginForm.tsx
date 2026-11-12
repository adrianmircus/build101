import type { Ref } from "react";
import type { Field, Notice } from "./failure-view";
import { IdentityFields } from "./IdentityFields";
import { NeutralMessage } from "./NeutralMessage";
import { NoticeBody } from "./NoticeBody";
import { PasswordField } from "./PasswordField";
import { MissingNotice } from "./MissingNotice";
import { SubmitRow } from "./SubmitRow";
import type { StudentLoginController } from "./useStudentLogin";

export type KnownSchool = { name: string } | null;

type Props = {
  login: StudentLoginController;
  /** The school already known, with the username when it comes from a scanned card. */
  school: KnownSchool;
  fromCard: boolean;
  onChangeSchool: () => void;
  onNotMe: () => void;
  passwordRef?: Ref<HTMLInputElement>;
};

const LEAD = {
  card: "Escribí la contraseña que está en la tarjeta.",
  school: "Copiá tu usuario y tu contraseña.",
  full: "Copiá los tres datos tal como están en la tarjeta.",
} as const;

function leadKey(fromCard: boolean, school: KnownSchool): keyof typeof LEAD {
  if (fromCard) return "card";
  return school ? "school" : "full";
}

/** A missing data goes next to its field; any other notice goes under the form. */
function splitNotice(notice: Notice | null): { missing: Field | null; general: Notice | null } {
  if (notice?.kind === "missing") return { missing: notice.field, general: null };
  return { missing: null, general: notice };
}

/** The three data of the card, in the order of the card: school, username, password. With the school known, two. */
export function StudentLoginForm({ login, school, fromCard, onChangeSchool, onNotMe, passwordRef }: Props) {
  const { state } = login;
  const { missing, general } = splitNotice(state.notice);
  return (
    <section aria-labelledby="ingreso-titulo">
      <h1 id="ingreso-titulo" className="text-3xl font-bold">
        {fromCard ? "Leímos tu tarjeta" : "Entrá con tu tarjeta"}
      </h1>
      <p className="mt-2 mb-7 text-lg text-slate-700">{LEAD[leadKey(fromCard, school)]}</p>
      <form onSubmit={login.submit} noValidate className="grid gap-6" aria-busy={state.busy}>
        <IdentityFields login={login} school={school} fromCard={fromCard} missing={missing} general={general !== null} onChangeSchool={onChangeSchool} onNotMe={onNotMe} />
        <PasswordField
          value={state.password}
          reveal={state.reveal}
          onChange={(e) => login.edit("password", e.target.value)}
          onToggle={login.toggleReveal}
          describedBy={missing === "password" ? "contrasena-falta" : general ? "aviso-ingreso" : undefined}
          inputRef={passwordRef}
        >
          {missing === "password" && <MissingNotice id="contrasena-falta" field="password" />}
        </PasswordField>
        {general && (
          <NeutralMessage key={state.noticeKey} id="aviso-ingreso">
            <NoticeBody notice={general} withCard={fromCard} />
          </NeutralMessage>
        )}
        <SubmitRow busy={state.busy} tryAgain={general?.kind === "wrong"} fromCard={fromCard} />
      </form>
    </section>
  );
}
