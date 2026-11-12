-- T1.F5: fixes from Codex's review of T1.5a (docs/revisiones/fase-1-t1-5a-codex.md). No new table, no new column, no
-- change of signature: every function here is CREATE OR REPLACE of one that exists (or a new app helper).
--
-- P-1 (high). publish copied q.options whole, and the SQL validators of the options only asked for `graph` to be an
-- object, so {"functions":[],"correctOptionId":"B","recipients":["<uuid>"]} went in through the RPC, was approved and
-- was published. Two layers:
--   (a) app.is_graph_spec replicates GraphSpec of lib/domain/assessments/versions.ts (allowed keys at each level,
--       types, limits) and always answers a boolean. The option validators of the edit (app.clean_question_options,
--       T1.4c) and of the AI output (app.is_generated_questions, T1.4d/T1.4e) use it through app.is_question_option,
--       and what they discard they discard with `is not true`.
--   (b) publish_version no longer copies the jsonb as it is stored: app.publication_content projects every option
--       through a closed projection (id, text and a graph projected to its allowed keys). A row that somebody seeded
--       as the table owner, with anything nested in graph, is not copied either.
-- Lengths are counted like zod counts them (UTF-16 code units: app.js_length), so what SQL accepts zod accepts, and a
-- number must be finite as a JS double.
--
-- P-2 (medium). aids.readAloud is true in every publication. The app shows «Escuchar» to every student who does not
-- answer with the eyes, without looking at the profile (components/solve/SolveAssessment.tsx), and showing it only to
-- some would let a student deduce a profile (CLAUDE.md). docs/contratos/fase-1.md, «Decisiones que cambian el spec».
--
-- P-3 (low). The first publication of an assessment makes it 'published' (the CHECK admits it). Its revision does not
-- move: the revision guards the fields a person edits (kind, topic, instructions), which publishing does not touch.
-- To take the assessment lock at the start and not at the end, publish_version
-- takes the assessment FOR NO KEY UPDATE in the place where it took FOR SHARE (before the version). It is the lock an
-- UPDATE of the status takes anyway; FOR UPDATE would also conflict with the FOR KEY SHARE that any foreign key insert
-- pointing at the assessment takes, and would open a deadlock with a transaction that holds an assignment and inserts
-- such a row. Against every other RPC (they take it FOR SHARE or FOR UPDATE) it conflicts exactly the same. The order
-- stays group -> assessment -> version -> assignments -> attempts. Two publications of different versions of the same
-- assessment queue on the assessment, and nobody takes a lock upwards.

-- ---------------------------------------------------------------------------------------------
-- (a) Validators
-- ---------------------------------------------------------------------------------------------

-- The length of a text as JavaScript counts it (z.string().max): UTF-16 code units. A character outside the BMP is two.
create function app.js_length(p_text text) returns integer
language sql
immutable
set search_path = ''
as $$
  select char_length(p_text) + char_length(regexp_replace(p_text, E'[^\\U00010000-\\U0010FFFF]', '', 'g'))
$$;

