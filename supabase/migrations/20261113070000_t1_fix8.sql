-- T1.F8: fixes from Codex's closing review of phase 1 (docs/revisiones/fase-1-cierre-codex-1.md, F1-1 to F1-5).
-- No table and no column change: CREATE OR REPLACE of functions that exist, one new RPC, grants and guards.
--
-- F1-1 (high). students.interface was derived from the profile (motor -> gaze, dysgraphia -> voice), so a student who
-- reads "gaze" in student_home could deduce that "motor" is registered. It is now an accessibility setting the staff
-- chooses, independent of the profile. api.set_student_needs no longer touches it (same signature); the new
-- api.set_student_interface(student, interface, revision) changes it: the staff of the student's group and
-- inclusion, like set_student_needs (app.needs_gate); optimistic concurrency on the student revision under the
-- student's row lock; the same value is idempotent and does not move the revision. Existing students keep the value they
-- have now. Whoever picks it (phase 6 UI) may suggest gaze when motor is registered, always as an explicit action.
--
-- F1-2 (medium). student_save_draft checked the graph of an answer with "projection = original", which accepts the nulls
-- the projection uses to mark an invalid leaf ({"functions":[{"expr":null}],"points":[]} and
-- {"functions":null,"points":null}), while app.is_graph_spec rejects them. tiza_student now has EXECUTE, by name, on the
-- pure helpers (app.is_graph_spec, app.project_graph and what they call): all SECURITY INVOKER, IMMUTABLE and without
-- table reads, so no table access and no borrowed privilege. Saving validates with app.is_graph_spec; reading projects
-- with app.project_graph and validates the projection. The inline copy of the projection is gone.
--
-- F1-3 (medium). Expected inputs that ended in raw SQL errors (23514, 23502) or in a silent success: add_group_staff with a
-- role that is not owner/co_teacher, internal_create_institution with a bad kind, code, name or kind/expiry/owner
-- combination, internal_add_membership with a bad role, internal_upsert_app_user with a blank or long name. Now each is
-- rejected before anything is written with INVALID and a reason that has its Spanish text.
--
-- F1-4 (medium). Ownership guards (P0004) on the columns that say whom a row belongs to and that app.touch_row does not
-- freeze (it only freezes id, institution_id and created_at). The only exceptions are the documented erasure ones:
-- columns that go to NULL (student_pseudonyms.student_id, account_provisioning.student_id) and the actor columns that
-- the foreign key sets to NULL when the account is deleted.
--
-- F1-5 (low). The reasons SQL raises and the texts in lib/domain/errors/reasons.ts are compared by 030_reasons.test.sql
-- and by reasons.test.ts. New reasons of this migration: invalid_interface, invalid_role, invalid_code,
-- invalid_institution_kind, invalid_institution_shape.

-- ---------------------------------------------------------------------------------------------
-- F1-1
-- ---------------------------------------------------------------------------------------------

-- Creates the row (p_revision null) or edits it (p_revision = the current one). Every accepted call writes one event.
-- It does not touch students.interface (T1.F8, F1-1): the interface is an accessibility setting, not a function of the
-- profile. The same op_id for the same student and the same content answers what was stored; for anything else it is
-- CONFLICT op_key_reused, checked before the revision.
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

  return jsonb_build_object('studentId', p_student_id, 'revision', v_revision);
end
$$;


grant execute on function api.set_student_needs(uuid, text[], text[], text[], uuid, integer, date) to authenticated;

