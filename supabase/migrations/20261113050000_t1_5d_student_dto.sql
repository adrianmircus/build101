-- T1.5d: what the student reads. Replaces the four stubs of 20261111131200 (same signatures, no change of contract) with
-- the DTOs of lib/domain/delivery/student-dto.ts: student_home, student_task_list, student_task and student_grades. The
-- ticket's own number (20261112220000) was already used.
--
-- They run as tiza_student (the window of «El rol del estudiante»): SECURITY DEFINER functions owned by that role, with
-- no privilege beyond what 20261111131300 already gave it and no helper of their own. Postgres is what keeps them away
-- from the key and from anyone's profile; these bodies only name what the student may read. Each DTO is built key by key
-- with jsonb_build_object (the list of what leaves), never from a whole row or a whole jsonb.
--
-- Who: the student of the session. student_home, student_task_list and student_grades take no id and answer the caller's
-- own rows; whoever has no active student row (a teacher, inclusion, an archived student) is FORBIDDEN not_a_student, and
-- no session is FORBIDDEN no_session. student_task takes an attempt: another student's attempt, one of a teacher's call
-- or an id that does not exist are NOT_FOUND (RLS hides the rows from the role and app.is_student_self says no), the same
-- as student_open_attempt.
--
-- How the student answers: interface comes from students.interface (derived from the profile when the profile is saved,
-- which tiza_student cannot read) and answerMode and aids from the publication; none names a profile. Dictation needs a
-- valid ai_dictation consent, checked on every read: without it interface voice is standard and answerMode voice is typed.
-- Answers already dictated stay as the student wrote them.
--
-- student_task is a pure read (student_open_attempt stamps first_viewed_at). What it shows at each moment is the table of
-- lib/domain/delivery/attempt-rules.ts, with the order of questions of the attempt RPCs: a withdrawn publication or
-- assignment and a superseded attempt first (only what was submitted, read only; anything else is NOT_FOUND), then a
-- publication that is not yet open (CONFLICT not_published), then the status. A submitted attempt is readOnly; one past
-- its due date is still shown, with late true. It reads the attempt it is given, also a superseded one: that is how the
-- student sees what they handed in (the open RPC only finds the attempt in force). It is one statement, so one snapshot:
-- a submit that commits in the middle cannot show a submitted status with an older draft.
--
-- student_task_list shows the attempt in force of each assignment, also before publish_at (the dates are part of the
-- summary), and hides what student_task would hide: withdrawn and not submitted. student_grades shows only what a teacher
-- corrected (a grade row exists), with the status of each exercise and never its errors.
--
-- Titles: an assessment has no title, so the topic is the title, or «Práctico» / «Prueba» when it has none.

select app.begin_student_rpc_change();

create or replace function api.student_home()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_student app.students;
  v_dictation boolean;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select s.* into v_student from app.students s where s.id = app.actor_student_id();
  if not found then
    perform app.raise_error('FORBIDDEN', 'not_a_student');
  end if;

  select exists (
    select 1 from app.consents c
     where c.student_id = v_student.id and c.purpose = 'ai_dictation' and c.status = 'granted'
       and c.valid_from <= clock_timestamp() and (c.valid_until is null or c.valid_until > clock_timestamp())
  ) into v_dictation;

  return jsonb_build_object(
    'displayName', v_student.display_name,
    'interface', case when v_student.interface = 'voice' and not v_dictation then 'standard' else v_student.interface end,
    'groups', (
      select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'subjectId', g.subject_id) order by g.name, g.id), '[]'::jsonb)
        from app.enrollments e
        join app.groups g on g.id = e.group_id
       where e.student_id = v_student.id and e.ended_at is null and g.archived_at is null
    )
  );
end
$$;

