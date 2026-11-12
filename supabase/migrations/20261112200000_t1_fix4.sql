-- T1.F4: the review of T1.F3 by Codex (F3-2). F3-1 (privacy), F3-3 and F3-4 (tests) need no schema
-- change: the guard app.op_key_frozen already lets an erasure in force for the institution set
-- op_key and op_identity to null together, on any row of that institution (assessments, exercises
-- and versions); which rows the erasure nulls is the rule of lib/domain/permissions/erasure.ts.
--
-- F3-2. The replay of an operation never depends on a reference that can change afterwards. The
-- order in create_group and add_exercise is now: authorization and validations of shape, lock and
-- lookup of the op_key (replay), and only for a new creation the validations of references:
--   * create_group: the subject can be disabled after the group exists (subjects.enabled);
--   * add_exercise: the unit of the syllabus can be deleted after the exercise exists.
-- Same signatures, same grants (CREATE OR REPLACE).

-- ---------------------------------------------------------------------------------------------
-- Exercises: the shape check no longer reads the syllabus; the topic has its own check
-- ---------------------------------------------------------------------------------------------

-- Same signature. Shape only: label and body. p_topic_id and p_group_id stay in the signature (the
-- callers do not change) but are not read here: see app.assert_exercise_topic.
create or replace function app.clean_exercise(p_label text, p_body text, p_topic_id uuid, p_group_id uuid) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_label text := btrim(p_label, E' \t\r\n');
begin
  if v_label is null or char_length(v_label) not between 1 and 20 then
    perform app.raise_error('INVALID', 'invalid_label');
  end if;
  if p_body is null or btrim(p_body, E' \t\r\n') = '' or char_length(p_body) > 20000 then
    perform app.raise_error('INVALID', 'invalid_body');
  end if;
  return v_label;
end
$$;

