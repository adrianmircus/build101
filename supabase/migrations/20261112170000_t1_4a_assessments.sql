-- T1.4a: assessments and their original exercises. Replaces the stubs of 20261111131100 (same
-- signatures) and grants EXECUTE to authenticated. No new table.
--
-- Who: only staff of the group (a teacher, a co-teacher, the sandbox visitor, an admin who also teaches
-- it). An admin who does not teach the group, inclusion and an enrolled student are FORBIDDEN; a
-- teacher of another group, another institution and an unknown id are NOT_FOUND. The subject always
-- comes from the group (the composite FK of assessments makes any other value impossible).
--
-- Locks, in the order of docs/contratos/fase-1.md: the group row FOR SHARE (so archiving the group and
-- writing in it are ordered), the assessment FOR UPDATE, the exercises by id, and only then the
-- versions by id (app.lock_versions). Every write of an exercise takes the assessment first: that is
-- what orders add, update, remove and reorder, and what lets reorder compare the exact set of
-- exercises. Nothing here changes the text of a version: editing or removing an exercise, or changing
-- the general instructions, only sets versions.stale on the non-archived versions that are affected
-- (the ones that adapted that exercise; every one for the instructions). create_version (T1.4b) must
-- take the assessment row before it copies exercises, or a version made in between would miss the mark.
--
-- Revisions. An exercise has its own (text, label, topic, removal); the assessment's moves with its
-- own fields and with reorder, never with add, edit or remove, so editing the instructions in one tab
-- does not conflict with adding an exercise in another. reorder compares the assessment revision and
-- then the exact set of live exercises: a set that changed is INVALID exercises_mismatch.
--
-- Idempotency. create_assessment and add_exercise create rows and their signatures carry no op_key:
-- a double submit creates two rows. That is a contract hole (reported to the orchestrator); the front
-- disables the button while the call is in flight. update_exercise, remove_exercise, update_assessment,
-- archive_assessment and reorder_exercises are revision-checked writes: remove and archive answer a
-- retry that carries the revision it had read with the same result.
--
-- State. An archived assessment, or one in an archived group, takes no content write (create, add,
-- edit, remove, reorder, update_assessment): all INVALID archived. Archiving itself is always allowed.

-- ---------------------------------------------------------------------------------------------
-- Guards: columns that say where a row belongs never change.
-- ---------------------------------------------------------------------------------------------

create function app.assessments_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id is distinct from old.group_id or new.subject_id is distinct from old.subject_id then
    raise exception 'app.assessments_frozen: group_id and subject_id never change' using errcode = 'P0004';
  end if;
  if new.created_by is distinct from old.created_by and new.created_by is not null then
    raise exception 'app.assessments_frozen: created_by only goes to null' using errcode = 'P0004';
  end if;
  if old.status = 'archived' and new.status <> 'archived' then
    raise exception 'app.assessments_frozen: an archived assessment is not reopened' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create trigger assessments_frozen
  before update on app.assessments
  for each row execute function app.assessments_frozen();

create function app.assessment_exercises_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assessment_id is distinct from old.assessment_id then
    raise exception 'app.assessment_exercises_frozen: assessment_id never changes' using errcode = 'P0004';
  end if;
  if old.removed_at is not null and (
       new.removed_at is distinct from old.removed_at or new.label is distinct from old.label
       or new.body is distinct from old.body or new.position is distinct from old.position
       or new.topic_id is distinct from old.topic_id) then
    raise exception 'app.assessment_exercises_frozen: a removed exercise does not change' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create trigger assessment_exercises_frozen
  before update on app.assessment_exercises
  for each row execute function app.assessment_exercises_frozen();

-- ---------------------------------------------------------------------------------------------
-- Helpers (SECURITY INVOKER, run by the RPCs as postgres)
-- ---------------------------------------------------------------------------------------------

