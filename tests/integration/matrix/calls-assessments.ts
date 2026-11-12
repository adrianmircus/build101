import { randomUUID } from "node:crypto";
import { freshAssessment, revisionOf } from "./resources";
import type { CallsOf } from "./types";

// How to call the operations over assessments and their exercises (T1.4a).

type AssessmentRpc =
  | "create_assessment" | "update_assessment" | "archive_assessment" | "list_assessments" | "get_assessment"
  | "add_exercise" | "update_exercise" | "remove_exercise" | "reorder_exercises";

const TEXT = { p_kind: "worksheet", p_topic: "Repaso", p_general_instructions: "Instrucciones" };

export const ASSESSMENT_CALLS: CallsOf<AssessmentRpc> = {
  create_assessment: async (s) => ({ args: { p_group_id: s.groupId, ...TEXT, p_op_key: randomUUID() } }),
  update_assessment: async (s) => {
    const a = await freshAssessment(s);
    return { args: { p_assessment_id: a.id, p_revision: a.revision, ...TEXT, p_topic: "Otro tema" } };
  },
  archive_assessment: async (s) => {
    const a = await freshAssessment(s);
    return { args: { p_assessment_id: a.id, p_revision: a.revision } };
  },
  list_assessments: async (s) => ({ args: { p_group_id: s.groupId }, listing: true, target: (await freshAssessment(s)).id }),
  get_assessment: async (s) => ({ args: { p_assessment_id: (await freshAssessment(s)).id } }),
  add_exercise: async (s) => ({ args: { p_assessment_id: (await freshAssessment(s)).id, p_label: "9", p_body: "Enunciado", p_op_key: randomUUID() } }),
  update_exercise: async (s) => {
    const a = await freshAssessment(s, 1);
    const [id] = a.exerciseIds;
    if (id === undefined) throw new Error("Falta el ejercicio de prueba.");
    const revision = await revisionOf("assessment_exercises", id);
    return { args: { p_exercise_id: id, p_revision: revision, p_label: "1", p_body: "Enunciado cambiado" } };
  },
  remove_exercise: async (s) => {
    const a = await freshAssessment(s, 2);
    const [id] = a.exerciseIds;
    if (id === undefined) throw new Error("Falta el ejercicio de prueba.");
    return { args: { p_exercise_id: id, p_revision: await revisionOf("assessment_exercises", id) } };
  },
  reorder_exercises: async (s) => {
    const a = await freshAssessment(s, 2);
    return { args: { p_assessment_id: a.id, p_revision: await revisionOf("assessments", a.id), p_exercise_ids: [...a.exerciseIds].reverse() } };
  },
};
