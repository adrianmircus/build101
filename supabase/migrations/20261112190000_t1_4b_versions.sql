-- T1.4b: versions, their configuration and their recipients. Replaces the stubs of 20261111131100 and
-- 20261112180000 (same signatures) and grants EXECUTE to authenticated. No new table.
--
-- Who: only staff of the group of the assessment, like T1.4a (a teacher, a co-teacher, the sandbox
-- visitor, an admin who also teaches it). An admin who does not teach the group, inclusion and an
-- enrolled student are FORBIDDEN; a teacher of another group, another institution and an unknown id
-- are NOT_FOUND.
--
-- Locks, in the order of docs/contratos/fase-1.md: the group row FOR SHARE and the assessment FOR UPDATE
-- (app.assessment_lock), then the version (app.lock_version_tree), then, inside the trigger that checks
-- an enrollment, the (group, student) advisory lock that enroll_student and unenroll_student take. Every
-- RPC that writes a version takes the assessment first:
--   * create_version, so a version made in between an exercise edit and its stale mark is never missed
--     (update_exercise takes the same row first: either the version exists when it marks, or it copies
--     the edited exercise);
--   * set_version_recipients and archive_version, because "one version of an assessment per student at a
--     time" is a rule of the assessment, not of one version: two versions of the same assessment are
--     locked by two different rows, so only the assessment row orders them (the unique index is the
--     backstop and would answer a raw 23505).
--
-- Idempotency. create_version: op_key and op_identity stored in the insert (T1.F3 protocol), looked up
-- under an advisory lock on (institution, op_key) before any row lock; the identity is the sha256 of
-- jsonb_build_array('create_version', assessment, config, answer mode, base version). The config is the
-- normalized one (interests trimmed). set_version_recipients: op_id of the event (C5), looked up under the
-- version lock with the operation, the version and the exact set of recipients it was asked for.
--
-- Recipients. A set is applied as a difference: the rows of the students that stay are untouched (their
-- valid_from keeps meaning "since when"), the ones that leave are closed with valid_to, the ones that join
-- are opened. valid_to and valid_from take clock_timestamp() under the lock. The revision of the version
-- moves only when the set changed (an approval is of one revision), but the event is written always, so the
-- op_id is recorded. The event result is { id, revision } of the version; who joined or left, and the
-- resulting set, go only in data (an erasure redacts it).
--
-- Configuration. Fixed at creation: which exercises the version keeps (config.keep). Changing it later
-- would add or remove adapted exercises with their questions and keys, which is another version: it is
-- INVALID keep_changed. Changing the rest (profiles, supports, interests, answer mode) bumps the revision
-- and marks the version stale when it already has content: that content was made for another config.
--
-- State. An archived assessment or group takes no write (assessment_archived, archived); an archived
-- version takes no write (version_archived). Archiving a version is always allowed and closes its
-- recipients: otherwise the students would stay "taken" for the assessment by a version nobody sees.
--
-- Extension: update_group validates its name and school year like create_group (invalid_name,
-- invalid_school_year); they used to reach the table's CHECK as a raw 23514.

-- ---------------------------------------------------------------------------------------------
-- Guards: columns that say where a row belongs never change.
-- ---------------------------------------------------------------------------------------------

create function app.versions_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assessment_id is distinct from old.assessment_id or new.position is distinct from old.position
     or new.base_version_id is distinct from old.base_version_id then
    raise exception 'app.versions_frozen: assessment_id, position and base_version_id never change' using errcode = 'P0004';
  end if;
  if new.created_by is distinct from old.created_by and new.created_by is not null then
    raise exception 'app.versions_frozen: created_by only goes to null' using errcode = 'P0004';
  end if;
  if old.archived_at is not null and new.archived_at is distinct from old.archived_at then
    raise exception 'app.versions_frozen: an archived version is not restored' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create trigger versions_frozen
  before update on app.versions
  for each row execute function app.versions_frozen();

-- A recipient row is closed (valid_to, once), never rewritten.
create function app.version_recipients_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.institution_id is distinct from old.institution_id
     or new.assessment_id is distinct from old.assessment_id or new.version_id is distinct from old.version_id
     or new.student_id is distinct from old.student_id or new.valid_from is distinct from old.valid_from
     or new.created_at is distinct from old.created_at then
    raise exception 'app.version_recipients_frozen: only valid_to changes' using errcode = 'P0004';
  end if;
  if old.valid_to is not null and new.valid_to is distinct from old.valid_to then
    raise exception 'app.version_recipients_frozen: a closed row does not change' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create trigger version_recipients_frozen
  before update on app.version_recipients
  for each row execute function app.version_recipients_frozen();

