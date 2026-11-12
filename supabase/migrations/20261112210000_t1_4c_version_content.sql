-- T1.4c: the content of a version (instructions, adapted exercises, questions and their correct option)
-- and the approval of one revision. Replaces the stubs of 20261111131100 (same signatures) and grants
-- EXECUTE to authenticated. No new table. The ticket's own number (20261112160000) was already used.
--
-- Who: only staff of the group of the assessment, like T1.4a and T1.4b. An admin who does not teach the
-- group, inclusion and an enrolled student are FORBIDDEN; a teacher of another group, another institution
-- and an unknown id are NOT_FOUND; no session is FORBIDDEN no_session.
--
-- Locks, in the order of docs/contratos/fase-1.md. An edit of the content takes the group row and the
-- assessment row FOR SHARE (so archiving an assessment and writing in it are ordered, without making two
-- edits of one assessment wait for each other), then the version tree (app.lock_version_tree: the version
-- and the adapted exercise being edited), then the question and its key. Every writer of the content of a
-- version (these RPCs, the outputs of a generation, a change of configuration) takes the version first, so
-- the version row is what orders two edits: the second finds the first's event under the lock.
--
-- Protocol of an edit (CAS, «Orden de locks y revisión»): authorize and validate the shape without a
-- lock; lock; look the op_id up with app.claim_version_op under the lock (the RPC and its exact target are
-- its identity; the data that define the edit are compared too, so the same op_id with another text is a
-- CONFLICT op_key_reused and never a silent success); only then the references that can change (an archived
-- assessment, group or version) and the revision; write; mark the answer key stale; write the event.
-- The replay of an op_id never depends on those references: it answers what was stored even when the
-- assessment was archived since.
--
-- Revisions. Every change of content by a person sets the provenance of what it touches to null
-- (written_by_generation_id, instructions_written_by): the revision that now exists was written by a
-- person, and no later output of a generation applies over it (C3). Editing a question, its options or its
-- correct option bumps the question, its adapted exercise and the version (the answer key, «Clave»).
-- Approving or rejecting is not an edit: neither bumps any revision.
--
-- Approval is of one revision of the version. approve_version needs p_revision = the current revision and
-- the content complete (the status recalculated by app.refresh_version_status is ready: every adapted
-- exercise ready with text, no generation running); any later change leaves approved_revision behind.
-- reject_version records the reasons and, when that same revision was approved, takes the approval back:
-- a rejected revision must not stay publishable.
--
-- A text that looks like it says the solution does not block anything here: the service warns the
-- teacher (revealWarnings over get_version and get_answer_key, «Prueba de fugas»).

-- ---------------------------------------------------------------------------------------------
-- Guards: columns that say where a row belongs never change (P0004).
-- ---------------------------------------------------------------------------------------------

create function app.version_exercises_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assessment_id is distinct from old.assessment_id or new.version_id is distinct from old.version_id
     or new.exercise_id is distinct from old.exercise_id then
    raise exception 'app.version_exercises_frozen: assessment_id, version_id and exercise_id never change' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create trigger version_exercises_frozen
  before update on app.version_exercises
  for each row execute function app.version_exercises_frozen();

create function app.version_questions_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.version_id is distinct from old.version_id or new.version_exercise_id is distinct from old.version_exercise_id then
    raise exception 'app.version_questions_frozen: version_id and version_exercise_id never change' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create trigger version_questions_frozen
  before update on app.version_questions
  for each row execute function app.version_questions_frozen();

create function app.question_keys_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.version_id is distinct from old.version_id or new.question_id is distinct from old.question_id then
    raise exception 'app.question_keys_frozen: version_id and question_id never change' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create trigger question_keys_frozen
  before update on app.question_keys
  for each row execute function app.question_keys_frozen();

-- ---------------------------------------------------------------------------------------------
-- Helpers (SECURITY INVOKER, run by the RPCs as postgres)
-- ---------------------------------------------------------------------------------------------

-- Authorizes an adapted exercise (null or unknown is NOT_FOUND). Reads without locking.
create function app.version_exercise_target(
  p_version_exercise_id uuid, out o_version_id uuid, out o_assessment_id uuid, out o_group_id uuid, out o_institution_id uuid)
