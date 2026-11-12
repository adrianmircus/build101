"use client";

import { useEffect, useRef, useState } from "react";
import { forgetSchool, type RememberedSchool } from "@/lib/client/remembered-school";
import { PauseView } from "./PauseView";
import { StudentLoginForm } from "./StudentLoginForm";
import { useStudentLogin } from "./useStudentLogin";

type Props = {
  /** The school remembered on this device, if any. */
  remembered: RememberedSchool | null;
  /** A scanned or opened card: school and username come filled and only the password is left. */
  card?: { code: string; name: string; username: string } | null;
};

/** The login of the student: the three data of the card, or two with the school remembered, or one with a card. */
export function StudentLogin({ remembered, card: initialCard = null }: Props) {
  const [card, setCard] = useState(initialCard);
  const school = card ? { code: card.code, name: card.name } : remembered;
  const login = useStudentLogin({ school, username: card?.username ?? "" });
  const passwordRef = useRef<HTMLInputElement>(null);
  const { pause } = login.state;

  useEffect(() => {
    if (initialCard) passwordRef.current?.focus();
  }, [initialCard]);

  if (pause) return <PauseView retryAt={pause.retryAt} at={pause.at} onBack={login.resume} />;
  return (
    <StudentLoginForm
      login={login}
      school={school}
      fromCard={card !== null}
      passwordRef={passwordRef}
      onChangeSchool={() => {
        login.edit("code", "");
        forgetSchool();
      }}
      onNotMe={() => {
        login.edit("username", "");
        setCard(null);
      }}
    />
  );
}