-- Every recipient is enrolled in the group of the assessment, now, and not archived. The check takes the
-- same advisory lock as enroll_student and unenroll_student for that (group, student) pair, so an
-- enrollment cannot end between the check and the insert. Callers insert in student id order: two
-- transactions never take the pair locks in opposite orders.
create function app.version_recipients_enrolled() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_group_id uuid;
begin
  select a.group_id into v_group_id from app.assessments a where a.id = new.assessment_id;
  perform pg_advisory_xact_lock(hashtextextended('tiza.enrollment:' || v_group_id::text || ':' || new.student_id::text, 0));
  perform 1 from app.students s where s.id = new.student_id and s.archived_at is null for share;
  if not found or not exists (
       select 1 from app.enrollments e
        where e.group_id = v_group_id and e.student_id = new.student_id and e.ended_at is null) then
    perform app.raise_error('INVALID', 'not_enrolled');
  end if;
  return new;
end
$$;

create trigger version_recipients_enrolled
  before insert on app.version_recipients
  for each row execute function app.version_recipients_enrolled();

-- ---------------------------------------------------------------------------------------------
-- Helpers (SECURITY INVOKER, run by the RPCs as postgres)
-- ---------------------------------------------------------------------------------------------

-- Authorizes a version (null or unknown is NOT_FOUND). Reads without locking.
create function app.version_target(p_version_id uuid, out o_assessment_id uuid, out o_group_id uuid, out o_institution_id uuid)
language plpgsql
set search_path = ''
as $$
begin
  select v.assessment_id, a.group_id, a.institution_id into o_assessment_id, o_group_id, o_institution_id
    from app.versions v join app.assessments a on a.id = v.assessment_id
   where v.id = p_version_id;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform app.assessment_gate(o_group_id);
end
$$;