language plpgsql
set search_path = ''
as $$
begin
  select ve.version_id, ve.assessment_id, a.group_id, a.institution_id
    into o_version_id, o_assessment_id, o_group_id, o_institution_id
    from app.version_exercises ve join app.assessments a on a.id = ve.assessment_id
   where ve.id = p_version_exercise_id;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform app.assessment_gate(o_group_id);
end
$$;

-- Authorizes a question (null or unknown is NOT_FOUND). Reads without locking.
create function app.question_target(
  p_question_id uuid, out o_version_id uuid, out o_version_exercise_id uuid, out o_assessment_id uuid, out o_group_id uuid,
  out o_institution_id uuid)
language plpgsql
set search_path = ''
as $$
begin
  select q.version_id, q.version_exercise_id, ve.assessment_id, a.group_id, a.institution_id
    into o_version_id, o_version_exercise_id, o_assessment_id, o_group_id, o_institution_id
    from app.version_questions q
    join app.version_exercises ve on ve.id = q.version_exercise_id
    join app.assessments a on a.id = ve.assessment_id
   where q.id = p_question_id;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform app.assessment_gate(o_group_id);
end
$$;

-- Group FOR SHARE, then the assessment FOR SHARE: the first locks of every write of version content.
-- Archiving the assessment (which takes it FOR UPDATE) is ordered against the edit, and two edits of one
-- assessment do not wait for each other here: the version row orders them.
create function app.assessment_share(p_assessment_id uuid, p_group_id uuid) returns app.assessments
language plpgsql
set search_path = ''
as $$
declare
  v_assessment app.assessments;
begin
  perform 1 from app.groups g where g.id = p_group_id for share;
  select * into v_assessment from app.assessments a where a.id = p_assessment_id for share;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  return v_assessment;
end
$$;

-- What every change of content ends with, under the version lock: the version's revision moves (an
-- approval of the old one stops being valid), the answer key is marked stale (publishing compares, it
-- does not trust the flag) and the status is recalculated, whoever wrote the content (C19).
create function app.touch_version_content(p_version_id uuid) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_revision integer;
begin
  update app.versions set revision = revision + 1 where id = p_version_id returning revision into v_revision;
  update app.answer_keys set stale = true where version_id = p_version_id and not stale;
  perform app.refresh_version_status(p_version_id);
  return v_revision;
end
$$;

-- The adapted exercise of a question or key edit: its revision moves and a person now owns it.
create function app.touch_exercise_content(p_version_exercise_id uuid) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_revision integer;
begin
  update app.version_exercises set revision = revision + 1, written_by_generation_id = null
   where id = p_version_exercise_id returning revision into v_revision;
  return v_revision;
end
$$;

-- The event of an operation. The unique (institution_id, op_id) index is the backstop of
-- claim_version_op: the same op_id used at the same time on a version of another assessment (another
-- version lock) is the same CONFLICT, never a raw 23505.
create function app.write_version_event(
  p_institution_id uuid, p_version_id uuid, p_op_id uuid, p_kind text, p_operation text, p_target_id uuid, p_result jsonb,
  p_version_exercise_id uuid, p_version_revision integer, p_exercise_revision integer, p_data jsonb, p_event_id uuid default gen_random_uuid())
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into app.version_events (id, institution_id, version_id, op_id, kind, operation, target_id, result,
                                  version_exercise_id, version_revision, exercise_revision, data, actor_user_id)
  values (p_event_id, p_institution_id, p_version_id, p_op_id, p_kind, p_operation, p_target_id, p_result,
          p_version_exercise_id, p_version_revision, p_exercise_revision, p_data, app.actor_id());
exception when unique_violation then
  perform app.raise_error('CONFLICT', 'op_key_reused');
end
$$;

