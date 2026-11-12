-- T1.3a: student needs (health data): writes with history, audited reads, and the interface the
-- student RPCs read. Replaces the stubs of 20261111131000 (same signatures) and grants EXECUTE to
-- authenticated. No new table.
--
-- Who may touch a student's needs (app.needs_gate), from the session and never from a parameter:
--   * inclusion of the institution: every student of it, read and write;
--   * staff of a group where the student is enrolled right now (a teacher, or an admin who also
--     teaches that group), and the sandbox visitor in their sandbox;
--   * an admin who does not teach the student's group: FORBIDDEN (least privilege for health data);
--   * the student themselves: FORBIDDEN; a teacher of another group, another institution: NOT_FOUND.
--
-- Lock order of set_student_needs: the (institution, op_id) advisory lock, then the student row
-- (for update, which also serializes the create-or-edit of the needs row), then the needs row. The
-- op_id is looked up under those locks and compared with the identity stored in the event (the
-- student and the exact content of the request); the unique index on (institution, op_id) is the
-- last resort and is translated to CONFLICT op_key_reused.
--
-- The catalogue below mirrors PROFILE_IDS and SUPPORT_IDS in lib/domain/students/needs.ts (a test
-- compares them with data/profiles); a profile or support is added in both places in the same ticket.

-- ---------------------------------------------------------------------------------------------
-- Guard: the student a needs row belongs to never changes (id and institution_id are already
-- frozen by app.touch_row).
-- ---------------------------------------------------------------------------------------------

create function app.student_needs_student_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.student_id is distinct from old.student_id then
    raise exception 'app.student_needs_student_frozen: student_id never changes' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create trigger student_needs_student_frozen
  before update on app.student_needs
  for each row execute function app.student_needs_student_frozen();

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- Reads without locking: the caller locks after being authorized. Returns the institution.
create function app.needs_gate(p_student_id uuid) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_institution_id uuid;
begin
  select s.institution_id into v_institution_id from app.students s where s.id = p_student_id;
  if v_institution_id is null
     or not app.is_member(v_institution_id, array['admin', 'teacher', 'inclusion', 'student']) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if app.is_member(v_institution_id, array['inclusion']) then
    return v_institution_id;
  end if;
  if exists (
    select 1 from app.enrollments e
     where e.institution_id = v_institution_id and e.student_id = p_student_id and e.ended_at is null
       and app.is_group_staff(e.group_id)
  ) then
    return v_institution_id;
  end if;
  if app.is_member(v_institution_id, array['admin']) or app.is_student_self(p_student_id) then
    perform app.raise_error('FORBIDDEN', 'forbidden');
  end if;
  perform app.raise_error('NOT_FOUND', 'not_found');
  return null;
end
$$;

-- The same shape as NeedsFields: what an event keeps in before and after.
create function app.needs_fields(p_profiles text[], p_supports text[], p_interests text[], p_review_due_on date) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'profiles', to_jsonb(coalesce(p_profiles, '{}'::text[])),
    'supports', to_jsonb(coalesce(p_supports, '{}'::text[])),
    'interests', to_jsonb(coalesce(p_interests, '{}'::text[])),
    'reviewDueOn', p_review_due_on
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- set_student_needs
-- ---------------------------------------------------------------------------------------------

