import "server-only";
import type { AttemptForGrading, AttemptRow } from "@/lib/domain/delivery/rpc";
import type { z } from "zod";
import type { ExerciseResult } from "@/lib/domain/delivery/entities";
import { callRpc, type RpcDb } from "./rpc";

// What the teacher sees to correct (T1.5c). The list shows no adapted content and no version;
// getAttemptForGrading is audited (the adapted content can reveal the adaptation): wrap the client
// with withRequestId.

/** Without content: it leaves no audit row. */
export async function listAssessmentAttempts(db: RpcDb, assessmentId: string): Promise<AttemptRow[]> {
  const { items } = await callRpc(db, "list_assessment_attempts", { p_assessment_id: assessmentId });
  return items;
}

export async function getAttemptForGrading(db: RpcDb, attemptId: string): Promise<AttemptForGrading> {
  return callRpc(db, "get_attempt_for_grading", { p_attempt_id: attemptId });
}

export type GradeInput = {
  feedback: string;
  /** By exercise id. */
  exerciseResults: Record<string, z.infer<typeof ExerciseResult>>;
  score?: number;
  /** The grade revision the teacher read; absent for the first grade. A stale one is CONFLICT. */
  revision?: number;
};

export async function gradeAttempt(db: RpcDb, attemptId: string, input: GradeInput): Promise<{ attemptId: string; revision: number }> {
  return callRpc(db, "grade_attempt", {
    p_attempt_id: attemptId,
    p_feedback: input.feedback,
    p_exercise_results: input.exerciseResults,
    p_score: input.score,
    p_revision: input.revision,
  });
}