-- The topic of an exercise must be a unit of the group's current syllabus. A reference: it is
-- checked for a new write, never for the replay of one that already happened.
create function app.assert_exercise_topic(p_topic_id uuid, p_group_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_topic_id is not null and not exists (
       select 1 from app.syllabi s, jsonb_array_elements(s.units) u
        where s.group_id = p_group_id and u ->> 'id' = p_topic_id::text) then
    perform app.raise_error('INVALID', 'unknown_topic');
  end if;
end
$$;

-- Same body as T1.F3, with the topic checked after the replay.
create or replace function api.add_exercise(p_assessment_id uuid, p_label text, p_body text, p_op_key uuid, p_topic_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_group_id uuid;
  v_institution_id uuid;
  v_label text;
  v_identity text;
  v_existing app.assessment_exercises;
  v_count integer;
  v_id uuid;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_group_id, t.o_institution_id into v_group_id, v_institution_id from app.assessment_target(p_assessment_id) t;
  v_label := app.clean_exercise(p_label, p_body, p_topic_id, v_group_id);
  if p_op_key is null then
    perform app.raise_error('INVALID', 'invalid_op_key');
  end if;
  v_identity := encode(sha256(convert_to(
    jsonb_build_array('add_exercise', p_assessment_id, v_label, p_body, p_topic_id)::text, 'utf8')), 'hex');

  -- Before the assessment lock: the replay of an exercise added to an assessment archived since
  -- (or whose unit was deleted since) still answers what it created.
  perform pg_advisory_xact_lock(hashtextextended('tiza.add_exercise:' || v_institution_id::text || ':' || p_op_key::text, 0));
  select * into v_existing from app.assessment_exercises e where e.institution_id = v_institution_id and e.op_key = p_op_key;
  if found then
    if v_existing.op_identity = v_identity then
      return jsonb_build_object('id', v_existing.id, 'revision', 1);
    end if;
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;

  -- A new exercise: now the references.
  perform app.assert_exercise_topic(p_topic_id, v_group_id);
  perform app.assessment_lock(p_assessment_id, v_group_id, true);
  select count(*) into v_count from app.assessment_exercises e where e.assessment_id = p_assessment_id and e.removed_at is null;
  if v_count >= 200 then
    perform app.raise_error('INVALID', 'too_many_exercises');
  end if;
  insert into app.assessment_exercises (institution_id, assessment_id, position, label, body, topic_id, op_key, op_identity)
  values (v_institution_id, p_assessment_id,
          coalesce((select max(e.position) + 1 from app.assessment_exercises e where e.assessment_id = p_assessment_id and e.removed_at is null), 0),
          v_label, p_body, p_topic_id, p_op_key, v_identity)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'revision', 1);
end
$$;

-- Same body as T1.F3 (no op_key to replay), with the topic check that clean_exercise used to do.
create or replace function api.update_exercise(p_exercise_id uuid, p_revision integer, p_label text, p_body text, p_topic_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_assessment_id uuid;
  v_group_id uuid;
  v_label text;
  v_exercise app.assessment_exercises;
  v_revision integer;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select e.assessment_id into v_assessment_id from app.assessment_exercises e where e.id = p_exercise_id;
  select t.o_group_id into v_group_id from app.assessment_target(v_assessment_id) t;
  v_label := app.clean_exercise(p_label, p_body, p_topic_id, v_group_id);
  perform app.assert_exercise_topic(p_topic_id, v_group_id);

  perform app.assessment_lock(v_assessment_id, v_group_id, true);
  select * into v_exercise from app.assessment_exercises e where e.id = p_exercise_id for update;
  if not found or v_exercise.removed_at is not null then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform app.assert_revision(p_revision, v_exercise.revision);
  update app.assessment_exercises set label = v_label, body = p_body, topic_id = p_topic_id, revision = revision + 1
   where id = p_exercise_id returning revision into v_revision;
  if v_label is distinct from v_exercise.label or p_body is distinct from v_exercise.body
     or p_topic_id is distinct from v_exercise.topic_id then
    perform app.mark_versions_stale(v_assessment_id, p_exercise_id);
  end if;
  return jsonb_build_object('id', p_exercise_id, 'revision', v_revision);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- create_group: the subject is checked after the replay
-- ---------------------------------------------------------------------------------------------
create or replace function api.create_group(p_institution_id uuid, p_name text, p_subject_id text, p_school_year integer, p_op_key uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_name text := btrim(p_name, E' \t\r\n');
  v_identity text;
  v_existing app.groups;
  v_group app.groups;
begin
  perform app.rpc_begin();
  v_actor := app.require_actor();
  if not app.is_member(p_institution_id, array['admin', 'teacher', 'inclusion', 'student']) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if not app.is_member(p_institution_id, array['admin', 'teacher']) then
    perform app.raise_error('FORBIDDEN', 'forbidden');
  end if;
  if v_name is null or char_length(v_name) not between 1 and 120 then
    perform app.raise_error('INVALID', 'invalid_name');
  end if;
  if p_school_year is null or p_school_year not between 2020 and 2100 then
    perform app.raise_error('INVALID', 'invalid_school_year');
  end if;
  if p_op_key is null then
    perform app.raise_error('INVALID', 'invalid_op_key');
  end if;
  v_identity := encode(sha256(convert_to(
    jsonb_build_array('create_group', p_institution_id, p_subject_id, p_school_year, v_name)::text, 'utf8')), 'hex');

  -- One lock per (institution, op_key), before anything is read: two copies of the request serialize.
  perform pg_advisory_xact_lock(hashtextextended('tiza.create_group:' || p_institution_id::text || ':' || p_op_key::text, 0));
  select * into v_existing from app.groups g where g.institution_id = p_institution_id and g.op_key = p_op_key;
  if found then
    if v_existing.op_identity = v_identity then
      return jsonb_build_object('id', v_existing.id, 'revision', 1);
    end if;
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;

  -- A new group: now the reference. A subject that is off (not rolled out yet) is as good as
  -- missing; one switched off after the group was created does not undo the replay above.
  if not exists (select 1 from app.subjects s where s.id = p_subject_id and s.enabled) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  insert into app.groups (institution_id, subject_id, name, school_year, created_by, op_key, op_identity)
  values (p_institution_id, p_subject_id, v_name, p_school_year, v_actor, p_op_key, v_identity)
  returning * into v_group;
  insert into app.group_staff (institution_id, group_id, user_id, role)
  values (p_institution_id, v_group.id, v_actor, 'owner');
  return jsonb_build_object('id', v_group.id, 'revision', v_group.revision);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- T14b-1, T14b-2: update_version_config and what is still running for the old configuration
-- ---------------------------------------------------------------------------------------------

-- Same signature. A change of the configuration or the answer mode:
--   * T14b-1: the generations still running for the old configuration (of the version or of one of
--     its exercises) become superseded (terminal), and nothing keeps pointing at them: the
--     version's and the exercises' current_generation_id and the exercises' written_by_generation_id
--     go to null. By the protocol of the generation outputs (C3) an output is applied only when its
--     generation is the one in force for the target; with both columns null no output of the old
--     configuration applies, it is stored as obsolete. An exercise that was 'generating' goes back
--     to what its text says (pending when empty, ready when it has text). Answer key generations
--     are not touched: they follow the stale mark. Locks, in order: assessment, version, its running
--     generations by id, its adapted exercises by id (what app.lock_version_tree does for one
--     generation; here for all of them). The status is recalculated.
--   * T14b-2: the content that goes out of date includes edited instructions (instructions_revision
--     above 1), not only adapted text or a generation in force.
create or replace function api.update_version_config(p_version_id uuid, p_revision integer, p_config jsonb, p_answer_mode text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_assessment_id uuid;
  v_group_id uuid;
  v_config jsonb;
  v_assessment app.assessments;
  v_version app.versions;
  v_revision integer;
  v_has_content boolean;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_assessment_id, t.o_group_id into v_assessment_id, v_group_id from app.version_target(p_version_id) t;
  v_config := app.clean_version_config(p_config);
  if p_answer_mode is null or p_answer_mode not in ('typed', 'gaze', 'voice') then
    perform app.raise_error('INVALID', 'invalid_answer_mode');
  end if;

  v_assessment := app.assessment_lock(v_assessment_id, v_group_id, true);
  if not app.lock_version_tree(p_version_id, null, null) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  select * into v_version from app.versions v where v.id = p_version_id;
  perform app.assert_revision(p_revision, v_version.revision);
  if v_version.archived_at is not null then
    perform app.raise_error('INVALID', 'version_archived');
  end if;
  if app.config_keep_set(v_version.config) is distinct from app.config_keep_set(v_config) then
    perform app.raise_error('INVALID', 'keep_changed');
  end if;
  if v_config = v_version.config and p_answer_mode = v_version.answer_mode then
    return jsonb_build_object('id', p_version_id, 'revision', v_version.revision);
  end if;

  -- The rest of the tree, after the version row: generations, then adapted exercises, each by id.
  perform 1 from app.generations g where g.version_id = p_version_id and g.status = 'running' order by g.id for update;
  perform 1 from app.version_exercises ve where ve.version_id = p_version_id order by ve.id for update;
  perform set_config('tiza.lock_depth', '3', true);

  -- Content made for another configuration is out of date, like content made from an exercise that
  -- changed; it is not touched, only marked. Edited instructions are content too.
  select v_version.current_generation_id is not null or v_version.instructions_revision > 1 or exists (
           select 1 from app.version_exercises ve
            where ve.version_id = p_version_id and (ve.status <> 'pending' or btrim(ve.body) <> '')) into v_has_content;

  update app.generations set status = 'superseded', finished_at = clock_timestamp()
   where version_id = p_version_id and status = 'running' and kind in ('version', 'exercise');
  update app.version_exercises
     set current_generation_id = null, written_by_generation_id = null,
         status = case when status = 'generating' then (case when btrim(body) = '' then 'pending' else 'ready' end) else status end
   where version_id = p_version_id
     and (current_generation_id is not null or written_by_generation_id is not null or status = 'generating');
  update app.versions
     set config = v_config, answer_mode = p_answer_mode, revision = revision + 1, stale = stale or v_has_content,
         current_generation_id = null
   where id = p_version_id returning revision into v_revision;
  perform app.refresh_version_status(p_version_id);
  return jsonb_build_object('id', p_version_id, 'revision', v_revision);
end
$$;
