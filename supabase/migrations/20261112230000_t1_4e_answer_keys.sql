-- T1.4e: answer keys. Replaces the stubs of 20261111131100 (same signatures) and grants EXECUTE: the four teacher
-- RPCs to authenticated, internal_record_answer_key_revision to service_role. No new table, no new column. The
-- ticket's own number (20261112180000) was already used.
--
-- Also (coordinator's extension, review of T1.4d): the validators of the AI outputs of T1.4d now check every
-- mandatory field explicitly and always answer a boolean, and internal_record_generation_output discards on
-- `v_valid is not true`. Before, a validator could answer NULL (a missing field), `when not v_valid` did not
-- catch it and an empty gaze_questions output applied: it deleted the questions of the exercise and wrote none.
--
-- A revision of the key is immutable (append-only trigger of the contract) and keeps the snapshot it was made for:
-- exercise_revisions, question_revisions and instructions_revision. It corresponds to a version when the three
-- equal today's (app.answer_key_matches); version_revision is only for tracing. Whoever writes content takes the
-- version lock first, so under that lock the revisions of today cannot move.
--
-- Locks, in the order of the contract: group and assessment FOR SHARE, the version, the running answer key
-- generations by id, then the answer_keys row. edit and confirm compare p_base_revision_id with the current
-- revision UNDER those locks: two copies from the same base serialize and the second is CONFLICT
-- revision_mismatch (no op_key: like every edit with a revision, the second copy finds its base is no longer
-- the current one). A person's edit or confirmation wins over a running generation: it supersedes it and the
-- key no longer points at it, so whatever the generation records afterwards is obsolete.
--
-- Who: staff of the group (app.version_target -> assessment_gate): an admin who does not teach the group,
-- inclusion and an enrolled student are FORBIDDEN, a teacher of another group or institution NOT_FOUND. A
-- student never reads the key: tiza_student has no privilege on these tables and no student_* RPC names them.

-- ---------------------------------------------------------------------------------------------
-- Validators of the AI outputs of T1.4d: every mandatory field explicit, always a boolean.
-- ---------------------------------------------------------------------------------------------

create or replace function app.is_generated_exercise(p_output jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_output) = 'object'
    and jsonb_typeof(p_output -> 'body') = 'string'
    and char_length(p_output ->> 'body') between 1 and 20000
    and btrim(p_output ->> 'body', E' \t\r\n') <> ''
    and (not p_output ? 'changes' or (
          jsonb_typeof(p_output -> 'changes') = 'array'
      and jsonb_array_length(p_output -> 'changes') <= 20
      and not exists (
            select 1 from jsonb_array_elements(p_output -> 'changes') as c
             where jsonb_typeof(c) is distinct from 'object'
                or jsonb_typeof(c -> 'what') is distinct from 'string' or char_length(c ->> 'what') > 500
                or jsonb_typeof(c -> 'why') is distinct from 'string' or char_length(c ->> 'why') > 1000))),
    false)
$$;

create or replace function app.is_generated_questions(p_output jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_output) = 'object'
    and jsonb_typeof(p_output -> 'questions') = 'array'
    and jsonb_array_length(p_output -> 'questions') between 1 and 10
    and not exists (
          select 1 from jsonb_array_elements(p_output -> 'questions') as q
           where jsonb_typeof(q) is distinct from 'object'
              or jsonb_typeof(q -> 'stem') is distinct from 'string'
              or char_length(q ->> 'stem') not between 1 and 5000
              or btrim(q ->> 'stem', E' \t\r\n') = ''
              or jsonb_typeof(q -> 'options') is distinct from 'array'
              or not coalesce(app.is_option_list(q -> 'options'), false)
              or exists (select 1 from jsonb_object_keys(q) as k where k not in ('stem', 'options'))
              or exists (
                   select 1 from jsonb_array_elements(q -> 'options') as o
                    where jsonb_typeof(o -> 'text') is distinct from 'string' or char_length(o ->> 'text') > 2000
                       or exists (select 1 from jsonb_object_keys(o) as k where k not in ('id', 'text', 'graph'))
                       or (o ? 'graph' and jsonb_typeof(o -> 'graph') is distinct from 'object'))),
    false)
