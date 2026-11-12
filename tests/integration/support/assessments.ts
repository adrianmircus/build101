import { randomUUID } from "node:crypto";
import { runRpc } from "./db";
import { idOf } from "./session";
import { createWorld, teacherOf, type World } from "./world";

// The original of an assessment for the race tests of T1.4a and T1.F3: made through the RPCs and
// committed, with placeholder text only.

export type Original = { world: World; assessmentId: string; exercises: string[] };

export async function original(count: number): Promise<Original> {
  const world = await createWorld();
  const created = await runRpc(teacherOf(world), "create_assessment", {
    p_group_id: world.groupId,
    p_kind: "worksheet",
    p_topic: "Repaso",
    p_general_instructions: "Instrucciones",
    p_op_key: randomUUID(),
  });
  const assessmentId = idOf(created);
  const exercises: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const added = await runRpc(teacherOf(world), "add_exercise", {
      p_assessment_id: assessmentId,
      p_label: String(index + 1),
      p_body: `Enunciado ${index + 1}`,
      p_op_key: randomUUID(),
      p_topic_id: null,
    });
    exercises.push(idOf(added));
  }
  return { world, assessmentId, exercises };
}

/** The exercises as a tuple the test can destructure without an undefined. */
export function pick(o: Original, count: 1): [string];
export function pick(o: Original, count: 2): [string, string];
export function pick(o: Original, count: 3): [string, string, string];
export function pick(o: Original, count: number): string[] {
  const found = o.exercises.slice(0, count);
  if (found.length !== count) throw new Error("Faltan ejercicios.");
  return found;
}
