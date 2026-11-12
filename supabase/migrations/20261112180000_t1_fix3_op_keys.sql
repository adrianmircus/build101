-- T1.F3: every RPC that creates a row a person can trigger twice is idempotent (contract sweep).
-- The inventory, with what each RPC had before and why the others are left out, is in
-- docs/contratos/fase-1.md («Idempotencia de las altas»). Also the T1.4a review (T14a-1, T14a-4).
--
-- 1. Implemented RPCs that created rows without an operation key get a required p_op_key (DROP of
--    the old signature + CREATE, same grants): create_group, create_assessment and add_exercise. A
--    double submit created two rows. Same protocol as create_student_note (T1.F2):
--      * the row stores op_key and op_identity: the sha256 of the jsonb array of what defines the
--        creation, as it was then (jsonb text, so no separator can make two inputs collide). It is
--        never rebuilt from the row: names, texts and topics can be edited afterwards;
--      * op_key is unique per institution (like generations, operations, account_provisioning and
--        import_runs): the same key reused on another resource is CONFLICT op_key_reused, never a
--        second row;
--      * an advisory lock on (institution, op_key) is taken before any row lock and before the
--        lookup, so two copies of the same request serialize and the second finds the first's row.
--        Under it: the same identity answers the original result ({id, revision: 1}, even if the
--        row was edited, archived or removed later), another identity is CONFLICT op_key_reused;
--      * a null p_op_key is INVALID invalid_op_key (no default: a request without an identity is
--        exactly the double submit this prevents);
--      * app.op_key_frozen() freezes both columns. Where the identity is derived from free text an
--        erasure may redact (assessments, assessment_exercises, versions), the erasure in force for
--        that institution may set both to null together: the hash would let someone check a
--        candidate name against the redacted text. Groups have no student data and never clear it.
-- 2. Stubs not yet implemented get the signature their ticket must implement, and the storage:
--      * create_version(p_assessment_id, p_config, p_answer_mode, p_op_key, p_base_version_id)
--        (T1.4b): versions gets op_key and op_identity;
--      * publish_version keeps its signature (it already had p_op_key) but publications had nowhere
--        to store it: op_key, op_identity and op_attempts (the attempts count the publish answered,
--        replayed as is: later republishes move attempts, so it cannot be recounted);
--      * internal_record_answer_key_revision (T1.4e): one revision per generation, so a retried job
--        writes it once (unique index on generation_id).
-- 3. update_exercise marks the affected versions stale when the topic changes too (T14a-1).
-- 4. An archived assessment answers INVALID assessment_archived (it has no restore); an archived
--    group keeps INVALID archived (T14a-4).
--
-- create_group also validates its name and school year (INVALID invalid_name and the new
-- invalid_school_year) before computing the identity: they used to reach the table's CHECK as a raw
-- 23514.

-- ---------------------------------------------------------------------------------------------
-- Storage of the operation
-- ---------------------------------------------------------------------------------------------

-- The operation of a row never changes. With the argument 'erasable', an erasure in force for the
-- row's institution may forget it (both columns to null together) when it redacts the text the
-- identity was derived from.
create function app.op_key_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.op_key is distinct from old.op_key or new.op_identity is distinct from old.op_identity then
    if tg_nargs = 1 and tg_argv[0] = 'erasable'
       and new.op_key is null and new.op_identity is null
       and app.erasure_in_force() is not distinct from old.institution_id
       and old.institution_id is not null then
      return new;
    end if;
    raise exception 'app.op_key_frozen: the operation of a % row never changes', tg_table_name using errcode = 'P0004';
  end if;
  return new;
end
$$;

alter table app.groups
  add column op_key uuid,
  add column op_identity text check (op_identity is null or op_identity ~ '^[0-9a-f]{64}$'),
  add constraint groups_op_check check ((op_key is null) = (op_identity is null));
create unique index groups_op_key_key on app.groups (institution_id, op_key) where op_key is not null;
create trigger groups_op_key_frozen before update on app.groups
  for each row execute function app.op_key_frozen();

alter table app.assessments
  add column op_key uuid,
  add column op_identity text check (op_identity is null or op_identity ~ '^[0-9a-f]{64}$'),
  add constraint assessments_op_check check ((op_key is null) = (op_identity is null));
create unique index assessments_op_key_key on app.assessments (institution_id, op_key) where op_key is not null;
create trigger assessments_op_key_frozen before update on app.assessments
  for each row execute function app.op_key_frozen('erasable');

