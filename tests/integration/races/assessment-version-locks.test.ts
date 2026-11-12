import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { original, pick, type Original } from "../support/assessments";
import { countRows, openSession, readRows } from "../support/db";
import { waitUntilBlocked } from "../support/race";
import { describeOutcome, type Session } from "../support/session";
import { teacherOf } from "../support/world";
// T14a-2 and F3-3: the version locks themselves. Every operation that writes several versions locks them
// in id order (app.lock_versions). A writer that holds the first version (or its whole tree: version,
// generation, adapted exercises) must never meet an exercise edit that already holds another version
// while it waits: that is a deadlock.
//
// The check is deterministic. The two versions are inserted high id first, so their physical order is
// the reverse of the id order, and the editor runs with index and bitmap scans off: without an
// `order by` the rows would be locked in physical order (high first). The writer holds the lowest id,
// the edit has to wait on it, and then the writer takes the other version, its generation and its
// exercises with NOWAIT: an edit that took any of them first (reversed or missing order) makes it fail
// with 55P03. Without NOWAIT the two would wait for each other until the deadlock detector.
type Seeded = { low: string; high: string; generation: Record<string, string>; adapted: Record<string, string[]> };

async function insertVersion(o: Original, id: string, position: string): Promise<{ adapted: string[]; generation: string }> {
  await readRows("insert into app.versions (id, institution_id, assessment_id, position, general_instructions) values ($1, $2, $3, $4, 'Copia')", [
    id,
    o.world.institutionId,
    o.assessmentId,
    position,
  ]);
  const adapted: string[] = [];
  for (const exercise of o.exercises) {
    const rows = await readRows<{ id: string }>(
      "insert into app.version_exercises (institution_id, assessment_id, version_id, exercise_id, source_revision, body) values ($1, $2, $3, $4, 1, 'Copia adaptada') returning id",
      [o.world.institutionId, o.assessmentId, id, exercise],
    );
    adapted.push(rows[0]?.id ?? "");
  }
  const made = await readRows<{ id: string }>(
    `insert into app.generations (institution_id, version_id, kind, target_revision, op_key, subject_id, inputs, profiles_hash, profiles_revision,
                                  prompt_version, required_jobs, status, finished_at)
     values ($1, $2, 'version', 1, $3, 'math', '{}', repeat('a', 64), 'r1', 'p1', 0, 'done', now()) returning id`,
    [o.world.institutionId, id, randomUUID()],
  );
  return { adapted, generation: made[0]?.id ?? "" };
}

async function seedVersions(o: Original): Promise<Seeded> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [low, high] = [randomUUID(), randomUUID()].sort();
    if (!low || !high) throw new Error("Faltan ids.");
    // Inserted high first: a scan that does not order by id reaches high before low.
    const first = await insertVersion(o, high, String(2 * attempt + 1));
    const second = await insertVersion(o, low, String(2 * attempt + 2));
    const physical = await readRows<{ id: string }>("select id from app.versions where id = any($1::uuid[]) order by ctid", [`{${low},${high}}`]);
    // A freed slot of the page can reorder them: drop them and seed again with other ids.
    if (physical[0]?.id === high) {
      return { low, high, generation: { [high]: first.generation, [low]: second.generation }, adapted: { [high]: first.adapted, [low]: second.adapted } };
    }
    await readRows("delete from app.versions where id = any($1::uuid[])", [`{${low},${high}}`]);
  }
  throw new Error("No se pudo sembrar las versiones en orden físico inverso al de los ids.");
}

function codeOf(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "error";
}

async function nowait(writer: Session, sql: string, value: string): Promise<string> {
  return writer.rows(sql, [value]).then(
    () => "ok",
    (error: unknown) => codeOf(error),
  );
}

describe("race: marking versions stale against another writer of the same versions", () => {
  for (const holder of ["version", "tree"] as const) {
    it(`an exercise edit waits on the first version (the writer holds its ${holder}) and holds none of the others, 4 times`, async () => {
      for (let round = 0; round < 4; round += 1) {
        const o = await original(1);
        const [one] = pick(o, 1);
        const { low, high, generation, adapted } = await seedVersions(o);
        const [writer, editor, observer] = await Promise.all([openSession(), openSession(), openSession()]);
        try {
          await writer.beginAsOwner();
          if (holder === "version") {
            await writer.rows("select id from app.versions where id = $1 for update", [low]);
          } else {
            await writer.rows("select app.lock_version_tree($1, $2, $3::uuid[])", [low, generation[low] ?? "", `{${(adapted[low] ?? []).join(",")}}`]);
          }
          await editor.begin(teacherOf(o.world));
          for (const setting of ["enable_indexscan", "enable_bitmapscan", "enable_indexonlyscan"]) await editor.rows(`set local ${setting} = off`);
          let done = false;
          const pending = editor
            .call("update_exercise", { p_exercise_id: one, p_revision: 1, p_label: "1", p_body: "Editado", p_topic_id: null })
            .finally(() => {
              done = true;
            });
          // The edit reached the versions and waits for the one the writer holds ...
          expect(await waitUntilBlocked(editor, observer, () => done), `round ${round}`).not.toBeNull();
          // ... without having taken anything of the other one: the whole tree is free for the writer.
          const taken = [
            await nowait(writer, "select id from app.versions where id = $1 for update nowait", high),
            await nowait(writer, "select id from app.generations where id = $1 for update nowait", generation[high] ?? ""),
            await nowait(writer, "select id from app.version_exercises where version_id = $1 for update nowait", high),
          ];
          expect(taken, `round ${round}`).toEqual(["ok", "ok", "ok"]);
          await writer.commit();
          expect(describeOutcome(await pending), `round ${round}`).toBe("ok");
          await editor.commit();
        } finally {
          await Promise.all([writer.close(), editor.close(), observer.close()]);
        }
        const stale = await countRows("select count(*)::text as n from app.versions where assessment_id = $1 and stale", [o.assessmentId]);
        expect(stale, `round ${round}`).toBe(2);
      }
    });
  }
});
