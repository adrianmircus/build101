"use client";

import { useEffect, useRef, useState } from "react";
import { FocusHeading } from "./FocusHeading";
import { NeutralMessage } from "./NeutralMessage";
import { closePreviousSession } from "./login-attempt";
import { hasUnclosed, supersedeLogins } from "./login-guard";
import { primary } from "./field-styles";
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
  const [pendingClose, setPendingClose] = useState<{ token: string | null; mine: number; busy: boolean } | null>(null);

  function open(token: string | null) {
    latest.current += 1;
    const mine = latest.current;
    setGeneration(mine);
    setView({ kind: "reading" });
    // A login of the card before this one may still be in the air: it is marked old and the new card waits until that one is over
    // (and closed, if it did sign in). Without a login in flight this is immediate.
    void supersedeLogins().then(() => proceed(token, mine));
  }

  // The new card shows only when no session of an old card is left open. If closing it failed, it says so and offers to try again.
  function proceed(token: string | null, mine: number) {
    if (latest.current !== mine) return;
    if (hasUnclosed()) {
      setPendingClose({ token, mine, busy: false });
      return;
    }
    setPendingClose(null);
    void (token ? readCard(token) : Promise.resolve(UNUSABLE)).then((outcome) => {
      if (latest.current === mine) setView(viewOfCard(outcome, Date.now()));
    });
  }

  async function retryClose() {
    if (!pendingClose) return;
    const { token, mine } = pendingClose;
    setPendingClose({ token, mine, busy: true });
    await closePreviousSession();
    proceed(token, mine);
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
  return (
    <StudentShell help={view.kind !== "card"}>
      {pendingClose ? (
        <CloseFailed busy={pendingClose.busy} onRetry={() => void retryClose()} />
      ) : (
        <CardBody view={view} generation={generation} remembered={remembered ?? null} onBack={toLogin} />
      )}
    </StudentShell>
  );
}

/** The session of the card before could not be closed: nothing else shows until it is, and the way forward is one button. */
function CloseFailed({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  return (
    <div className="grid gap-5" role="alert">
      <NeutralMessage>
        <p>
          <strong>No pudimos cerrar la sesión anterior.</strong> Probá de nuevo.
        </p>
      </NeutralMessage>
      <button type="button" onClick={onRetry} disabled={busy} className={primary}>
        {busy ? "Probando…" : "Probar de nuevo"}
      </button>
    </div>
  );
}

type BodyProps = { view: ScanView; generation: number; remembered: ReturnType<typeof useRememberedSchool>; onBack: () => void };

function CardBody({ view, generation, remembered, onBack }: BodyProps) {
  const login = <StudentLogin remembered={remembered ?? null} />;
  if (view.kind === "reading") {
    return (
      <div role="status">
        <FocusHeading id="leyendo-titulo">Leyendo tu tarjeta…</FocusHeading>
      </div>
    );
  }
  if (view.kind === "card") return <StudentLogin key={generation} remembered={remembered ?? null} card={view.card} />;
  if (view.kind === "pause") return <PauseView retryAt={view.retryAt} at={view.at} onBack={onBack} />;
  if (view.kind === "idle") return login;
  if (view.kind !== "problem") return null;
  return (
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
  );
}
