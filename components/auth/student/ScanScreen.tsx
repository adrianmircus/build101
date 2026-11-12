"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { canScan } from "./barcode";
import { CameraPanel } from "./CameraPanel";
import { CardProblem } from "./CardProblem";
import { FocusHeading } from "./FocusHeading";
import { NoCameraView } from "./NoCameraView";
import { PauseView } from "./PauseView";
import { readCard } from "./read-card";
import { ScanIntro } from "./ScanIntro";
import { tokenFromScan } from "./scan-token";
import { viewOfCard, type ScanView } from "./scan-view";
import { StudentLogin } from "./StudentLogin";
import { StudentShell } from "./StudentShell";
import { useRememberedSchool } from "./useRememberedSchool";

const noSubscription = () => () => {};
const unknownOnServer = () => null;

/** /ingresar/estudiante/escanear: the QR of the card fills school and username; the password is still typed. */
export function ScanScreen() {
  const supported = useSyncExternalStore(noSubscription, canScan, unknownOnServer);
  const remembered = useRememberedSchool();
  const [view, setView] = useState<ScanView>({ kind: "idle" });
  const [strange, setStrange] = useState(false);
  const reading = useRef(false);

  const onCode = useCallback((raw: string) => {
    const token = tokenFromScan(raw);
    if (!token) return setStrange(true);
    if (reading.current) return;
    reading.current = true;
    setView({ kind: "reading" });
    void readCard(token).then((outcome) => {
      reading.current = false;
      setView(viewOfCard(outcome, Date.now()));
    });
  }, []);

  const idle = () => setView({ kind: "idle" });
  return (
    <StudentShell help={view.kind !== "card"}>
      {view.kind === "idle" && (supported === false ? <NoCameraView denied={false} /> : <ScanIntro onOpen={() => setView({ kind: "camera" })} />)}
      {view.kind === "camera" && <CameraPanel onCode={onCode} onProblem={() => setView({ kind: "nocamera" })} onCancel={idle} strangeCode={strange} />}
      {view.kind === "reading" && (
        <div role="status">
          <FocusHeading id="leyendo-titulo">Leyendo tu tarjeta…</FocusHeading>
        </div>
      )}
      {view.kind === "nocamera" && <NoCameraView denied />}
      {view.kind === "problem" && <CardProblem why={view.why} onRetry={idle} />}
      {view.kind === "pause" && <PauseView retryAt={view.retryAt} at={view.at} onBack={idle} />}
      {view.kind === "card" && <StudentLogin remembered={remembered ?? null} card={view.card} />}
    </StudentShell>
  );
}
