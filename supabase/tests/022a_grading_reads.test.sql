-- T1.5c: the teacher's side of delivery, reading. list_assessment_attempts (the state per student, without saying which version
-- each one got) and get_attempt_for_grading (audited). Who may call (the teacher of the group and nobody else, from every other
-- caller, with the proof that nothing changed, not even an audit row), NULLs and ids that do not exist, the exact keys of both
-- answers, what they must not say, the audit row (one per request, with the student it shows), the key and the publication of
-- the attempt, and the attempts that are not in force. Grading itself is in 022b. The races with two connections are in
-- tests/integration/races/grading*.test.ts. Placeholder text only. The whole file is rolled back.
begin;
-- Phase 1 links ordinary accounts (any email) to students; the shape guard of phase 2 (T2.5a) is off in this file. 040_f2_contract covers it.
alter table app.account_provisioning disable trigger student_auth_link_guard;
select plan(31);

create function pg_temp.rpc(p_user uuid, p_role text, p_sql text) returns jsonb
language plpgsql as $f$
declare
  v_res jsonb; v_state text; v_message text; v_detail text;
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else jsonb_build_object('sub', p_user, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  execute p_sql into v_res;
  reset role;
  return v_res;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  reset role;
  return jsonb_build_object('error', v_state || ' ' || v_message || ' ' || coalesce(v_detail, ''));
end
$f$;

create temp table ids (k text primary key, id uuid not null);
create function pg_temp.id(p_key text) returns uuid language sql as $$ select id from ids where k = p_key $$;
create function pg_temp.as_user(p_user text, p_sql text) returns jsonb language sql
  as $$ select pg_temp.rpc(pg_temp.id(p_user), 'authenticated', p_sql) $$;
create function pg_temp.as_service(p_sql text) returns jsonb language sql
  as $$ select pg_temp.rpc(null, 'service_role', p_sql) $$;
create function pg_temp.keys(p_obj jsonb) returns text language sql
  as $$ select string_agg(k, ',' order by k) from jsonb_object_keys(p_obj) k $$;
create function pg_temp.keep(p_key text, p_res jsonb) returns jsonb language plpgsql as $$
begin
  insert into ids (k, id) values (p_key, (p_res ->> 'id')::uuid);
  return p_res;
end $$;
-- A refused call as "CODE reason" (what the front gets); null when it worked.
create function pg_temp.err(p_res jsonb) returns text language sql
  as $$ select nullif(btrim(regexp_replace(p_res ->> 'error', '^P0001 ', '')), '') $$;

insert into ids (k, id) select k, gen_random_uuid() from unnest(array[
  'admin', 'teach', 'incl', 'userb', 'nobody', 'ghost', 'stu_a', 'stu_b', 'stu_c', 'stu_x', 'other'
]) as k;
insert into auth.users (id, email) select id, k || '@t1-5c.invalid' from ids where k <> 'ghost';
do $$
declare
  k text;
begin
  for k in select ids.k from ids where ids.k <> 'ghost' loop
    perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;

-- Institution n: admin, the teacher teach (group g_n), inclusion. Students s1 (account stu_a), s2 (stu_b) and s3 (stu_c) in
-- g_n. Institution b: the teacher userb, with the group g_b and the student sx (account stu_x). Placeholder names only.
insert into ids (k, id) select 'i_n', (pg_temp.as_service($$ select api.internal_create_institution('Liceo N', 't1-5c', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, %L)', pg_temp.id('i_n'), pg_temp.id(u.k), u.role))
  from (values ('admin', 'admin'), ('teach', 'teacher'), ('incl', 'inclusion'), ('other', 'teacher')) as u(k, role);
insert into ids (k, id) values
  ('g_n', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid);
insert into ids (k, id)
  select 's' || n, (pg_temp.as_user('teach', format('select api.create_student(%L, %L, %L, gen_random_uuid())', pg_temp.id('g_n'), 'Estudiante ' || n, 'est.' || n)) ->> 'id')::uuid
    from generate_series(1, 3) n;
select pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id(l.s), pg_temp.id(l.u)))
  from (values ('s1', 'stu_a'), ('s2', 'stu_b'), ('s3', 'stu_c')) as l(s, u);
insert into ids (k, id) select 'i_b', (pg_temp.as_service($$ select api.internal_create_institution('Liceo B', 't1-5c-b', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_b'), pg_temp.id('userb')));
insert into ids (k, id) values
  ('g_b', (pg_temp.as_user('userb', format('select api.create_group(%L, ''1.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_b'))) ->> 'id')::uuid);
insert into ids (k, id) values
  ('sx', (pg_temp.as_user('userb', format('select api.create_student(%L, ''Estudiante X'', ''est.x'', gen_random_uuid())', pg_temp.id('g_b'))) ->> 'id')::uuid);
select pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('sx'), pg_temp.id('stu_x')));

-- Builders: everything goes through the RPCs, except the gaze questions (no RPC writes them yet).
create function pg_temp.mk_asm(p_key text, p_instr text) returns void language plpgsql as $$
begin
  perform pg_temp.keep(p_key, pg_temp.as_user('teach', format('select api.create_assessment(%L, ''worksheet'', ''Repaso'', %L, gen_random_uuid())', pg_temp.id('g_n'), p_instr)));
end $$;
create function pg_temp.mk_ex(p_asm text, p_key text, p_body text) returns void language plpgsql as $$
begin
  perform pg_temp.keep(p_key, pg_temp.as_user('teach', format('select api.add_exercise(%L, %L, %L, gen_random_uuid(), null)', pg_temp.id(p_asm), right(p_key, 1), p_body)));
end $$;
create function pg_temp.mkv(p text, p_n integer, p_mode text) returns void language plpgsql as $$
declare
  i integer;
begin
  perform pg_temp.mk_asm('a_' || p, 'Instrucciones');
  for i in 1..p_n loop
    perform pg_temp.mk_ex('a_' || p, 'e_' || p || i, 'Enunciado ' || i);
  end loop;
  perform pg_temp.keep(p, pg_temp.as_user('teach', format($q$ select api.create_version(%L, '{"profiles":["motor"],"supports":[],"interests":[]}'::jsonb, %L, gen_random_uuid(), null) $q$,
    pg_temp.id('a_' || p), p_mode)));
  insert into ids (k, id) select 'x_' || p || row_number() over (order by e.position), ve.id
    from app.version_exercises ve join app.assessment_exercises e on e.id = ve.exercise_id where ve.version_id = pg_temp.id(p);
  for i in 1..p_n loop
    perform pg_temp.as_user('teach', format('select api.update_version_exercise(%L, %s, %L, gen_random_uuid())', pg_temp.id('x_' || p || i),
      (select revision from app.version_exercises where id = pg_temp.id('x_' || p || i)), 'Adaptado ' || i));
  end loop;
end $$;
-- A question (options A, B, C) in each adapted exercise, with its correct option B.
create function pg_temp.gazeq(p text, p_n integer) returns void language plpgsql as $$
declare
  i integer;
begin
  for i in 1..p_n loop
    insert into ids (k, id) values ('q_' || p || i, gen_random_uuid());
    insert into app.version_questions (id, institution_id, version_id, version_exercise_id, position, stem, options)
      select pg_temp.id('q_' || p || i), ve.institution_id, ve.version_id, ve.id, 0, '¿Cuánto es 2 + 2?', '[{"id":"A","text":"3"},{"id":"B","text":"4"},{"id":"C","text":"5"}]'::jsonb
        from app.version_exercises ve where ve.id = pg_temp.id('x_' || p || i);
    perform pg_temp.as_user('teach', format('select api.set_question_key(%L, ''B'', null)', pg_temp.id('q_' || p || i)));
  end loop;
end $$;
create function pg_temp.rev(p_ver text) returns text language sql as $$ select v.revision::text from app.versions v where v.id = pg_temp.id(p_ver) $$;
create function pg_temp.kc(p_ver text) returns text language sql as $$
  select jsonb_build_object(
    'exercises', coalesce((select jsonb_object_agg(ve.id::text, jsonb_build_object('answer', 'Respuesta')) from app.version_exercises ve where ve.version_id = pg_temp.id(p_ver)), '{}'::jsonb),
    'questions', coalesce((select jsonb_object_agg(k.question_id::text, k.correct_option_id) from app.question_keys k where k.version_id = pg_temp.id(p_ver)), '{}'::jsonb))::text
$$;
create function pg_temp.cur(p_ver text) returns text language sql as $$
  select coalesce((select quote_literal(k.current_revision_id) from app.answer_keys k where k.version_id = pg_temp.id(p_ver)), 'null')
$$;
-- Publishes the version p: ready, with the recipients and approved (gaze: with its questions and key).
create function pg_temp.publish(p text, p_n integer, p_mode text, p_students text[]) returns jsonb language plpgsql as $$
declare
  v_res jsonb;
begin
  perform pg_temp.mkv(p, p_n, p_mode);
  if p_mode = 'gaze' then
    perform pg_temp.gazeq(p, p_n);
    v_res := pg_temp.as_user('teach', format('select api.edit_answer_key(%L, %L::jsonb, %s)', pg_temp.id(p), pg_temp.kc(p), pg_temp.cur(p)));
    if v_res ? 'error' then raise exception 'key %: %', p, v_res; end if;
  end if;
  perform pg_temp.as_user('teach', format('select api.set_version_recipients(%L, %s, array[%s]::uuid[], gen_random_uuid())', pg_temp.id(p), pg_temp.rev(p),
    (select string_agg(quote_literal(pg_temp.id(s)), ',') from unnest(p_students) s)));
  perform pg_temp.as_user('teach', format('select api.approve_version(%L, %s, gen_random_uuid())', pg_temp.id(p), pg_temp.rev(p)));
  v_res := pg_temp.as_user('teach', format('select api.publish_version(%L, %s, gen_random_uuid(), null)', pg_temp.id(p), pg_temp.rev(p)));
  if v_res ->> 'publicationId' is null then raise exception 'publish %: %', p, v_res; end if;
  insert into ids (k, id) values ('p_' || p, (v_res ->> 'publicationId')::uuid);
  return v_res;
end $$;
-- Remembers the attempt in force (t_<student>_<p>) and the assignment (a_<student>_<p>) of a student on the assessment of p.
create function pg_temp.remember(p text, p_student text) returns void language plpgsql as $$
begin
  insert into ids (k, id)
    select 't_' || p_student || '_' || p, t.id from app.assignment_attempts t join app.assignments a on a.id = t.assignment_id
     where a.student_id = pg_temp.id(p_student) and a.assessment_id = pg_temp.id('a_' || p) and t.superseded_at is null;
  insert into ids (k, id)
    select 'as_' || p_student || '_' || p, a.id from app.assignments a
     where a.student_id = pg_temp.id(p_student) and a.assessment_id = pg_temp.id('a_' || p);
end $$;


-- The group of the other teacher of the institution (who has no part in the group of the assessments below).
insert into ids (k, id) values
  ('g_o', (pg_temp.as_user('other', format('select api.create_group(%L, ''3.º B'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid);

-- Everything grading can write or disclose, as one string: assignments, attempts, drafts, grades and audit rows of the institution.
create function pg_temp.digest() returns text language sql as $$
  select md5(coalesce((select string_agg(a::text, ';' order by a.id) from app.assignments a where a.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(t::text, ';' order by t.id) from app.assignment_attempts t where t.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(s::text, ';' order by s.id) from app.submissions s where s.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(g::text, ';' order by g.id) from app.grades g where g.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(l.id::text, ';' order by l.id) from app.audit_log l where l.institution_id = pg_temp.id('i_n') and l.action = 'get_attempt_for_grading'), ''))
$$;
create function pg_temp.call(p_user text, p_sql text) returns jsonb language sql as $$
  select case when p_user is null then pg_temp.rpc(null, 'authenticated', p_sql) else pg_temp.as_user(p_user, p_sql) end
$$;
-- A refused call: its error and whether it changed anything.
create function pg_temp.refused(p_user text, p_sql text) returns text language plpgsql as $$
declare
  v_before text := pg_temp.digest();
  v_err text;
begin
  v_err := pg_temp.err(pg_temp.call(p_user, p_sql));
  return coalesce(v_err, 'ok') || ' changed=' || (v_before <> pg_temp.digest())::text;
end $$;
create temp table res (k text primary key, r jsonb);
create function pg_temp.keepr(p_key text, p_res jsonb) returns jsonb language plpgsql as $$
begin
  insert into res (k, r) values (p_key, p_res);
  return p_res;
end $$;
create function pg_temp.r(p_key text) returns jsonb language sql as $$ select r from res where k = p_key $$;

-- Every caller but the teacher of the group, from the same call, with what each one gets and whether anything changed:
-- an admin who does not teach it, inclusion and the students of the group are FORBIDDEN; another group, another institution and
-- a person with no membership are NOT_FOUND; no app user and no session are FORBIDDEN no_session.
create function pg_temp.others(p_sql text) returns text language sql as $$
  select string_agg(coalesce(u, '(sin sesión)') || '=' || pg_temp.refused(u, p_sql), ';' order by u nulls last)
    from unnest(array['admin', 'incl', 'stu_a', 'stu_b', 'stu_c', 'stu_x', 'other', 'userb', 'nobody', 'ghost', null]) u $$;
create function pg_temp.denied() returns text language sql as $$
  select string_agg(coalesce(u, '(sin sesión)') || '=' || case
           when u is null or u = 'ghost' then 'FORBIDDEN no_session'
           when u in ('admin', 'incl', 'stu_a', 'stu_b', 'stu_c') then 'FORBIDDEN forbidden'
           else 'NOT_FOUND not_found' end || ' changed=false', ';' order by u nulls last)
    from unnest(array['admin', 'incl', 'stu_a', 'stu_b', 'stu_c', 'stu_x', 'other', 'userb', 'nobody', 'ghost', null]) u $$;

-- The RPCs of the test, as the SQL a caller sends.
create function pg_temp.q_start(p_attempt text) returns text language sql as $$
  select format('select api.student_start_attempt(%L)', pg_temp.id(p_attempt)) $$;
create function pg_temp.q_save(p_attempt text, p_rev text, p_answers text, p_choices text) returns text language sql as $$
  select format('select api.student_save_draft(%L, %s, %L::jsonb, %L::jsonb)', pg_temp.id(p_attempt), p_rev, p_answers, p_choices) $$;
create function pg_temp.q_submit(p_attempt text, p_rev text) returns text language sql as $$
  select format('select api.student_submit_attempt(%L, %s)', pg_temp.id(p_attempt), p_rev) $$;
create function pg_temp.q_list(p_asm text) returns text language sql as $$
  select format('select api.list_assessment_attempts(%L)', pg_temp.id(p_asm)) $$;
create function pg_temp.q_get(p_attempt text) returns text language sql as $$
  select format('select api.get_attempt_for_grading(%L)', pg_temp.id(p_attempt)) $$;
-- grade_attempt: the attempt, the feedback, the results as a jsonb literal, the score and the revision (SQL text: 'null' or a number).
create function pg_temp.q_grade(p_attempt text, p_feedback text, p_results text, p_score text, p_rev text) returns text language sql as $$
  select format('select api.grade_attempt(%L, %L, %L::jsonb, %s, %s)', pg_temp.id(p_attempt), p_feedback, p_results, p_score, p_rev) $$;
-- An answers document with one typed answer for each exercise given.
create function pg_temp.ans(p_exercises text[], p_text text) returns text language sql as $$
  select coalesce(jsonb_object_agg(pg_temp.id(x)::text, jsonb_build_object('text', p_text, 'mode', 'typed')), '{}'::jsonb)::text from unnest(p_exercises) x $$;
-- Results with one status for each exercise given.
create function pg_temp.results(p_exercises text[], p_status text) returns text language sql as $$
  select coalesce(jsonb_object_agg(pg_temp.id(x)::text, jsonb_build_object('status', p_status, 'errors', '[]'::jsonb)), '{}'::jsonb)::text from unnest(p_exercises) x $$;

-- A typed version for s1, s2 and s3 (two exercises) and a gaze one (one question, options A, B and C) for s1.
select pg_temp.publish('vt', 2, 'typed', array['s1', 's2', 's3']);
select pg_temp.publish('vg', 1, 'gaze', array['s1']);
select pg_temp.remember('vt', 's1');
select pg_temp.remember('vt', 's2');
select pg_temp.remember('vt', 's3');
select pg_temp.remember('vg', 's1');
-- s1 submits both attempts, s2 started and saved a draft, s3 did not open it.
select pg_temp.as_user('stu_a', pg_temp.q_start('t_s1_vt'));
select pg_temp.as_user('stu_a', pg_temp.q_save('t_s1_vt', '1', pg_temp.ans(array['x_vt1', 'x_vt2'], 'respuesta final'), '{}'));
select pg_temp.as_user('stu_a', pg_temp.q_submit('t_s1_vt', '2'));
select pg_temp.as_user('stu_a', pg_temp.q_start('t_s1_vg'));
select pg_temp.as_user('stu_a', pg_temp.q_save('t_s1_vg', '1', '{}', jsonb_build_object(pg_temp.id('q_vg1')::text, 'C')::text));
select pg_temp.as_user('stu_a', pg_temp.q_submit('t_s1_vg', '2'));
select pg_temp.as_user('stu_b', pg_temp.q_start('t_s2_vt'));
select pg_temp.as_user('stu_b', pg_temp.q_save('t_s2_vt', '1', pg_temp.ans(array['x_vt1'], 'borrador'), '{}'));

-- ---------------------------------------------------------------------------------------------
-- Privileges and who calls
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_proc p
            where p.pronamespace = 'api'::regnamespace
              and p.proname in ('list_assessment_attempts', 'get_attempt_for_grading', 'grade_attempt')
              and p.prosecdef and p.proowner <> 'tiza_student'::regrole
              and has_function_privilege('authenticated', p.oid, 'execute')
              and not has_function_privilege('anon', p.oid, 'execute')
              and not has_function_privilege('service_role', p.oid, 'execute')), 3::bigint,
  'the three RPCs are SECURITY DEFINER (not of the student role); authenticated executes them, anon and service_role do not');

select is(pg_temp.others(pg_temp.q_list('a_vt')), pg_temp.denied(),
  'list_assessment_attempts: nobody but the teacher of the group (admin, inclusion, the students, another group, another institution, no membership, no app user, no session), and nothing changes');
select is(pg_temp.others(pg_temp.q_get('t_s1_vt')), pg_temp.denied(),
  'get_attempt_for_grading: the same, and not even an audit row is written for who is refused');
select is(pg_temp.refused('teach', 'select api.list_assessment_attempts(gen_random_uuid())') || '|' || pg_temp.refused('teach', 'select api.list_assessment_attempts(null)') || '|'
  || pg_temp.refused('teach', 'select api.get_attempt_for_grading(gen_random_uuid())') || '|' || pg_temp.refused('teach', 'select api.get_attempt_for_grading(null)'),
  'NOT_FOUND not_found changed=false|NOT_FOUND not_found changed=false|NOT_FOUND not_found changed=false|NOT_FOUND not_found changed=false',
  'an id that does not exist, or none at all, is NOT_FOUND in both reads');

-- ---------------------------------------------------------------------------------------------
-- list_assessment_attempts
-- ---------------------------------------------------------------------------------------------
select pg_temp.keepr('list', pg_temp.as_user('teach', pg_temp.q_list('a_vt')));
select is(pg_temp.keys(pg_temp.r('list')), 'items', 'the list answers exactly items');
select is(jsonb_array_length(pg_temp.r('list') -> 'items'), 3, 'one row per student with an assignment on this assessment, and not the ones of the other assessment');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.r('list') -> 'items' -> 0) k),
  'assignmentId,attemptId,displayName,graded,late,score,status,studentId,submittedAt', 'a row has exactly the keys of AttemptRow');
