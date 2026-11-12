-- T1.4d: generations, internal (service_role only). Replaces the stubs of 20261111131100 (same signatures)
-- and grants EXECUTE to service_role. No new table and no new column. The ticket's own number (20261112170000)
-- was already used.
--
-- The three RPCs follow the lock order of docs/contratos/fase-1.md: the version, then its generations, then
-- its adapted exercises by id (app.lock_version_tree). Every writer of the content of a version takes the
-- version first, so the version row is what orders a generation against a manual edit, a change of
-- configuration and another generation.
--
-- internal_create_generation. The identity of a request is what the generation row itself stores and never
-- changes (the guard below freezes it): the version, the kind, the target, the profiles hash and revision, the
-- prompt version, the number of jobs and the inputs the caller sent (the starting revisions the RPC adds are
-- left out of the comparison). Who asked is not part of it: the account can be deleted and the column goes to
-- null. The lookup is under an advisory lock on (institution, op_key), before any row lock and before any
-- reference that can change (an assessment archived since, a version archived since): a replay answers
-- { id, created: false } whatever happened to them. The same op_key with another identity is CONFLICT
-- op_key_reused, never a second generation. No hash of the inputs is stored: they can hold personal text, and
-- a hash would be a second copy that an erasure would also have to forget (it only redacts the inputs; after
-- that, a replay of that op_key is a CONFLICT, which is safe). A new one
-- takes the assessment FOR SHARE (like the edits of T1.4c), the version tree, and applies «Vigencia»:
--   * kind version: the running generations of kind version and exercise of the version become superseded;
--     the new one is the version's generation in force and every adapted exercise is generating under it;
--   * kind exercise: only the running generation of that exercise becomes superseded; other exercises (and a
--     version generation, which keeps its other exercises) are not touched;
--   * kind answer_key: only the running answer key generation becomes superseded; the adaptation is not
--     touched, and the answer key row (created here if it does not exist yet) points at the new one.
-- Terminal states never reopen: a generation that is not running is never touched again, and each new one is
-- a new row. inputs keeps what the caller sent plus the starting revisions read under the lock:
-- exerciseRevisions { adapted exercise: revision }, questionRevisions { question: revision } and
-- instructionsRevision. The caller cannot set these keys: the RPC overwrites them.
--
-- internal_record_generation_output. Always stores the output (unique per generation, kind and exercise, so a
-- retry returns what was decided the first time, without applying it twice) and applies it only if the
-- generation is running, is the one in force for the target (the version's for the instructions, the
-- exercise's for an exercise or its questions) and the target has the revision the generation started from
-- or a later one that this same generation wrote (written_by_generation_id, instructions_written_by): the
-- text and the gaze questions of one exercise, and the instructions, land in any order (C3). A manual edit
-- sets the provenance to null, so a later output of the generation is obsolete: the person always wins. An
-- output that arrives after its generation closed (or was superseded) is stored as obsolete and touches
-- nothing. An output that does not have the expected shape is stored as discarded and touches nothing (the
-- caller validates with zod first; this is the backstop, and the raw output is not lost). What does not make
-- sense for the generation (an answer key output here, an exercise that is not its target) is INVALID.
--
-- internal_finish_generation. Closes a running generation once (done, failed or cancelled). Anything else
-- answers what it already is with changed false. The exercises that were still generating under it go back to
-- what their text says (cancelled and done) or to error (failed); a failed or cancelled generation stops being
-- the one in force. On done, one 'generated' event with op_id = the generation id (the unique indexes are the
-- backstop: two jobs closing the same generation write one). The status of the version is recalculated.

-- What a generation was asked never changes: its identity is compared from these columns (see above).
create or replace function app.generations_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'running' and new.status is distinct from old.status then
    raise exception 'app.generations_guard: a finished generation never reopens' using errcode = 'P0004';
  end if;
  -- Inside an erasure only inputs may change (redacting a student's free text); the rest never.
  if new.version_id <> old.version_id or new.kind <> old.kind or new.op_key <> old.op_key
     or new.profiles_hash <> old.profiles_hash or new.profiles_revision <> old.profiles_revision or new.prompt_version <> old.prompt_version
     or new.required_jobs <> old.required_jobs or new.subject_id <> old.subject_id or new.target_revision <> old.target_revision
     or (new.inputs <> old.inputs
         and not app.redaction_allowed('generations', new.institution_id, to_jsonb(old), to_jsonb(new)))
     or new.target_exercise_id is distinct from old.target_exercise_id then
    raise exception 'app.generations_guard: what a generation was asked never changes' using errcode = 'P0004';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Shape of what the AI returns (the backstop of the zod schemas of the service). Never raises.
-- ---------------------------------------------------------------------------------------------

-- { body, changes? }: the text of an adapted exercise and, for the teacher, what changed and why.
create function app.is_generated_exercise(p_output jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_output -> 'body') = 'string'
     and char_length(p_output ->> 'body') between 1 and 20000
     and btrim(p_output ->> 'body') <> ''
     and (not p_output ? 'changes' or (
           jsonb_typeof(p_output -> 'changes') = 'array'
       and jsonb_array_length(p_output -> 'changes') <= 20
       and not exists (
             select 1 from jsonb_array_elements(p_output -> 'changes') as c
              where jsonb_typeof(c) <> 'object'
                 or jsonb_typeof(c -> 'what') is distinct from 'string' or char_length(c ->> 'what') > 500
                 or jsonb_typeof(c -> 'why') is distinct from 'string' or char_length(c ->> 'why') > 1000)))
$$;

-- { questions: [{ stem, options }] }: 1 to 10 questions, each with an enunciation and 2 to 4 options with a
-- one-letter id and a text. The correct option is not part of it: it comes from the answer key.
create function app.is_generated_questions(p_output jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_output -> 'questions') = 'array'
     and jsonb_array_length(p_output -> 'questions') between 1 and 10
     and not exists (
           select 1 from jsonb_array_elements(p_output -> 'questions') as q
            where jsonb_typeof(q) <> 'object'
               or jsonb_typeof(q -> 'stem') is distinct from 'string' or char_length(q ->> 'stem') not between 1 and 5000
               or btrim(q ->> 'stem') = ''
               or not app.is_option_list(q -> 'options')
               or exists (
                    select 1 from jsonb_array_elements(q -> 'options') as o
                     where jsonb_typeof(o -> 'text') is distinct from 'string' or char_length(o ->> 'text') > 2000
                        or exists (select 1 from jsonb_object_keys(o) as k where k not in ('id', 'text', 'graph'))
                        or (o ? 'graph' and jsonb_typeof(o -> 'graph') <> 'object')))
$$;

-- { instructions }: the general instructions of the version, empty allowed.
create function app.is_generated_instructions(p_output jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_output -> 'instructions') = 'string' and char_length(p_output ->> 'instructions') <= 5000
$$;

-- ---------------------------------------------------------------------------------------------
-- internal_create_generation
-- ---------------------------------------------------------------------------------------------

create or replace function api.internal_create_generation(
  p_version_id uuid, p_kind text, p_op_key uuid, p_inputs jsonb, p_profiles_hash text, p_profiles_revision text,
  p_prompt_version text, p_required_jobs integer, p_target_exercise_id uuid default null, p_requested_by uuid default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_assessment_id uuid;
  v_group_id uuid;
  v_institution_id uuid;
  v_subject_id text;
  v_existing app.generations;
  v_assessment app.assessments;
  v_version app.versions;
  v_exercise app.version_exercises;
  v_id uuid;
  v_target_revision integer;
  v_exercise_revisions jsonb;
  v_question_revisions jsonb;
begin
  perform app.rpc_begin();
  if p_version_id is null or p_op_key is null then
    perform app.raise_error('INVALID', 'invalid_op_key');
  end if;
  if p_kind is null or p_kind not in ('version', 'exercise', 'answer_key')
     or p_inputs is null or jsonb_typeof(p_inputs) <> 'object' or octet_length(p_inputs::text) > 2000000
     or p_profiles_hash is null or p_profiles_hash !~ '^[0-9a-f]{64}$'
     or p_profiles_revision is null or char_length(p_profiles_revision) not between 1 and 80
     or p_prompt_version is null or char_length(p_prompt_version) not between 1 and 80
     or p_required_jobs is null or p_required_jobs not between 0 and 200 then
    perform app.raise_error('INVALID', 'invalid_generation');
  end if;
  if (p_kind = 'exercise') <> (p_target_exercise_id is not null) then
    perform app.raise_error('INVALID', 'invalid_target');
  end if;
  select v.assessment_id, a.group_id, a.institution_id, a.subject_id
    into v_assessment_id, v_group_id, v_institution_id, v_subject_id
    from app.versions v join app.assessments a on a.id = v.assessment_id
   where v.id = p_version_id;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  -- Before any row lock and before any reference that can change: a replay answers what was created.
  perform pg_advisory_xact_lock(hashtextextended('tiza.create_generation:' || v_institution_id::text || ':' || p_op_key::text, 0));
  select * into v_existing from app.generations g where g.institution_id = v_institution_id and g.op_key = p_op_key;
  if found then
    if v_existing.version_id = p_version_id and v_existing.kind = p_kind
       and v_existing.target_exercise_id is not distinct from p_target_exercise_id
       and v_existing.profiles_hash = p_profiles_hash and v_existing.profiles_revision = p_profiles_revision
       and v_existing.prompt_version = p_prompt_version and v_existing.required_jobs = p_required_jobs
       and (v_existing.inputs - 'exerciseRevisions' - 'questionRevisions' - 'instructionsRevision')
           = (p_inputs - 'exerciseRevisions' - 'questionRevisions' - 'instructionsRevision') then
      return jsonb_build_object('id', v_existing.id, 'created', false);
    end if;
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;

  if p_requested_by is not null and not exists (select 1 from app.app_users u where u.id = p_requested_by) then
    perform app.raise_error('INVALID', 'invalid_generation');
  end if;

  -- A new generation: the assessment FOR SHARE, the version, its running generations by id, then the
  -- adapted exercises it will mark, by id.
  v_assessment := app.assessment_share(v_assessment_id, v_group_id);
  perform app.assert_assessment_writable(v_assessment, v_group_id);
  if not app.lock_version_tree(p_version_id, null, null) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform 1 from app.generations g where g.version_id = p_version_id and g.status = 'running' order by g.id for update;
  if p_kind = 'version' then
    perform 1 from app.version_exercises ve where ve.version_id = p_version_id order by ve.id for update;
  elsif p_kind = 'exercise' then
    perform 1 from app.version_exercises ve where ve.version_id = p_version_id and ve.id = p_target_exercise_id for update;
  end if;
  perform set_config('tiza.lock_depth', '3', true);

  select * into v_version from app.versions v where v.id = p_version_id;
  if v_version.archived_at is not null then
    perform app.raise_error('INVALID', 'version_archived');
  end if;
  if p_kind = 'exercise' then
    select * into v_exercise from app.version_exercises ve where ve.id = p_target_exercise_id and ve.version_id = p_version_id;
    if not found then
      perform app.raise_error('INVALID', 'invalid_target');
    end if;
    v_target_revision := v_exercise.revision;
  else
    v_target_revision := v_version.revision;
  end if;

  -- The starting revisions, read under the version lock: no writer of content can move them meanwhile.
  select coalesce(jsonb_object_agg(ve.id::text, ve.revision), '{}') into v_exercise_revisions
    from app.version_exercises ve
   where ve.version_id = p_version_id and (p_kind <> 'exercise' or ve.id = p_target_exercise_id);
  select coalesce(jsonb_object_agg(q.id::text, q.revision), '{}') into v_question_revisions
    from app.version_questions q
   where q.version_id = p_version_id and (p_kind <> 'exercise' or q.version_exercise_id = p_target_exercise_id);

  -- Vigencia. Terminal states never reopen: only running generations are replaced, each by a new row.
  if p_kind = 'version' then
    update app.generations set status = 'superseded', finished_at = clock_timestamp()
     where version_id = p_version_id and status = 'running' and kind in ('version', 'exercise');
  elsif p_kind = 'exercise' then
    update app.generations set status = 'superseded', finished_at = clock_timestamp()
     where version_id = p_version_id and status = 'running' and kind = 'exercise' and target_exercise_id = p_target_exercise_id;
  else
    update app.generations set status = 'superseded', finished_at = clock_timestamp()
     where version_id = p_version_id and status = 'running' and kind = 'answer_key';
  end if;

  insert into app.generations (institution_id, version_id, kind, target_exercise_id, target_revision, op_key, subject_id,
                               inputs, profiles_hash, profiles_revision, prompt_version, required_jobs, requested_by)
  values (v_institution_id, p_version_id, p_kind, p_target_exercise_id, v_target_revision, p_op_key, v_subject_id,
          p_inputs || jsonb_build_object('exerciseRevisions', v_exercise_revisions, 'questionRevisions', v_question_revisions,
                                         'instructionsRevision', v_version.instructions_revision),
          p_profiles_hash, p_profiles_revision, p_prompt_version, p_required_jobs, p_requested_by)
  returning id into v_id;

  if p_kind = 'version' then
    update app.version_exercises set current_generation_id = v_id, status = 'generating', error_code = null
     where version_id = p_version_id;
    update app.versions set current_generation_id = v_id, error_code = null where id = p_version_id;
  elsif p_kind = 'exercise' then
    update app.version_exercises set current_generation_id = v_id, status = 'generating', error_code = null
     where id = p_target_exercise_id;
  else
    -- The key has its own vigencia: the adaptation is not touched.
    insert into app.answer_keys (institution_id, version_id, current_generation_id, status)
    values (v_institution_id, p_version_id, v_id, 'generating')
    on conflict (version_id) do update set current_generation_id = v_id, status = 'generating', error_code = null;
  end if;
  perform app.refresh_version_status(p_version_id);
  return jsonb_build_object('id', v_id, 'created', true);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- internal_record_generation_output
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
  v_outcome := case when not v_valid then 'discarded' when v_in_force and v_fresh then 'applied' else 'obsolete' end;

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
-- internal_finish_generation
-- ---------------------------------------------------------------------------------------------

create or replace function api.internal_finish_generation(p_generation_id uuid, p_status text, p_error_code text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_version_id uuid;
  v_gen app.generations;
  v_version app.versions;
  v_applied integer;
  v_obsolete integer;
  v_discarded integer;
begin
  perform app.rpc_begin();
  if p_generation_id is null or p_status is null or p_status not in ('done', 'failed', 'cancelled') then
    perform app.raise_error('INVALID', 'invalid_status');
  end if;
  if p_error_code is not null and (p_status = 'done' or p_error_code !~ '^[a-z][a-z0-9_]{1,62}$') then
    perform app.raise_error('INVALID', 'invalid_error_code');
  end if;
  select g.version_id into v_version_id from app.generations g where g.id = p_generation_id;  -- no lock
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  perform app.lock_version_tree(v_version_id, p_generation_id, null);
  select * into v_gen from app.generations g where g.id = p_generation_id;
  -- Closing is idempotent: a generation that is no longer running is never touched again.
  if v_gen.status <> 'running' then
    return jsonb_build_object('id', p_generation_id, 'status', v_gen.status, 'changed', false);
  end if;
  perform 1 from app.version_exercises ve where ve.version_id = v_version_id and ve.current_generation_id = p_generation_id order by ve.id for update;
  perform set_config('tiza.lock_depth', '3', true);

  update app.generations set status = p_status, error_code = p_error_code, finished_at = clock_timestamp() where id = p_generation_id;

  if v_gen.kind in ('version', 'exercise') then
    -- What was still generating under it goes to error when it failed, back to what its text says otherwise.
    update app.version_exercises
       set status = case
             when status <> 'generating' then status
             when p_status = 'failed' then 'error'
             when btrim(body) = '' then 'pending' else 'ready' end,
           error_code = case when status = 'generating' and p_status = 'failed' then p_error_code else error_code end,
           -- A generation that did not complete is not the one in force any more.
           current_generation_id = case when p_status = 'done' then current_generation_id else null end
     where version_id = v_version_id and current_generation_id = p_generation_id;
    if v_gen.kind = 'version' then
      update app.versions
         set error_code = case when p_status = 'failed' then p_error_code else null end,
             current_generation_id = case when p_status = 'done' then current_generation_id else null end
       where id = v_version_id and current_generation_id = p_generation_id;
    end if;
  else
    update app.answer_keys
       set status = case when p_status = 'failed' then 'error' when current_revision_id is not null then 'ready' else 'empty' end,
           error_code = case when p_status = 'failed' then p_error_code end,
           current_generation_id = case when p_status = 'done' then current_generation_id else null end
     where version_id = v_version_id and current_generation_id = p_generation_id;
  end if;
  perform app.refresh_version_status(v_version_id);

  if p_status = 'done' then
    select * into v_version from app.versions v where v.id = v_version_id;
    select count(*) filter (where o.outcome = 'applied'), count(*) filter (where o.outcome = 'obsolete'), count(*) filter (where o.outcome = 'discarded')
      into v_applied, v_obsolete, v_discarded from app.generation_outputs o where o.generation_id = p_generation_id;
    begin
      insert into app.version_events (institution_id, version_id, op_id, kind, operation, target_id, result, generation_id,
                                      version_exercise_id, version_revision, data, actor_user_id)
      values (v_gen.institution_id, v_version_id, p_generation_id, 'generated', 'internal_finish_generation', p_generation_id,
              jsonb_build_object('id', p_generation_id, 'status', 'done', 'changed', true), p_generation_id,
              v_gen.target_exercise_id, v_version.revision,
              jsonb_build_object('kind', v_gen.kind, 'applied', v_applied, 'obsolete', v_obsolete, 'discarded', v_discarded),
              v_gen.requested_by);
    exception when unique_violation then
      perform app.raise_error('CONFLICT', 'op_key_reused');
    end;
  end if;
  return jsonb_build_object('id', p_generation_id, 'status', p_status, 'changed', true);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: internal, service_role only.
-- ---------------------------------------------------------------------------------------------

grant execute on function api.internal_create_generation(uuid, text, uuid, jsonb, text, text, text, integer, uuid, uuid) to service_role;
grant execute on function api.internal_record_generation_output(uuid, text, jsonb, uuid) to service_role;
grant execute on function api.internal_finish_generation(uuid, text, text) to service_role;
