-- Contract, phase 1: the single lock order.
--
-- Every transaction takes row locks in this order, skipping what it does not need:
--   assessments -> assessment_exercises (by id) -> versions (by id) -> generations
--   -> version_exercises (by id) -> version_questions and question_keys -> answer_keys
--   -> assignments (by id) -> assignment_attempts -> submissions -> grades
-- Two transactions that follow one order cannot deadlock. Start, cancel, edit, approve and
-- complete a generation all go through app.lock_version_tree, which takes the version, then the
-- generation, then the exercises sorted by id, and refuses to go back up the order.
--
-- Pattern inside an RPC: authorize with a plain read first (never lock rows the actor cannot see),
-- then call app.lock_begin() once, then the lock helpers, then re-read what you will compare
-- (revisions) under the lock.
--
-- The markers are transaction-local settings. lock_begin() resets them because one test
-- transaction can call several RPCs in a row; in production each RPC is its own transaction.

create function app.lock_begin() returns void
language sql
set search_path = ''
as $$
  select set_config('tiza.lock_tree', '', true), set_config('tiza.lock_depth', '0', true);
$$;

-- Depth reached so far in this RPC: 0 nothing, 1 version, 2 generation, 3 exercises, 9 several
-- versions or delivery rows (nothing of a version tree may be locked after those).
create function app.lock_depth() returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('tiza.lock_depth', true), ''), '0')::integer
$$;

create function app.lock_violation(p_what text) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'lock order violated: %', p_what using errcode = 'P0004';
end
$$;

-- Returns false when the version does not exist. A generation that is not of this version is a
-- bug, not a user error.
create function app.lock_version_tree(p_version_id uuid, p_generation_id uuid, p_exercise_ids uuid[]) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_tree text := coalesce(current_setting('tiza.lock_tree', true), '');
  v_depth integer := app.lock_depth();
begin
  if v_depth = 9 or (v_tree <> '' and v_tree <> p_version_id::text) then
    perform app.lock_violation('one version tree per RPC, and before delivery rows');
  end if;
  if p_generation_id is not null and v_depth >= 3 then
    perform app.lock_violation('the generation is locked before the exercises');
  end if;
  perform 1 from app.versions v where v.id = p_version_id for update;
  if not found then
    return false;
  end if;
  v_depth := greatest(v_depth, 1);
  if p_generation_id is not null then
    perform 1 from app.generations g where g.id = p_generation_id and g.version_id = p_version_id for update;
    if not found then
      perform app.lock_violation('the generation is not of this version');
    end if;
    v_depth := greatest(v_depth, 2);
  end if;
  if p_exercise_ids is not null and cardinality(p_exercise_ids) > 0 then
    perform 1 from app.version_exercises ve
     where ve.version_id = p_version_id and ve.id = any (p_exercise_ids)
     order by ve.id
       for update;
    v_depth := 3;
  end if;
  perform set_config('tiza.lock_tree', p_version_id::text, true);
  perform set_config('tiza.lock_depth', v_depth::text, true);
  return true;
end
$$;

-- Several versions at once (approve all, publish): by id, and nothing deeper afterwards.
create function app.lock_versions(p_version_ids uuid[]) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if app.lock_depth() <> 0 then
    perform app.lock_violation('several versions are locked first or alone');
  end if;
  perform 1 from app.versions v where v.id = any (p_version_ids) order by v.id for update;
  get diagnostics v_count = row_count;
  perform set_config('tiza.lock_depth', '9', true);
  return v_count;
end
$$;

-- Delivery rows come after any version lock: publish locks its version first, then assignments.
-- Start and submit lock only their assignment, so they never wait on a version.
create function app.lock_assignments(p_assignment_ids uuid[]) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform 1 from app.assignments a where a.id = any (p_assignment_ids) order by a.id for update;
  get diagnostics v_count = row_count;
  perform set_config('tiza.lock_depth', '9', true);
  return v_count;
end
$$;