-- z.number(): a finite JS double. A jsonb number can be bigger than that and would arrive as Infinity.
create function app.is_js_number(p_value jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_value) = 'number' and abs((p_value #>> '{}')::numeric) <= 1.7976931348623157e308::numeric, false)
$$;

-- An optional string of up to p_max characters: absent is fine; present, it is a string within the limit (null is not).
create function app.is_optional_text(p_object jsonb, p_key text, p_max integer) returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when not p_object ? p_key then true
              else coalesce(jsonb_typeof(p_object -> p_key) = 'string' and app.js_length(p_object ->> p_key) <= p_max, false) end
$$;

-- GraphSpec (lib/domain/assessments/versions.ts), strict at each level:
--   { functions: [{ expr: string<=200, label?: string<=60 }] (<=5), points: [{ x, y: number, label?: string<=60 }] (<=20),
--     window?: { xMin, xMax, yMin, yMax: number } }
-- Plain plpgsql with early returns: a jsonb function applied to the wrong type raises, and SQL does not promise the
-- order in which an AND is evaluated. Always a boolean, never NULL.
create function app.is_graph_spec(p_graph jsonb) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_key text;
begin
  if jsonb_typeof(p_graph) is distinct from 'object' then
    return false;
  end if;
  for v_key in select jsonb_object_keys(p_graph) loop
    if v_key not in ('functions', 'points', 'window') then
      return false;
    end if;
  end loop;

  if jsonb_typeof(p_graph -> 'functions') is distinct from 'array' or jsonb_array_length(p_graph -> 'functions') > 5 then
    return false;
  end if;
  for v_item in select e from jsonb_array_elements(p_graph -> 'functions') as e loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      return false;
    end if;
    for v_key in select jsonb_object_keys(v_item) loop
      if v_key not in ('expr', 'label') then
        return false;
      end if;
    end loop;
    if jsonb_typeof(v_item -> 'expr') is distinct from 'string' or app.js_length(v_item ->> 'expr') > 200
       or not app.is_optional_text(v_item, 'label', 60) then
      return false;
    end if;
  end loop;

  if jsonb_typeof(p_graph -> 'points') is distinct from 'array' or jsonb_array_length(p_graph -> 'points') > 20 then
    return false;
  end if;
  for v_item in select e from jsonb_array_elements(p_graph -> 'points') as e loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      return false;
    end if;
    for v_key in select jsonb_object_keys(v_item) loop
      if v_key not in ('x', 'y', 'label') then
        return false;
      end if;
    end loop;
    if not app.is_js_number(v_item -> 'x') or not app.is_js_number(v_item -> 'y') or not app.is_optional_text(v_item, 'label', 60) then
      return false;
    end if;
  end loop;

  if p_graph ? 'window' then
    v_item := p_graph -> 'window';
    if jsonb_typeof(v_item) is distinct from 'object' then
      return false;
    end if;
    for v_key in select jsonb_object_keys(v_item) loop
      if v_key not in ('xMin', 'xMax', 'yMin', 'yMax') then
        return false;
      end if;
    end loop;
    if not app.is_js_number(v_item -> 'xMin') or not app.is_js_number(v_item -> 'xMax')
       or not app.is_js_number(v_item -> 'yMin') or not app.is_js_number(v_item -> 'yMax') then
      return false;
    end if;
  end if;
  return true;
end
$$;

-- One option as zod has it (QuestionOption): { id: [A-Z], text: string<=2000, graph?: GraphSpec }, nothing else.
create function app.is_question_option(p_option jsonb) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
begin
  if jsonb_typeof(p_option) is distinct from 'object' then
    return false;
  end if;
  for v_key in select jsonb_object_keys(p_option) loop
    if v_key not in ('id', 'text', 'graph') then
      return false;
    end if;
  end loop;
  if jsonb_typeof(p_option -> 'id') is distinct from 'string' or (p_option ->> 'id') !~ '^[A-Z]$'
     or jsonb_typeof(p_option -> 'text') is distinct from 'string' or app.js_length(p_option ->> 'text') > 2000 then
    return false;
  end if;
  if p_option ? 'graph' and not app.is_graph_spec(p_option -> 'graph') then
    return false;
  end if;
  return true;
end
$$;

-- 2 to 4 options, each one valid, with distinct ids. Same answer as OptionList in zod.
create function app.is_strict_option_list(p_options jsonb) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_option jsonb;
begin
  if jsonb_typeof(p_options) is distinct from 'array' or jsonb_array_length(p_options) not between 2 and 4 then
    return false;
  end if;
  for v_option in select e from jsonb_array_elements(p_options) as e loop
    if not app.is_question_option(v_option) then
      return false;
    end if;
  end loop;
  return (select count(distinct o ->> 'id') from jsonb_array_elements(p_options) as o) = jsonb_array_length(p_options);
end
$$;

-- The options of an edit (T1.4c). Same errors and same order as before: repeated ids are options_repeated, anything
-- else off is invalid_options. The shape check is no longer "graph is an object": it is the whole GraphSpec.
create or replace function app.clean_question_options(p_options jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_option jsonb;
begin
  if jsonb_typeof(p_options) is distinct from 'array' or jsonb_array_length(p_options) not between 2 and 4 then
    perform app.raise_error('INVALID', 'invalid_options');
  end if;
  for v_option in select e from jsonb_array_elements(p_options) as e loop
    if app.is_question_option(v_option) is not true then
      perform app.raise_error('INVALID', 'invalid_options');
    end if;
  end loop;
  if (select count(distinct o ->> 'id') from jsonb_array_elements(p_options) as o) <> jsonb_array_length(p_options) then
    perform app.raise_error('INVALID', 'options_repeated');
  end if;
  return p_options;
end
$$;

-- { questions: [{ stem, options }] } from the AI (T1.4d/T1.4e): 1 to 10 questions, each with a stem and a strict option
-- list. The correct option is not part of it: it comes from the answer key.
create or replace function app.is_generated_questions(p_output jsonb) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_question jsonb;
  v_key text;
begin
  if jsonb_typeof(p_output) is distinct from 'object' or jsonb_typeof(p_output -> 'questions') is distinct from 'array'
     or jsonb_array_length(p_output -> 'questions') not between 1 and 10 then
    return false;
  end if;
  for v_question in select e from jsonb_array_elements(p_output -> 'questions') as e loop
    if jsonb_typeof(v_question) is distinct from 'object' then
      return false;
    end if;
    for v_key in select jsonb_object_keys(v_question) loop
      if v_key not in ('stem', 'options') then
        return false;
      end if;
    end loop;
    if jsonb_typeof(v_question -> 'stem') is distinct from 'string' or char_length(v_question ->> 'stem') not between 1 and 5000
       or btrim(v_question ->> 'stem', E' \t\r\n') = ''
       or app.is_strict_option_list(v_question -> 'options') is not true then
      return false;
    end if;
  end loop;
  return true;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- (b) The closed projection of what a student receives
-- ---------------------------------------------------------------------------------------------

-- A graph as its allowed keys, whatever the stored jsonb carries. Missing lists come out empty so the shape is always
-- the one zod parses.
create function app.project_graph(p_graph jsonb) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
      'functions', coalesce((
        select jsonb_agg(jsonb_build_object('expr', f.e -> 'expr') || case when f.e ? 'label' then jsonb_build_object('label', f.e -> 'label') else '{}'::jsonb end order by f.n)
          from jsonb_array_elements(case when jsonb_typeof(p_graph -> 'functions') = 'array' then p_graph -> 'functions' else '[]'::jsonb end) with ordinality as f(e, n)), '[]'::jsonb),
      'points', coalesce((
        select jsonb_agg(jsonb_build_object('x', f.e -> 'x', 'y', f.e -> 'y') || case when f.e ? 'label' then jsonb_build_object('label', f.e -> 'label') else '{}'::jsonb end order by f.n)
          from jsonb_array_elements(case when jsonb_typeof(p_graph -> 'points') = 'array' then p_graph -> 'points' else '[]'::jsonb end) with ordinality as f(e, n)), '[]'::jsonb))
    || case when jsonb_typeof(p_graph -> 'window') = 'object'
            then jsonb_build_object('window', jsonb_build_object(
                   'xMin', p_graph #> '{window,xMin}', 'xMax', p_graph #> '{window,xMax}', 'yMin', p_graph #> '{window,yMin}', 'yMax', p_graph #> '{window,yMax}'))
            else '{}'::jsonb end
$$;

-- An option as the student receives it: id, text and, if it has one, its graph projected. Never the jsonb as stored.
create function app.project_option(p_option jsonb) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('id', p_option -> 'id', 'text', p_option -> 'text')
         || case when p_option ? 'graph' then jsonb_build_object('graph', app.project_graph(p_option -> 'graph')) else '{}'::jsonb end
$$;

-- What a student receives of a version: the instructions of the version, its adapted exercises in the order of the
-- original and, in gaze mode, their questions with the options (projected) and never the correct one.
create or replace function app.publication_content(p_version_id uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
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
    from app.versions v where v.id = p_version_id
$$;

-- P-2: read aloud is on in every publication. It is a support of the platform, shown to every student who does not
-- answer with the eyes; it is not a decision per profile (and a per-profile value would reveal the profile).
create or replace function app.publication_aids(p_config jsonb) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('readAloud', true)
$$;

-- P-3: the first lock of publish_version: the group FOR SHARE (like assessment_share) and then the assessment
-- FOR NO KEY UPDATE instead of FOR SHARE.
create function app.assessment_publish_lock(p_assessment_id uuid, p_group_id uuid) returns app.assessments
language plpgsql
set search_path = ''
as $$
declare
  v_assessment app.assessments;
begin
  perform 1 from app.groups g where g.id = p_group_id for share;
  select * into v_assessment from app.assessments a where a.id = p_assessment_id for no key update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  return v_assessment;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- publish_version: same signature as T1.5a, with the assessment lock first (P-3) and the status at the end.
-- ---------------------------------------------------------------------------------------------

create or replace function api.publish_version(p_version_id uuid, p_revision integer, p_op_key uuid, p_answer_key_revision_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_assessment_id uuid;
  v_group_id uuid;
  v_institution_id uuid;
  v_identity text;
  v_existing app.publications;
  v_assessment app.assessments;
  v_version app.versions;
  v_key app.answer_keys;
  v_key_revision uuid;
  v_students uuid[];
  v_student uuid;
  v_assignment_ids uuid[];
  v_assignment app.assignments;
  v_attempt app.assignment_attempts;
  v_attempts integer;
  v_done integer := 0;
  v_publication_id uuid;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select t.o_assessment_id, t.o_group_id, t.o_institution_id into v_assessment_id, v_group_id, v_institution_id
    from app.version_target(p_version_id) t;
  if p_op_key is null then
    perform app.raise_error('INVALID', 'invalid_op_key');
  end if;
  if p_revision is null then
    perform app.raise_error('INVALID', 'revision_required');
  end if;
  v_identity := encode(sha256(convert_to(
    jsonb_build_array('publish_version', p_version_id, p_revision, p_answer_key_revision_id)::text, 'utf8')), 'hex');

  -- Before any row lock: a replay answers what was published even if the assessment was archived since.
  perform pg_advisory_xact_lock(hashtextextended('tiza.publish_version:' || v_institution_id::text || ':' || p_op_key::text, 0));
  select * into v_existing from app.publications p where p.institution_id = v_institution_id and p.op_key = p_op_key;
  if found then
    if v_existing.op_identity = v_identity then
      return jsonb_build_object('publicationId', v_existing.id, 'attempts', v_existing.op_attempts);
    end if;
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;

  v_assessment := app.assessment_publish_lock(v_assessment_id, v_group_id);
  if not app.lock_version_tree(p_version_id, null, null) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform app.assert_assessment_writable(v_assessment, v_group_id);
  select * into v_version from app.versions v where v.id = p_version_id;
  if v_version.archived_at is not null then
    perform app.raise_error('INVALID', 'version_archived');
  end if;
  perform app.assert_revision(p_revision, v_version.revision);

  -- The content is complete when the recalculated status is ready (the check of approve_version): a version that
  -- was never approved because it is half made says so, not "approve it first".
  if app.refresh_version_status(p_version_id) is distinct from 'ready' then
    perform app.raise_error('CONFLICT', 'content_incomplete');
  end if;
  if v_version.approved_revision is distinct from v_version.revision then
    perform app.raise_error('CONFLICT', 'not_approved');
  end if;
  if v_version.answer_mode = 'gaze' and exists (
       select 1 from app.version_exercises ve
        where ve.version_id = p_version_id
          and not exists (select 1 from app.version_questions q where q.version_exercise_id = ve.id)) then
    perform app.raise_error('CONFLICT', 'missing_questions');
  end if;

  -- The key. Nobody writes it without the version lock, which we hold: a plain read is consistent.
  select * into v_key from app.answer_keys k where k.version_id = p_version_id;
  v_key_revision := coalesce(p_answer_key_revision_id, case when v_version.answer_mode = 'gaze' then v_key.current_revision_id end);
  if v_key_revision is null then
    if v_version.answer_mode = 'gaze' then
      perform app.raise_error('CONFLICT', 'no_answer_key');
    end if;
  else
    if not exists (select 1 from app.answer_key_revisions r where r.id = v_key_revision and r.version_id = p_version_id) then
      perform app.raise_error('NOT_FOUND', 'not_found');
    end if;
    if not app.answer_key_matches(v_key_revision, p_version_id)
       or app.answer_key_content_problem(p_version_id, (select r.content from app.answer_key_revisions r where r.id = v_key_revision),
                                         v_version.answer_mode) is not null then
      perform app.raise_error('CONFLICT', 'stale_answer_key');
    end if;
  end if;

  -- The recipients of today, still enrolled. The pair lock is the one of enroll_student and unenroll_student, in
  -- student id order like version_recipients_enrolled.
  v_students := coalesce((select array_agg(r.student_id order by r.student_id) from app.version_recipients r
                           where r.version_id = p_version_id and r.valid_to is null), '{}');
  foreach v_student in array v_students loop
    perform pg_advisory_xact_lock(hashtextextended('tiza.enrollment:' || v_group_id::text || ':' || v_student::text, 0));
    perform 1 from app.students s where s.id = v_student and s.archived_at is null for share;
    if not found or not exists (
         select 1 from app.enrollments e where e.group_id = v_group_id and e.student_id = v_student and e.ended_at is null) then
      perform app.raise_error('CONFLICT', 'not_enrolled');
    end if;
  end loop;
  -- A generation means the profiles of the recipients were used to adapt: each one needs the consent in force.
  if exists (select 1 from app.generations g where g.version_id = p_version_id)
     and exists (
       select 1 from unnest(v_students) as s(id)
        where not exists (
          select 1 from app.consents c
           where c.student_id = s.id and c.purpose = 'ai_adaptation' and c.status = 'granted'
             and c.valid_from <= clock_timestamp() and (c.valid_until is null or c.valid_until > clock_timestamp()))) then
    perform app.raise_error('CONFLICT', 'missing_consent');
  end if;

  -- The assignments of the recipients that already have one, by id and before any attempt. After this, nobody can
  -- start, save or submit one of these attempts (they lock the assignment first), so what we read is what we move.
  v_assignment_ids := coalesce((select array_agg(a.id order by a.id) from app.assignments a
                                 where a.assessment_id = v_assessment_id and a.student_id = any (v_students)), '{}');
  perform app.lock_assignments(v_assignment_ids);
  select count(*) into v_attempts
    from unnest(v_students) as s(id)
    left join app.assignments a on a.assessment_id = v_assessment_id and a.student_id = s.id
    left join app.assignment_attempts t on t.assignment_id = a.id and t.superseded_at is null
   where a.id is null or (a.status <> 'withdrawn' and (t.id is null or t.status = 'opened'));

  insert into app.publications (institution_id, assessment_id, version_id, version_revision, answer_key_revision_id, content,
                                answer_mode, aids, published_by, published_at, op_key, op_identity, op_attempts)
  values (v_institution_id, v_assessment_id, p_version_id, v_version.revision, v_key_revision, app.publication_content(p_version_id),
          v_version.answer_mode, app.publication_aids(v_version.config), app.actor_id(), clock_timestamp(), p_op_key, v_identity, v_attempts)
  returning id into v_publication_id;

  foreach v_student in array v_students loop
    select * into v_assignment from app.assignments a where a.assessment_id = v_assessment_id and a.student_id = v_student;
    if not found then
      insert into app.assignments (institution_id, assessment_id, student_id)
      values (v_institution_id, v_assessment_id, v_student)
      returning * into v_assignment;
      insert into app.assignment_attempts (institution_id, assessment_id, assignment_id, version_id, publication_id, answer_key_revision_id, number)
      values (v_institution_id, v_assessment_id, v_assignment.id, p_version_id, v_publication_id, v_key_revision, 1);
      v_done := v_done + 1;
    elsif v_assignment.status <> 'withdrawn' then
      select * into v_attempt from app.assignment_attempts t where t.assignment_id = v_assignment.id and t.superseded_at is null for update;
      if not found then
        insert into app.assignment_attempts (institution_id, assessment_id, assignment_id, version_id, publication_id, answer_key_revision_id, number)
        values (v_institution_id, v_assessment_id, v_assignment.id, p_version_id, v_publication_id, v_key_revision,
                (select coalesce(max(t.number), 0) + 1 from app.assignment_attempts t where t.assignment_id = v_assignment.id));
        v_done := v_done + 1;
      elsif v_attempt.status = 'opened' then
        update app.assignment_attempts
           set version_id = p_version_id, publication_id = v_publication_id, answer_key_revision_id = v_key_revision,
               revision = revision + 1
         where id = v_attempt.id;
        v_done := v_done + 1;
      end if;
    end if;
  end loop;
  if v_done <> v_attempts then
    raise exception 'api.publish_version: the attempts counted (%) are not the ones touched (%)', v_attempts, v_done using errcode = 'P0004';
  end if;
  -- P-3: the first publication makes the assessment 'published' (not archived: that was checked under the lock).
  update app.assessments set status = 'published'
   where id = v_assessment_id and status <> 'published';
  return jsonb_build_object('publicationId', v_publication_id, 'attempts', v_attempts);
end
$$;

grant execute on function api.publish_version(uuid, integer, uuid, uuid) to authenticated;
