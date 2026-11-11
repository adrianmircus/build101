#!/usr/bin/env node
// T0.6 gate measurement. Usage:
//   node scripts/gate/run-gate.mjs --base <url> --token <t> [--seconds 48] [--cold]
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    token: { type: "string" },
    seconds: { type: "string", default: "48" },
    cold: { type: "boolean", default: false },
  },
});
if (!values.base || !values.token) {
  console.error("Uso: node scripts/gate/run-gate.mjs --base <url> --token <t> [--seconds 48] [--cold]");
  process.exit(1);
}
const base = values.base.replace(/\/$/, "");
const seconds = Number(values.seconds);
const headers = { "x-gate-token": values.token };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (form, id) => `${base}/gate-netlify/${form}?id=${id}&caller=server&seconds=${seconds}`;

// Fire the request like pg_net would: after A's 202 (or 2 s into B) the connection is dropped.
async function launch(form) {
  const id = randomUUID();
  const ctrl = new AbortController();
  let httpStatus = "error";
  try {
    const res = await fetch(url(form, id), { method: "POST", headers, signal: ctrl.signal });
    httpStatus = res.status;
    if (form === "after") ctrl.abort();
    else {
      await sleep(2000);
      ctrl.abort();
    }
  } catch (e) {
    if (e.name !== "AbortError") httpStatus = String(e.cause?.code ?? e.message);
  }
  return { id, httpStatus };
}

async function status(id) {
  const res = await fetch(`${base}/gate-netlify/status?id=${id}`, { headers });
  return res.ok ? res.json() : { found: false, error: res.status };
}

async function measure(form, temperature) {
  const { id, httpStatus } = await launch(form);
  await sleep((seconds + 15) * 1000);
  const s = await status(id);
  const r = s.record;
  const done = Boolean(r);
  return {
    forma: form === "after" ? "A (after)" : "B (stream)",
    temperatura: temperature,
    llamada: "servidor",
    http: httpStatus,
    "terminó": done ? "sí" : "no",
    "duración (s)": done ? ((Date.parse(r.workEndedAt) - Date.parse(r.workStartedAt)) / 1000).toFixed(1) : "-",
    "demora de escritura (s)": done ? ((Date.parse(r.writtenAt) - Date.parse(r.workEndedAt)) / 1000).toFixed(2) : "-",
    "instancia fría": done ? (r.cold ? "sí" : "no") : "?",
    store: s.store ?? "?",
  };
}

const rows = [];
for (const form of ["after", "stream"]) rows.push(await measure(form, "caliente"));
if (values.cold) {
  for (const form of ["after", "stream"]) {
    console.error("Esperando 15 minutos sin pedidos para medir en frío...");
    await sleep(15 * 60 * 1000);
    rows.push(await measure(form, "frío"));
  }
}
console.table(rows);