-- Authorizes a group for the original of an assessment. Returns the institution. Reads without
-- locking: the caller locks after being authorized.
create function app.assessment_gate(p_group_id uuid) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_institution_id uuid;
begin
  select g.institution_id into v_institution_id from app.groups g where g.id = p_group_id;
  if v_institution_id is null
     or not app.is_member(v_institution_id, array['admin', 'teacher', 'inclusion', 'student']) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if app.is_group_staff(p_group_id) then
    return v_institution_id;
  end if;
  -- Seen but not enough: an admin who does not teach the group, inclusion, a student of the group.
  if app.is_member(v_institution_id, array['admin', 'inclusion'])
     or exists (
       select 1 from app.enrollments e
         join app.students s on s.institution_id = e.institution_id and s.id = e.student_id
        where e.group_id = p_group_id and e.ended_at is null
          and s.user_id = app.session_user_id() and s.archived_at is null) then
    perform app.raise_error('FORBIDDEN', 'forbidden');
  end if;
  perform app.raise_error('NOT_FOUND', 'not_found');
  return null;
end
$$;

-- Authorizes an assessment (null or unknown is NOT_FOUND). The group and institution come out
-- through the OUT parameters.
create function app.assessment_target(p_assessment_id uuid, out o_group_id uuid, out o_institution_id uuid)
language plpgsql
set search_path = ''
as $$
begin
  select a.group_id, a.institution_id into o_group_id, o_institution_id
    from app.assessments a
   where a.id = p_assessment_id;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform app.assessment_gate(o_group_id);
end
$$;

-- Group FOR SHARE, then the assessment FOR UPDATE. With p_write, an archived group or assessment is
-- INVALID archived.
create function app.assessment_lock(p_assessment_id uuid, p_group_id uuid, p_write boolean) returns app.assessments
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
  if p_write and (v_group_archived is not null or v_assessment.status = 'archived') then
    perform app.raise_error('INVALID', 'archived');
  end if;
  return v_assessment;
end
$$;

-- Sets stale on the non-archived versions of the assessment, all of them (p_exercise_id null) or the
-- ones that adapted that exercise. Versions are locked by id, after the assessment and its exercises.
create function app.mark_versions_stale(p_assessment_id uuid, p_exercise_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(v.id order by v.id), '{}') into v_ids
    from app.versions v
   where v.assessment_id = p_assessment_id and v.archived_at is null
     and (p_exercise_id is null
          or exists (select 1 from app.version_exercises ve where ve.version_id = v.id and ve.exercise_id = p_exercise_id));
  if cardinality(v_ids) = 0 then
    return;
  end if;
  perform app.lock_versions(v_ids);
  update app.versions set stale = true where id = any (v_ids) and not stale;
end
$$;

-- The exercise fields as stored: a null or blank label or body is INVALID, never a silent pass.
create function app.clean_exercise(p_label text, p_body text, p_topic_id uuid, p_group_id uuid) returns text
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
  if p_topic_id is not null and not exists (
       select 1 from app.syllabi s, jsonb_array_elements(s.units) u
        where s.group_id = p_group_id and u ->> 'id' = p_topic_id::text) then
    perform app.raise_error('INVALID', 'unknown_topic');
  end if;
  return v_label;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Assessments
-- ---------------------------------------------------------------------------------------------

