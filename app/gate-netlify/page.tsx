"use client";

import { useEffect, useRef, useState } from "react";

type Form = "after" | "stream";

export default function GatePage() {
  const [token, setToken] = useState("");
  const [seconds, setSeconds] = useState(48);
  const [id, setId] = useState<string | null>(null);
  const [message, setMessage] = useState("Todavía no lanzaste nada.");
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  async function launch(form: Form) {
    const newId = crypto.randomUUID();
    setId(newId);
    setMessage(`Lanzando la forma ${form === "after" ? "A (after)" : "B (stream)"}...`);
    const url = `/gate-netlify/${form}?id=${newId}&caller=browser&seconds=${seconds}`;
    try {
      const res = await fetch(url, { method: "POST", headers: { "x-gate-token": token } });
      setMessage(`El servidor respondió ${res.status}. Esperando el resultado...`);
      if (form === "stream") await res.text();
    } catch {
      setMessage("Se cortó la conexión. Seguimos consultando el estado.");
    }
  }

  useEffect(() => {
    if (!id) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/gate-netlify/status?id=${id}`, { headers: { "x-gate-token": tokenRef.current } });
        if (!res.ok) return setMessage(`El estado respondió ${res.status}.`);
        const data = (await res.json()) as { found: boolean; store: string; record: unknown };
        setMessage(
          data.found
            ? `Terminó. Almacén: ${data.store}. ${JSON.stringify(data.record)}`
            : `Todavía sin resultado (almacén: ${data.store}).`,
        );
      } catch {
        setMessage("No pude consultar el estado.");
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [id]);

  return (
    <main style={{ maxWidth: 640, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Compuerta de Netlify (prueba temporal)</h1>
      <p>
        <label htmlFor="gate-token">Token de la prueba</label>
        <br />
        <input id="gate-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
      </p>
      <p>
        <label htmlFor="gate-seconds">Segundos de trabajo (1 a 55)</label>
        <br />
        <input id="gate-seconds" type="number" min={1} max={55} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} />
      </p>
      <p>
        <button type="button" onClick={() => launch("after")}>Lanzar A (202 y after)</button>{" "}
        <button type="button" onClick={() => launch("stream")}>Lanzar B (stream)</button>
      </p>
      <p>Id del pedido: {id ?? "ninguno"}</p>
      <p role="status" aria-live="polite">{message}</p>
    </main>
  );
}