$$;

create or replace function app.is_generated_instructions(p_output jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_output) = 'object'
    and jsonb_typeof(p_output -> 'instructions') = 'string' and char_length(p_output ->> 'instructions') <= 5000,
    false)
$$;

-- ---------------------------------------------------------------------------------------------
-- Guards (P0004): what identifies a key never changes, revisions are numbered one by one.
-- ---------------------------------------------------------------------------------------------

create function app.answer_keys_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.version_id is distinct from old.version_id then
    raise exception 'app.answer_keys_frozen: version_id never changes' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create trigger answer_keys_frozen
  before update on app.answer_keys
  for each row execute function app.answer_keys_frozen();

-- Revisions of a key are numbered 1, 2, 3... with no gap (the RPCs hold the key row, so two writers never
-- take the same number; the unique index is the backstop), and a generated one points at an answer key
-- generation of its own version.
create function app.answer_key_revisions_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.number is distinct from (select coalesce(max(r.number), 0) + 1 from app.answer_key_revisions r where r.answer_key_id = new.answer_key_id) then
    raise exception 'app.answer_key_revisions_guard: revisions are numbered one by one' using errcode = 'P0004';
  end if;
  if new.generation_id is not null and not exists (
       select 1 from app.generations g where g.id = new.generation_id and g.version_id = new.version_id and g.kind = 'answer_key') then
    raise exception 'app.answer_key_revisions_guard: a generated revision comes from an answer key generation' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create trigger answer_key_revisions_guard
  before insert on app.answer_key_revisions
  for each row execute function app.answer_key_revisions_guard();

-- ---------------------------------------------------------------------------------------------
-- Helpers (SECURITY INVOKER, run by the RPCs as postgres). STABLE: inside one statement they read the
-- statement snapshot, so get_answer_key answers a consistent picture.
-- ---------------------------------------------------------------------------------------------

-- The revisions of today of what a key is made for: { adapted exercise: revision }, { question: revision } and
-- the instructions revision of the version.
create function app.answer_key_snapshot(p_version_id uuid, out o_exercises jsonb, out o_questions jsonb, out o_instructions integer)
language sql
stable
set search_path = ''
as $$
  select (select coalesce(jsonb_object_agg(ve.id::text, ve.revision), '{}'::jsonb) from app.version_exercises ve where ve.version_id = p_version_id),
         (select coalesce(jsonb_object_agg(q.id::text, q.revision), '{}'::jsonb) from app.version_questions q where q.version_id = p_version_id),
         (select v.instructions_revision from app.versions v where v.id = p_version_id)
$$;

-- A snapshot corresponds to a version when the three equal today's. A missing piece is never a match.
create function app.answer_key_snapshot_matches(p_version_id uuid, p_exercises jsonb, p_questions jsonb, p_instructions integer)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    p_exercises is not null and p_questions is not null and p_instructions is not null
    and (s.o_exercises = p_exercises and s.o_questions = p_questions and s.o_instructions = p_instructions), false)
    from app.answer_key_snapshot(p_version_id) s
$$;

-- Does this revision of the key correspond to the version today? (C1) version_revision is not compared:
-- changing the recipients moves it and does not touch the key.
create function app.answer_key_matches(p_revision_id uuid, p_version_id uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select app.answer_key_snapshot_matches(p_version_id, r.exercise_revisions, r.question_revisions, r.instructions_revision)
      from app.answer_key_revisions r
     where r.id = p_revision_id and r.version_id = p_version_id), false)
$$;

