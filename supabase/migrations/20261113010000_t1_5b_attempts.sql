-- T1.5b: the student's side of an attempt. Replaces the four stubs of 20261111131200 (same signatures) with the protocol
-- of docs/contratos/fase-1.md, «Intentos y entrega»: open, start, save the draft and submit. The ticket's own number
-- (20261112200000) was already used.
--
-- They run as tiza_student (the window of «El rol del estudiante»): SECURITY DEFINER functions owned by that role, with
-- no privilege beyond what 20261111131300 already gave it, and no helper of their own (every helper they call is one
-- the role already executes). Postgres is what keeps them away from the key and from anyone's profile; these bodies
-- only name what the student may read.
--
-- Who: the student of the attempt. Everything is decided from the session: another student's assignment or attempt,
-- the one of a teacher or of someone with no student row are NOT_FOUND (RLS hides them from the role and
-- app.is_student_self says no); no session is FORBIDDEN no_session.
--
-- What can be done at each moment is the table of lib/domain/delivery/attempt-rules.ts, applied with the same order of
-- questions (a withdrawn publication or assignment and a superseded attempt first, then a publication that is not yet
-- open, then the status). The moment is clock_timestamp() taken after the locks (never now(): it can be older than the
-- row we waited for). publish_at and due_at live in assessments.
--
--   open     the attempt in force of an assignment. Opened and started read in full; submitted reads (also from a
--            withdrawn publication); one that is closed and not submitted is NOT_FOUND; before publish_at is
--            CONFLICT not_published. The first look stamps first_viewed_at: the only write, one row, no assignment
--            lock (it takes no other lock, so it cannot cross publish_version).
--   start    app.lock_attempt_tree (assignment -> attempt -> draft). Already started or submitted: answers the same,
--            changes nothing. Withdrawn or superseded: CONFLICT attempt_closed; before publish_at: not_published.
--            Otherwise opened -> started, creates the draft (revision 1) and moves the assignment to in_progress.
--   save     lock_attempt_tree. Submitted: CONFLICT already_submitted. Opened: CONFLICT attempt_not_started.
--            Closed: attempt_closed. Not yet open: not_published. Then each exercise id of the answers and each
--            question id of the choices has to be of the attempt's publication (INVALID unknown_exercise) and each
--            chosen option one of the question's (INVALID unknown_choice); the revision is the draft's
--            (CONFLICT revision_mismatch) and goes up by one. The draft is replaced as a whole.
--   submit   lock_attempt_tree. Submitted: answers what was saved with alreadySubmitted and changes nothing, whatever
--            revision comes (the second click). Opened: attempt_not_started. Closed: attempt_closed. Not yet open:
--            not_published. A draft newer than p_revision is CONFLICT draft_outdated. Freezes the draft, marks the
--            attempt submitted (late when after due_at) and the assignment submitted.
--
-- The shape of the answers is checked before any lock (INVALID invalid_answers, invalid_choices, revision_required):
-- the repo validates with zod first, this is the second wall. Every validator answers a boolean and the condition that
-- discards uses "is not true", so a NULL never lets a malformed input through.

select app.begin_student_rpc_change();