-- With the assessment already locked: an archived assessment or group takes no write.
create function app.assert_assessment_writable(p_assessment app.assessments, p_group_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_assessment.status = 'archived' then
    perform app.raise_error('INVALID', 'assessment_archived');
  end if;
  if (select g.archived_at from app.groups g where g.id = p_group_id) is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;
end
$$;

-- The configuration as stored: { profiles, supports, interests, keep? }, the same shape as VersionConfig
-- in lib/domain/assessments/versions.ts. Profiles and supports are the validated catalogue (the one of
-- set_student_needs; a profile or support is added in both places in the same ticket). A null, a missing
-- key, another type or a repeated value is INVALID, never a silent pass. Interests are trimmed.
create function app.clean_version_config(p_config jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_profiles text[];
  v_supports text[];
  v_interests text[];
  v_keep uuid[];
  v_result jsonb;
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_config) as k where k not in ('profiles', 'supports', 'interests', 'keep'))
     or not (p_config ? 'profiles' and p_config ? 'supports' and p_config ? 'interests') then
    perform app.raise_error('INVALID', 'invalid_config');
  end if;
  if jsonb_typeof(p_config -> 'profiles') <> 'array' or jsonb_typeof(p_config -> 'supports') <> 'array'
     or jsonb_typeof(p_config -> 'interests') <> 'array'
     or jsonb_array_length(p_config -> 'profiles') > 10 or jsonb_array_length(p_config -> 'supports') > 10
     or exists (select 1 from jsonb_array_elements(p_config -> 'profiles') as e where jsonb_typeof(e) <> 'string')
     or exists (select 1 from jsonb_array_elements(p_config -> 'supports') as e where jsonb_typeof(e) <> 'string') then
    perform app.raise_error('INVALID', 'invalid_config');
  end if;
  v_profiles := array(select e #>> '{}' from jsonb_array_elements(p_config -> 'profiles') with ordinality as t(e, n) order by n);
  v_supports := array(select e #>> '{}' from jsonb_array_elements(p_config -> 'supports') with ordinality as t(e, n) order by n);
  if (select count(distinct v) from unnest(v_profiles) as v) <> cardinality(v_profiles)
     or (select count(distinct v) from unnest(v_supports) as v) <> cardinality(v_supports) then
    perform app.raise_error('INVALID', 'invalid_config');
  end if;
  if exists (select 1 from unnest(v_profiles) as v where v not in ('adhd', 'asd', 'dysgraphia', 'dyslexia', 'motor')) then
    perform app.raise_error('INVALID', 'unknown_profile');
  end if;
  if exists (select 1 from unnest(v_supports) as v where v not in ('preguntas_guia', 'recordatorio', 'ejemplo_resuelto', 'numeros_simples')) then
    perform app.raise_error('INVALID', 'unknown_support');
  end if;

  if jsonb_array_length(p_config -> 'interests') > 5
     or exists (select 1 from jsonb_array_elements(p_config -> 'interests') as e where jsonb_typeof(e) <> 'string') then
    perform app.raise_error('INVALID', 'invalid_interests');
  end if;
  v_interests := array(select btrim(e #>> '{}', E' \t\r\n') from jsonb_array_elements(p_config -> 'interests') with ordinality as t(e, n) order by n);
  if exists (select 1 from unnest(v_interests) as v where char_length(v) not between 1 and 60)
     or (select count(distinct v) from unnest(v_interests) as v) <> cardinality(v_interests) then
    perform app.raise_error('INVALID', 'invalid_interests');
  end if;

  v_result := jsonb_build_object('profiles', to_jsonb(v_profiles), 'supports', to_jsonb(v_supports), 'interests', to_jsonb(v_interests));
  if p_config ? 'keep' then
    if jsonb_typeof(p_config -> 'keep') <> 'array' or jsonb_array_length(p_config -> 'keep') > 200
       or exists (select 1 from jsonb_array_elements(p_config -> 'keep') as e
                   where jsonb_typeof(e) <> 'string'
                      or (e #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      perform app.raise_error('INVALID', 'invalid_keep');
    end if;
    v_keep := array(select (e #>> '{}')::uuid from jsonb_array_elements(p_config -> 'keep') with ordinality as t(e, n) order by n);
    if (select count(distinct v) from unnest(v_keep) as v) <> cardinality(v_keep) then
      perform app.raise_error('INVALID', 'invalid_keep');
    end if;
    v_result := v_result || jsonb_build_object('keep', to_jsonb(array(select k::text from unnest(v_keep) with ordinality as t(k, n) order by n)));
  end if;
  return v_result;
end
$$;

-- The set of exercises a configuration keeps, to compare: null when it keeps them all.
create function app.config_keep_set(p_config jsonb) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_config ? 'keep'
              then coalesce((select jsonb_agg(k order by k) from jsonb_array_elements_text(p_config -> 'keep') as k), '[]'::jsonb)
         end
$$;

-- ---------------------------------------------------------------------------------------------
-- create_version
-- ---------------------------------------------------------------------------------------------

create or replace function api.create_version(p_assessment_id uuid, p_config jsonb, p_answer_mode text, p_op_key uuid, p_base_version_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_group_id uuid;
  v_institution_id uuid;
  v_config jsonb;
  v_identity text;
  v_existing app.versions;
  v_assessment app.assessments;
  v_live uuid[];
  v_chosen uuid[];
  v_position integer;
  v_version app.versions;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_group_id, t.o_institution_id into v_group_id, v_institution_id from app.assessment_target(p_assessment_id) t;
  v_config := app.clean_version_config(p_config);
  if p_answer_mode is null or p_answer_mode not in ('typed', 'gaze', 'voice') then
    perform app.raise_error('INVALID', 'invalid_answer_mode');
  end if;
  if p_op_key is null then
    perform app.raise_error('INVALID', 'invalid_op_key');
  end if;
  v_identity := encode(sha256(convert_to(
    jsonb_build_array('create_version', p_assessment_id, v_config, p_answer_mode, p_base_version_id)::text, 'utf8')), 'hex');

  -- Before any row lock: a replay of a version created in an assessment archived since still answers
  -- what it created.
  perform pg_advisory_xact_lock(hashtextextended('tiza.create_version:' || v_institution_id::text || ':' || p_op_key::text, 0));
  select * into v_existing from app.versions v where v.institution_id = v_institution_id and v.op_key = p_op_key;
  if found then
    if v_existing.op_identity = v_identity then
      return jsonb_build_object('id', v_existing.id, 'revision', 1, 'position', v_existing.position);
    end if;
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;

  -- The assessment row BEFORE the exercises are copied: an exercise edit that commits after this point
  -- finds the version and marks it stale; one that committed before is copied as it is now.
  v_assessment := app.assessment_lock(p_assessment_id, v_group_id, true);
  if p_base_version_id is not null and not exists (
       select 1 from app.versions b where b.id = p_base_version_id and b.assessment_id = p_assessment_id) then
    perform app.raise_error('INVALID', 'invalid_base_version');
  end if;

  select coalesce(array_agg(e.id order by e.position, e.id), '{}') into v_live
    from app.assessment_exercises e where e.assessment_id = p_assessment_id and e.removed_at is null;
  if v_config ? 'keep' then
    if exists (select 1 from jsonb_array_elements_text(v_config -> 'keep') as k where k::uuid <> all (v_live)) then
      perform app.raise_error('INVALID', 'invalid_keep');
    end if;
    v_chosen := array(select x from unnest(v_live) as x where x::text in (select k from jsonb_array_elements_text(v_config -> 'keep') as k));
  else
    v_chosen := v_live;
  end if;
  if cardinality(v_chosen) = 0 then
    perform app.raise_error('INVALID', 'no_exercises');
  end if;

  -- Positions are never reused, not even those of archived versions.
  select coalesce(max(v.position), 0) + 1 into v_position from app.versions v where v.assessment_id = p_assessment_id;
  insert into app.versions (institution_id, assessment_id, position, base_version_id, general_instructions, config, answer_mode,
                            created_by, op_key, op_identity)
  values (v_institution_id, p_assessment_id, v_position, p_base_version_id, v_assessment.general_instructions, v_config, p_answer_mode,
          app.actor_id(), p_op_key, v_identity)
  returning * into v_version;
  insert into app.version_exercises (institution_id, assessment_id, version_id, exercise_id, source_revision)
  select v_institution_id, p_assessment_id, v_version.id, e.id, e.revision
    from app.assessment_exercises e where e.id = any (v_chosen);
  return jsonb_build_object('id', v_version.id, 'revision', v_version.revision, 'position', v_version.position);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- update_version_config
-- ---------------------------------------------------------------------------------------------

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

  -- Content made for another configuration is out of date, like content made from an exercise that
  -- changed; it is not touched, only marked.
  select v_version.current_generation_id is not null or exists (
           select 1 from app.version_exercises ve
            where ve.version_id = p_version_id and (ve.status <> 'pending' or btrim(ve.body) <> '')) into v_has_content;
  update app.versions
     set config = v_config, answer_mode = p_answer_mode, revision = revision + 1, stale = stale or v_has_content
   where id = p_version_id returning revision into v_revision;
  return jsonb_build_object('id', p_version_id, 'revision', v_revision);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- set_version_recipients
-- ---------------------------------------------------------------------------------------------

create or replace function api.set_version_recipients(p_version_id uuid, p_revision integer, p_student_ids uuid[], p_op_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_assessment_id uuid;
  v_group_id uuid;
  v_institution_id uuid;
  v_ids uuid[];
  v_assessment app.assessments;
  v_event app.version_events;
  v_version app.versions;
  v_current uuid[];
  v_added uuid[];
  v_removed uuid[];
  v_now timestamptz;
  v_student uuid;
  v_revision integer;
  v_result jsonb;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_assessment_id, t.o_group_id, t.o_institution_id into v_assessment_id, v_group_id, v_institution_id
    from app.version_target(p_version_id) t;
  if p_op_id is null then
    perform app.raise_error('INVALID', 'invalid_op_key');
  end if;
  if p_student_ids is null or cardinality(p_student_ids) > 200
     or exists (select 1 from unnest(p_student_ids) as s where s is null)
     or (select count(distinct s) from unnest(p_student_ids) as s) <> cardinality(p_student_ids) then
    perform app.raise_error('INVALID', 'invalid_students');
  end if;
  v_ids := array(select s from unnest(p_student_ids) as s order by s);
  -- Students of this institution only (the FK would answer a raw 23503 for another one).
  if (select count(*) from app.students s where s.id = any (v_ids) and s.institution_id = v_institution_id) <> cardinality(v_ids) then
    perform app.raise_error('INVALID', 'invalid_students');
  end if;

  v_assessment := app.assessment_lock(v_assessment_id, v_group_id, false);
  if not app.lock_version_tree(p_version_id, null, null) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  -- Under the locks: has this op_id been applied? Its identity is this RPC, this version and the exact
  -- set it asked for (stored in the event); the same answers what was stored, anything else is a reuse.
  v_event := app.claim_version_op(v_institution_id, p_op_id, 'set_version_recipients', p_version_id, p_version_id);
  if v_event.id is not null then
    if v_event.data -> 'recipients' = to_jsonb(array(select s::text from unnest(v_ids) as s)) then
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

  v_current := coalesce((select array_agg(r.student_id order by r.student_id) from app.version_recipients r
                          where r.version_id = p_version_id and r.valid_to is null), '{}');
  v_added := array(select s from unnest(v_ids) as s where s <> all (v_current) order by s);
  v_removed := array(select s from unnest(v_current) as s where s <> all (v_ids) order by s);
  if exists (select 1 from app.version_recipients r
              where r.assessment_id = v_assessment_id and r.valid_to is null and r.version_id <> p_version_id
                and r.student_id = any (v_added)) then
    perform app.raise_error('CONFLICT', 'recipient_in_other_version');
  end if;

  v_now := clock_timestamp();
  update app.version_recipients set valid_to = greatest(v_now, valid_from)
   where version_id = p_version_id and valid_to is null and student_id = any (v_removed);
  -- In student id order: the trigger takes one advisory lock per student.
  foreach v_student in array v_added loop
    insert into app.version_recipients (institution_id, assessment_id, version_id, student_id, valid_from)
    values (v_institution_id, v_assessment_id, p_version_id, v_student, v_now);
  end loop;

  v_revision := v_version.revision;
  if cardinality(v_added) > 0 or cardinality(v_removed) > 0 then
    update app.versions set revision = revision + 1 where id = p_version_id returning revision into v_revision;
  end if;
  begin
    v_result := jsonb_build_object('id', p_version_id, 'revision', v_revision);
    insert into app.version_events (institution_id, version_id, op_id, kind, operation, target_id, result, version_revision, data, actor_user_id)
    values (v_institution_id, p_version_id, p_op_id, 'recipients_changed', 'set_version_recipients', p_version_id, v_result, v_revision,
            jsonb_build_object('added', to_jsonb(array(select s::text from unnest(v_added) as s)),
                               'removed', to_jsonb(array(select s::text from unnest(v_removed) as s)),
                               'recipients', to_jsonb(array(select s::text from unnest(v_ids) as s))),
            app.actor_id());
  exception when unique_violation then
    -- The same op_id used at the same time on a version of another assessment: the index decides.
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end;
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- archive_version
-- ---------------------------------------------------------------------------------------------

-- Archiving an archived version with the current revision changes nothing and answers the same. Allowed
-- also in an archived assessment or group: taking something out of sight is always possible.
create or replace function api.archive_version(p_version_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_assessment_id uuid;
  v_group_id uuid;
  v_version app.versions;
  v_revision integer;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_assessment_id, t.o_group_id into v_assessment_id, v_group_id from app.version_target(p_version_id) t;
  perform app.assessment_lock(v_assessment_id, v_group_id, false);
  if not app.lock_version_tree(p_version_id, null, null) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  select * into v_version from app.versions v where v.id = p_version_id;
  perform app.assert_revision(p_revision, v_version.revision);
  v_revision := v_version.revision;
  if v_version.archived_at is null then
    update app.version_recipients set valid_to = greatest(clock_timestamp(), valid_from)
     where version_id = p_version_id and valid_to is null;
    update app.versions set archived_at = now(), revision = revision + 1
     where id = p_version_id returning revision into v_revision;
  end if;
  return jsonb_build_object('id', p_version_id, 'revision', v_revision);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- list_versions: no configuration, answer mode or recipients. Not audited: it shows no student.
-- ---------------------------------------------------------------------------------------------

create or replace function api.list_versions(p_assessment_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_items jsonb;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  perform app.assessment_target(p_assessment_id);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'position', v.position, 'status', v.status, 'stale', v.stale,
           'approved', v.approved_revision is not null and v.approved_revision = v.revision,
           'exerciseCount', (select count(*) from app.version_exercises ve where ve.version_id = v.id),
           'readyCount', (select count(*) from app.version_exercises ve where ve.version_id = v.id and ve.status = 'ready'),
           'revision', v.revision
         ) order by v.position, v.id), '[]'::jsonb)
    into v_items
    from app.versions v
   where v.assessment_id = p_assessment_id and v.archived_at is null;
  return jsonb_build_object('items', v_items);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- get_version: the teacher's review. Audited with the recipients it shows (a version without
-- recipients shows nobody, so it writes no row).
-- ---------------------------------------------------------------------------------------------

create or replace function api.get_version(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_version app.versions;
  v_recipients jsonb;
  v_shown uuid[];
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_institution_id into v_institution_id from app.version_target(p_version_id) t;
  select * into v_version from app.versions v where v.id = p_version_id;

  select coalesce(jsonb_agg(jsonb_build_object('studentId', r.student_id, 'displayName', s.display_name, 'validFrom', r.valid_from)
                            order by r.valid_from, s.display_name, r.student_id), '[]'::jsonb),
         coalesce(array_agg(r.student_id order by r.student_id), '{}'::uuid[])
    into v_recipients, v_shown
    from app.version_recipients r
    join app.students s on s.institution_id = r.institution_id and s.id = r.student_id
   where r.version_id = p_version_id and r.valid_to is null;
  perform app.audit_disclosure(v_institution_id, 'get_version', 'version', p_version_id, v_shown);

  return jsonb_build_object(
    'version', jsonb_build_object(
      'id', v_version.id, 'assessmentId', v_version.assessment_id, 'position', v_version.position,
      'baseVersionId', v_version.base_version_id, 'generalInstructions', v_version.general_instructions,
      'instructionsRevision', v_version.instructions_revision, 'config', v_version.config, 'answerMode', v_version.answer_mode,
      'status', v_version.status, 'stale', v_version.stale, 'errorCode', v_version.error_code,
      'currentGenerationId', v_version.current_generation_id, 'approvedRevision', v_version.approved_revision,
      'revision', v_version.revision),
    'recipients', v_recipients,
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ve.id, 'exerciseId', ve.exercise_id, 'sourceRevision', ve.source_revision, 'body', ve.body,
               'changes', ve.changes, 'status', ve.status, 'errorCode', ve.error_code,
               'currentGenerationId', ve.current_generation_id, 'revision', ve.revision)
             order by e.position, ve.id)
        from app.version_exercises ve
        join app.assessment_exercises e on e.id = ve.exercise_id
       where ve.version_id = p_version_id), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'versionExerciseId', q.version_exercise_id, 'position', q.position, 'stem', q.stem,
               'options', q.options, 'revision', q.revision)
             order by e.position, q.position, q.id)
        from app.version_questions q
        join app.version_exercises ve on ve.id = q.version_exercise_id
        join app.assessment_exercises e on e.id = ve.exercise_id
       where q.version_id = p_version_id), '[]'::jsonb),
    'keys', coalesce((
      select jsonb_agg(jsonb_build_object('questionId', k.question_id, 'correctOptionId', k.correct_option_id, 'revision', k.revision)
                       order by k.question_id)
        from app.question_keys k where k.version_id = p_version_id), '[]'::jsonb));
end
$$;

-- ---------------------------------------------------------------------------------------------
-- update_group (T1.2a): same signature; name and school year are validated like create_group.
-- ---------------------------------------------------------------------------------------------

create or replace function api.update_group(p_group_id uuid, p_revision integer, p_name text, p_school_year integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := btrim(p_name, E' \t\r\n');
  v_revision integer;
  v_archived_at timestamptz;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  perform app.group_gate(p_group_id, 'manage');
  if v_name is null or char_length(v_name) not between 1 and 120 then
    perform app.raise_error('INVALID', 'invalid_name');
  end if;
  if p_school_year is null or p_school_year not between 2020 and 2100 then
    perform app.raise_error('INVALID', 'invalid_school_year');
  end if;
  select g.revision, g.archived_at into v_revision, v_archived_at from app.groups g where g.id = p_group_id for update;
  perform app.assert_revision(p_revision, v_revision);
  if v_archived_at is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;
  update app.groups set name = v_name, school_year = p_school_year, revision = revision + 1
   where id = p_group_id returning revision into v_revision;
  return jsonb_build_object('id', p_group_id, 'revision', v_revision);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: nothing in api has a default grant.
-- ---------------------------------------------------------------------------------------------

grant execute on function api.create_version(uuid, jsonb, text, uuid, uuid) to authenticated;
grant execute on function api.update_version_config(uuid, integer, jsonb, text) to authenticated;
grant execute on function api.set_version_recipients(uuid, integer, uuid[], uuid) to authenticated;
grant execute on function api.archive_version(uuid, integer) to authenticated;
grant execute on function api.list_versions(uuid) to authenticated;
grant execute on function api.get_version(uuid) to authenticated;