-- Creates the row (p_revision null) or edits it (p_revision = the current one). Every accepted call
-- writes one event, and the student's interface follows the profiles: gaze with motor, voice with
-- dysgraphia, standard otherwise (student_home reads it; the student role cannot read the needs).
-- The same op_id for the same student and the same content answers what was stored; for anything
-- else it is CONFLICT op_key_reused, checked before the revision.
create or replace function api.set_student_needs(
  p_student_id uuid, p_profiles text[], p_supports text[], p_interests text[], p_op_id uuid,
  p_revision integer default null, p_review_due_on date default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_profiles text[];
  v_supports text[];
  v_interests text[];
  v_after jsonb;
  v_before jsonb;
  v_event app.student_need_events;
  v_row app.student_needs;
  v_archived_at timestamptz;
  v_revision integer;
  v_interface text;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.needs_gate(p_student_id);

  -- Shape first: a null is INVALID, never a silent pass (length(null) < 3 is null, not true).
  if p_op_id is null then
    perform app.raise_error('INVALID', 'invalid_op_key');
  end if;
  if p_profiles is null or p_supports is null or p_interests is null
     or exists (select 1 from unnest(p_profiles) as v where v is null)
     or exists (select 1 from unnest(p_supports) as v where v is null)
     or exists (select 1 from unnest(p_interests) as v where v is null) then
    perform app.raise_error('INVALID', 'invalid_needs');
  end if;
  if cardinality(p_profiles) > 10 or cardinality(p_supports) > 10
     or (select count(distinct v) from unnest(p_profiles) as v) <> cardinality(p_profiles)
     or (select count(distinct v) from unnest(p_supports) as v) <> cardinality(p_supports) then
    perform app.raise_error('INVALID', 'invalid_needs');
  end if;
  if exists (select 1 from unnest(p_profiles) as v where v not in ('adhd', 'asd', 'dysgraphia', 'dyslexia', 'motor')) then
    perform app.raise_error('INVALID', 'unknown_profile');
  end if;
  if exists (select 1 from unnest(p_supports) as v where v not in ('preguntas_guia', 'recordatorio', 'ejemplo_resuelto', 'numeros_simples')) then
    perform app.raise_error('INVALID', 'unknown_support');
  end if;
  -- Interests are free text: trimmed like the schema does, non-empty, short, without repeats.
  v_interests := array(select btrim(v, E' \t\r\n') from unnest(p_interests) with ordinality as t(v, n) order by n);
  if cardinality(v_interests) > 10 or exists (select 1 from unnest(v_interests) as v where char_length(v) not between 1 and 60)
     or (select count(distinct v) from unnest(v_interests) as v) <> cardinality(v_interests) then
    perform app.raise_error('INVALID', 'invalid_interests');
  end if;
  -- Profiles and supports are sets: stored sorted, so the same set is the same request.
  v_profiles := array(select v from unnest(p_profiles) as v order by v);
  v_supports := array(select v from unnest(p_supports) as v order by v);
  v_after := app.needs_fields(v_profiles, v_supports, v_interests, p_review_due_on);

  perform pg_advisory_xact_lock(hashtextextended('tiza.needs_op:' || v_institution_id::text || ':' || p_op_id::text, 0));
  select s.archived_at into v_archived_at from app.students s where s.id = p_student_id for update;

  -- Under the locks: has this op_id been applied? The identity is the student and the content.
  select * into v_event from app.student_need_events e
   where e.institution_id = v_institution_id and e.op_id = p_op_id;
  if found then
    if v_event.student_id = p_student_id and v_event.after = v_after then
      return jsonb_build_object('studentId', p_student_id, 'revision', v_event.need_revision);
    end if;
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;

  if v_archived_at is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;

  select * into v_row from app.student_needs n where n.student_id = p_student_id for update;
  if v_row.id is null then
    -- Creating: the client has no revision to send yet.
    if p_revision is not null then
      perform app.raise_error('CONFLICT', 'revision_mismatch');
    end if;
    v_before := null;
    v_revision := 1;
    insert into app.student_needs (institution_id, student_id, profiles, supports, interests, review_due_on)
    values (v_institution_id, p_student_id, v_profiles, v_supports, v_interests, p_review_due_on);
  else
    perform app.assert_revision(p_revision, v_row.revision);
    v_before := app.needs_fields(v_row.profiles, v_row.supports, v_row.interests, v_row.review_due_on);
    update app.student_needs
       set profiles = v_profiles, supports = v_supports, interests = v_interests,
           review_due_on = p_review_due_on, revision = revision + 1
     where id = v_row.id
     returning revision into v_revision;
  end if;

  begin
    insert into app.student_need_events (institution_id, student_id, op_id, kind, need_revision, before, after, actor_user_id)
    values (v_institution_id, p_student_id, p_op_id,
            case when cardinality(v_profiles) = 0 and cardinality(v_supports) = 0 and cardinality(v_interests) = 0
                      and p_review_due_on is null then 'cleared' else 'set' end,
            v_revision, v_before, v_after, app.actor_id());
  exception when unique_violation then
    -- The same op_id used at the same time for another student: the unique index decides.
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end;

  v_interface := case
    when 'motor' = any (v_profiles) then 'gaze'
    when 'dysgraphia' = any (v_profiles) then 'voice'
    else 'standard'
  end;
  -- No revision bump: the interface is derived, not something anyone edits.
  update app.students set interface = v_interface where id = p_student_id and interface is distinct from v_interface;

  return jsonb_build_object('studentId', p_student_id, 'revision', v_revision);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Audited reads: one audit_log row per request, with the students whose needs were shown.
-- ---------------------------------------------------------------------------------------------

-- Every student must be readable by the caller and belong to one institution; otherwise the whole
-- request is refused (the code of the first student that fails), so nothing is half shown.
create or replace function api.get_student_needs(p_student_ids uuid[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_institution_id uuid;
  v_one uuid;
  v_items jsonb;
  v_shown uuid[];
begin
  perform app.rpc_begin();
  perform app.require_actor();
  if p_student_ids is null or cardinality(p_student_ids) not between 1 and 200
     or exists (select 1 from unnest(p_student_ids) as v where v is null) then
    perform app.raise_error('INVALID', 'invalid_students');
  end if;
  v_ids := array(select distinct v from unnest(p_student_ids) as v order by v);
  foreach v_id in array v_ids loop
    v_one := app.needs_gate(v_id);
    if v_institution_id is not null and v_one <> v_institution_id then
      perform app.raise_error('INVALID', 'invalid_students');
    end if;
    v_institution_id := v_one;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
           'studentId', n.student_id, 'revision', n.revision, 'profiles', to_jsonb(n.profiles),
           'supports', to_jsonb(n.supports), 'interests', to_jsonb(n.interests), 'reviewDueOn', n.review_due_on
         ) order by n.student_id), '[]'::jsonb),
         coalesce(array_agg(n.student_id order by n.student_id), '{}'::uuid[])
    into v_items, v_shown
    from app.student_needs n
   where n.institution_id = v_institution_id and n.student_id = any (v_ids);
  perform app.audit_disclosure(v_institution_id, 'get_student_needs', 'student_needs', null, v_shown);
  return jsonb_build_object('items', v_items);
