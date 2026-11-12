import Link from "next/link";
import { inlineLink } from "@/components/ui/styles";
import { ErrorSummary } from "./ErrorSummary";
import { summaryTitle } from "./passwordRules";
import { StatusMessage } from "./StatusMessage";
import type { InviteNotice as Notice } from "./useInviteSubmit";

// What an invitation form says after a failed try, above its button. The message takes the focus.
export function InviteNotice({ notice }: { notice: Notice | null }) {
  if (notice === null) return null;
  if (notice.problems.length > 0) return <ErrorSummary key={notice.attempt} title={summaryTitle(notice.problems.length)} problems={notice.problems} />;
  if (notice.wrongPassword) {
    return (
      <StatusMessage key={notice.attempt} tone="error">
        <p>
          <strong>La contraseña no coincide.</strong> Revisala o{" "}
          <Link href="/ingresar/profesor/olvide" className={inlineLink}>
            creá una contraseña nueva
          </Link>
          .
        </p>
      </StatusMessage>
    );
  }
  if (notice.text === null) return null;
  return (
    <StatusMessage key={notice.attempt} tone="neutral">
      <p>{notice.text}</p>
    </StatusMessage>
  );
}