select is((select string_agg((i ->> 'displayName') || ':' || (i ->> 'status') || ':' || (i ->> 'graded') || ':' || (i ->> 'late'), ',' order by ord)
             from jsonb_array_elements(pg_temp.r('list') -> 'items') with ordinality as t(i, ord)),
  'Estudiante 1:submitted:false:false,Estudiante 2:started:false:false,Estudiante 3:opened:false:false',
  'by name: the one that submitted, the one that started and the one that did not open it');
select is((select concat_ws('|', i ->> 'studentId' = pg_temp.id('s1')::text, i ->> 'assignmentId' = pg_temp.id('as_s1_vt')::text, i ->> 'attemptId' = pg_temp.id('t_s1_vt')::text,
                              i ->> 'submittedAt' is not null, i ->> 'score' is null)
             from jsonb_array_elements(pg_temp.r('list') -> 'items') i where i ->> 'displayName' = 'Estudiante 1'), 't|t|t|t|t',
  'the row of a student points to their student, assignment and attempt, with the time of the submission and no score yet');
select is((select count(*) from jsonb_array_elements(pg_temp.r('list') -> 'items') i where i ->> 'displayName' in ('Estudiante 2', 'Estudiante 3') and i ->> 'submittedAt' is not null), 0::bigint,
  'the ones that did not submit have no time of submission');