-- The options of a question as the RPC stores them: 2 to 4 objects with a one-letter id and a text of up to
-- 2000 characters, plus an optional graph (an object: zod validates it deeper). Repeated ids are
-- INVALID options_repeated, anything else off INVALID invalid_options, never a raw CHECK error.
create function app.clean_question_options(p_options jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if p_options is null or jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) not between 2 and 4
     or exists (
       select 1 from jsonb_array_elements(p_options) as o
        where jsonb_typeof(o) <> 'object'
           or exists (select 1 from jsonb_object_keys(o) as k where k not in ('id', 'text', 'graph'))
           or jsonb_typeof(o -> 'id') is distinct from 'string' or (o ->> 'id') !~ '^[A-Z]$'
           or jsonb_typeof(o -> 'text') is distinct from 'string' or char_length(o ->> 'text') > 2000
           or (o ? 'graph' and jsonb_typeof(o -> 'graph') <> 'object')) then
    perform app.raise_error('INVALID', 'invalid_options');
  end if;
  if (select count(distinct o ->> 'id') from jsonb_array_elements(p_options) as o) <> jsonb_array_length(p_options) then
    perform app.raise_error('INVALID', 'options_repeated');
  end if;
  return p_options;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- update_version_instructions: p_revision is the version's instructions_revision.
-- ---------------------------------------------------------------------------------------------

