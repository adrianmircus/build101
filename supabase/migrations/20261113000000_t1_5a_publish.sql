-- T1.5a: minimal publication. Replaces the stub api.publish_version of 20261111131200 (same signature) and grants
-- EXECUTE to authenticated. No new table, no new column. The ticket's own number (20261112190000) was already used.
--
-- What it does, in one transaction (docs/contratos/fase-1.md, «Intentos y entrega»): checks, copies the approved
-- revision of the version into app.publications and creates or moves the attempts of its recipients. No dates, no
-- withdrawing, no reassigning (T8.1).
--
-- Who: staff of the group, like every RPC of the version (app.version_target -> assessment_gate): an admin who does
-- not teach the group, inclusion and an enrolled student are FORBIDDEN, a teacher of another group or institution
-- NOT_FOUND. A student never publishes.
--
-- The checks, in this order (the first one that fails answers):
--   revision_mismatch (CONFLICT)   p_revision is not the version's revision;
--   content_incomplete (CONFLICT)  the recalculated status of the version is not ready: some adapted exercise is
--                                  pending, generating or in error, or has no text (approve_version asks the same);
--   not_approved (CONFLICT)        approved_revision is not the revision (never approved, edited since, rejected);
--   missing_questions (CONFLICT)   gaze: some adapted exercise has no question (nothing to answer with the eyes);
--   no_answer_key (CONFLICT)       gaze with no key at all: the key is mandatory;
--   stale_answer_key (CONFLICT)    the revision of the key does not correspond to the version of today
--                                  (app.answer_key_matches), or its content does not fit the version;
--   not_enrolled (CONFLICT)        a recipient is no longer enrolled in the group (or was archived);
--   missing_consent (CONFLICT)     the version has a generation (the profiles went to the AI) and a recipient has no
--                                  ai_adaptation consent in force.
-- The key: p_answer_key_revision_id, or, in gaze mode when it is null, the current revision of the answer key. In
-- typed and voice mode the key is optional: null means no key, and one that is given is checked like in gaze mode.
-- Approving the key (approve_answer_key) is not required: publishing is the teacher's act and the comparison is the
-- guarantee ("publishing compares, the mark is not trusted").
--
-- The copy (publications.content) is built here, clause by clause: { generalInstructions, exercises: [{ id, label,
-- body }], questions: [{ id, exerciseId, stem, options }] } with the ids of the ADAPTED exercises. The questions are
-- copied in gaze mode only. It never carries question_keys, the changes or the reasons, the configuration or the
-- recipients. aids is computed from the configuration ({ readAloud: dyslexia is one of the profiles }) and never
-- names a profile. revealWarnings is not run here: the service shows those warnings (T4.7), they do not block.
--
-- Idempotency (T1.F3 protocol). op_key, op_identity and op_attempts are written in the same insert as the
-- publication. op_identity is the sha256 of jsonb_build_array('publish_version', version, revision, key revision),
-- as the caller sent them. It is looked up under pg_advisory_xact_lock of (RPC, institution, op_key), before any row
-- lock and before looking at the version: the replay answers { publicationId, attempts: op_attempts } as it was, even
-- if a later publication moved those attempts, the version was edited or the assessment archived.
--
-- Locks, in the order of the contract: the group and the assessment FOR SHARE (the same first locks as every write of
-- content), the version, then, per recipient in student id order, the enrollment advisory lock of the pair (the one
-- enroll_student and unenroll_student take; it is how version_recipients_enrolled checks), then the assignments of
-- the recipients by id (app.lock_assignments) BEFORE their attempts: it is the order student_start_attempt follows
-- (assignment -> attempt -> draft). Publishing never takes an attempt before its assignment.
--
-- Attempts, per recipient: no assignment, one is created with attempt 1 opened; an attempt in force that is opened
-- moves to the new publication with its key (a new revision of the attempt); started or submitted is not touched; a
-- withdrawn assignment is not touched either (T8.1 reassigns). op_attempts counts the attempts created or moved,
-- and it is computed before the insert because a publication is immutable.
--
-- Guards (P0004), as the owner: what says to whom an assignment or an attempt belongs never changes (assignments:
-- assessment_id and student_id; attempts: assignment_id, assessment_id and number). publications_guard already
-- keeps a publication immutable except for withdrawn_at, once.

-- ---------------------------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------------------------

create function app.assignments_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assessment_id is distinct from old.assessment_id or new.student_id is distinct from old.student_id then
    raise exception 'app.assignments_frozen: assessment_id and student_id never change' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create trigger assignments_frozen
  before update on app.assignments
  for each row execute function app.assignments_frozen();

create function app.assignment_attempts_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assignment_id is distinct from old.assignment_id or new.assessment_id is distinct from old.assessment_id
     or new.number is distinct from old.number then
    raise exception 'app.assignment_attempts_frozen: assignment_id, assessment_id and number never change' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create trigger assignment_attempts_frozen
  before update on app.assignment_attempts
  for each row execute function app.assignment_attempts_frozen();