create or replace function api.student_task_list()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_student uuid;
  v_now timestamptz;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_student := app.actor_student_id();
  if v_student is null then
    perform app.raise_error('FORBIDDEN', 'not_a_student');
  end if;
  v_now := clock_timestamp();

  return jsonb_build_object('tasks', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'assignmentId', a.id,
      'attemptId', t.id,
      'title', coalesce(nullif(btrim(s.topic), ''), case s.kind when 'exam' then 'Prueba' else 'Práctico' end),
      'kind', s.kind,
      'subjectId', s.subject_id,
      'publishAt', s.publish_at,
      'dueAt', s.due_at,
      'status', case t.status
                  when 'submitted' then case when g.id is not null then 'graded' else 'submitted' end
                  when 'started' then 'in_progress'
                  else 'not_started' end,
      'late', case when t.status = 'submitted' then t.late else coalesce(v_now > s.due_at, false) end
    ) order by t.created_at desc, t.id), '[]'::jsonb)
      from app.assignments a
      join app.assignment_attempts t on t.assignment_id = a.id and t.superseded_at is null
      join app.assessments s on s.id = a.assessment_id
      join app.publications p on p.id = t.publication_id
      left join app.grades g on g.attempt_id = t.id
     where a.student_id = v_student
       and (t.status = 'submitted' or (a.status <> 'withdrawn' and p.withdrawn_at is null))
  ));
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
            jsonb_build_object('id', o.x ->> 'id', 'text', o.x ->> 'text')
            || case when jsonb_typeof(o.x -> 'graph') = 'object' then jsonb_build_object('graph', o.x -> 'graph') else '{}'::jsonb end
            order by o.n), '[]'::jsonb)
            from jsonb_array_elements(case when jsonb_typeof(q.x -> 'options') = 'array' then q.x -> 'options' else '[]'::jsonb end)
                 with ordinality as o(x, n)
        )
      ) order by q.n), '[]'::jsonb)
        from jsonb_array_elements(case when jsonb_typeof(v.content -> 'questions') = 'array' then v.content -> 'questions' else '[]'::jsonb end)
             with ordinality as q(x, n)
    ),
    -- An attempt that has not started has no draft row yet: revision 1 is the one start creates.
    'draft', jsonb_build_object(
      'revision', coalesce(v.draft_revision, 1),
      'answers', coalesce(v.answers, '{}'::jsonb),
      'choices', coalesce(v.choices, '{}'::jsonb)
    )
  );
end
$$;

create or replace function api.student_grades()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_student uuid;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_student := app.actor_student_id();
  if v_student is null then
    perform app.raise_error('FORBIDDEN', 'not_a_student');
  end if;

  return jsonb_build_object('grades', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'assignmentId', a.id,
      'attemptId', t.id,
      'title', coalesce(nullif(btrim(s.topic), ''), case s.kind when 'exam' then 'Prueba' else 'Práctico' end),
      'kind', s.kind,
      'subjectId', s.subject_id,
      'score', g.score,
      'feedback', g.feedback,
      'gradedAt', g.graded_at,
      -- The status of each exercise of the publication the teacher marked, never its errors.
      'exercises', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'exerciseId', e.x ->> 'id', 'label', e.x ->> 'label', 'status', g.exercise_results -> (e.x ->> 'id') ->> 'status'
        ) order by e.n), '[]'::jsonb)
          from jsonb_array_elements(case when jsonb_typeof(p.content -> 'exercises') = 'array' then p.content -> 'exercises' else '[]'::jsonb end)
               with ordinality as e(x, n)
         where (g.exercise_results -> (e.x ->> 'id') ->> 'status') in ('correct', 'partial', 'wrong', 'blank')
      )
    ) order by g.graded_at desc nulls last, g.id), '[]'::jsonb)
      from app.grades g
      join app.assignment_attempts t on t.id = g.attempt_id
      join app.assignments a on a.id = t.assignment_id
      join app.assessments s on s.id = a.assessment_id
      join app.publications p on p.id = t.publication_id
     where a.student_id = v_student
  ));
end
$$;

grant execute on function api.student_home() to authenticated;
grant execute on function api.student_task_list() to authenticated;
grant execute on function api.student_task(uuid) to authenticated;
grant execute on function api.student_grades() to authenticated;

select app.end_student_rpc_change();