-- It says nothing of what each one received.
select is((select count(*) from ids x where x.k in ('vt', 'vg', 'p_vt', 'p_vg', 'x_vt1', 'x_vt2', 'x_vg1', 'q_vg1') and position(x.id::text in pg_temp.r('list')::text) > 0), 0::bigint,
  'the list carries no version, publication, exercise or question id');
select is(pg_temp.r('list')::text ~* '(answerMode|answer_mode|aids|config|interface|profiles|supports|interests|gaze|typed|voice|readAloud|versionId|publicationId|answerKey)', false,
  'and no key or word that lets a reader tell the answer mode, the aids or the configuration');
select is((select count(*) from jsonb_array_elements(pg_temp.as_user('teach', pg_temp.q_list('a_vg')) -> 'items') i where i ->> 'studentId' = pg_temp.id('s1')::text), 1::bigint,
  'the other assessment lists its own recipient');
select is((select count(*) from app.audit_log l where l.institution_id = pg_temp.id('i_n') and l.action = 'list_assessment_attempts'), 0::bigint,
  'the list writes no audit row: it shows a name and a state, nothing sensitive');

-- ---------------------------------------------------------------------------------------------
-- get_attempt_for_grading
-- ---------------------------------------------------------------------------------------------
create temp table audit_before as select count(*) as n from app.audit_log l where l.institution_id = pg_temp.id('i_n') and l.action = 'get_attempt_for_grading';
select pg_temp.keepr('get1', pg_temp.as_user('teach', pg_temp.q_get('t_s1_vt')));
select is(pg_temp.keys(pg_temp.r('get1')), 'answerKey,answers,attemptId,choices,grade,late,publication,status,student,submittedAt',
  'it answers exactly the keys of AttemptForGrading');