alter table app.assessment_exercises
  add column op_key uuid,
  add column op_identity text check (op_identity is null or op_identity ~ '^[0-9a-f]{64}$'),
  add constraint assessment_exercises_op_check check ((op_key is null) = (op_identity is null));
create unique index assessment_exercises_op_key_key on app.assessment_exercises (institution_id, op_key) where op_key is not null;
create trigger assessment_exercises_op_key_frozen before update on app.assessment_exercises
  for each row execute function app.op_key_frozen('erasable');

-- T1.4b writes them: the identity is the assessment, the configuration, the answer mode and the
-- base version of the creation. The configuration is health data and can be redacted in a shared
-- version, so the identity can be forgotten with it.
alter table app.versions
  add column op_key uuid,
  add column op_identity text check (op_identity is null or op_identity ~ '^[0-9a-f]{64}$'),
  add constraint versions_op_check check ((op_key is null) = (op_identity is null));
create unique index versions_op_key_key on app.versions (institution_id, op_key) where op_key is not null;
create trigger versions_op_key_frozen before update on app.versions
  for each row execute function app.op_key_frozen('erasable');

-- T1.5a writes them: the identity is the version, the approved revision and the key revision. A
-- publication is immutable: publications_guard already rejects any change to these columns, also
-- inside an erasure (only content is redactable there).
alter table app.publications
  add column op_key uuid,
  add column op_identity text check (op_identity is null or op_identity ~ '^[0-9a-f]{64}$'),
  add column op_attempts integer check (op_attempts is null or op_attempts >= 0),
  add constraint publications_op_check check ((op_key is null) = (op_identity is null) and (op_key is null) = (op_attempts is null));
create unique index publications_op_key_key on app.publications (institution_id, op_key) where op_key is not null;

-- T1.4e: a generated key revision is written once per generation, however many times its job runs.
create unique index answer_key_revisions_generation_key on app.answer_key_revisions (generation_id) where generation_id is not null;

-- ---------------------------------------------------------------------------------------------
-- create_group
-- ---------------------------------------------------------------------------------------------
drop function api.create_group(uuid, text, text, integer);

create function api.create_group(p_institution_id uuid, p_name text, p_subject_id text, p_school_year integer, p_op_key uuid)
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
  -- A subject that is off (not rolled out yet) is as good as missing.
  if not exists (select 1 from app.subjects s where s.id = p_subject_id and s.enabled) then
    perform app.raise_error('NOT_FOUND', 'not_found');
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

  insert into app.groups (institution_id, subject_id, name, school_year, created_by, op_key, op_identity)
  values (p_institution_id, p_subject_id, v_name, p_school_year, v_actor, p_op_key, v_identity)
  returning * into v_group;
  insert into app.group_staff (institution_id, group_id, user_id, role)
  values (p_institution_id, v_group.id, v_actor, 'owner');
  return jsonb_build_object('id', v_group.id, 'revision', v_group.revision);
end
$$;