end
$$;

-- The students enrolled now and not archived. A reader of the group who may not read needs (an
-- admin who does not teach it) is FORBIDDEN, as the matrix says.
create or replace function api.get_group_needs(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_items jsonb;
  v_shown uuid[];
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.group_reader_gate(p_group_id);
  if not (app.is_group_staff(p_group_id) or app.is_member(v_institution_id, array['inclusion'])) then
    perform app.raise_error('FORBIDDEN', 'forbidden');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'studentId', n.student_id, 'revision', n.revision, 'profiles', to_jsonb(n.profiles),
           'supports', to_jsonb(n.supports), 'interests', to_jsonb(n.interests), 'reviewDueOn', n.review_due_on
         ) order by n.student_id), '[]'::jsonb),
         coalesce(array_agg(n.student_id order by n.student_id), '{}'::uuid[])
    into v_items, v_shown
    from app.student_needs n
    join app.students s on s.institution_id = n.institution_id and s.id = n.student_id
   where n.institution_id = v_institution_id and s.archived_at is null
     and exists (select 1 from app.enrollments e
                  where e.institution_id = v_institution_id and e.group_id = p_group_id
                    and e.student_id = n.student_id and e.ended_at is null);
  perform app.audit_disclosure(v_institution_id, 'get_group_needs', 'group', p_group_id, v_shown);
  return jsonb_build_object('items', v_items);
end
$$;

-- Newest first. A page with no events (a student with no history, or an offset past the end)
-- shows nobody, so it writes no audit row.
create or replace function api.list_student_need_events(p_student_id uuid, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_total integer;
  v_items jsonb;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.needs_gate(p_student_id);
  if p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset < 0 then
    perform app.raise_error('INVALID', 'invalid_page');
  end if;

  select count(*) into v_total from app.student_need_events e
   where e.institution_id = v_institution_id and e.student_id = p_student_id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'studentId', p.student_id, 'kind', p.kind, 'needRevision', p.need_revision,
           'before', p.before, 'after', p.after, 'actorUserId', p.actor_user_id, 'createdAt', p.created_at
         ) order by p.need_revision desc), '[]'::jsonb)
    into v_items
    from (select * from app.student_need_events e
           where e.institution_id = v_institution_id and e.student_id = p_student_id
           order by e.need_revision desc limit p_limit offset p_offset) p;
  if jsonb_array_length(v_items) > 0 then
    perform app.audit_disclosure(v_institution_id, 'list_student_need_events', 'student', p_student_id, array[p_student_id]);
  end if;
  return jsonb_build_object('items', v_items, 'total', v_total);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: nothing in api has a default grant.
-- ---------------------------------------------------------------------------------------------

grant execute on function api.set_student_needs(uuid, text[], text[], text[], uuid, integer, date) to authenticated;
grant execute on function api.get_student_needs(uuid[]) to authenticated;
grant execute on function api.get_group_needs(uuid) to authenticated;
grant execute on function api.list_student_need_events(uuid, integer, integer) to authenticated;