create or replace function api.update_version_instructions(p_version_id uuid, p_revision integer, p_general_instructions text, p_op_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_assessment_id uuid;
  v_group_id uuid;
  v_institution_id uuid;
  v_assessment app.assessments;
  v_event app.version_events;
  v_version app.versions;
  v_instructions_revision integer;
  v_version_revision integer;
  v_result jsonb;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_assessment_id, t.o_group_id, t.o_institution_id into v_assessment_id, v_group_id, v_institution_id
    from app.version_target(p_version_id) t;
  if p_op_id is null then
    perform app.raise_error('INVALID', 'invalid_op_key');
  end if;
  if p_general_instructions is null or char_length(p_general_instructions) > 5000 then
    perform app.raise_error('INVALID', 'invalid_instructions');
  end if;

  v_assessment := app.assessment_share(v_assessment_id, v_group_id);
  if not app.lock_version_tree(p_version_id, null, null) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  v_event := app.claim_version_op(v_institution_id, p_op_id, 'update_version_instructions', p_version_id, p_version_id);
  if v_event.id is not null then
    if v_event.data ->> 'instructions' is not distinct from p_general_instructions then
      return v_event.result;
    end if;
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;

  perform app.assert_assessment_writable(v_assessment, v_group_id);
  select * into v_version from app.versions v where v.id = p_version_id;
  if v_version.archived_at is not null then
    perform app.raise_error('INVALID', 'version_archived');
  end if;
  perform app.assert_revision(p_revision, v_version.instructions_revision);

  update app.versions
     set general_instructions = p_general_instructions, instructions_revision = instructions_revision + 1,
         instructions_written_by = null
   where id = p_version_id returning instructions_revision into v_instructions_revision;
  v_version_revision := app.touch_version_content(p_version_id);
  v_result := jsonb_build_object('id', p_version_id, 'instructionsRevision', v_instructions_revision, 'versionRevision', v_version_revision);
  perform app.write_version_event(v_institution_id, p_version_id, p_op_id, 'edited', 'update_version_instructions', p_version_id, v_result,
                                  null, v_version_revision, null, jsonb_build_object('instructions', p_general_instructions));
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- update_version_exercise: the text of an adapted exercise. With text it is ready, empty it is pending
-- again.
-- ---------------------------------------------------------------------------------------------

create or replace function api.update_version_exercise(p_version_exercise_id uuid, p_revision integer, p_body text, p_op_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_version_id uuid;
  v_assessment_id uuid;
  v_group_id uuid;
  v_institution_id uuid;
  v_assessment app.assessments;
  v_event app.version_events;
  v_version app.versions;
  v_exercise app.version_exercises;
  v_revision integer;
  v_version_revision integer;
  v_result jsonb;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_version_id, t.o_assessment_id, t.o_group_id, t.o_institution_id
    into v_version_id, v_assessment_id, v_group_id, v_institution_id
    from app.version_exercise_target(p_version_exercise_id) t;
  if p_op_id is null then
    perform app.raise_error('INVALID', 'invalid_op_key');
  end if;
  if p_body is null or char_length(p_body) > 20000 then
    perform app.raise_error('INVALID', 'invalid_body');
  end if;

  v_assessment := app.assessment_share(v_assessment_id, v_group_id);
  if not app.lock_version_tree(v_version_id, null, array[p_version_exercise_id]) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  -- Under the lock: has this op_id been applied? Its identity is this RPC, this exercise and the text.
  v_event := app.claim_version_op(v_institution_id, p_op_id, 'update_version_exercise', v_version_id, p_version_exercise_id);
  if v_event.id is not null then
    if v_event.data ->> 'body' is not distinct from p_body then
      return v_event.result;
    end if;
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;

  perform app.assert_assessment_writable(v_assessment, v_group_id);
  select * into v_version from app.versions v where v.id = v_version_id;
  if v_version.archived_at is not null then
    perform app.raise_error('INVALID', 'version_archived');
  end if;
  select * into v_exercise from app.version_exercises ve where ve.id = p_version_exercise_id;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform app.assert_revision(p_revision, v_exercise.revision);

  -- A person wrote this revision: written_by_generation_id goes to null, so nothing a generation still
  -- has to deliver for this exercise applies over it.
  update app.version_exercises
     set body = p_body, revision = revision + 1, written_by_generation_id = null,
         status = case when btrim(p_body, E' \t\r\n') <> '' then 'ready' else 'pending' end, error_code = null
   where id = p_version_exercise_id returning revision into v_revision;
  v_version_revision := app.touch_version_content(v_version_id);
  v_result := jsonb_build_object('id', p_version_exercise_id, 'revision', v_revision, 'versionRevision', v_version_revision);
  perform app.write_version_event(v_institution_id, v_version_id, p_op_id, 'edited', 'update_version_exercise', p_version_exercise_id, v_result,
                                  p_version_exercise_id, v_version_revision, v_revision, jsonb_build_object('body', p_body));
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- update_version_question: the stem and the options. The correct option cannot be taken out by an edit:
-- the key is changed first (set_question_key).
-- ---------------------------------------------------------------------------------------------

create or replace function api.update_version_question(p_question_id uuid, p_revision integer, p_stem text, p_options jsonb, p_op_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_version_id uuid;
  v_exercise_id uuid;
  v_assessment_id uuid;
  v_group_id uuid;
  v_institution_id uuid;
  v_assessment app.assessments;
  v_event app.version_events;
  v_version app.versions;
  v_question app.version_questions;
  v_correct text;
  v_revision integer;
  v_exercise_revision integer;
  v_version_revision integer;
  v_data jsonb;
  v_result jsonb;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_version_id, t.o_version_exercise_id, t.o_assessment_id, t.o_group_id, t.o_institution_id
    into v_version_id, v_exercise_id, v_assessment_id, v_group_id, v_institution_id
    from app.question_target(p_question_id) t;
  if p_op_id is null then
    perform app.raise_error('INVALID', 'invalid_op_key');
  end if;
  if p_stem is null or btrim(p_stem, E' \t\r\n') = '' or char_length(p_stem) > 5000 then
    perform app.raise_error('INVALID', 'invalid_stem');
  end if;
  perform app.clean_question_options(p_options);
  v_data := jsonb_build_object('stem', p_stem, 'options', p_options);

  v_assessment := app.assessment_share(v_assessment_id, v_group_id);
  if not app.lock_version_tree(v_version_id, null, array[v_exercise_id]) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  select * into v_question from app.version_questions q where q.id = p_question_id for update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  select k.correct_option_id into v_correct from app.question_keys k where k.question_id = p_question_id for update;

  v_event := app.claim_version_op(v_institution_id, p_op_id, 'update_version_question', v_version_id, p_question_id);
  if v_event.id is not null then
    if v_event.data = v_data then
      return v_event.result;
    end if;
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;

  perform app.assert_assessment_writable(v_assessment, v_group_id);
  select * into v_version from app.versions v where v.id = v_version_id;
  if v_version.archived_at is not null then
    perform app.raise_error('INVALID', 'version_archived');
  end if;
  perform app.assert_revision(p_revision, v_question.revision);
  if v_correct is not null and not exists (select 1 from jsonb_array_elements(p_options) as o where o ->> 'id' = v_correct) then
    perform app.raise_error('INVALID', 'correct_option_removed');
  end if;

  update app.version_questions set stem = p_stem, options = p_options, revision = revision + 1
   where id = p_question_id returning revision into v_revision;
  v_exercise_revision := app.touch_exercise_content(v_exercise_id);
  v_version_revision := app.touch_version_content(v_version_id);
  v_result := jsonb_build_object('id', p_question_id, 'revision', v_revision, 'versionRevision', v_version_revision);
  perform app.write_version_event(v_institution_id, v_version_id, p_op_id, 'edited', 'update_version_question', p_question_id, v_result,
                                  v_exercise_id, v_version_revision, v_exercise_revision, v_data);
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- set_question_key: the correct option of a question. p_revision is the revision of the key (null when the
-- question has none yet). It carries no op_key: asking for the option the key already has is a
-- no-op that answers the current key (so the second copy of a request answers the same as the first), and
-- any other option needs the revision the caller read (revision_mismatch).
-- ---------------------------------------------------------------------------------------------

create or replace function api.set_question_key(p_question_id uuid, p_correct_option_id text, p_revision integer default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_version_id uuid;
  v_exercise_id uuid;
  v_assessment_id uuid;
  v_group_id uuid;
  v_institution_id uuid;
  v_assessment app.assessments;
  v_version app.versions;
  v_question app.version_questions;
  v_key app.question_keys;
  v_key_revision integer;
  v_exercise_revision integer;
  v_version_revision integer;
  v_result jsonb;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_version_id, t.o_version_exercise_id, t.o_assessment_id, t.o_group_id, t.o_institution_id
    into v_version_id, v_exercise_id, v_assessment_id, v_group_id, v_institution_id
    from app.question_target(p_question_id) t;
  if p_correct_option_id is null or p_correct_option_id !~ '^[A-Z]$' then
    perform app.raise_error('INVALID', 'unknown_option');
  end if;

  v_assessment := app.assessment_share(v_assessment_id, v_group_id);
  if not app.lock_version_tree(v_version_id, null, array[v_exercise_id]) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  select * into v_question from app.version_questions q where q.id = p_question_id for update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  select * into v_key from app.question_keys k where k.question_id = p_question_id for update;
  -- The same option again, whoever sent it first: nothing to write.
  if v_key.id is not null and v_key.correct_option_id = p_correct_option_id then
    return jsonb_build_object('questionId', p_question_id, 'revision', v_key.revision);
  end if;

  perform app.assert_assessment_writable(v_assessment, v_group_id);
  select * into v_version from app.versions v where v.id = v_version_id;
  if v_version.archived_at is not null then
    perform app.raise_error('INVALID', 'version_archived');
  end if;
  if not exists (select 1 from jsonb_array_elements(v_question.options) as o where o ->> 'id' = p_correct_option_id) then
    perform app.raise_error('INVALID', 'unknown_option');
  end if;
  -- No key yet: the caller must not have sent one. A key: the caller must have read this revision.
  if p_revision is distinct from v_key.revision then
    perform app.raise_error('CONFLICT', 'revision_mismatch');
  end if;

  if v_key.id is null then
    insert into app.question_keys (institution_id, version_id, question_id, correct_option_id)
    values (v_institution_id, v_version_id, p_question_id, p_correct_option_id)
    returning revision into v_key_revision;
  else
    update app.question_keys set correct_option_id = p_correct_option_id, revision = revision + 1
     where id = v_key.id returning revision into v_key_revision;
  end if;
  update app.version_questions set revision = revision + 1 where id = p_question_id;
  v_exercise_revision := app.touch_exercise_content(v_exercise_id);
  v_version_revision := app.touch_version_content(v_version_id);
  v_result := jsonb_build_object('questionId', p_question_id, 'revision', v_key_revision);
  -- No op_id comes with this call: the event gets its own, so the feedback is not lost.
  perform app.write_version_event(v_institution_id, v_version_id, gen_random_uuid(), 'edited', 'set_question_key', p_question_id, v_result,
                                  v_exercise_id, v_version_revision, v_exercise_revision,
                                  jsonb_build_object('correctOptionId', p_correct_option_id));
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- approve_version
-- ---------------------------------------------------------------------------------------------

create or replace function api.approve_version(p_version_id uuid, p_revision integer, p_op_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_assessment_id uuid;
  v_group_id uuid;
  v_institution_id uuid;
  v_assessment app.assessments;
  v_event app.version_events;
  v_version app.versions;
  v_result jsonb;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_assessment_id, t.o_group_id, t.o_institution_id into v_assessment_id, v_group_id, v_institution_id
    from app.version_target(p_version_id) t;
  if p_op_id is null then
    perform app.raise_error('INVALID', 'invalid_op_key');
  end if;

  v_assessment := app.assessment_share(v_assessment_id, v_group_id);
  if not app.lock_version_tree(p_version_id, null, null) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  -- Its identity is this RPC, this version and the revision it approved.
  v_event := app.claim_version_op(v_institution_id, p_op_id, 'approve_version', p_version_id, p_version_id);
  if v_event.id is not null then
    if v_event.data -> 'revision' is not distinct from to_jsonb(p_revision) then
      return v_event.result;
    end if;
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;

  perform app.assert_assessment_writable(v_assessment, v_group_id);
  select * into v_version from app.versions v where v.id = p_version_id;
  if v_version.archived_at is not null then
    perform app.raise_error('INVALID', 'version_archived');
  end if;
  perform app.assert_revision(p_revision, v_version.revision);
  -- The content is complete when the recalculated status is ready: every adapted exercise ready with
  -- text and no generation running. A version made by hand, with no generation, gets there too.
  if app.refresh_version_status(p_version_id) <> 'ready' then
    perform app.raise_error('CONFLICT', 'content_incomplete');
  end if;

  update app.versions set approved_revision = revision where id = p_version_id;
  v_result := jsonb_build_object('id', p_version_id, 'approvedRevision', v_version.revision);
  perform app.write_version_event(v_institution_id, p_version_id, p_op_id, 'approved', 'approve_version', p_version_id, v_result,
                                  null, v_version.revision, null, jsonb_build_object('revision', v_version.revision));
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- reject_version
-- ---------------------------------------------------------------------------------------------

create or replace function api.reject_version(p_version_id uuid, p_revision integer, p_reasons text[], p_op_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_assessment_id uuid;
  v_group_id uuid;
  v_institution_id uuid;
  v_assessment app.assessments;
  v_event app.version_events;
  v_version app.versions;
  v_event_id uuid := gen_random_uuid();
  v_result jsonb;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_assessment_id, t.o_group_id, t.o_institution_id into v_assessment_id, v_group_id, v_institution_id
    from app.version_target(p_version_id) t;
  if p_op_id is null then
    perform app.raise_error('INVALID', 'invalid_op_key');
  end if;
  if p_reasons is null or cardinality(p_reasons) not between 1 and 10
     or exists (select 1 from unnest(p_reasons) as r where r is null or r !~ '^[a-z][a-z_]{1,40}$') then
    perform app.raise_error('INVALID', 'invalid_reasons');
  end if;

  v_assessment := app.assessment_share(v_assessment_id, v_group_id);
  if not app.lock_version_tree(p_version_id, null, null) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  v_event := app.claim_version_op(v_institution_id, p_op_id, 'reject_version', p_version_id, p_version_id);
  if v_event.id is not null then
    if v_event.data -> 'reasons' is not distinct from to_jsonb(p_reasons) then
      return v_event.result;
    end if;
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;

  perform app.assert_assessment_writable(v_assessment, v_group_id);
  select * into v_version from app.versions v where v.id = p_version_id;
  if v_version.archived_at is not null then
    perform app.raise_error('INVALID', 'version_archived');
  end if;
  perform app.assert_revision(p_revision, v_version.revision);

  -- A rejected revision is not approved: otherwise it would stay publishable.
  update app.versions set approved_revision = null where id = p_version_id and approved_revision is not null;
  v_result := jsonb_build_object('eventId', v_event_id);
  perform app.write_version_event(v_institution_id, p_version_id, p_op_id, 'rejected', 'reject_version', p_version_id, v_result,
                                  null, v_version.revision, null,
                                  jsonb_build_object('reasons', to_jsonb(p_reasons), 'revision', v_version.revision), v_event_id);
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: nothing in api has a default grant.
-- ---------------------------------------------------------------------------------------------

grant execute on function api.update_version_instructions(uuid, integer, text, uuid) to authenticated;
grant execute on function api.update_version_exercise(uuid, integer, text, uuid) to authenticated;
grant execute on function api.update_version_question(uuid, integer, text, jsonb, uuid) to authenticated;
grant execute on function api.set_question_key(uuid, text, integer) to authenticated;
grant execute on function api.approve_version(uuid, integer, uuid) to authenticated;
grant execute on function api.reject_version(uuid, integer, text[], uuid) to authenticated;