-- ---------------------------------------------------------------------------------------------
-- Helpers (SECURITY INVOKER, run by the RPC as postgres). They read under the version lock.
-- ---------------------------------------------------------------------------------------------

-- What a student receives of a version: the instructions of the version, its adapted exercises in the order of the
-- original and, in gaze mode, their questions with the options and never the correct one.
create function app.publication_content(p_version_id uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'generalInstructions', v.general_instructions,
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object('id', ve.id, 'label', e.label, 'body', ve.body) order by e.position, e.id)
        from app.version_exercises ve join app.assessment_exercises e on e.id = ve.exercise_id
       where ve.version_id = v.id), '[]'::jsonb),
    'questions', case when v.answer_mode = 'gaze' then coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'exerciseId', q.version_exercise_id, 'stem', q.stem, 'options', q.options)
                       order by e.position, e.id, q.position, q.id)
        from app.version_questions q
        join app.version_exercises ve on ve.id = q.version_exercise_id
        join app.assessment_exercises e on e.id = ve.exercise_id
       where q.version_id = v.id), '[]'::jsonb) else '[]'::jsonb end)
    from app.versions v where v.id = p_version_id
$$;

-- The supports of the platform that the configuration turns on. Computed here, never named after a profile: read
-- aloud is the platform's support of dyslexia (data/profiles/dyslexia.md leaves it to the platform).
create function app.publication_aids(p_config jsonb) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('readAloud', coalesce(jsonb_typeof(p_config -> 'profiles') = 'array' and (p_config -> 'profiles') ? 'dyslexia', false))
$$;

-- ---------------------------------------------------------------------------------------------
-- publish_version
-- ---------------------------------------------------------------------------------------------

