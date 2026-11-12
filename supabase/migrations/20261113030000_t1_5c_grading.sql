-- T1.5c: grading. Replaces the three stubs of 20261111131200 (same signatures) with the protocol of
-- docs/contratos/fase-1.md, «Intentos y entrega»: the teacher sees the state of each student and grades what was submitted.
-- The ticket's own number (20261112210000) was already used. No new table, no new column, no change of signature.
--
-- Who: staff of the group (app.assessment_gate, like every RPC of the assessment): an admin who does not teach the group,
-- inclusion and an enrolled student are FORBIDDEN; a teacher of another group, another institution or an id that does not
-- exist are NOT_FOUND; no session is FORBIDDEN no_session. Authorization is a plain read before any lock.
--
--   list_assessment_attempts   One row per assignment of the assessment: the student, the attempt in force (the latest
--                              one when none is in force) and its grade. It never says which version a student got, nor
--                              the answer mode, the aids or anything of the configuration: the keys are a closed list. It
--                              discloses a name and a state, no profile, so it writes no audit row.
--   get_attempt_for_grading    Audited, one row per request with the student it shows. The publication the student
--                              solved (it can reveal the adaptation), their answers and choices, the key revision of the
--                              attempt and the grade. Only a submitted attempt: before that there is nothing to grade
--                              (CONFLICT not_submitted) and nothing is disclosed. One statement, so it reads one snapshot.
--   grade_attempt              app.lock_attempt_tree (assignment -> attempt -> draft) and, after them, the grade row, the
--                              last level of the order. Under the lock: the attempt has to be submitted (CONFLICT
--                              not_submitted), also from a withdrawn publication or a superseded attempt. The results are
--                              by id of an exercise of the attempt's publication, never another one (INVALID
--                              unknown_result_exercise). Revision: the first grade comes with a null p_revision; the next
--                              ones with the revision they read (CONFLICT revision_mismatch). The first grade repeated
--                              with the same content (a double click, a retry after a cut) answers the same grade; with
--                              other content it is revision_mismatch. A grade has no op_key (docs, «Idempotencia de las
--                              altas»): the lock on the assignment is what orders two copies, and the content under that
--                              lock is what is compared.
--                              The first grade of the current attempt moves the assignment from submitted to graded.
--
-- The shape of the input is checked before any lock (INVALID invalid_feedback, invalid_score, invalid_results): the repo
-- validates with zod first, this is the second wall. Every validator answers a boolean and what it discards it discards
-- with "is not true", so a NULL never lets a malformed input through.
--
-- Guards, as the owner (P0004): grades.attempt_id never changes, and a grade is only born on a submitted attempt.

-- ---------------------------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------------------------

create function app.grades_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.attempt_id is distinct from old.attempt_id then
      raise exception 'app.grades_guard: attempt_id never changes' using errcode = 'P0004';
    end if;
  elsif not exists (select 1 from app.assignment_attempts t where t.id = new.attempt_id and t.status = 'submitted') then
    raise exception 'app.grades_guard: only a submitted attempt is graded' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create trigger grades_guard
  before insert or update on app.grades
  for each row execute function app.grades_guard();

-- ---------------------------------------------------------------------------------------------
-- Helpers (SECURITY INVOKER, run by the RPCs as postgres)
-- ---------------------------------------------------------------------------------------------

