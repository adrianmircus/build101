import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { original, pick, type Original } from "../support/assessments";
import { countRows, openSession, readRows } from "../support/db";
import { waitUntilBlocked } from "../support/race";
import { describeOutcome } from "../support/session";
import { teacherOf } from "../support/world";
// T14a-2: the version locks themselves. Every operation that writes several versions locks them in id
// order (app.lock_versions). A writer that holds the first version and then wants the second must
// never meet an exercise edit that holds the second while it waits for the first: that is a deadlock.
// The writer here is the database owner taking the rows in id order, as publishing and approving
// several versions will; NOWAIT makes the check immediate instead of waiting for the deadlock detector.
describe("race: marking versions stale against another writer of the same versions", () => {
  async function twoVersions(o: Original): Promise<{ low: string; high: string }> {
    const [low, high] = [randomUUID(), randomUUID()].sort();
    if (!low || !high) throw new Error("Faltan ids.");
    // Inserted high first: a scan that does not order by id reaches high before low.
    const rows: [string, string][] = [
      [high, "1"],
      [low, "2"],
    ];
    for (const [id, position] of rows) {
      await readRows("insert into app.versions (id, institution_id, assessment_id, position, general_instructions) values ($1, $2, $3, $4, 'Copia')", [
        id,
        o.world.institutionId,
        o.assessmentId,
        position,
      ]);
      for (const exercise of o.exercises) {
        await readRows(
          "insert into app.version_exercises (institution_id, assessment_id, version_id, exercise_id, source_revision, body) values ($1, $2, $3, $4, 1, 'Copia adaptada')",
          [o.world.institutionId, o.assessmentId, id, exercise],
        );
      }
    }
    return { low, high };
  }

  function codeOf(error: unknown): string {
    return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "error";
  }

  it("an exercise edit waits on the first version and holds none of the others, 5 times", async () => {
    for (let round = 0; round < 5; round += 1) {
      const o = await original(1);
      const [one] = pick(o, 1);
      const { low, high } = await twoVersions(o);
      const [writer, editor, observer] = await Promise.all([openSession(), openSession(), openSession()]);
      try {
        await writer.beginAsOwner();
        await writer.rows("select id from app.versions where id = $1 for update", [low]);
        await editor.begin(teacherOf(o.world));
        let done = false;
        const pending = editor
          .call("update_exercise", { p_exercise_id: one, p_revision: 1, p_label: "1", p_body: "Editado", p_topic_id: null })
          .finally(() => {
            done = true;
          });
        // The edit reached the versions and waits for the one the writer holds ...
        expect(await waitUntilBlocked(editor, observer, () => done), `round ${round}`).not.toBeNull();
        // ... without having taken the other one first: the writer gets it at once. An edit that
        // locked versions out of id order would hold `high`, and this fails with 55P03 (without
        // NOWAIT, the two would deadlock).
        const second = await writer.rows("select id from app.versions where id = $1 for update nowait", [high]).then(
          () => "ok",
          (error: unknown) => codeOf(error),
        );
        expect(second, `round ${round}`).toBe("ok");
        await writer.commit();
        const outcome = await pending;
        expect(describeOutcome(outcome), `round ${round}`).toBe("ok");
        await editor.commit();
      } finally {
        await Promise.all([writer.close(), editor.close(), observer.close()]);
      }
      const stale = await countRows("select count(*)::text as n from app.versions where assessment_id = $1 and stale", [o.assessmentId]);
      expect(stale, `round ${round}`).toBe(2);
    }
  });
});