create or replace function api.publish_version(p_version_id uuid, p_revision integer, p_op_key uuid, p_answer_key_revision_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_assessment_id uuid;
  v_group_id uuid;
  v_institution_id uuid;
  v_identity text;
  v_existing app.publications;
  v_assessment app.assessments;
  v_version app.versions;
  v_key app.answer_keys;
  v_key_revision uuid;
  v_students uuid[];
  v_student uuid;
  v_assignment_ids uuid[];
  v_assignment app.assignments;
  v_attempt app.assignment_attempts;
  v_attempts integer;
  v_done integer := 0;
  v_publication_id uuid;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_assessment_id, t.o_group_id, t.o_institution_id into v_assessment_id, v_group_id, v_institution_id
    from app.version_target(p_version_id) t;
  if p_op_key is null then
    perform app.raise_error('INVALID', 'invalid_op_key');
  end if;
  if p_revision is null then
    perform app.raise_error('INVALID', 'revision_required');
  end if;
  v_identity := encode(sha256(convert_to(
    jsonb_build_array('publish_version', p_version_id, p_revision, p_answer_key_revision_id)::text, 'utf8')), 'hex');

  -- Before any row lock: a replay answers what was published even if the assessment was archived since.
  perform pg_advisory_xact_lock(hashtextextended('tiza.publish_version:' || v_institution_id::text || ':' || p_op_key::text, 0));
  select * into v_existing from app.publications p where p.institution_id = v_institution_id and p.op_key = p_op_key;
  if found then
    if v_existing.op_identity = v_identity then
      return jsonb_build_object('publicationId', v_existing.id, 'attempts', v_existing.op_attempts);
    end if;
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;

  v_assessment := app.assessment_share(v_assessment_id, v_group_id);
  if not app.lock_version_tree(p_version_id, null, null) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform app.assert_assessment_writable(v_assessment, v_group_id);
  select * into v_version from app.versions v where v.id = p_version_id;
  if v_version.archived_at is not null then
    perform app.raise_error('INVALID', 'version_archived');
  end if;
  perform app.assert_revision(p_revision, v_version.revision);

  -- The content is complete when the recalculated status is ready (the check of approve_version): a version that
  -- was never approved because it is half made says so, not "approve it first".
  if app.refresh_version_status(p_version_id) is distinct from 'ready' then
    perform app.raise_error('CONFLICT', 'content_incomplete');
  end if;
  if v_version.approved_revision is distinct from v_version.revision then
    perform app.raise_error('CONFLICT', 'not_approved');
  end if;
  if v_version.answer_mode = 'gaze' and exists (
       select 1 from app.version_exercises ve
        where ve.version_id = p_version_id
          and not exists (select 1 from app.version_questions q where q.version_exercise_id = ve.id)) then
    perform app.raise_error('CONFLICT', 'missing_questions');
  end if;

  -- The key. Nobody writes it without the version lock, which we hold: a plain read is consistent.
  select * into v_key from app.answer_keys k where k.version_id = p_version_id;
  v_key_revision := coalesce(p_answer_key_revision_id, case when v_version.answer_mode = 'gaze' then v_key.current_revision_id end);
  if v_key_revision is null then
    if v_version.answer_mode = 'gaze' then
      perform app.raise_error('CONFLICT', 'no_answer_key');
    end if;
  else
    if not exists (select 1 from app.answer_key_revisions r where r.id = v_key_revision and r.version_id = p_version_id) then
      perform app.raise_error('NOT_FOUND', 'not_found');
    end if;
    if not app.answer_key_matches(v_key_revision, p_version_id)
       or app.answer_key_content_problem(p_version_id, (select r.content from app.answer_key_revisions r where r.id = v_key_revision),
                                         v_version.answer_mode) is not null then
      perform app.raise_error('CONFLICT', 'stale_answer_key');
    end if;
  end if;

  -- The recipients of today, still enrolled. The pair lock is the one of enroll_student and unenroll_student, in
  -- student id order like version_recipients_enrolled.
  v_students := coalesce((select array_agg(r.student_id order by r.student_id) from app.version_recipients r
                           where r.version_id = p_version_id and r.valid_to is null), '{}');
  foreach v_student in array v_students loop
    perform pg_advisory_xact_lock(hashtextextended('tiza.enrollment:' || v_group_id::text || ':' || v_student::text, 0));
    perform 1 from app.students s where s.id = v_student and s.archived_at is null for share;
    if not found or not exists (
         select 1 from app.enrollments e where e.group_id = v_group_id and e.student_id = v_student and e.ended_at is null) then
      perform app.raise_error('CONFLICT', 'not_enrolled');
    end if;
  end loop;
  -- A generation means the profiles of the recipients were used to adapt: each one needs the consent in force.
  if exists (select 1 from app.generations g where g.version_id = p_version_id)
     and exists (
       select 1 from unnest(v_students) as s(id)
        where not exists (
          select 1 from app.consents c
           where c.student_id = s.id and c.purpose = 'ai_adaptation' and c.status = 'granted'
             and c.valid_from <= clock_timestamp() and (c.valid_until is null or c.valid_until > clock_timestamp()))) then
    perform app.raise_error('CONFLICT', 'missing_consent');
  end if;

  -- The assignments of the recipients that already have one, by id and before any attempt. After this, nobody can
  -- start, save or submit one of these attempts (they lock the assignment first), so what we read is what we move.
  v_assignment_ids := coalesce((select array_agg(a.id order by a.id) from app.assignments a
                                 where a.assessment_id = v_assessment_id and a.student_id = any (v_students)), '{}');
  perform app.lock_assignments(v_assignment_ids);
  select count(*) into v_attempts
    from unnest(v_students) as s(id)
    left join app.assignments a on a.assessment_id = v_assessment_id and a.student_id = s.id
    left join app.assignment_attempts t on t.assignment_id = a.id and t.superseded_at is null
   where a.id is null or (a.status <> 'withdrawn' and (t.id is null or t.status = 'opened'));

  insert into app.publications (institution_id, assessment_id, version_id, version_revision, answer_key_revision_id, content,
                                answer_mode, aids, published_by, published_at, op_key, op_identity, op_attempts)
  values (v_institution_id, v_assessment_id, p_version_id, v_version.revision, v_key_revision, app.publication_content(p_version_id),
          v_version.answer_mode, app.publication_aids(v_version.config), app.actor_id(), clock_timestamp(), p_op_key, v_identity, v_attempts)
  returning id into v_publication_id;

  foreach v_student in array v_students loop
    select * into v_assignment from app.assignments a where a.assessment_id = v_assessment_id and a.student_id = v_student;
    if not found then
      insert into app.assignments (institution_id, assessment_id, student_id)
      values (v_institution_id, v_assessment_id, v_student)
      returning * into v_assignment;
      insert into app.assignment_attempts (institution_id, assessment_id, assignment_id, version_id, publication_id, answer_key_revision_id, number)
      values (v_institution_id, v_assessment_id, v_assignment.id, p_version_id, v_publication_id, v_key_revision, 1);
      v_done := v_done + 1;
    elsif v_assignment.status <> 'withdrawn' then
      select * into v_attempt from app.assignment_attempts t where t.assignment_id = v_assignment.id and t.superseded_at is null for update;
      if not found then
        insert into app.assignment_attempts (institution_id, assessment_id, assignment_id, version_id, publication_id, answer_key_revision_id, number)
        values (v_institution_id, v_assessment_id, v_assignment.id, p_version_id, v_publication_id, v_key_revision,
                (select coalesce(max(t.number), 0) + 1 from app.assignment_attempts t where t.assignment_id = v_assignment.id));
        v_done := v_done + 1;
      elsif v_attempt.status = 'opened' then
        update app.assignment_attempts
           set version_id = p_version_id, publication_id = v_publication_id, answer_key_revision_id = v_key_revision,
               revision = revision + 1
         where id = v_attempt.id;
        v_done := v_done + 1;
      end if;
    end if;
  end loop;
  if v_done <> v_attempts then
    raise exception 'api.publish_version: the attempts counted (%) are not the ones touched (%)', v_attempts, v_done using errcode = 'P0004';
  end if;
  return jsonb_build_object('publicationId', v_publication_id, 'attempts', v_attempts);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: nothing in api has a default grant.
-- ---------------------------------------------------------------------------------------------

grant execute on function api.publish_version(uuid, integer, uuid, uuid) to authenticated;
