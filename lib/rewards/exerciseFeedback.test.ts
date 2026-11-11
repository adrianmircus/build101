// Pruebas sin IA de las caras por ejercicio que ve el estudiante: dos estados, nunca «Mal» ni solo color.
import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExerciseFeedback } from "@/components/student/ExerciseFeedback";
import { OUTCOMES, outcomeOf } from "@/lib/rewards/exerciseFeedback";
import type { ExerciseStatus } from "@/lib/groups/types";

const html = (props: Parameters<typeof ExerciseFeedback>[0]) => renderToStaticMarkup(createElement(ExerciseFeedback, props));

const statuses: ExerciseStatus[] = ["correct", "partial", "wrong", "blank"];
it("caras: cada estado de la corrección", () => {
  expect(statuses.map(outcomeOf)).toEqual(["correct", "notYet", "notYet", "notYet"]);
});

const labels = Object.values(OUTCOMES).map((o) => o.label);
it("caras: los textos no retan", () => {
  expect(labels.filter((l) => /\bmal\b|incorrect|error|equivoc/i.test(l))).toEqual([]);
});
it("caras: cada estado con su forma", () => {
  expect(new Set(Object.values(OUTCOMES).map((o) => o.shape)).size).toEqual(2);
});
it("caras: el error no es rojo", () => {
  expect(Object.values(OUTCOMES).filter((o) => /red|rose/.test(o.box + o.ink)).length).toEqual(0);
});

const wrong = html({ status: "wrong", exerciseNumber: 2 });
it("render: muestra el texto", () => {
  expect(wrong.includes(OUTCOMES.notYet.label)).toEqual(true);
});
it("render: muestra el número", () => {
  expect(wrong.includes("Ejercicio 2")).toEqual(true);
});
it("render: la cara es decorativa", () => {
  expect(wrong.includes('aria-hidden="true"')).toEqual(true);
});
it("render: sin role status por defecto", () => {
  expect(wrong.includes('role="status"')).toEqual(false);
});
it("render: con live se anuncia", () => {
  expect(html({ status: "correct", live: true }).includes('role="status"')).toEqual(true);
});
it("render: forma distinta según el resultado", () => {
  expect([html({ status: "correct" }), wrong].map((h) => h.match(/data-shape="(\w+)"/)?.[1])).toEqual(["circle", "square"]);
});
it("render: la acción aparece", () => {
  expect(html({ status: "partial", action: createElement("button", { type: "button" }, "Ver pista") }).includes("Ver pista")).toEqual(true);
});