create or replace function api.student_open_attempt(p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_attempt app.assignment_attempts;
  v_closed boolean;
  v_publish_at timestamptz;
begin
  perform app.rpc_begin();
  perform app.require_actor();

  select t.* into v_attempt
    from app.assignments a
    join app.assignment_attempts t on t.assignment_id = a.id and t.superseded_at is null
   where a.id = p_assignment_id and app.is_student_self(a.student_id);
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  select (a.status = 'withdrawn' or p.withdrawn_at is not null), s.publish_at into v_closed, v_publish_at
    from app.assignments a
    join app.publications p on p.id = v_attempt.publication_id
    join app.assessments s on s.id = a.assessment_id
   where a.id = v_attempt.assignment_id;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  if v_closed then
    if v_attempt.status <> 'submitted' then
      perform app.raise_error('NOT_FOUND', 'not_found');
    end if;
  elsif v_publish_at is not null and clock_timestamp() < v_publish_at then
    perform app.raise_error('CONFLICT', 'not_published');
  end if;

  if v_attempt.first_viewed_at is null then
    update app.assignment_attempts set first_viewed_at = clock_timestamp()
     where id = v_attempt.id and first_viewed_at is null;
  end if;
  return jsonb_build_object('attemptId', v_attempt.id, 'status', v_attempt.status);
end
$$;

create or replace function api.student_start_attempt(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_attempt app.assignment_attempts;
  v_closed boolean;
  v_publish_at timestamptz;
  v_draft integer;
  v_now timestamptz;
begin
  perform app.rpc_begin();
  perform app.require_actor();

  -- Without a lock: the attempt is the caller's.
  select t.assignment_id into v_assignment_id
    from app.assignment_attempts t
    join app.assignments a on a.id = t.assignment_id
   where t.id = p_attempt_id and app.is_student_self(a.student_id);
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  if not app.lock_attempt_tree(p_attempt_id) then  -- assignment -> attempt -> draft
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  v_now := clock_timestamp();
  select t.* into v_attempt from app.assignment_attempts t where t.id = p_attempt_id;
  select s.revision into v_draft from app.submissions s where s.attempt_id = p_attempt_id;

  -- Already started (or submitted): the same answer, nothing changes.
  if v_attempt.status <> 'opened' then
    if v_draft is null then
      raise exception 'api.student_start_attempt: an attempt that started has no draft' using errcode = 'P0004';
    end if;
    return jsonb_build_object('attemptId', v_attempt.id, 'status', v_attempt.status, 'draftRevision', v_draft);
  end if;

  select (a.status = 'withdrawn' or p.withdrawn_at is not null or v_attempt.superseded_at is not null), s.publish_at
    into v_closed, v_publish_at
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
  if v_publish_at is not null and v_now < v_publish_at then
    perform app.raise_error('CONFLICT', 'not_published');
  end if;

  update app.assignment_attempts
     set status = 'started', started_at = v_now, first_viewed_at = coalesce(first_viewed_at, v_now), revision = revision + 1
   where id = p_attempt_id;
  insert into app.submissions (institution_id, attempt_id) values (v_attempt.institution_id, p_attempt_id)
  returning revision into v_draft;
  update app.assignments set status = 'in_progress', revision = revision + 1
   where id = v_attempt.assignment_id and status = 'assigned';
  return jsonb_build_object('attemptId', p_attempt_id, 'status', 'started', 'draftRevision', v_draft);
end
$$;

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
           and (not (e.value ? 'graph') or jsonb_typeof(e.value -> 'graph') = 'object')
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

create or replace function api.student_submit_attempt(p_attempt_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_attempt app.assignment_attempts;
  v_closed boolean;
  v_publish_at timestamptz;
  v_due_at timestamptz;
  v_draft integer;
  v_now timestamptz;
  v_late boolean;
begin
  perform app.rpc_begin();
  perform app.require_actor();

  -- Without a lock: the attempt is the caller's.
  select t.assignment_id into v_assignment_id
    from app.assignment_attempts t
    join app.assignments a on a.id = t.assignment_id
   where t.id = p_attempt_id and app.is_student_self(a.student_id);
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if p_revision is null then
    perform app.raise_error('INVALID', 'revision_required');
  end if;

  if not app.lock_attempt_tree(p_attempt_id) then  -- assignment -> attempt -> draft
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  v_now := clock_timestamp();
  select t.* into v_attempt from app.assignment_attempts t where t.id = p_attempt_id;  -- again, under the lock

  -- The second click: it found the first one's work and changes nothing.
  if v_attempt.status = 'submitted' then
    return jsonb_build_object('submittedAt', v_attempt.submitted_at, 'late', v_attempt.late, 'alreadySubmitted', true);
  end if;
  if v_attempt.status <> 'started' then
    perform app.raise_error('CONFLICT', 'attempt_not_started');
  end if;
  select (a.status = 'withdrawn' or p.withdrawn_at is not null or v_attempt.superseded_at is not null), s.publish_at, s.due_at
    into v_closed, v_publish_at, v_due_at
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
  if v_publish_at is not null and v_now < v_publish_at then
    perform app.raise_error('CONFLICT', 'not_published');
  end if;

  select s.revision into v_draft from app.submissions s where s.attempt_id = p_attempt_id;
  if v_draft is null then
    raise exception 'api.student_submit_attempt: an attempt that started has no draft' using errcode = 'P0004';
  end if;
  if v_draft <> p_revision then
    perform app.raise_error('CONFLICT', 'draft_outdated');
  end if;

  v_late := v_due_at is not null and v_now > v_due_at;
  update app.submissions set submitted_at = v_now where attempt_id = p_attempt_id;
  update app.assignment_attempts
     set status = 'submitted', submitted_at = v_now, late = v_late, revision = revision + 1
   where id = p_attempt_id;
  update app.assignments set status = 'submitted', revision = revision + 1 where id = v_attempt.assignment_id;
  return jsonb_build_object('submittedAt', v_now, 'late', v_late, 'alreadySubmitted', false);
end
$$;

grant execute on function api.student_open_attempt(uuid) to authenticated;
grant execute on function api.student_start_attempt(uuid) to authenticated;
grant execute on function api.student_save_draft(uuid, integer, jsonb, jsonb) to authenticated;
grant execute on function api.student_submit_attempt(uuid, integer) to authenticated;

select app.end_student_rpc_change();