create or replace function api.create_assessment(p_group_id uuid, p_kind text, p_topic text, p_general_instructions text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_subject_id text;
  v_group_archived timestamptz;
  v_topic text := btrim(p_topic, E' \t\r\n');
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

  select g.subject_id, g.archived_at into v_subject_id, v_group_archived from app.groups g where g.id = p_group_id for share;
  if v_group_archived is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;
  insert into app.assessments (institution_id, group_id, subject_id, kind, topic, general_instructions, created_by)
  values (v_institution_id, p_group_id, v_subject_id, p_kind, v_topic, p_general_instructions, app.actor_id())
  returning * into v_assessment;
  return jsonb_build_object('id', v_assessment.id, 'revision', v_assessment.revision);
end
$$;

create or replace function api.update_assessment(p_assessment_id uuid, p_revision integer, p_kind text, p_topic text, p_general_instructions text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_group_id uuid;
  v_topic text := btrim(p_topic, E' \t\r\n');
  v_assessment app.assessments;
  v_revision integer;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_group_id into v_group_id from app.assessment_target(p_assessment_id) t;
  if p_kind is null or p_kind not in ('worksheet', 'exam') then
    perform app.raise_error('INVALID', 'invalid_kind');
  end if;
  if v_topic is null or char_length(v_topic) > 200 then
    perform app.raise_error('INVALID', 'invalid_topic');
  end if;
  if p_general_instructions is null or char_length(p_general_instructions) > 5000 then
    perform app.raise_error('INVALID', 'invalid_instructions');
  end if;

  v_assessment := app.assessment_lock(p_assessment_id, v_group_id, true);
  perform app.assert_revision(p_revision, v_assessment.revision);
  update app.assessments
     set kind = p_kind, topic = v_topic, general_instructions = p_general_instructions, revision = revision + 1
   where id = p_assessment_id returning revision into v_revision;
  if p_general_instructions is distinct from v_assessment.general_instructions then
    perform app.mark_versions_stale(p_assessment_id, null);
  end if;
  return jsonb_build_object('id', p_assessment_id, 'revision', v_revision);
end
$$;

-- Archiving an archived assessment with the current revision changes nothing and answers the same.
-- Allowed also in an archived group: taking something out of sight is always possible.
create or replace function api.archive_assessment(p_assessment_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_group_id uuid;
  v_assessment app.assessments;
  v_revision integer;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_group_id into v_group_id from app.assessment_target(p_assessment_id) t;
  v_assessment := app.assessment_lock(p_assessment_id, v_group_id, false);
  perform app.assert_revision(p_revision, v_assessment.revision);
  v_revision := v_assessment.revision;
  if v_assessment.status <> 'archived' then
    update app.assessments set status = 'archived', revision = revision + 1
     where id = p_assessment_id returning revision into v_revision;
  end if;
  return jsonb_build_object('id', p_assessment_id, 'revision', v_revision);
end
$$;

create or replace function api.list_assessments(p_group_id uuid, p_include_archived boolean default false, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_total integer;
  v_items jsonb;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  perform app.assessment_gate(p_group_id);
  if p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset < 0 then
    perform app.raise_error('INVALID', 'invalid_page');
  end if;
  select count(*) into v_total from app.assessments a
   where a.group_id = p_group_id and (coalesce(p_include_archived, false) or a.status <> 'archived');
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'kind', m.kind, 'topic', m.topic, 'subjectId', m.subject_id, 'status', m.status,
           'publishAt', m.publish_at, 'dueAt', m.due_at, 'createdAt', m.created_at, 'revision', m.revision,
           'exerciseCount', (select count(*) from app.assessment_exercises e where e.assessment_id = m.id and e.removed_at is null),
           'versionCount', (select count(*) from app.versions v where v.assessment_id = m.id and v.archived_at is null)
         ) order by m.created_at desc, m.id), '[]'::jsonb)
    into v_items
    from (select a.* from app.assessments a
           where a.group_id = p_group_id and (coalesce(p_include_archived, false) or a.status <> 'archived')
           order by a.created_at desc, a.id
           limit p_limit offset p_offset) m;
  return jsonb_build_object('items', v_items, 'total', v_total);
end
$$;

create or replace function api.get_assessment(p_assessment_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_assessment app.assessments;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  perform app.assessment_target(p_assessment_id);
  select * into v_assessment from app.assessments a where a.id = p_assessment_id;
  return jsonb_build_object(
    'assessment', jsonb_build_object(
      'id', v_assessment.id, 'groupId', v_assessment.group_id, 'subjectId', v_assessment.subject_id,
      'kind', v_assessment.kind, 'topic', v_assessment.topic, 'generalInstructions', v_assessment.general_instructions,
      'status', v_assessment.status, 'publishAt', v_assessment.publish_at, 'dueAt', v_assessment.due_at,
      'sourceFileId', v_assessment.source_file_id, 'createdAt', v_assessment.created_at, 'revision', v_assessment.revision),
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'position', e.position, 'label', e.label, 'body', e.body, 'topicId', e.topic_id, 'revision', e.revision)
             order by e.position, e.id)
        from app.assessment_exercises e
       where e.assessment_id = p_assessment_id and e.removed_at is null), '[]'::jsonb));
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Exercises
-- ---------------------------------------------------------------------------------------------