-- Authorizes an attempt for the staff of its group (null or unknown is NOT_FOUND). Reads without locking.
create function app.attempt_target(p_attempt_id uuid, out o_assignment_id uuid, out o_student_id uuid, out o_institution_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_group_id uuid;
begin
  select t.assignment_id, a.student_id, t.institution_id, s.group_id
    into o_assignment_id, o_student_id, o_institution_id, v_group_id
    from app.assignment_attempts t
    join app.assignments a on a.id = t.assignment_id
    join app.assessments s on s.id = a.assessment_id
   where t.id = p_attempt_id;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform app.assessment_gate(v_group_id);
end
$$;

-- ExerciseResult by id (lib/domain/delivery/entities.ts): { <exercise id>: { status, errors: [<key>] } }, strict, with at
-- most 20 error keys each. Plain plpgsql with early returns: a jsonb function applied to the wrong type raises, and SQL does
-- not promise the order in which an AND is evaluated. Always a boolean, never NULL.
create function app.is_exercise_results(p_results jsonb) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_entry record;
  v_error jsonb;
begin
  if jsonb_typeof(p_results) is distinct from 'object' or octet_length(p_results::text) > 1000000 then
    return false;
  end if;
  for v_entry in select e.key, e.value from jsonb_each(p_results) e loop
    if v_entry.key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return false;
    end if;
    if jsonb_typeof(v_entry.value) is distinct from 'object' or (v_entry.value - array['status', 'errors']) <> '{}'::jsonb then
      return false;
    end if;
    if jsonb_typeof(v_entry.value -> 'status') is distinct from 'string'
       or not coalesce((v_entry.value ->> 'status') in ('correct', 'partial', 'wrong', 'blank'), false) then
      return false;
    end if;
    if jsonb_typeof(v_entry.value -> 'errors') is distinct from 'array' or jsonb_array_length(v_entry.value -> 'errors') > 20 then
      return false;
    end if;
    for v_error in select x.value from jsonb_array_elements(v_entry.value -> 'errors') x loop
      if jsonb_typeof(v_error) is distinct from 'string' or (v_error #>> '{}') !~ '^[a-z][a-z0-9_]{0,39}$' then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- list_assessment_attempts
-- ---------------------------------------------------------------------------------------------

create or replace function api.list_assessment_attempts(p_assessment_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_items jsonb;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  perform app.assessment_target(p_assessment_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'studentId', a.student_id, 'displayName', s.display_name, 'assignmentId', a.id,
           'attemptId', t.id, 'status', t.status, 'submittedAt', t.submitted_at, 'late', coalesce(t.late, false),
           'score', g.score, 'graded', g.id is not null
         ) order by s.display_name, a.student_id), '[]'::jsonb)
    into v_items
    from app.assignments a
    join app.students s on s.institution_id = a.institution_id and s.id = a.student_id
    left join lateral (
      select x.* from app.assignment_attempts x
       where x.assignment_id = a.id
       order by (x.superseded_at is null) desc, x.number desc
       limit 1) t on true
    left join app.grades g on g.attempt_id = t.id
   where a.assessment_id = p_assessment_id;
  return jsonb_build_object('items', v_items);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- get_attempt_for_grading
-- ---------------------------------------------------------------------------------------------

create or replace function api.get_attempt_for_grading(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_student_id uuid;
  v_result jsonb;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_institution_id, t.o_student_id into v_institution_id, v_student_id from app.attempt_target(p_attempt_id) t;

  select jsonb_build_object(
           'attemptId', t.id,
           'student', jsonb_build_object('id', s.id, 'displayName', s.display_name),
           'status', t.status, 'submittedAt', t.submitted_at, 'late', t.late,
           'publication', jsonb_build_object(
             'id', p.id, 'assessmentId', p.assessment_id, 'versionId', p.version_id, 'versionRevision', p.version_revision,
             'answerKeyRevisionId', p.answer_key_revision_id, 'content', p.content, 'answerMode', p.answer_mode,
             'aids', p.aids, 'publishedAt', p.published_at, 'withdrawnAt', p.withdrawn_at),
           'answers', coalesce(d.answers, '{}'::jsonb), 'choices', coalesce(d.choices, '{}'::jsonb),
           'answerKey', case when r.id is null then null else jsonb_build_object(
             'id', r.id, 'number', r.number, 'source', r.source, 'content', r.content, 'versionRevision', r.version_revision,
             'exerciseRevisions', r.exercise_revisions, 'questionRevisions', r.question_revisions,
             'instructionsRevision', r.instructions_revision, 'createdAt', r.created_at) end,
           'grade', case when g.id is null then null else jsonb_build_object(
             'score', g.score, 'feedback', g.feedback, 'exerciseResults', g.exercise_results,
             'gradedBy', g.graded_by, 'gradedAt', g.graded_at, 'revision', g.revision) end)
    into v_result
    from app.assignment_attempts t
    join app.students s on s.institution_id = t.institution_id and s.id = v_student_id
    join app.publications p on p.id = t.publication_id
    left join app.submissions d on d.attempt_id = t.id
    left join app.answer_key_revisions r on r.id = t.answer_key_revision_id
    left join app.grades g on g.attempt_id = t.id
   where t.id = p_attempt_id;
  if v_result is null then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  -- Nothing to grade yet, and nothing disclosed: the draft of a student who has not turned it in stays theirs.
  if v_result ->> 'status' is distinct from 'submitted' then
    perform app.raise_error('CONFLICT', 'not_submitted');
  end if;

  perform app.audit_disclosure(v_institution_id, 'get_attempt_for_grading', 'attempt', p_attempt_id, array[v_student_id]);
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- grade_attempt
-- ---------------------------------------------------------------------------------------------

create or replace function api.grade_attempt(
  p_attempt_id uuid, p_feedback text, p_exercise_results jsonb, p_score integer default null, p_revision integer default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_institution_id uuid;
  v_attempt app.assignment_attempts;
  v_grade app.grades;
  v_content jsonb;
  v_valid boolean;
  v_revision integer;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_assignment_id, t.o_institution_id into v_assignment_id, v_institution_id from app.attempt_target(p_attempt_id) t;

  -- The shape, before any lock.
  v_valid := coalesce(p_feedback is not null and app.js_length(p_feedback) <= 5000, false);
  if v_valid is not true then
    perform app.raise_error('INVALID', 'invalid_feedback');
  end if;
  v_valid := coalesce(p_score is null or p_score between 1 and 10, false);
  if v_valid is not true then
    perform app.raise_error('INVALID', 'invalid_score');
  end if;
  v_valid := coalesce(app.is_exercise_results(p_exercise_results), false);
  if v_valid is not true then
    perform app.raise_error('INVALID', 'invalid_results');
  end if;

  if not app.lock_attempt_tree(p_attempt_id) then  -- assignment -> attempt -> draft
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  select t.* into v_attempt from app.assignment_attempts t where t.id = p_attempt_id;  -- again, under the lock
  if v_attempt.status <> 'submitted' then
    perform app.raise_error('CONFLICT', 'not_submitted');
  end if;

  -- Every id is an exercise of this attempt's publication, never another one's.
  select p.content into v_content from app.publications p where p.id = v_attempt.publication_id;
  if v_content is null or exists (
       select 1 from jsonb_object_keys(p_exercise_results) k
        where not exists (select 1 from jsonb_array_elements(v_content -> 'exercises') x where x ->> 'id' = k)) then
    perform app.raise_error('INVALID', 'unknown_result_exercise');
  end if;

  -- The grade row comes last in the order of the locks.
  select g.* into v_grade from app.grades g where g.attempt_id = p_attempt_id for update;

  if not found then
    if p_revision is not null then
      perform app.raise_error('CONFLICT', 'revision_mismatch');
    end if;
    insert into app.grades (institution_id, attempt_id, score, feedback, exercise_results, graded_by, graded_at)
    values (v_institution_id, p_attempt_id, p_score, p_feedback, p_exercise_results, app.actor_id(), clock_timestamp())
    returning revision into v_revision;
    -- The current attempt is the one the assignment is waiting on; a superseded one or a withdrawn assignment stay as they are.
    if v_attempt.superseded_at is null then
      update app.assignments set status = 'graded', revision = revision + 1 where id = v_assignment_id and status = 'submitted';
    end if;
    return jsonb_build_object('attemptId', p_attempt_id, 'revision', v_revision);
  end if;

  if p_revision is null then
    -- The first grade again: the same content is the same grade (the second click found the first one's work);
    -- other content is a grade somebody already wrote.
    if v_grade.score is not distinct from p_score and v_grade.feedback = p_feedback and v_grade.exercise_results = p_exercise_results then
      return jsonb_build_object('attemptId', p_attempt_id, 'revision', v_grade.revision);
    end if;
    perform app.raise_error('CONFLICT', 'revision_mismatch');
  end if;
  perform app.assert_revision(p_revision, v_grade.revision);

  update app.grades
     set score = p_score, feedback = p_feedback, exercise_results = p_exercise_results,
         graded_by = app.actor_id(), graded_at = clock_timestamp(), revision = revision + 1
   where id = v_grade.id
  returning revision into v_revision;
  return jsonb_build_object('attemptId', p_attempt_id, 'revision', v_revision);
end
$$;

grant execute on function api.list_assessment_attempts(uuid) to authenticated;
grant execute on function api.get_attempt_for_grading(uuid) to authenticated;
grant execute on function api.grade_attempt(uuid, text, jsonb, integer, integer) to authenticated;
