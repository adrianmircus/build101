"use client";

import { useEffect, useRef, useState } from "react";
import { FocusHeading } from "./FocusHeading";
import { NeutralMessage } from "./NeutralMessage";
import { supersedeLogins } from "./login-guard";
import { PauseView } from "./PauseView";
import { readCard, type CardOutcome } from "./read-card";
import { viewOfCard, type ScanView } from "./scan-view";
import { StudentLogin } from "./StudentLogin";
import { StudentShell } from "./StudentShell";
import { useRememberedSchool } from "./useRememberedSchool";

const TOKEN_IN_HASH = /^#([A-Za-z0-9_-]{43})$/;

/** The token of the card is in the fragment: the browser never sends it to the server. It leaves the address bar at once. */
function takeTokenFromAddress(): string | null {
  const token = TOKEN_IN_HASH.exec(location.hash)?.[1] ?? null;
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  return token;
}

/** Is the fragment a card (and not an internal anchor like #main-content)? */
function hashIsCard(): boolean {
  return TOKEN_IN_HASH.test(location.hash);
}

const UNUSABLE: CardOutcome = { kind: "unusable" };

/** /t#<token>: what the phone's camera opens when it reads the card. Same login, school and username already in. */
export function CardLanding() {
  const remembered = useRememberedSchool();
  const [view, setView] = useState<ScanView>({ kind: "reading" });
  const started = useRef(false);
  // Which card is the one on screen. A new card (another QR in this same tab) takes a new number and every answer of the old ones is dropped.
  const [generation, setGeneration] = useState(0);
  const latest = useRef(0);

  function open(token: string | null) {
    latest.current += 1;
    const mine = latest.current;
    setGeneration(mine);
    setView({ kind: "reading" });
    // A login of the card before this one may still be in the air: it is marked old and the new card waits until that one is over
    // (and closed, if it did sign in). Without a login in flight this is immediate.
    void supersedeLogins()
      .then(() => (token ? readCard(token) : UNUSABLE))
      .then((outcome) => {
        if (latest.current === mine) setView(viewOfCard(outcome, Date.now()));
      });
  }

  useEffect(() => {
    if (started.current) return; // in development effects run twice, and the fragment is already gone
    started.current = true;
    open(takeTokenFromAddress());
  }, []);

  // Another QR opened in this same tab changes only the fragment: the page does not load again, so it is read here.
  useEffect(() => {
    const onHashChange = () => {
      if (hashIsCard()) open(takeTokenFromAddress());
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const toLogin = () => setView({ kind: "idle" });
  const login = <StudentLogin remembered={remembered ?? null} />;
  return (
    <StudentShell help={view.kind !== "card"}>
      {view.kind === "reading" && (
        <div role="status">
          <FocusHeading id="leyendo-titulo">Leyendo tu tarjeta…</FocusHeading>
        </div>
      )}
      {view.kind === "card" && <StudentLogin key={generation} remembered={remembered ?? null} card={view.card} />}
      {view.kind === "pause" && <PauseView retryAt={view.retryAt} at={view.at} onBack={toLogin} />}
      {view.kind === "problem" && (
        <div className="grid gap-7">
          <NeutralMessage>
            {view.why === "unusable" ? (
              <p>
                <strong>No pudimos usar esta tarjeta.</strong> Puede que sea una tarjeta vieja: si tu profe te dio una nueva, usá esa. Mientras tanto,
                escribí acá los datos que están en la tarjeta.
              </p>
            ) : (
              <p>
                <strong>No pudimos conectarnos.</strong> No hiciste nada mal. Podés escribir los datos de la tarjeta acá, o probar de nuevo en un ratito.
              </p>
            )}
          </NeutralMessage>
          {login}
        </div>
      )}
      {view.kind === "idle" && login}
    </StudentShell>
  );
}