create or replace function api.add_exercise(p_assessment_id uuid, p_label text, p_body text, p_topic_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_group_id uuid;
  v_institution_id uuid;
  v_label text;
  v_count integer;
  v_id uuid;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_group_id, t.o_institution_id into v_group_id, v_institution_id from app.assessment_target(p_assessment_id) t;
  v_label := app.clean_exercise(p_label, p_body, p_topic_id, v_group_id);

  perform app.assessment_lock(p_assessment_id, v_group_id, true);
  select count(*) into v_count from app.assessment_exercises e where e.assessment_id = p_assessment_id and e.removed_at is null;
  if v_count >= 200 then
    perform app.raise_error('INVALID', 'too_many_exercises');
  end if;
  insert into app.assessment_exercises (institution_id, assessment_id, position, label, body, topic_id)
  values (v_institution_id, p_assessment_id,
          coalesce((select max(e.position) + 1 from app.assessment_exercises e where e.assessment_id = p_assessment_id and e.removed_at is null), 0),
          v_label, p_body, p_topic_id)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'revision', 1);
end
$$;

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
  if v_label is distinct from v_exercise.label or p_body is distinct from v_exercise.body then
    perform app.mark_versions_stale(v_assessment_id, p_exercise_id);
  end if;
  return jsonb_build_object('id', p_exercise_id, 'revision', v_revision);
end
$$;

-- A retry of a removal that went through (the exercise is removed, one revision after the one the
-- caller read) answers the same result.
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
  if v_assessment.status = 'archived' or (select g.archived_at from app.groups g where g.id = v_group_id) is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;
  perform app.assert_revision(p_revision, v_exercise.revision);
  update app.assessment_exercises set removed_at = clock_timestamp(), revision = revision + 1
   where id = p_exercise_id returning revision into v_revision;
  perform app.mark_versions_stale(v_assessment_id, p_exercise_id);
  return jsonb_build_object('id', p_exercise_id, 'revision', v_revision);
end
$$;

create or replace function api.reorder_exercises(p_assessment_id uuid, p_revision integer, p_exercise_ids uuid[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_group_id uuid;
  v_assessment app.assessments;
  v_live uuid[];
  v_revision integer;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_group_id into v_group_id from app.assessment_target(p_assessment_id) t;
  if p_exercise_ids is null or cardinality(p_exercise_ids) not between 1 and 200
     or array_position(p_exercise_ids, null) is not null
     or (select count(distinct x) from unnest(p_exercise_ids) x) <> cardinality(p_exercise_ids) then
    perform app.raise_error('INVALID', 'exercises_mismatch');
  end if;

  v_assessment := app.assessment_lock(p_assessment_id, v_group_id, true);
  perform app.assert_revision(p_revision, v_assessment.revision);
  select coalesce(array_agg(e.id order by e.id), '{}') into v_live from (
    select e2.id from app.assessment_exercises e2
     where e2.assessment_id = p_assessment_id and e2.removed_at is null order by e2.id for update) e;
  if v_live is distinct from (select array_agg(x order by x) from unnest(p_exercise_ids) x) then
    perform app.raise_error('INVALID', 'exercises_mismatch');
  end if;

  update app.assessment_exercises e set position = (o.ord - 1)::integer
    from unnest(p_exercise_ids) with ordinality as o(id, ord)
   where e.id = o.id and e.position <> (o.ord - 1)::integer;
  update app.assessments set revision = revision + 1 where id = p_assessment_id returning revision into v_revision;
  return jsonb_build_object('id', p_assessment_id, 'revision', v_revision);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: nothing in api has a default grant.
-- ---------------------------------------------------------------------------------------------

grant execute on function api.create_assessment(uuid, text, text, text) to authenticated;
grant execute on function api.update_assessment(uuid, integer, text, text, text) to authenticated;
grant execute on function api.archive_assessment(uuid, integer) to authenticated;
grant execute on function api.list_assessments(uuid, boolean, integer, integer) to authenticated;
grant execute on function api.get_assessment(uuid) to authenticated;
grant execute on function api.add_exercise(uuid, text, text, uuid) to authenticated;
grant execute on function api.update_exercise(uuid, integer, text, text, uuid) to authenticated;
grant execute on function api.remove_exercise(uuid, integer) to authenticated;
grant execute on function api.reorder_exercises(uuid, integer, uuid[]) to authenticated;
