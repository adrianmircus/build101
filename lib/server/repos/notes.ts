import "server-only";
import type { Written } from "@/lib/domain/common";
import type { StudentNote } from "@/lib/domain/students/records";
import { callRpc, type RpcDb } from "./rpc";

// Private notes of the staff about a student. Only the staff of the group where the student is
// enrolled reads or writes them, and only the author edits or archives: the database says who, a
// repo only translates names and types. Reads are audited: wrap the client with withRequestId.

/** Newest first, archived ones included (`archivedAt` says so). */
export async function listStudentNotes(db: RpcDb, studentId: string): Promise<StudentNote[]> {
  const { items } = await callRpc(db, "list_student_notes", {
    p_student_id: studentId,
  });
  return items;
}

export type NewNote = {
  body: string;
  /** One per attempt, kept on a retry: the same key never writes the note twice. */
  opKey: string;
};

export async function createStudentNote(db: RpcDb, studentId: string, input: NewNote): Promise<Written> {
  return callRpc(db, "create_student_note", {
    p_student_id: studentId,
    p_body: input.body,
    p_op_key: input.opKey,
  });
}

/** `revision` is the one the caller read: a stale one is CONFLICT. */
export type NoteChanges = { revision: number; body: string };

export async function updateStudentNote(db: RpcDb, noteId: string, changes: NoteChanges): Promise<Written> {
  return callRpc(db, "update_student_note", {
    p_note_id: noteId,
    p_revision: changes.revision,
    p_body: changes.body,
  });
}

export async function archiveStudentNote(db: RpcDb, noteId: string, revision: number): Promise<Written> {
  return callRpc(db, "archive_student_note", {
    p_note_id: noteId,
    p_revision: revision,
  });
}