grant execute on function api.create_group(uuid, text, text, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Assessments: an archived assessment has its own reason (it is never restored)
-- ---------------------------------------------------------------------------------------------

-- Same signature. Group FOR SHARE, then the assessment FOR UPDATE. With p_write, an archived
-- assessment is INVALID assessment_archived and an archived group INVALID archived (the group can
-- be restored; the assessment cannot).
create or replace function app.assessment_lock(p_assessment_id uuid, p_group_id uuid, p_write boolean) returns app.assessments
language plpgsql
set search_path = ''
as $$
declare
  v_group_archived timestamptz;
  v_assessment app.assessments;
begin
  select g.archived_at into v_group_archived from app.groups g where g.id = p_group_id for share;
  select * into v_assessment from app.assessments a where a.id = p_assessment_id for update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if p_write and v_assessment.status = 'archived' then
    perform app.raise_error('INVALID', 'assessment_archived');
  end if;
  if p_write and v_group_archived is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;
  return v_assessment;
end
$$;

drop function api.create_assessment(uuid, text, text, text);

create function api.create_assessment(p_group_id uuid, p_kind text, p_topic text, p_general_instructions text, p_op_key uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_subject_id text;
  v_group_archived timestamptz;
  v_topic text := btrim(p_topic, E' \t\r\n');
  v_identity text;
  v_existing app.assessments;
  v_assessment app.assessments;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.assessment_gate(p_group_id);
  if p_kind is null or p_kind not in ('worksheet', 'exam') then
    perform app.raise_error('INVALID', 'invalid_kind');
  end if;
  if v_topic is null or char_length(v_topic) > 200 then
    perform app.raise_error('INVALID', 'invalid_topic');
  end if;
  if p_general_instructions is null or char_length(p_general_instructions) > 5000 then
    perform app.raise_error('INVALID', 'invalid_instructions');
  end if;
  if p_op_key is null then
    perform app.raise_error('INVALID', 'invalid_op_key');
  end if;
  v_identity := encode(sha256(convert_to(
    jsonb_build_array('create_assessment', p_group_id, p_kind, v_topic, p_general_instructions)::text, 'utf8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended('tiza.create_assessment:' || v_institution_id::text || ':' || p_op_key::text, 0));
  select * into v_existing from app.assessments a where a.institution_id = v_institution_id and a.op_key = p_op_key;
  if found then
    if v_existing.op_identity = v_identity then
      return jsonb_build_object('id', v_existing.id, 'revision', 1);
    end if;
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;

  select g.subject_id, g.archived_at into v_subject_id, v_group_archived from app.groups g where g.id = p_group_id for share;
  if v_group_archived is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;
  insert into app.assessments (institution_id, group_id, subject_id, kind, topic, general_instructions, created_by, op_key, op_identity)
  values (v_institution_id, p_group_id, v_subject_id, p_kind, v_topic, p_general_instructions, app.actor_id(), p_op_key, v_identity)
  returning * into v_assessment;
  return jsonb_build_object('id', v_assessment.id, 'revision', v_assessment.revision);
end
$$;

grant execute on function api.create_assessment(uuid, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Exercises
-- ---------------------------------------------------------------------------------------------

drop function api.add_exercise(uuid, text, text, uuid);

-- p_op_key goes before p_topic_id: a parameter with a default goes last.
create function api.add_exercise(p_assessment_id uuid, p_label text, p_body text, p_op_key uuid, p_topic_id uuid default null)
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
  -- still answers what it created.
  perform pg_advisory_xact_lock(hashtextextended('tiza.add_exercise:' || v_institution_id::text || ':' || p_op_key::text, 0));
  select * into v_existing from app.assessment_exercises e where e.institution_id = v_institution_id and e.op_key = p_op_key;
  if found then
    if v_existing.op_identity = v_identity then
      return jsonb_build_object('id', v_existing.id, 'revision', 1);
    end if;
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;

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

grant execute on function api.add_exercise(uuid, text, text, uuid, uuid) to authenticated;

-- Same signature. A change of the topic marks the versions that adapted the exercise stale too
-- (T14a-1): the unit of the syllabus is part of what an adaptation was made from.
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

-- Same signature; the archived reasons of assessment_lock (T14a-4).
create or replace function api.remove_exercise(p_exercise_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_assessment_id uuid;
  v_group_id uuid;
  v_assessment app.assessments;
  v_exercise app.assessment_exercises;
  v_revision integer;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select e.assessment_id into v_assessment_id from app.assessment_exercises e where e.id = p_exercise_id;
  select t.o_group_id into v_group_id from app.assessment_target(v_assessment_id) t;
  v_assessment := app.assessment_lock(v_assessment_id, v_group_id, false);
  select * into v_exercise from app.assessment_exercises e where e.id = p_exercise_id for update;
  if v_exercise.removed_at is not null then
    if p_revision is not null and p_revision = v_exercise.revision - 1 then
      return jsonb_build_object('id', p_exercise_id, 'revision', v_exercise.revision);
    end if;
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if v_assessment.status = 'archived' then
    perform app.raise_error('INVALID', 'assessment_archived');
  end if;
  if (select g.archived_at from app.groups g where g.id = v_group_id) is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;
  perform app.assert_revision(p_revision, v_exercise.revision);
  update app.assessment_exercises set removed_at = clock_timestamp(), revision = revision + 1
   where id = p_exercise_id returning revision into v_revision;
  perform app.mark_versions_stale(v_assessment_id, p_exercise_id);
  return jsonb_build_object('id', p_exercise_id, 'revision', v_revision);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Stubs whose ticket must implement the new signature
-- ---------------------------------------------------------------------------------------------

-- T1.4b. Idempotent by op_key as above: identity sha256 of
-- jsonb_build_array('create_version', assessment, config, answer mode, base version); the replay
-- answers { id, revision: 1, position } of the version it created.
drop function api.create_version(uuid, jsonb, text, uuid);

create function api.create_version(p_assessment_id uuid, p_config jsonb, p_answer_mode text, p_op_key uuid, p_base_version_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;