select is(pg_temp.keys(pg_temp.r('get1') -> 'student') || '|' || pg_temp.keys(pg_temp.r('get1') -> 'publication'),
  'displayName,id|aids,answerKeyRevisionId,answerMode,assessmentId,content,id,publishedAt,versionId,versionRevision,withdrawnAt',
  'the student and the publication have exactly their keys');
select is(concat_ws('|', pg_temp.r('get1') #>> '{student,id}' = pg_temp.id('s1')::text, pg_temp.r('get1') #>> '{student,displayName}', pg_temp.r('get1') ->> 'status',
                    pg_temp.r('get1') ->> 'late', pg_temp.r('get1') ->> 'attemptId' = pg_temp.id('t_s1_vt')::text, pg_temp.r('get1') #>> '{publication,id}' = pg_temp.id('p_vt')::text,
                    pg_temp.r('get1') #>> '{publication,answerMode}', pg_temp.r('get1') #>> '{publication,aids,readAloud}'),
  't|Estudiante 1|submitted|false|t|t|typed|true', 'the student shown, the state and the publication that student solved');
select is(pg_temp.r('get1') -> 'answers', pg_temp.ans(array['x_vt1', 'x_vt2'], 'respuesta final')::jsonb, 'their answers are the ones they submitted');
select is(concat_ws('|', pg_temp.r('get1') -> 'choices', pg_temp.r('get1') -> 'answerKey', pg_temp.r('get1') -> 'grade'), '{}|null|null',
  'no choices, no key (a typed version without one) and no grade yet');
select is(jsonb_array_length(pg_temp.r('get1') #> '{publication,content,exercises}'), 2, 'the publication carries the exercises the student solved');
select is((select count(*) from app.audit_log l where l.institution_id = pg_temp.id('i_n') and l.action = 'get_attempt_for_grading') - (select n from audit_before), 1::bigint,
  'one audit row for the request');
select is((select concat_ws('|', l.entity, l.entity_id = pg_temp.id('t_s1_vt'), l.student_ids = array[pg_temp.id('s1')], l.actor_user_id = pg_temp.id('teach'))
             from app.audit_log l where l.institution_id = pg_temp.id('i_n') and l.action = 'get_attempt_for_grading'), 'attempt|t|t|t',
  'with the attempt, the student it showed and who asked');
select pg_temp.as_user('teach', pg_temp.q_get('t_s1_vt'));
select is((select count(*) from app.audit_log l where l.institution_id = pg_temp.id('i_n') and l.action = 'get_attempt_for_grading') - (select n from audit_before), 2::bigint,
  'a second request is a second row: one per request');
select is(pg_temp.refused('teach', pg_temp.q_get('t_s2_vt')) || '|' || pg_temp.refused('teach', pg_temp.q_get('t_s3_vt')),
  'CONFLICT not_submitted changed=false|CONFLICT not_submitted changed=false',
  'an attempt that has not been submitted (started with a draft, or not even opened) is CONFLICT not_submitted: nothing is shown and nothing is logged');

-- The gaze version: the key of the revision the attempt was published with, and the choices.
select pg_temp.keepr('get2', pg_temp.as_user('teach', pg_temp.q_get('t_s1_vg')));
select is(concat_ws('|', pg_temp.r('get2') #>> '{publication,answerMode}', jsonb_array_length(pg_temp.r('get2') #> '{publication,content,questions}'),
                    pg_temp.r('get2') -> 'choices' = jsonb_build_object(pg_temp.id('q_vg1')::text, 'C'), pg_temp.r('get2') -> 'answers'), 'gaze|1|t|{}',
  'a gaze attempt: its questions and what was chosen');
select is(concat_ws('|', pg_temp.r('get2') #>> '{answerKey,id}' = pg_temp.r('get2') #>> '{publication,answerKeyRevisionId}',
                    pg_temp.r('get2') #>> '{answerKey,id}' = (select t.answer_key_revision_id::text from app.assignment_attempts t where t.id = pg_temp.id('t_s1_vg')),
                    pg_temp.r('get2') #>> array['answerKey', 'content', 'questions', pg_temp.id('q_vg1')::text],
                    pg_temp.keys(pg_temp.r('get2') -> 'answerKey')),
  't|t|B|content,createdAt,exerciseRevisions,id,instructionsRevision,number,questionRevisions,source,versionRevision',
  'the key is the revision of the attempt (its publication''s) with the correct option, which only the teacher reads');
select is(pg_temp.r('get2') #>> '{publication,content}' ~ 'correct', false, 'while the copy the student solved carries no correct option');

-- A publication that was withdrawn and an attempt that was replaced are still read.
update app.publications set withdrawn_at = clock_timestamp() where id = pg_temp.id('p_vt');
select is((pg_temp.as_user('teach', pg_temp.q_get('t_s1_vt')) #>> '{publication,withdrawnAt}') is not null, true, 'a withdrawn publication is read, with its withdrawal date');
update app.assignment_attempts set superseded_at = clock_timestamp() where id = pg_temp.id('t_s1_vg');
select is(pg_temp.as_user('teach', pg_temp.q_get('t_s1_vg')) ->> 'status', 'submitted', 'and a replaced attempt that was submitted');
-- The list shows the attempt in force; where none is, the latest one. Here a new attempt takes the place of the one of s3.
update app.assignment_attempts set superseded_at = clock_timestamp() where id = pg_temp.id('t_s3_vt');
select is((select i ->> 'attemptId' from jsonb_array_elements(pg_temp.as_user('teach', pg_temp.q_list('a_vt')) -> 'items') i where i ->> 'displayName' = 'Estudiante 3'),
  pg_temp.id('t_s3_vt')::text, 'with no attempt in force the list shows the latest one');
insert into ids (k, id) values ('t2_s3_vt', gen_random_uuid());
insert into app.assignment_attempts (id, institution_id, assessment_id, assignment_id, version_id, publication_id, answer_key_revision_id, number)
  select pg_temp.id('t2_s3_vt'), t.institution_id, t.assessment_id, t.assignment_id, t.version_id, t.publication_id, t.answer_key_revision_id, 2
    from app.assignment_attempts t where t.id = pg_temp.id('t_s3_vt');
select is((select i ->> 'attemptId' from jsonb_array_elements(pg_temp.as_user('teach', pg_temp.q_list('a_vt')) -> 'items') i where i ->> 'displayName' = 'Estudiante 3'),
  pg_temp.id('t2_s3_vt')::text, 'and with one in force, that one');

select * from finish();
rollback;