-- The shape of the content of a key, the backstop of the zod schema: { exercises: { <id>: { answer, rubric? } },
-- questions: { <id>: "A" } }. Never raises; false for anything else (including null).
create function app.is_answer_key_content(p_content jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_content) = 'object'
    and octet_length(p_content::text) <= 1000000
    and not exists (select 1 from jsonb_object_keys(p_content) as k where k not in ('exercises', 'questions'))
    and jsonb_typeof(p_content -> 'exercises') = 'object'
    and jsonb_typeof(p_content -> 'questions') = 'object'
    and not exists (
          select 1 from jsonb_each(p_content -> 'exercises') as e
           where e.key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              or jsonb_typeof(e.value) is distinct from 'object'
              or exists (select 1 from jsonb_object_keys(e.value) as k where k not in ('answer', 'rubric'))
              or jsonb_typeof(e.value -> 'answer') is distinct from 'string' or char_length(e.value ->> 'answer') > 5000
              or (e.value ? 'rubric' and (jsonb_typeof(e.value -> 'rubric') is distinct from 'string' or char_length(e.value ->> 'rubric') > 5000)))
    and not exists (
          select 1 from jsonb_each(p_content -> 'questions') as q
           where q.key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              or jsonb_typeof(q.value) is distinct from 'string' or (q.value #>> '{}') !~ '^[A-Z]$'),
    false)
$$;

-- What is wrong with a well-formed content, against the version today: null when nothing, else the reason.
--   invalid_answer_key  it names an exercise or a question that is not of the version;
--   unknown_option      the option of a question is not one of its options;
--   key_incomplete      in gaze mode some question has no correct option.
create function app.answer_key_content_problem(p_version_id uuid, p_content jsonb, p_answer_mode text) returns text
language sql
stable
set search_path = ''
as $$
  select case
    when exists (select 1 from jsonb_object_keys(p_content -> 'exercises') as k
                  where not exists (select 1 from app.version_exercises ve where ve.version_id = p_version_id and ve.id::text = k))
      then 'invalid_answer_key'
    when exists (select 1 from jsonb_object_keys(p_content -> 'questions') as k
                  where not exists (select 1 from app.version_questions q where q.version_id = p_version_id and q.id::text = k))
      then 'invalid_answer_key'
    when exists (select 1 from jsonb_each_text(p_content -> 'questions') as e
                   join app.version_questions q on q.version_id = p_version_id and q.id::text = e.key
                  where not exists (select 1 from jsonb_array_elements(q.options) as o where o ->> 'id' = e.value))
      then 'unknown_option'
    when p_answer_mode = 'gaze'
         and exists (select 1 from app.version_questions q where q.version_id = p_version_id and not (p_content -> 'questions') ? q.id::text)
      then 'key_incomplete'
  end
$$;

-- Appends the next revision of a key. The caller holds the answer_keys row. Returns its id and number.
create function app.append_answer_key_revision(
  p_institution_id uuid, p_version_id uuid, p_answer_key_id uuid, p_source text, p_content jsonb, p_version_revision integer,
  p_exercise_revisions jsonb, p_question_revisions jsonb, p_instructions_revision integer, p_generation_id uuid, p_author uuid,
  out o_id uuid, out o_number integer)
language plpgsql
set search_path = ''
as $$
begin
  insert into app.answer_key_revisions (institution_id, version_id, answer_key_id, number, source, content, version_revision,
                                        exercise_revisions, question_revisions, instructions_revision, generation_id, author_user_id)
  values (p_institution_id, p_version_id, p_answer_key_id,
          (select coalesce(max(r.number), 0) + 1 from app.answer_key_revisions r where r.answer_key_id = p_answer_key_id),
          p_source, p_content, p_version_revision, p_exercise_revisions, p_question_revisions, p_instructions_revision,
          p_generation_id, p_author)
  returning id, number into o_id, o_number;
end
$$;

-- A person's edit or confirmation: the revision becomes the current one, corresponds to today's content (so the
-- key is no longer stale), and a running generation is superseded: the person wins. Under the locks of the RPC.
create function app.adopt_answer_key_revision(p_version_id uuid, p_answer_key_id uuid, p_revision_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  update app.generations set status = 'superseded', finished_at = clock_timestamp()
   where version_id = p_version_id and kind = 'answer_key' and status = 'running';
  update app.answer_keys
     set current_revision_id = p_revision_id, current_generation_id = null, stale = false, status = 'ready', error_code = null,
         revision = revision + 1
   where id = p_answer_key_id;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- get_answer_key: the teacher's read. Not audited: it carries no student, profile or recipient. A version that has
-- no key yet is NOT_FOUND no_answer_key (the row is created by the first generation or the first edit; a read
-- never writes). stale is the flag or the comparison, whichever says so.
-- ---------------------------------------------------------------------------------------------

create or replace function api.get_answer_key(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  perform 1 from app.version_target(p_version_id) t;
  select jsonb_build_object(
           'id', k.id, 'versionId', k.version_id, 'status', k.status,
           'stale', k.stale or (r.id is not null and not app.answer_key_matches(r.id, k.version_id)),
           'current', case when r.id is null then null else jsonb_build_object(
             'id', r.id, 'number', r.number, 'source', r.source, 'content', r.content, 'versionRevision', r.version_revision,
             'exerciseRevisions', r.exercise_revisions, 'questionRevisions', r.question_revisions,
             'instructionsRevision', r.instructions_revision, 'createdAt', r.created_at) end,
           'approvedRevisionId', k.approved_revision_id, 'revision', k.revision)
    into v_result
    from app.answer_keys k
    left join app.answer_key_revisions r on r.id = k.current_revision_id
   where k.version_id = p_version_id;
  if v_result is null then
    perform app.raise_error('NOT_FOUND', 'no_answer_key');
  end if;
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- edit_answer_key: the content the teacher sends, with the revisions of today. CAS on p_base_revision_id: null
-- only while there is no current revision (the very first key).
-- ---------------------------------------------------------------------------------------------

create or replace function api.edit_answer_key(p_version_id uuid, p_content jsonb, p_base_revision_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_assessment_id uuid;
  v_group_id uuid;
  v_institution_id uuid;
  v_assessment app.assessments;
  v_version app.versions;
  v_key app.answer_keys;
  v_snapshot record;
  v_problem text;
  v_written record;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_assessment_id, t.o_group_id, t.o_institution_id into v_assessment_id, v_group_id, v_institution_id
    from app.version_target(p_version_id) t;
  if not app.is_answer_key_content(p_content) then
    perform app.raise_error('INVALID', 'invalid_answer_key');
  end if;

  v_assessment := app.assessment_share(v_assessment_id, v_group_id);
  if not app.lock_version_tree(p_version_id, null, null) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform 1 from app.generations g where g.version_id = p_version_id and g.kind = 'answer_key' and g.status = 'running' order by g.id for update;
  perform set_config('tiza.lock_depth', '2', true);
  select * into v_key from app.answer_keys k where k.version_id = p_version_id for update;

  perform app.assert_assessment_writable(v_assessment, v_group_id);
  select * into v_version from app.versions v where v.id = p_version_id;
  if v_version.archived_at is not null then
    perform app.raise_error('INVALID', 'version_archived');
  end if;
  if p_base_revision_id is distinct from v_key.current_revision_id then
    perform app.raise_error('CONFLICT', 'revision_mismatch');
  end if;
  v_problem := app.answer_key_content_problem(p_version_id, p_content, v_version.answer_mode);
  if v_problem is not null then
    perform app.raise_error('INVALID', v_problem);
  end if;

  if v_key.id is null then
    insert into app.answer_keys (institution_id, version_id) values (v_institution_id, p_version_id) returning * into v_key;
  end if;
  select * into v_snapshot from app.answer_key_snapshot(p_version_id);
  select * into v_written from app.append_answer_key_revision(
    v_institution_id, p_version_id, v_key.id, 'edited', p_content, v_version.revision,
    v_snapshot.o_exercises, v_snapshot.o_questions, v_snapshot.o_instructions, null, app.actor_id());
  perform app.adopt_answer_key_revision(p_version_id, v_key.id, v_written.o_id);
  return jsonb_build_object('revisionId', v_written.o_id, 'number', v_written.o_number);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- confirm_answer_key: "the key is still right". A new revision with the content of the base, the correct options
-- of question_keys of today and the revisions of today. In gaze mode, one option for each question.
-- ---------------------------------------------------------------------------------------------

create or replace function api.confirm_answer_key(p_version_id uuid, p_base_revision_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_assessment_id uuid;
  v_group_id uuid;
  v_institution_id uuid;
  v_assessment app.assessments;
  v_version app.versions;
  v_key app.answer_keys;
  v_base app.answer_key_revisions;
  v_content jsonb;
  v_snapshot record;
  v_written record;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_assessment_id, t.o_group_id, t.o_institution_id into v_assessment_id, v_group_id, v_institution_id
    from app.version_target(p_version_id) t;
  if p_base_revision_id is null then
    perform app.raise_error('INVALID', 'revision_required');
  end if;

  v_assessment := app.assessment_share(v_assessment_id, v_group_id);
  if not app.lock_version_tree(p_version_id, null, null) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform 1 from app.generations g where g.version_id = p_version_id and g.kind = 'answer_key' and g.status = 'running' order by g.id for update;
  perform set_config('tiza.lock_depth', '2', true);
  select * into v_key from app.answer_keys k where k.version_id = p_version_id for update;

  perform app.assert_assessment_writable(v_assessment, v_group_id);
  select * into v_version from app.versions v where v.id = p_version_id;
  if v_version.archived_at is not null then
    perform app.raise_error('INVALID', 'version_archived');
  end if;
  if p_base_revision_id is distinct from v_key.current_revision_id then
    perform app.raise_error('CONFLICT', 'revision_mismatch');
  end if;
  select * into v_base from app.answer_key_revisions r where r.id = p_base_revision_id;

  v_content := jsonb_build_object(
    'exercises', v_base.content -> 'exercises',
    'questions', coalesce((select jsonb_object_agg(k.question_id::text, k.correct_option_id) from app.question_keys k where k.version_id = p_version_id), '{}'::jsonb));
  if v_version.answer_mode = 'gaze' and exists (
       select 1 from app.version_questions q where q.version_id = p_version_id and not (v_content -> 'questions') ? q.id::text) then
    perform app.raise_error('INVALID', 'key_incomplete');
  end if;

  select * into v_snapshot from app.answer_key_snapshot(p_version_id);
  select * into v_written from app.append_answer_key_revision(
    v_institution_id, p_version_id, v_key.id, 'confirmed', v_content, v_version.revision,
    v_snapshot.o_exercises, v_snapshot.o_questions, v_snapshot.o_instructions, null, app.actor_id());
  perform app.adopt_answer_key_revision(p_version_id, v_key.id, v_written.o_id);
  return jsonb_build_object('revisionId', v_written.o_id, 'number', v_written.o_number);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- approve_answer_key: marks one revision as the approved one. It must be the current one and still correspond to
-- the version; asking again for the one already approved answers the same without writing. Publishing
-- (T1.5a) compares again: the mark is not trusted.
-- ---------------------------------------------------------------------------------------------

create or replace function api.approve_answer_key(p_version_id uuid, p_revision_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_assessment_id uuid;
  v_group_id uuid;
  v_assessment app.assessments;
  v_version app.versions;
  v_key app.answer_keys;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_assessment_id, t.o_group_id into v_assessment_id, v_group_id from app.version_target(p_version_id) t;
  if p_revision_id is null then
    perform app.raise_error('INVALID', 'revision_required');
  end if;

  v_assessment := app.assessment_share(v_assessment_id, v_group_id);
  if not app.lock_version_tree(p_version_id, null, null) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform set_config('tiza.lock_depth', '2', true);
  select * into v_key from app.answer_keys k where k.version_id = p_version_id for update;
  if v_key.id is null then
    perform app.raise_error('NOT_FOUND', 'no_answer_key');
  end if;
  if not exists (select 1 from app.answer_key_revisions r where r.id = p_revision_id and r.version_id = p_version_id) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  perform app.assert_assessment_writable(v_assessment, v_group_id);
  select * into v_version from app.versions v where v.id = p_version_id;
  if v_version.archived_at is not null then
    perform app.raise_error('INVALID', 'version_archived');
  end if;
  if v_key.current_revision_id is distinct from p_revision_id then
    perform app.raise_error('CONFLICT', 'revision_mismatch');
  end if;
  if not app.answer_key_matches(p_revision_id, p_version_id) then
    perform app.raise_error('CONFLICT', 'stale_answer_key');
  end if;
  if v_key.approved_revision_id is distinct from p_revision_id then
    update app.answer_keys set approved_revision_id = p_revision_id, revision = revision + 1
     where id = v_key.id returning revision into v_key.revision;
  end if;
  return jsonb_build_object('answerKeyId', v_key.id, 'approvedRevisionId', p_revision_id, 'revision', v_key.revision);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- internal_record_answer_key_revision (service_role): the key a generation made. It keeps the snapshot of the
-- inputs of its generation, not today's. It becomes current only if the generation is in force (running and the
-- key's current_generation_id), that snapshot still corresponds to the version and the content is consistent with
-- it; otherwise it is stored as obsolete and touches nothing. One revision per generation: a retry answers the
-- stored one. The output is also stored in generation_outputs (kind answer_key) with its outcome.
-- A content that is not the shape asked for is INVALID: unlike the outputs of T1.4d there is no revision to
-- return for a discarded one.
-- ---------------------------------------------------------------------------------------------

create or replace function api.internal_record_answer_key_revision(p_generation_id uuid, p_content jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_version_id uuid;
  v_kind text;
  v_gen app.generations;
  v_key app.answer_keys;
  v_version app.versions;
  v_existing app.generation_outputs;
  v_revision_id uuid;
  v_number integer;
  v_in_force boolean;
  v_matches boolean;
  v_outcome text;
  v_written record;
begin
  perform app.rpc_begin();
  if p_generation_id is null then
    perform app.raise_error('INVALID', 'invalid_output');
  end if;
  if not app.is_answer_key_content(p_content) then
    perform app.raise_error('INVALID', 'invalid_answer_key');
  end if;
  select g.version_id, g.kind into v_version_id, v_kind from app.generations g where g.id = p_generation_id;  -- no lock
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if v_kind <> 'answer_key' then
    perform app.raise_error('INVALID', 'invalid_generation');
  end if;

  perform app.lock_version_tree(v_version_id, p_generation_id, null);
  select * into v_key from app.answer_keys k where k.version_id = v_version_id for update;
  if v_key.id is null then
    perform app.raise_error('NOT_FOUND', 'no_answer_key');
  end if;

  -- A retry of the same job: the revision and the decision are already there.
  select * into v_existing from app.generation_outputs o where o.generation_id = p_generation_id and o.kind = 'answer_key' and o.version_exercise_id is null;
  if found then
    select r.id, r.number into v_revision_id, v_number from app.answer_key_revisions r where r.generation_id = p_generation_id;
    return jsonb_build_object('revisionId', v_revision_id, 'number', v_number, 'outcome', v_existing.outcome);
  end if;

  select * into v_gen from app.generations g where g.id = p_generation_id;
  select * into v_version from app.versions v where v.id = v_version_id;
  v_in_force := v_gen.status = 'running' and v_key.current_generation_id = v_gen.id;
  v_matches := app.answer_key_snapshot_matches(v_version_id,
    case when jsonb_typeof(v_gen.inputs -> 'exerciseRevisions') = 'object' then v_gen.inputs -> 'exerciseRevisions' end,
    case when jsonb_typeof(v_gen.inputs -> 'questionRevisions') = 'object' then v_gen.inputs -> 'questionRevisions' end,
    case when jsonb_typeof(v_gen.inputs -> 'instructionsRevision') = 'number' then (v_gen.inputs ->> 'instructionsRevision')::integer end);
  v_outcome := case when v_in_force and v_matches
                         and app.answer_key_content_problem(v_version_id, p_content, v_version.answer_mode) is null
                    then 'applied' else 'obsolete' end;

  select * into v_written from app.append_answer_key_revision(
    v_gen.institution_id, v_version_id, v_key.id, 'generated', p_content, v_gen.target_revision,
    case when jsonb_typeof(v_gen.inputs -> 'exerciseRevisions') = 'object' then v_gen.inputs -> 'exerciseRevisions' else '{}'::jsonb end,
    case when jsonb_typeof(v_gen.inputs -> 'questionRevisions') = 'object' then v_gen.inputs -> 'questionRevisions' else '{}'::jsonb end,
    case when jsonb_typeof(v_gen.inputs -> 'instructionsRevision') = 'number' then (v_gen.inputs ->> 'instructionsRevision')::integer else 1 end,
    p_generation_id, null);
  insert into app.generation_outputs (institution_id, version_id, generation_id, version_exercise_id, kind, output, expected_revision, outcome)
  values (v_gen.institution_id, v_version_id, p_generation_id, null, 'answer_key', p_content, v_gen.target_revision, v_outcome);

  if v_outcome = 'applied' then
    update app.answer_keys set current_revision_id = v_written.o_id, stale = false, revision = revision + 1 where id = v_key.id;
  end if;
  return jsonb_build_object('revisionId', v_written.o_id, 'number', v_written.o_number, 'outcome', v_outcome);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- internal_record_generation_output (T1.4d), same signature: a validator that does not say true discards.
-- ---------------------------------------------------------------------------------------------

create or replace function api.internal_record_generation_output(p_generation_id uuid, p_kind text, p_output jsonb, p_version_exercise_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_version_id uuid;
  v_gen app.generations;
  v_existing record;
  v_exercise app.version_exercises;
  v_version app.versions;
  v_in_force boolean;
  v_fresh boolean;
  v_expected integer;
  v_valid boolean;
  v_outcome text;
  v_output_id uuid;
begin
  perform app.rpc_begin();
  if p_generation_id is null or p_kind is null or p_kind not in ('exercise', 'gaze_questions', 'instructions') then
    perform app.raise_error('INVALID', 'invalid_output');
  end if;
  if p_output is null or jsonb_typeof(p_output) <> 'object' or octet_length(p_output::text) > 2000000 then
    perform app.raise_error('INVALID', 'invalid_output');
  end if;
  if (p_kind in ('exercise', 'gaze_questions')) <> (p_version_exercise_id is not null) then
    perform app.raise_error('INVALID', 'invalid_target');
  end if;
  select g.version_id into v_version_id from app.generations g where g.id = p_generation_id;  -- no lock
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  perform app.lock_version_tree(v_version_id, p_generation_id, array_remove(array[p_version_exercise_id], null));

  -- A retry of the same job: the output is already there, answer what was decided then.
  select o.id, o.outcome into v_existing from app.generation_outputs o
   where o.generation_id = p_generation_id and o.kind = p_kind and o.version_exercise_id is not distinct from p_version_exercise_id;
  if found then
    return jsonb_build_object('outputId', v_existing.id, 'outcome', v_existing.outcome);
  end if;

  select * into v_gen from app.generations g where g.id = p_generation_id;
  select * into v_version from app.versions v where v.id = v_version_id;
  -- What does not make sense for this generation is a bug of the caller, not an output to keep.
  if v_gen.kind = 'answer_key' or (v_gen.kind = 'exercise' and p_kind = 'instructions') then
    perform app.raise_error('INVALID', 'invalid_output');
  end if;
  if v_gen.kind = 'exercise' and p_version_exercise_id is distinct from v_gen.target_exercise_id then
    perform app.raise_error('INVALID', 'invalid_target');
  end if;
  if p_version_exercise_id is not null then
    select * into v_exercise from app.version_exercises ve where ve.id = p_version_exercise_id and ve.version_id = v_version_id;
    if not found then
      perform app.raise_error('INVALID', 'invalid_target');
    end if;
  end if;

  v_valid := case p_kind
    when 'exercise' then app.is_generated_exercise(p_output)
    when 'gaze_questions' then app.is_generated_questions(p_output)
    else app.is_generated_instructions(p_output)
  end;

  -- In force: the generation is running and is the one of its resource. Fresh: the target has the revision
  -- the generation started from, or the revision this same generation wrote (a person's edit cleared it).
  if p_kind = 'instructions' then
    v_in_force := v_gen.status = 'running' and v_version.current_generation_id = v_gen.id;
    v_expected := (v_gen.inputs ->> 'instructionsRevision')::integer;
    v_fresh := v_version.instructions_revision = v_expected or v_version.instructions_written_by = v_gen.id;
  else
    v_in_force := v_gen.status = 'running' and v_exercise.current_generation_id = v_gen.id;
    v_expected := coalesce((v_gen.inputs -> 'exerciseRevisions' ->> p_version_exercise_id::text)::integer,
                           case when v_gen.kind = 'exercise' then v_gen.target_revision end);
    v_fresh := v_exercise.revision = v_expected or v_exercise.written_by_generation_id = v_gen.id;
  end if;
  v_outcome := case when v_valid is not true then 'discarded' when v_in_force and v_fresh then 'applied' else 'obsolete' end;

  insert into app.generation_outputs (institution_id, version_id, generation_id, version_exercise_id, kind, output, expected_revision, outcome)
  values (v_gen.institution_id, v_version_id, p_generation_id, p_version_exercise_id, p_kind, p_output, v_expected, v_outcome)
  returning id into v_output_id;

  if v_outcome = 'applied' then
    if p_kind = 'exercise' then
      update app.version_exercises
         set body = p_output ->> 'body',
             changes = coalesce((select jsonb_agg(jsonb_build_object('what', c ->> 'what', 'why', c ->> 'why') order by n)
                                   from jsonb_array_elements(p_output -> 'changes') with ordinality as t(c, n)), '[]'),
             status = 'ready', error_code = null, revision = revision + 1, written_by_generation_id = p_generation_id
       where id = p_version_exercise_id;
    elsif p_kind = 'gaze_questions' then
      -- The questions of the exercise are replaced as a set (their keys go with them: the answer key is
      -- another generation or the teacher). The exercise moves, a person did not write this revision.
      delete from app.version_questions where version_exercise_id = p_version_exercise_id;
      insert into app.version_questions (institution_id, version_id, version_exercise_id, position, stem, options)
      select v_gen.institution_id, v_version_id, p_version_exercise_id, (t.n - 1)::integer, q ->> 'stem', q -> 'options'
        from jsonb_array_elements(p_output -> 'questions') with ordinality as t(q, n);
      update app.version_exercises set revision = revision + 1, written_by_generation_id = p_generation_id
       where id = p_version_exercise_id;
    else
      update app.versions
         set general_instructions = p_output ->> 'instructions', instructions_revision = instructions_revision + 1,
             instructions_written_by = p_generation_id
       where id = v_version_id;
    end if;
    -- Every change of content moves the version, marks the key stale and recalculates the status.
    perform app.touch_version_content(v_version_id);
  end if;
  return jsonb_build_object('outputId', v_output_id, 'outcome', v_outcome);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: nothing in api has a default grant.
-- ---------------------------------------------------------------------------------------------

grant execute on function api.get_answer_key(uuid) to authenticated;
grant execute on function api.edit_answer_key(uuid, jsonb, uuid) to authenticated;
grant execute on function api.confirm_answer_key(uuid, uuid) to authenticated;
grant execute on function api.approve_answer_key(uuid, uuid) to authenticated;
grant execute on function api.internal_record_answer_key_revision(uuid, jsonb) to service_role;
