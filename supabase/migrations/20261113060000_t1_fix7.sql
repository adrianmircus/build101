-- T1.F7: fixes from Codex's review of T1.F6 (docs/revisiones/fase-1-t1-f6-codex.md). No table, no column, no signature
-- of the API changes: CREATE OR REPLACE of functions that exist.
--
-- 1 (medium). Lengths in SQL are counted by code points, like zod 4 does (z.string().max(3) accepts three emojis).
-- app.js_length counted UTF-16 units, so a 31-emoji label passed GraphSpec and SQL refused it. It now is char_length
-- (same name and signature, so every validator that calls it is fixed at once: is_graph_spec, is_question_option,
-- is_optional_text, leaf_text, grade feedback). Sizes in bytes of whole jsonb documents (octet_length of ::text) are
-- left in bytes on purpose: they are a cap on storage, not a length zod counts.
--
-- 2 (medium). app.project_option copied options[].text whole, so {"correctOptionId":"B"} as a text went to the student.
-- It now rebuilds the option by type: id one letter A-Z, text a string within 2000 code points, graph projected; any
-- other type comes out as JSON null. app.publication_content validates the projected option as a whole and, if it does
-- not pass, publishing fails with CONFLICT invalid_option (invalid_option_graph when the graph is what fails) before
-- anything is written.
--
-- 3 (T1.5d review, high and medium). api.student_task copied graph whole and the draft (answers, choices) as whole subtrees,
-- and api.student_save_draft accepted any object as answers.<id>.graph. Both are replaced here, inside the window of the
-- student RPCs. tiza_student has no EXECUTE on the app helpers (and none is granted), so the projection of
-- app.project_graph is spelled out inline, leaf by leaf with its type.
--   student_save_draft: a graph has to be a complete GraphSpec (its projection equals it), else INVALID invalid_answers.
--   student_task, by type on every read (the drafts and publications written before this migration may be dirty):
--     options: an option without a letter as id is left out (it could never be chosen); a text that is not a string within
--       2000 characters is ''; a graph that does not pass GraphSpec after the projection is left out, the option stays.
--     answers: only keys that are ids of an object; text is a string (else ''), mode typed or voice (else typed),
--       transcript only if a string, graph only if it passes GraphSpec; no other key.
--     choices: only an id with a letter A-Z as value.
--
create or replace function app.js_length(p_text text) returns integer
language sql
immutable
set search_path = ''
as $$
  select char_length(p_text)
$$;

create or replace function app.project_option(p_option jsonb) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
      'id', case when jsonb_typeof(p_option -> 'id') = 'string' and (p_option ->> 'id') ~ '^[A-Z]$' then p_option -> 'id' else 'null'::jsonb end,
      'text', app.leaf_text(p_option -> 'text', 2000))
    || case when jsonb_typeof(p_option) = 'object' and p_option ? 'graph' then jsonb_build_object('graph', app.project_graph(p_option -> 'graph')) else '{}'::jsonb end
$$;

create or replace function app.publication_content(p_version_id uuid) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_content jsonb;
  v_question jsonb;
  v_option jsonb;
begin
  select jsonb_build_object(
    'generalInstructions', v.general_instructions,
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object('id', ve.id, 'label', e.label, 'body', ve.body) order by e.position, e.id)
        from app.version_exercises ve join app.assessment_exercises e on e.id = ve.exercise_id
       where ve.version_id = v.id), '[]'::jsonb),
    'questions', case when v.answer_mode = 'gaze' then coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'exerciseId', q.version_exercise_id, 'stem', q.stem, 'options', coalesce((
                         select jsonb_agg(app.project_option(o.e) order by o.n)
                           from jsonb_array_elements(case when jsonb_typeof(q.options) = 'array' then q.options else '[]'::jsonb end) with ordinality as o(e, n)), '[]'::jsonb))
                       order by e.position, e.id, q.position, q.id)
        from app.version_questions q
        join app.version_exercises ve on ve.id = q.version_exercise_id
        join app.assessment_exercises e on e.id = ve.exercise_id
       where q.version_id = v.id), '[]'::jsonb) else '[]'::jsonb end)
    into v_content
    from app.versions v where v.id = p_version_id;

  for v_question in select q from jsonb_array_elements(coalesce(v_content -> 'questions', '[]'::jsonb)) as q loop
    for v_option in select o from jsonb_array_elements(v_question -> 'options') as o loop
      if v_option ? 'graph' and app.is_graph_spec(v_option -> 'graph') is not true then
        perform app.raise_error('CONFLICT', 'invalid_option_graph');
      end if;
      if app.is_question_option(v_option) is not true then
        perform app.raise_error('CONFLICT', 'invalid_option');
      end if;
    end loop;
  end loop;
  return v_content;
