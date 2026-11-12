import { randomUUID } from "node:crypto";
import { recordConsent } from "@/lib/server/repos/consents";
import { publishVersion } from "@/lib/server/repos/publications";
import { editAnswerKey } from "@/lib/server/repos/answer-keys";
import { approveVersion, setQuestionKey, updateVersionExercise } from "@/lib/server/repos/version-content";
import { getVersion, setVersionRecipients } from "@/lib/server/repos/versions";
import { studentTaskList } from "@/lib/server/repos/student";
import { createGroup, createSchool, type School } from "../factories";
import { createTestAssessment, createTestVersion } from "../factories/assessments";
import { createGazeContent, keyContentOf } from "../factories/generations";
import { createLoggedInStudent, createStudent, type LoggedInStudent } from "../factories/students";

// A class for the delivery tests (T1.7c): a group, and students with an account, each with a
// version published through the repos (typed text, or gaze with questions and a key). Placeholder text only.

export type Published = {
  student: LoggedInStudent;
  assessmentId: string;
  versionId: string;
  publicationId: string;
  /** What publish_version received and answered: repeating it must give the same. */
  publish: { input: { revision: number; opKey: string }; attempts: number };
  assignmentId: string;
  attemptId: string;
  exerciseIds: string[];
};

export type Classroom = School & { groupId: string };

export async function classroom(): Promise<Classroom> {
  const school = await createSchool();
  const group = await createGroup(school.teacher.client, school.institution.id);
  return { ...school, groupId: group.id };
}

async function revisionOf(school: School, versionId: string): Promise<number> {
  return (await getVersion(school.teacher.client, versionId)).version.revision;
}

/** Recipients, approval and publication of a ready version; returns the publication and what the student sees. */
async function finish(room: Classroom, student: LoggedInStudent, ids: { assessmentId: string; versionId: string }) {
  const teacher = room.teacher.client;
  const recipients = { studentIds: [student.id], opId: randomUUID() };
  await setVersionRecipients(teacher, ids.versionId, { ...recipients, revision: await revisionOf(room, ids.versionId) });
  await approveVersion(teacher, ids.versionId, { revision: await revisionOf(room, ids.versionId), opId: randomUUID() });
  const input = { revision: await revisionOf(room, ids.versionId), opKey: randomUUID() };
  const publication = await publishVersion(teacher, ids.versionId, input);
  const [task] = (await studentTaskList(student.client)).tasks.slice(-1);
  if (task === undefined) throw new Error("El estudiante no recibió la tarea.");
  return { publicationId: publication.publicationId, publish: { input, attempts: publication.attempts }, assignmentId: task.assignmentId, attemptId: task.attemptId };
}

async function newStudent(room: Classroom): Promise<LoggedInStudent> {
  return createLoggedInStudent(room.admin, await createStudent(room.teacher.client, room.groupId));
}

/** A typed version with one exercise, published to a new student. */
export async function publishTyped(room: Classroom): Promise<Published> {
  const teacher = room.teacher.client;
  const student = await newStudent(room);
  const assessment = await createTestAssessment(teacher, room.groupId, 1);
  const version = await createTestVersion(teacher, assessment.id);
  const detail = await getVersion(teacher, version.id);
  const exerciseIds = detail.exercises.map((exercise) => exercise.id);
  for (const exercise of detail.exercises) {
    await updateVersionExercise(teacher, exercise.id, { revision: exercise.revision, body: "Ejercicio adaptado", opId: randomUUID() });
  }
  const ids = { assessmentId: assessment.id, versionId: version.id };
  return { student, ...ids, exerciseIds, ...(await finish(room, student, ids)) };
}

/** A gaze version with one exercise, two questions and its key (B is not in play: the key is A), published to a new student. */
export async function publishGaze(room: Classroom): Promise<Published & { questionIds: string[] }> {
  const teacher = room.teacher.client;
  const student = await newStudent(room);
  await recordConsent(teacher, student.id, { purpose: "ai_adaptation", textVersion: "2026-11" });
  const content = await createGazeContent(room, room.groupId, 1);
  for (const questionId of content.questions) await setQuestionKey(teacher, questionId, { correctOptionId: "A" });
  await editAnswerKey(teacher, content.versionId, { content: keyContentOf(content) });
  const ids = { assessmentId: (await getVersion(teacher, content.versionId)).version.assessmentId, versionId: content.versionId };
  return { student, ...ids, exerciseIds: content.adapted, questionIds: content.questions, ...(await finish(room, student, ids)) };
}
