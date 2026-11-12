import "server-only";
import type { StudentGrades, StudentHome, StudentTask, StudentTaskList } from "@/lib/domain/delivery/student-dto";
import { callRpc, type RpcDb } from "./rpc";

// The four reads of a student (T1.5d), through their own session. What they return is already what
// the student may see: each result passes the leak check of lib/domain/delivery/leaks.ts. A repo
// must not add fields to it.

export async function studentHome(db: RpcDb): Promise<StudentHome> {
  return callRpc(db, "student_home", {});
}

export async function studentTaskList(db: RpcDb): Promise<StudentTaskList> {
  return callRpc(db, "student_task_list", {});
}

export async function studentTask(db: RpcDb, attemptId: string): Promise<StudentTask> {
  return callRpc(db, "student_task", { p_attempt_id: attemptId });
}

export async function studentGrades(db: RpcDb): Promise<StudentGrades> {
  return callRpc(db, "student_grades", {});
}