-- The accessibility setting of a student: which tools the screen offers (standard, gaze, voice). Not a label of a
-- profile. Who: the same as set_student_needs (app.needs_gate). Lock order: the student row (for update), nothing else.
create function api.set_student_interface(p_student_id uuid, p_interface text, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_student app.students;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  perform app.needs_gate(p_student_id);
  -- Shape first: a null is INVALID, never a silent pass (NOT IN with a null is null, not true).
  if p_interface is null or p_interface not in ('standard', 'gaze', 'voice') then
    perform app.raise_error('INVALID', 'invalid_interface');
  end if;
  select * into v_student from app.students s where s.id = p_student_id for update;
  perform app.assert_revision(p_revision, v_student.revision);
  if v_student.archived_at is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;
  if v_student.interface <> p_interface then
    update app.students set interface = p_interface, revision = revision + 1
     where id = p_student_id returning revision into v_student.revision;
  end if;
  return jsonb_build_object('id', p_student_id, 'revision', v_student.revision);
end
$$;

grant execute on function api.set_student_interface(uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- F1-2: the pure helpers tiza_student may run, by name. Each one is SECURITY INVOKER, IMMUTABLE and reads no table.
-- ---------------------------------------------------------------------------------------------

grant execute on function
  app.js_length(text), app.is_js_number(jsonb), app.is_optional_text(jsonb, text, integer),
  app.is_graph_spec(jsonb), app.leaf_text(jsonb, integer), app.leaf_number(jsonb),
  app.leaf_optional_text(jsonb, text, integer), app.project_graph(jsonb)
  to tiza_student;

-- The student RPCs of T1.F7 with the helpers instead of the inline copy of the projection. Same signatures.
select app.begin_student_rpc_change();

create or replace function api.student_save_draft(p_attempt_id uuid, p_revision integer, p_answers jsonb, p_choices jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_attempt app.assignment_attempts;
  v_closed boolean;
  v_publish_at timestamptz;
  v_content jsonb;
  v_draft integer;
  v_valid boolean;
begin
  perform app.rpc_begin();
  perform app.require_actor();

  select t.assignment_id into v_assignment_id
    from app.assignment_attempts t
    join app.assignments a on a.id = t.assignment_id
   where t.id = p_attempt_id and app.is_student_self(a.student_id);
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  -- The shape, before any lock. { <exercise id>: { text, mode, transcript?, graph? } } and { <question id>: "A" }.
  if p_revision is null then
    perform app.raise_error('INVALID', 'revision_required');
  end if;
  -- CASE, not AND: jsonb_each fails on anything that is not an object and SQL does not promise the order of an AND.
  v_valid := coalesce(case when jsonb_typeof(p_answers) = 'object' then
    octet_length(p_answers::text) <= 5000000
    and not exists (
      select 1 from jsonb_each(p_answers) e
       where not coalesce(
         case when jsonb_typeof(e.value) = 'object' then
           (e.value - array['text', 'mode', 'transcript', 'graph']) = '{}'::jsonb
           and jsonb_typeof(e.value -> 'text') = 'string' and char_length(e.value ->> 'text') <= 20000
           and jsonb_typeof(e.value -> 'mode') = 'string' and (e.value ->> 'mode') in ('typed', 'voice')
           and (not (e.value ? 'transcript')
                or (jsonb_typeof(e.value -> 'transcript') = 'string' and char_length(e.value ->> 'transcript') <= 20000))
           -- the graph is a whole GraphSpec; app.is_graph_spec is the one validator (it always answers a boolean)
           and (not (e.value ? 'graph') or app.is_graph_spec(e.value -> 'graph'))
         else false end, false))
    else false end, false);
  if v_valid is not true then
    perform app.raise_error('INVALID', 'invalid_answers');
  end if;
  v_valid := coalesce(case when jsonb_typeof(p_choices) = 'object' then
    not exists (
      select 1 from jsonb_each(p_choices) e
       where not coalesce(
         case when jsonb_typeof(e.value) = 'string' then (e.value #>> '{}') ~ '^[A-Z]$' else false end, false))
    else false end, false);
  if v_valid is not true then
    perform app.raise_error('INVALID', 'invalid_choices');
  end if;

  if not app.lock_attempt_tree(p_attempt_id) then  -- assignment -> attempt -> draft
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  select t.* into v_attempt from app.assignment_attempts t where t.id = p_attempt_id;
  if v_attempt.status = 'submitted' then
    perform app.raise_error('CONFLICT', 'already_submitted');
  end if;
  if v_attempt.status <> 'started' then
    perform app.raise_error('CONFLICT', 'attempt_not_started');
  end if;
  select (a.status = 'withdrawn' or p.withdrawn_at is not null or v_attempt.superseded_at is not null), s.publish_at, p.content
    into v_closed, v_publish_at, v_content
    from app.assignments a
    join app.publications p on p.id = v_attempt.publication_id
    join app.assessments s on s.id = a.assessment_id
   where a.id = v_attempt.assignment_id;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if v_closed then
    perform app.raise_error('CONFLICT', 'attempt_closed');
  end if;
  if v_publish_at is not null and clock_timestamp() < v_publish_at then
    perform app.raise_error('CONFLICT', 'not_published');
  end if;

  -- Every id is of this attempt's publication, never another one's.
  if exists (
       select 1 from jsonb_object_keys(p_answers) k
        where not exists (select 1 from jsonb_array_elements(v_content -> 'exercises') x where x ->> 'id' = k))
     or exists (
       select 1 from jsonb_object_keys(p_choices) k
        where not exists (select 1 from jsonb_array_elements(v_content -> 'questions') x where x ->> 'id' = k)) then
    perform app.raise_error('INVALID', 'unknown_exercise');
  end if;
  if exists (
       select 1 from jsonb_each_text(p_choices) c
        where not exists (
          select 1
            from jsonb_array_elements(v_content -> 'questions') q, jsonb_array_elements(q -> 'options') o
           where q ->> 'id' = c.key and o ->> 'id' = c.value)) then
    perform app.raise_error('INVALID', 'unknown_choice');
  end if;

  select s.revision into v_draft from app.submissions s where s.attempt_id = p_attempt_id;
  if v_draft is null then
    raise exception 'api.student_save_draft: an attempt that started has no draft' using errcode = 'P0004';
  end if;
  perform app.assert_revision(p_revision, v_draft);

  update app.submissions set answers = p_answers, choices = p_choices, revision = revision + 1
   where attempt_id = p_attempt_id
  returning revision into v_draft;
  return jsonb_build_object('revision', v_draft);
end
$$;

create or replace function api.student_task(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v record;
  v_now timestamptz;
  v_closed boolean;
  v_submitted boolean;
begin
  perform app.rpc_begin();
  perform app.require_actor();

  -- One statement: the attempt has to be the caller's and everything comes from one snapshot.
  select t.status as attempt_status, t.submitted_at, t.late, t.superseded_at,
         a.id as assignment_id, a.status as assignment_status,
         s.topic, s.kind, s.subject_id, s.publish_at, s.due_at,
         p.withdrawn_at, p.content, p.answer_mode, p.aids,
         d.revision as draft_revision, d.answers, d.choices,
         exists (
           select 1 from app.consents c
            where c.student_id = a.student_id and c.purpose = 'ai_dictation' and c.status = 'granted'
              and c.valid_from <= clock_timestamp() and (c.valid_until is null or c.valid_until > clock_timestamp())
         ) as dictation
    into v
    from app.assignment_attempts t
    join app.assignments a on a.id = t.assignment_id
    join app.assessments s on s.id = a.assessment_id
    join app.publications p on p.id = t.publication_id
    left join app.submissions d on d.attempt_id = t.id
   where t.id = p_attempt_id and app.is_student_self(a.student_id);
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  v_now := clock_timestamp();
  v_submitted := v.attempt_status = 'submitted';
  v_closed := v.assignment_status = 'withdrawn' or v.withdrawn_at is not null or v.superseded_at is not null;
  if v_closed then
    if not v_submitted then
      perform app.raise_error('NOT_FOUND', 'not_found');
    end if;
  elsif v.publish_at is not null and v_now < v.publish_at then
    perform app.raise_error('CONFLICT', 'not_published');
  end if;

  return jsonb_build_object(
    'attemptId', p_attempt_id,
    'assignmentId', v.assignment_id,
    'title', coalesce(nullif(btrim(v.topic), ''), case v.kind when 'exam' then 'Prueba' else 'Práctico' end),
    'kind', v.kind,
    'subjectId', v.subject_id,
    'generalInstructions', coalesce(v.content ->> 'generalInstructions', ''),
    'answerMode', case when v.answer_mode = 'voice' and not v.dictation then 'typed' else v.answer_mode end,
    'aids', jsonb_build_object('readAloud', coalesce(v.aids -> 'readAloud' = 'true'::jsonb, false)),
    'dueAt', v.due_at,
    'readOnly', v_submitted,
    'late', case when v_submitted then v.late else coalesce(v_now > v.due_at, false) end,
    'submittedAt', v.submitted_at,
    'exercises', (
      select coalesce(jsonb_agg(jsonb_build_object('id', e.x ->> 'id', 'label', e.x ->> 'label', 'body', e.x ->> 'body') order by e.n), '[]'::jsonb)
        from jsonb_array_elements(case when jsonb_typeof(v.content -> 'exercises') = 'array' then v.content -> 'exercises' else '[]'::jsonb end)
             with ordinality as e(x, n)
    ),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.x ->> 'id',
        'exerciseId', q.x ->> 'exerciseId',
        'stem', q.x ->> 'stem',
        'options', (
          select coalesce(jsonb_agg(
            jsonb_build_object('id', o.x -> 'id', 'text', case when jsonb_typeof(o.x -> 'text') = 'string' and char_length(o.x ->> 'text') <= 2000 then o.x -> 'text' else '""'::jsonb end)
            || (case when (o.x -> 'graph') is null then '{}'::jsonb else (select case when app.is_graph_spec(q.g) then jsonb_build_object('graph', q.g) else '{}'::jsonb end from (select app.project_graph((o.x -> 'graph')) as g) q) end)
            order by o.n), '[]'::jsonb)
            from jsonb_array_elements(case when jsonb_typeof(q.x -> 'options') = 'array' then q.x -> 'options' else '[]'::jsonb end)
                 with ordinality as o(x, n)
           where jsonb_typeof(o.x -> 'id') = 'string' and (o.x ->> 'id') ~ '^[A-Z]$'
        )
      ) order by q.n), '[]'::jsonb)
        from jsonb_array_elements(case when jsonb_typeof(v.content -> 'questions') = 'array' then v.content -> 'questions' else '[]'::jsonb end)
             with ordinality as q(x, n)
    ),
    -- An attempt that has not started has no draft row yet: revision 1 is the one start creates.
    'draft', jsonb_build_object(
      'revision', coalesce(v.draft_revision, 1),
      'answers', coalesce((select jsonb_object_agg(a.key, jsonb_build_object(
                 'text', case when jsonb_typeof(a.value -> 'text') = 'string' and char_length(a.value ->> 'text') <= 20000 then a.value -> 'text' else '""'::jsonb end,
                 'mode', case when jsonb_typeof(a.value -> 'mode') = 'string' and (a.value ->> 'mode') in ('typed', 'voice') then a.value -> 'mode' else '"typed"'::jsonb end)
               || (case when jsonb_typeof(a.value -> 'transcript') = 'string' and char_length(a.value ->> 'transcript') <= 20000 then jsonb_build_object('transcript', a.value -> 'transcript') else '{}'::jsonb end)
               || (case when (a.value -> 'graph') is null then '{}'::jsonb else (select case when app.is_graph_spec(q.g) then jsonb_build_object('graph', q.g) else '{}'::jsonb end from (select app.project_graph((a.value -> 'graph')) as g) q) end))
                 from jsonb_each(case when jsonb_typeof(v.answers) = 'object' then v.answers else '{}'::jsonb end) a
                where jsonb_typeof(a.value) = 'object' and a.key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), '{}'::jsonb),
      'choices', coalesce((select jsonb_object_agg(c.key, c.value)
                 from jsonb_each(case when jsonb_typeof(v.choices) = 'object' then v.choices else '{}'::jsonb end) c
                where jsonb_typeof(c.value) = 'string' and (c.value #>> '{}') ~ '^[A-Z]$' and c.key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), '{}'::jsonb)
    )
  );
end
$$;

grant execute on function api.student_save_draft(uuid, integer, jsonb, jsonb) to authenticated;
grant execute on function api.student_task(uuid) to authenticated;

select app.end_student_rpc_change();

-- ---------------------------------------------------------------------------------------------
-- F1-3: input validation before any write.
-- ---------------------------------------------------------------------------------------------

create or replace function api.add_group_staff(p_group_id uuid, p_user_id uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_archived_at timestamptz;
  v_staff app.group_staff;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.group_gate(p_group_id, 'staff');
  -- Shape first: a null role would reach the table as 23502, and a null in the comparison below would skip the check.
  if p_role is null or p_role not in ('owner', 'co_teacher') then
    perform app.raise_error('INVALID', 'invalid_role');
  end if;
  -- The group row serializes every change to its staff.
  select g.archived_at into v_archived_at from app.groups g where g.id = p_group_id for update;
  if v_archived_at is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;
  if not exists (
    select 1 from app.memberships m
     where m.institution_id = v_institution_id and m.user_id = p_user_id
       and m.revoked_at is null and m.role in ('teacher', 'admin')
  ) then
    perform app.raise_error('INVALID', 'not_a_member');
  end if;
  select * into v_staff from app.group_staff gs
   where gs.group_id = p_group_id and gs.user_id = p_user_id and gs.removed_at is null;
  if found then
    if v_staff.role <> p_role then
      perform app.raise_error('CONFLICT', 'revision_mismatch');
    end if;
    return jsonb_build_object('id', v_staff.id);
  end if;
  if p_role = 'owner' and exists (
    select 1 from app.group_staff gs where gs.group_id = p_group_id and gs.role = 'owner' and gs.removed_at is null
  ) then
    perform app.raise_error('CONFLICT', 'revision_mismatch');
  end if;
  insert into app.group_staff (institution_id, group_id, user_id, role)
  values (v_institution_id, p_group_id, p_user_id, p_role)
  returning * into v_staff;
  return jsonb_build_object('id', v_staff.id);
end
$$;

create or replace function api.internal_create_institution(
  p_name text, p_code text, p_kind text, p_expires_at timestamptz default null, p_owner_user_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_code text := lower(btrim(p_code));
  v_name text := btrim(p_name);
  v_row app.institutions;
begin
  perform app.rpc_begin();
  -- Shape first, as the table's checks say it: name 1 to 200, code lowercase letters, digits and hyphens (3 to 32),
  -- kind school or sandbox; a school has no expiry and no owner, a sandbox has both.
  if v_name is null or char_length(v_name) not between 1 and 200 then
    perform app.raise_error('INVALID', 'invalid_name');
  end if;
  if v_code is null or v_code !~ '^[a-z0-9][a-z0-9-]{2,31}$' then
    perform app.raise_error('INVALID', 'invalid_code');
  end if;
  if p_kind is null or p_kind not in ('school', 'sandbox') then
    perform app.raise_error('INVALID', 'invalid_institution_kind');
  end if;
  if (p_kind = 'school' and (p_expires_at is not null or p_owner_user_id is not null))
     or (p_kind = 'sandbox' and (p_expires_at is null or p_owner_user_id is null)) then
    perform app.raise_error('INVALID', 'invalid_institution_shape');
  end if;
  if p_owner_user_id is not null and not exists (select 1 from app.app_users u where u.id = p_owner_user_id) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  -- The code's unique index is the arbiter between two concurrent creations of the same code.
  insert into app.institutions (name, code, kind, expires_at, owner_user_id)
  values (v_name, v_code, p_kind, p_expires_at, p_owner_user_id)
  on conflict (code) do nothing
  returning * into v_row;
  if v_row.id is not null then
    return jsonb_build_object('id', v_row.id);
  end if;
  select * into v_row from app.institutions i where i.code = v_code;
  if v_row.name = v_name and v_row.kind = p_kind
     and v_row.expires_at is not distinct from p_expires_at
     and v_row.owner_user_id is not distinct from p_owner_user_id then
    return jsonb_build_object('id', v_row.id);
  end if;
  perform app.raise_error('CONFLICT', 'op_key_reused');
  return null;
end
$$;

create or replace function api.internal_upsert_app_user(p_user_id uuid, p_display_name text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.rpc_begin();
  -- A null name means "do not change it"; a name that is given has to be 1 to 120 characters once trimmed.
  if p_display_name is not null and char_length(btrim(p_display_name)) not between 1 and 120 then
    perform app.raise_error('INVALID', 'invalid_name');
  end if;
  if not exists (select 1 from auth.users a where a.id = p_user_id) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  insert into app.app_users as u (id, display_name) values (p_user_id, btrim(p_display_name))
  on conflict (id) do update
     set display_name = excluded.display_name, revision = u.revision + 1
   where excluded.display_name is not null and u.display_name is distinct from excluded.display_name
  returning u.id into v_id;
  if v_id is null then
    v_id := p_user_id;
  end if;
  return jsonb_build_object('id', v_id);
end
$$;

create or replace function api.internal_add_membership(p_institution_id uuid, p_user_id uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.rpc_begin();
  if p_role is null or p_role not in ('admin', 'teacher', 'inclusion', 'student') then
    perform app.raise_error('INVALID', 'invalid_role');
  end if;
  if not exists (select 1 from app.institutions i where i.id = p_institution_id)
     or not exists (select 1 from app.app_users u where u.id = p_user_id) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform app.identity_lock(p_institution_id, p_user_id);
  insert into app.memberships (institution_id, user_id, role) values (p_institution_id, p_user_id, p_role)
  on conflict (institution_id, user_id, role) where revoked_at is null do nothing
  returning id into v_id;
  if v_id is null then
    -- Under the lock nobody can revoke it now, and each READ COMMITTED statement sees what the
    -- previous holder committed. Still a defensive check: a null id would break the contract.
    select m.id into v_id from app.memberships m
     where m.institution_id = p_institution_id and m.user_id = p_user_id and m.role = p_role and m.revoked_at is null;
    if v_id is null then
      raise exception 'internal_add_membership: no active membership after the conflict' using errcode = 'P0004';
    end if;
  end if;
  return jsonb_build_object('id', v_id);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- F1-4: ownership guards. One BEFORE UPDATE trigger per table, P0004. app.touch_row already freezes id, institution_id
-- and created_at. "Goes to NULL only" is for what the foreign key (ON DELETE SET NULL) or the erasure nulls; "never
-- changes once set" is for nullable references that point at whom the row belongs to.
-- ---------------------------------------------------------------------------------------------

create function app.enrollments_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id is distinct from old.group_id or new.student_id is distinct from old.student_id then
    raise exception 'app.enrollments_frozen: group_id and student_id never change' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger enrollments_frozen before update on app.enrollments
  for each row execute function app.enrollments_frozen();

create function app.group_staff_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id is distinct from old.group_id or new.user_id is distinct from old.user_id then
    raise exception 'app.group_staff_frozen: group_id and user_id never change' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger group_staff_frozen before update on app.group_staff
  for each row execute function app.group_staff_frozen();

create function app.submissions_attempt_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.attempt_id is distinct from old.attempt_id then
    raise exception 'app.submissions_attempt_frozen: attempt_id never changes' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger submissions_attempt_frozen before update on app.submissions
  for each row execute function app.submissions_attempt_frozen();

-- The erasure of a student unlinks the pseudonym and the provisioning row: student_id goes to NULL, never to another student.
create function app.student_pseudonyms_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.student_id is distinct from old.student_id and new.student_id is not null then
    raise exception 'app.student_pseudonyms_frozen: student_id only goes to null' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger student_pseudonyms_frozen before update on app.student_pseudonyms
  for each row execute function app.student_pseudonyms_frozen();

create function app.account_provisioning_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.student_id is distinct from old.student_id and new.student_id is not null then
    raise exception 'app.account_provisioning_frozen: student_id only goes to null' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger account_provisioning_frozen before update on app.account_provisioning
  for each row execute function app.account_provisioning_frozen();

-- Once an account is tied to a student it is never moved to another one (it would hand over the student's data).
create function app.students_user_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.user_id is not null and new.user_id is not null and new.user_id <> old.user_id then
    raise exception 'app.students_user_frozen: user_id never moves to another account' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger students_user_frozen before update on app.students
  for each row execute function app.students_user_frozen();

create function app.groups_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.subject_id is distinct from old.subject_id then
    raise exception 'app.groups_frozen: subject_id never changes' using errcode = 'P0004';
  end if;
  if new.created_by is distinct from old.created_by and new.created_by is not null then
    raise exception 'app.groups_frozen: created_by only goes to null' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger groups_frozen before update on app.groups
  for each row execute function app.groups_frozen();

create function app.files_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id is distinct from old.group_id or new.student_id is distinct from old.student_id then
    raise exception 'app.files_frozen: group_id and student_id never change' using errcode = 'P0004';
  end if;
  if new.reserved_by is distinct from old.reserved_by and new.reserved_by is not null then
    raise exception 'app.files_frozen: reserved_by only goes to null' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger files_frozen before update on app.files
  for each row execute function app.files_frozen();

create function app.syllabi_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id is distinct from old.group_id then
    raise exception 'app.syllabi_frozen: group_id never changes' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger syllabi_frozen before update on app.syllabi
  for each row execute function app.syllabi_frozen();

create function app.operations_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id is distinct from old.group_id
     or (old.assessment_id is not null and new.assessment_id is distinct from old.assessment_id)
     or (old.file_id is not null and new.file_id is distinct from old.file_id) then
    raise exception 'app.operations_frozen: group_id, assessment_id and file_id never change' using errcode = 'P0004';
  end if;
  if new.requested_by is distinct from old.requested_by and new.requested_by is not null then
    raise exception 'app.operations_frozen: requested_by only goes to null' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger operations_frozen before update on app.operations
  for each row execute function app.operations_frozen();

create function app.group_analyses_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id is distinct from old.group_id
     or (old.assessment_id is not null and new.assessment_id is distinct from old.assessment_id)
     or (old.operation_id is not null and new.operation_id is distinct from old.operation_id) then
    raise exception 'app.group_analyses_frozen: group_id, assessment_id and operation_id never change' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger group_analyses_frozen before update on app.group_analyses
  for each row execute function app.group_analyses_frozen();

create function app.institutions_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.owner_user_id is not null and new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'app.institutions_frozen: owner_user_id never changes' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger institutions_frozen before update on app.institutions
  for each row execute function app.institutions_frozen();

create function app.invitations_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.invited_by is distinct from old.invited_by and new.invited_by is not null then
    raise exception 'app.invitations_frozen: invited_by only goes to null' using errcode = 'P0004';
  end if;
  if old.accepted_by is not null and new.accepted_by is distinct from old.accepted_by and new.accepted_by is not null then
    raise exception 'app.invitations_frozen: accepted_by only goes to null once set' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger invitations_frozen before update on app.invitations
  for each row execute function app.invitations_frozen();

create function app.notifications_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'app.notifications_frozen: user_id never changes' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger notifications_frozen before update on app.notifications
  for each row execute function app.notifications_frozen();

create function app.presets_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'app.presets_frozen: owner_user_id never changes' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger presets_frozen before update on app.presets
  for each row execute function app.presets_frozen();

create function app.sandbox_sessions_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'app.sandbox_sessions_frozen: owner_user_id never changes' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger sandbox_sessions_frozen before update on app.sandbox_sessions
  for each row execute function app.sandbox_sessions_frozen();

create function app.import_runs_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id and new.user_id is not null then
    raise exception 'app.import_runs_frozen: user_id only goes to null' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger import_runs_frozen before update on app.import_runs
  for each row execute function app.import_runs_frozen();

create function app.erasures_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.pseudonym_id is not null and new.pseudonym_id is distinct from old.pseudonym_id then
    raise exception 'app.erasures_frozen: pseudonym_id never changes' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger erasures_frozen before update on app.erasures
  for each row execute function app.erasures_frozen();