end
$$;

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
           -- the graph is a whole GraphSpec: rebuilt leaf by leaf with its type it has to come out equal (tiza_student may not run
           -- the app helpers, so the projection of app.project_graph is spelled out here)
           and (not (e.value ? 'graph') or (select jsonb_build_object(
          'functions', case when jsonb_typeof((e.value -> 'graph') -> 'functions') = 'array' and jsonb_array_length((e.value -> 'graph') -> 'functions') <= 5
            then coalesce((select jsonb_agg(case when jsonb_typeof(f.e) = 'object' then jsonb_build_object('expr', (case when jsonb_typeof(f.e -> 'expr') = 'string' and char_length(f.e -> 'expr' #>> '{}') <= 200 then f.e -> 'expr' else 'null'::jsonb end)) || (case when jsonb_typeof(f.e) = 'object' and f.e ? 'label' then jsonb_build_object('label', (case when jsonb_typeof(f.e -> 'label') = 'string' and char_length(f.e -> 'label' #>> '{}') <= 60 then f.e -> 'label' else 'null'::jsonb end)) else '{}'::jsonb end) else 'null'::jsonb end order by f.n)
                             from jsonb_array_elements((e.value -> 'graph') -> 'functions') with ordinality as f(e, n)), '[]'::jsonb) else 'null'::jsonb end,
          'points', case when jsonb_typeof((e.value -> 'graph') -> 'points') = 'array' and jsonb_array_length((e.value -> 'graph') -> 'points') <= 20
            then coalesce((select jsonb_agg(case when jsonb_typeof(f.e) = 'object' then jsonb_build_object('x', (case when jsonb_typeof(f.e -> 'x') = 'number' then (case when abs((f.e -> 'x' #>> '{}')::numeric) <= 1.7976931348623157e308::numeric then f.e -> 'x' else 'null'::jsonb end) else 'null'::jsonb end), 'y', (case when jsonb_typeof(f.e -> 'y') = 'number' then (case when abs((f.e -> 'y' #>> '{}')::numeric) <= 1.7976931348623157e308::numeric then f.e -> 'y' else 'null'::jsonb end) else 'null'::jsonb end)) || (case when jsonb_typeof(f.e) = 'object' and f.e ? 'label' then jsonb_build_object('label', (case when jsonb_typeof(f.e -> 'label') = 'string' and char_length(f.e -> 'label' #>> '{}') <= 60 then f.e -> 'label' else 'null'::jsonb end)) else '{}'::jsonb end) else 'null'::jsonb end order by f.n)
                             from jsonb_array_elements((e.value -> 'graph') -> 'points') with ordinality as f(e, n)), '[]'::jsonb) else 'null'::jsonb end)
        || case when jsonb_typeof((e.value -> 'graph')) = 'object' and (e.value -> 'graph') ? 'window'
                then jsonb_build_object('window', case when jsonb_typeof((e.value -> 'graph') -> 'window') = 'object'
                       then jsonb_build_object('xMin', (case when jsonb_typeof((e.value -> 'graph') #> '{window,xMin}') = 'number' then (case when abs(((e.value -> 'graph') #> '{window,xMin}' #>> '{}')::numeric) <= 1.7976931348623157e308::numeric then (e.value -> 'graph') #> '{window,xMin}' else 'null'::jsonb end) else 'null'::jsonb end), 'xMax', (case when jsonb_typeof((e.value -> 'graph') #> '{window,xMax}') = 'number' then (case when abs(((e.value -> 'graph') #> '{window,xMax}' #>> '{}')::numeric) <= 1.7976931348623157e308::numeric then (e.value -> 'graph') #> '{window,xMax}' else 'null'::jsonb end) else 'null'::jsonb end), 'yMin', (case when jsonb_typeof((e.value -> 'graph') #> '{window,yMin}') = 'number' then (case when abs(((e.value -> 'graph') #> '{window,yMin}' #>> '{}')::numeric) <= 1.7976931348623157e308::numeric then (e.value -> 'graph') #> '{window,yMin}' else 'null'::jsonb end) else 'null'::jsonb end), 'yMax', (case when jsonb_typeof((e.value -> 'graph') #> '{window,yMax}') = 'number' then (case when abs(((e.value -> 'graph') #> '{window,yMax}' #>> '{}')::numeric) <= 1.7976931348623157e308::numeric then (e.value -> 'graph') #> '{window,yMax}' else 'null'::jsonb end) else 'null'::jsonb end))
                       else 'null'::jsonb end)
                else '{}'::jsonb end) = e.value -> 'graph')
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
            || (case when (o.x -> 'graph') is null then '{}'::jsonb else (select case when not jsonb_path_exists(q.g, '$.** ? (@ == null)') then jsonb_build_object('graph', q.g) else '{}'::jsonb end from (select (select jsonb_build_object(
          'functions', case when jsonb_typeof((o.x -> 'graph') -> 'functions') = 'array' and jsonb_array_length((o.x -> 'graph') -> 'functions') <= 5
            then coalesce((select jsonb_agg(case when jsonb_typeof(f.e) = 'object' then jsonb_build_object('expr', (case when jsonb_typeof(f.e -> 'expr') = 'string' and char_length(f.e -> 'expr' #>> '{}') <= 200 then f.e -> 'expr' else 'null'::jsonb end)) || (case when jsonb_typeof(f.e) = 'object' and f.e ? 'label' then jsonb_build_object('label', (case when jsonb_typeof(f.e -> 'label') = 'string' and char_length(f.e -> 'label' #>> '{}') <= 60 then f.e -> 'label' else 'null'::jsonb end)) else '{}'::jsonb end) else 'null'::jsonb end order by f.n)
                             from jsonb_array_elements((o.x -> 'graph') -> 'functions') with ordinality as f(e, n)), '[]'::jsonb) else 'null'::jsonb end,
          'points', case when jsonb_typeof((o.x -> 'graph') -> 'points') = 'array' and jsonb_array_length((o.x -> 'graph') -> 'points') <= 20
            then coalesce((select jsonb_agg(case when jsonb_typeof(f.e) = 'object' then jsonb_build_object('x', (case when jsonb_typeof(f.e -> 'x') = 'number' then (case when abs((f.e -> 'x' #>> '{}')::numeric) <= 1.7976931348623157e308::numeric then f.e -> 'x' else 'null'::jsonb end) else 'null'::jsonb end), 'y', (case when jsonb_typeof(f.e -> 'y') = 'number' then (case when abs((f.e -> 'y' #>> '{}')::numeric) <= 1.7976931348623157e308::numeric then f.e -> 'y' else 'null'::jsonb end) else 'null'::jsonb end)) || (case when jsonb_typeof(f.e) = 'object' and f.e ? 'label' then jsonb_build_object('label', (case when jsonb_typeof(f.e -> 'label') = 'string' and char_length(f.e -> 'label' #>> '{}') <= 60 then f.e -> 'label' else 'null'::jsonb end)) else '{}'::jsonb end) else 'null'::jsonb end order by f.n)
                             from jsonb_array_elements((o.x -> 'graph') -> 'points') with ordinality as f(e, n)), '[]'::jsonb) else 'null'::jsonb end)
        || case when jsonb_typeof((o.x -> 'graph')) = 'object' and (o.x -> 'graph') ? 'window'
                then jsonb_build_object('window', case when jsonb_typeof((o.x -> 'graph') -> 'window') = 'object'
                       then jsonb_build_object('xMin', (case when jsonb_typeof((o.x -> 'graph') #> '{window,xMin}') = 'number' then (case when abs(((o.x -> 'graph') #> '{window,xMin}' #>> '{}')::numeric) <= 1.7976931348623157e308::numeric then (o.x -> 'graph') #> '{window,xMin}' else 'null'::jsonb end) else 'null'::jsonb end), 'xMax', (case when jsonb_typeof((o.x -> 'graph') #> '{window,xMax}') = 'number' then (case when abs(((o.x -> 'graph') #> '{window,xMax}' #>> '{}')::numeric) <= 1.7976931348623157e308::numeric then (o.x -> 'graph') #> '{window,xMax}' else 'null'::jsonb end) else 'null'::jsonb end), 'yMin', (case when jsonb_typeof((o.x -> 'graph') #> '{window,yMin}') = 'number' then (case when abs(((o.x -> 'graph') #> '{window,yMin}' #>> '{}')::numeric) <= 1.7976931348623157e308::numeric then (o.x -> 'graph') #> '{window,yMin}' else 'null'::jsonb end) else 'null'::jsonb end), 'yMax', (case when jsonb_typeof((o.x -> 'graph') #> '{window,yMax}') = 'number' then (case when abs(((o.x -> 'graph') #> '{window,yMax}' #>> '{}')::numeric) <= 1.7976931348623157e308::numeric then (o.x -> 'graph') #> '{window,yMax}' else 'null'::jsonb end) else 'null'::jsonb end))
                       else 'null'::jsonb end)
                else '{}'::jsonb end) as g) q) end)
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
               || (case when (a.value -> 'graph') is null then '{}'::jsonb else (select case when not jsonb_path_exists(q.g, '$.** ? (@ == null)') then jsonb_build_object('graph', q.g) else '{}'::jsonb end from (select (select jsonb_build_object(
          'functions', case when jsonb_typeof((a.value -> 'graph') -> 'functions') = 'array' and jsonb_array_length((a.value -> 'graph') -> 'functions') <= 5
            then coalesce((select jsonb_agg(case when jsonb_typeof(f.e) = 'object' then jsonb_build_object('expr', (case when jsonb_typeof(f.e -> 'expr') = 'string' and char_length(f.e -> 'expr' #>> '{}') <= 200 then f.e -> 'expr' else 'null'::jsonb end)) || (case when jsonb_typeof(f.e) = 'object' and f.e ? 'label' then jsonb_build_object('label', (case when jsonb_typeof(f.e -> 'label') = 'string' and char_length(f.e -> 'label' #>> '{}') <= 60 then f.e -> 'label' else 'null'::jsonb end)) else '{}'::jsonb end) else 'null'::jsonb end order by f.n)
                             from jsonb_array_elements((a.value -> 'graph') -> 'functions') with ordinality as f(e, n)), '[]'::jsonb) else 'null'::jsonb end,
          'points', case when jsonb_typeof((a.value -> 'graph') -> 'points') = 'array' and jsonb_array_length((a.value -> 'graph') -> 'points') <= 20
            then coalesce((select jsonb_agg(case when jsonb_typeof(f.e) = 'object' then jsonb_build_object('x', (case when jsonb_typeof(f.e -> 'x') = 'number' then (case when abs((f.e -> 'x' #>> '{}')::numeric) <= 1.7976931348623157e308::numeric then f.e -> 'x' else 'null'::jsonb end) else 'null'::jsonb end), 'y', (case when jsonb_typeof(f.e -> 'y') = 'number' then (case when abs((f.e -> 'y' #>> '{}')::numeric) <= 1.7976931348623157e308::numeric then f.e -> 'y' else 'null'::jsonb end) else 'null'::jsonb end)) || (case when jsonb_typeof(f.e) = 'object' and f.e ? 'label' then jsonb_build_object('label', (case when jsonb_typeof(f.e -> 'label') = 'string' and char_length(f.e -> 'label' #>> '{}') <= 60 then f.e -> 'label' else 'null'::jsonb end)) else '{}'::jsonb end) else 'null'::jsonb end order by f.n)
                             from jsonb_array_elements((a.value -> 'graph') -> 'points') with ordinality as f(e, n)), '[]'::jsonb) else 'null'::jsonb end)
        || case when jsonb_typeof((a.value -> 'graph')) = 'object' and (a.value -> 'graph') ? 'window'
                then jsonb_build_object('window', case when jsonb_typeof((a.value -> 'graph') -> 'window') = 'object'
                       then jsonb_build_object('xMin', (case when jsonb_typeof((a.value -> 'graph') #> '{window,xMin}') = 'number' then (case when abs(((a.value -> 'graph') #> '{window,xMin}' #>> '{}')::numeric) <= 1.7976931348623157e308::numeric then (a.value -> 'graph') #> '{window,xMin}' else 'null'::jsonb end) else 'null'::jsonb end), 'xMax', (case when jsonb_typeof((a.value -> 'graph') #> '{window,xMax}') = 'number' then (case when abs(((a.value -> 'graph') #> '{window,xMax}' #>> '{}')::numeric) <= 1.7976931348623157e308::numeric then (a.value -> 'graph') #> '{window,xMax}' else 'null'::jsonb end) else 'null'::jsonb end), 'yMin', (case when jsonb_typeof((a.value -> 'graph') #> '{window,yMin}') = 'number' then (case when abs(((a.value -> 'graph') #> '{window,yMin}' #>> '{}')::numeric) <= 1.7976931348623157e308::numeric then (a.value -> 'graph') #> '{window,yMin}' else 'null'::jsonb end) else 'null'::jsonb end), 'yMax', (case when jsonb_typeof((a.value -> 'graph') #> '{window,yMax}') = 'number' then (case when abs(((a.value -> 'graph') #> '{window,yMax}' #>> '{}')::numeric) <= 1.7976931348623157e308::numeric then (a.value -> 'graph') #> '{window,yMax}' else 'null'::jsonb end) else 'null'::jsonb end))
                       else 'null'::jsonb end)
                else '{}'::jsonb end) as g) q) end))
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
