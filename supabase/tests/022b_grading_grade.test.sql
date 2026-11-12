-- T1.5c: grading (grade_attempt). Who may call (the teacher of the group and nobody else, from every other caller, with the
-- proof that nothing changed), the shape of every argument with its NULLs, the ids of another publication, an attempt that was
-- not submitted, the first grade and its repetition, the revision of the next ones, a grade that is only feedback, the
-- attempts that are not in force (withdrawn publication or assignment, replaced attempt), and the guards of the table as its
-- owner (P0004). The reads are in 022a. The races with two connections (two grades at once, a grade against a late submission or
-- a new publication, the order of the locks) are in tests/integration/races/grading*.test.ts. Placeholder text only. The whole
-- file is rolled back.
begin;
select plan(42);

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
insert into auth.users (id, email) select id, k || '@t1-5c.invalid' from ids where k <> 'ghost' and k not like 'stu\_%';
do $$
declare
  k text;
begin
  for k in select ids.k from ids where ids.k <> 'ghost' and ids.k not like 'stu\_%' loop
    perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;

-- The student accounts have the canonical shape of phase 2 (docs/contratos/fase-2.md, «Cómo entra un estudiante»), like the provisioning
-- of T2.5a leaves them: the id is remembered in account_provisioning first, then the row of Auth is born with the email
-- <id>@estudiantes.usetiza.app (the trigger leaves it without a password), then the student is linked. So student_auth_link_guard
-- stays on. The keys stu_* are not in the first insert: only the staff are ordinary accounts, and a student's is born here.
create function pg_temp.link_student(p_student uuid, p_user uuid) returns void language plpgsql as $$
begin
  perform pg_temp.as_service(format('select api.internal_remember_student_account(%L, %L)',
    (select ap.id from app.account_provisioning ap where ap.student_id = p_student), p_user));
  insert into auth.users (id, email) values (p_user, p_user::text || '@estudiantes.usetiza.app');
  perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', p_user, 'Persona ' || (select k from ids where id = p_user)));
  perform pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', p_student, p_user));
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
select pg_temp.link_student(pg_temp.id(l.s), pg_temp.id(l.u))
  from (values ('s1', 'stu_a'), ('s2', 'stu_b'), ('s3', 'stu_c')) as l(s, u);
insert into ids (k, id) select 'i_b', (pg_temp.as_service($$ select api.internal_create_institution('Liceo B', 't1-5c-b', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_b'), pg_temp.id('userb')));
insert into ids (k, id) values
  ('g_b', (pg_temp.as_user('userb', format('select api.create_group(%L, ''1.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_b'))) ->> 'id')::uuid);
insert into ids (k, id) values
  ('sx', (pg_temp.as_user('userb', format('select api.create_student(%L, ''Estudiante X'', ''est.x'', gen_random_uuid())', pg_temp.id('g_b'))) ->> 'id')::uuid);
select pg_temp.link_student(pg_temp.id('sx'), pg_temp.id('stu_x'));

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

-- A typed version for s1, s2 and s3 (two exercises) and a gaze one (one question) for s1, to have the ids of another publication.
select pg_temp.publish('vt', 2, 'typed', array['s1', 's2', 's3']);
select pg_temp.publish('vg', 1, 'gaze', array['s1']);
select pg_temp.remember('vt', 's1');
select pg_temp.remember('vt', 's2');
select pg_temp.remember('vt', 's3');
select pg_temp.remember('vg', 's1');
-- s1 submitted, s2 started and saved a draft, s3 did not open it.
select pg_temp.as_user('stu_a', pg_temp.q_start('t_s1_vt'));
select pg_temp.as_user('stu_a', pg_temp.q_save('t_s1_vt', '1', pg_temp.ans(array['x_vt1', 'x_vt2'], 'respuesta final'), '{}'));
select pg_temp.as_user('stu_a', pg_temp.q_submit('t_s1_vt', '2'));
select pg_temp.as_user('stu_b', pg_temp.q_start('t_s2_vt'));
select pg_temp.as_user('stu_b', pg_temp.q_save('t_s2_vt', '1', pg_temp.ans(array['x_vt1'], 'borrador'), '{}'));

-- Results by exercise id, as a jsonb literal.
create function pg_temp.one_result(p_ex text, p_status text, p_errors text) returns text language sql as $$
  select jsonb_build_object(pg_temp.id(p_ex)::text, jsonb_build_object('status', p_status, 'errors', p_errors::jsonb))::text $$;
create function pg_temp.grade_row(p_attempt text) returns text language sql as $$
  select concat_ws('|', coalesce(g.score::text, 'null'), g.feedback, g.exercise_results, g.graded_by = pg_temp.id('teach'), g.graded_at is not null, g.revision)
    from app.grades g where g.attempt_id = pg_temp.id(p_attempt) $$;

-- ---------------------------------------------------------------------------------------------
-- Who calls, and what is not a call at all
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.others(pg_temp.q_grade('t_s1_vt', 'Bien', pg_temp.results(array['x_vt1'], 'correct'), '8', 'null')), pg_temp.denied(),
  'nobody but the teacher of the group grades (admin, inclusion, the students, another group, another institution, no membership, no app user, no session), and nothing changes');
select is(pg_temp.refused('teach', 'select api.grade_attempt(gen_random_uuid(), ''Bien'', ''{}''::jsonb, null, null)') || '|' || pg_temp.refused('teach', 'select api.grade_attempt(null, ''Bien'', ''{}''::jsonb, null, null)'),
  'NOT_FOUND not_found changed=false|NOT_FOUND not_found changed=false', 'an id that does not exist, or none at all, is NOT_FOUND');

-- ---------------------------------------------------------------------------------------------
-- The shape of every argument. A NULL is never a valid one.
-- ---------------------------------------------------------------------------------------------
select is_empty($$
  select v.label from (values
    ('feedback null', null, '{}', 'null', 'INVALID invalid_feedback'),
    ('feedback of 5001', repeat('a', 5001), '{}', 'null', 'INVALID invalid_feedback'),
    ('feedback of 5001 emoji (5001 code points)', repeat(chr(128512), 5001), '{}', 'null', 'INVALID invalid_feedback'),
    ('score 0', 'Bien', '{}', '0', 'INVALID invalid_score'),
    ('score 11', 'Bien', '{}', '11', 'INVALID invalid_score'),
    ('score negative', 'Bien', '{}', '-3', 'INVALID invalid_score'),
    ('results null', 'Bien', null, 'null', 'INVALID invalid_results'),
    ('results a list', 'Bien', '[]', 'null', 'INVALID invalid_results'),
    ('results a string', 'Bien', '"correct"', 'null', 'INVALID invalid_results'),
    ('a key that is not an id', 'Bien', '{"uno": {"status": "correct", "errors": []}}', 'null', 'INVALID invalid_results'),
    ('a result that is not an object', 'Bien', '{"00000000-0000-0000-0000-000000000001": "correct"}', 'null', 'INVALID invalid_results'),
    ('a result that is null', 'Bien', '{"00000000-0000-0000-0000-000000000001": null}', 'null', 'INVALID invalid_results'),
    ('a result with no status', 'Bien', '{"00000000-0000-0000-0000-000000000001": {"errors": []}}', 'null', 'INVALID invalid_results'),
    ('a status that is not one of the four', 'Bien', '{"00000000-0000-0000-0000-000000000001": {"status": "ok", "errors": []}}', 'null', 'INVALID invalid_results'),
    ('a status that is a number', 'Bien', '{"00000000-0000-0000-0000-000000000001": {"status": 1, "errors": []}}', 'null', 'INVALID invalid_results'),
    ('a result with no errors', 'Bien', '{"00000000-0000-0000-0000-000000000001": {"status": "wrong"}}', 'null', 'INVALID invalid_results'),
    ('errors that is not a list', 'Bien', '{"00000000-0000-0000-0000-000000000001": {"status": "wrong", "errors": "signo"}}', 'null', 'INVALID invalid_results'),
    ('21 errors', 'Bien', '{"00000000-0000-0000-0000-000000000001": {"status": "wrong", "errors": [' || (select string_agg('"e' || n || '"', ',') from generate_series(1, 21) n) || ']}}', 'null', 'INVALID invalid_results'),
    ('an error that is not a string', 'Bien', '{"00000000-0000-0000-0000-000000000001": {"status": "wrong", "errors": [3]}}', 'null', 'INVALID invalid_results'),
    ('an error that is null', 'Bien', '{"00000000-0000-0000-0000-000000000001": {"status": "wrong", "errors": [null]}}', 'null', 'INVALID invalid_results'),
    ('an error that is not a key', 'Bien', '{"00000000-0000-0000-0000-000000000001": {"status": "wrong", "errors": ["Signo mal"]}}', 'null', 'INVALID invalid_results'),
    ('an error of 41 characters', 'Bien', '{"00000000-0000-0000-0000-000000000001": {"status": "wrong", "errors": ["a' || repeat('b', 40) || '"]}}', 'null', 'INVALID invalid_results'),
    ('a result with an extra key', 'Bien', '{"00000000-0000-0000-0000-000000000001": {"status": "wrong", "errors": [], "nota": "x"}}', 'null', 'INVALID invalid_results')
  ) as v(label, feedback, results, score, expected)
  where pg_temp.refused('teach', format('select api.grade_attempt(%L, %L, %L::jsonb, %s, null)', pg_temp.id('t_s1_vt'), v.feedback, v.results, v.score))
        <> v.expected || ' changed=false'
$$, 'every malformed argument (or a NULL anywhere) is INVALID with its own reason and changes nothing');

-- ---------------------------------------------------------------------------------------------
-- Only what was submitted, and only exercises of its publication
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.refused('teach', pg_temp.q_grade('t_s2_vt', 'Bien', pg_temp.results(array['x_vt1'], 'correct'), '8', 'null')) || '|'
          || pg_temp.refused('teach', pg_temp.q_grade('t_s3_vt', 'Bien', '{}', 'null', 'null')),
  'CONFLICT not_submitted changed=false|CONFLICT not_submitted changed=false',
  'an attempt that was started (with a draft) or never opened is CONFLICT not_submitted and changes nothing');
select is(pg_temp.refused('teach', pg_temp.q_grade('t_s2_vt', 'Bien', '{}', 'null', '1')), 'CONFLICT not_submitted changed=false', 'also with a revision: there is no grade to compare with');
select is_empty($$
  select v.label from (values
    ('an exercise of another publication', pg_temp.results(array['x_vg1'], 'correct')),
    ('an exercise that does not exist', '{"00000000-0000-0000-0000-00000000dead": {"status": "correct", "errors": []}}'),
    ('one good exercise and one of another publication', pg_temp.results(array['x_vt1', 'x_vg1'], 'wrong')),
    ('a question used as an exercise', pg_temp.results(array['q_vg1'], 'blank'))
  ) as v(label, results)
  where pg_temp.refused('teach', pg_temp.q_grade('t_s1_vt', 'Bien', v.results, '6', 'null')) <> 'INVALID unknown_result_exercise changed=false'
$$, 'a result by the id of an exercise that is not of the publication of the attempt is INVALID unknown_result_exercise, and nothing is saved');

-- ---------------------------------------------------------------------------------------------
-- The first grade
-- ---------------------------------------------------------------------------------------------
create temp table asg_before as select a.revision, a.status from app.assignments a where a.id = pg_temp.id('as_s1_vt');
create temp table att_before as select t::text as t from app.assignment_attempts t where t.id = pg_temp.id('t_s1_vt');
select pg_temp.keepr('g1', pg_temp.as_user('teach', pg_temp.q_grade('t_s1_vt', 'Muy bien, revisá el signo.',
  jsonb_build_object(pg_temp.id('x_vt1')::text, jsonb_build_object('status', 'correct', 'errors', '[]'::jsonb),
                     pg_temp.id('x_vt2')::text, jsonb_build_object('status', 'partial', 'errors', '["signo", "calculo"]'::jsonb))::text, '7', 'null')));
select is(pg_temp.keys(pg_temp.r('g1')), 'attemptId,revision', 'it answers exactly the keys of its result');
select is(pg_temp.r('g1'), jsonb_build_object('attemptId', pg_temp.id('t_s1_vt'), 'revision', 1), 'the attempt and revision 1');
select is(pg_temp.grade_row('t_s1_vt'),
  '7|Muy bien, revisá el signo.|' || jsonb_build_object(pg_temp.id('x_vt1')::text, jsonb_build_object('status', 'correct', 'errors', '[]'::jsonb),
                     pg_temp.id('x_vt2')::text, jsonb_build_object('status', 'partial', 'errors', '["signo", "calculo"]'::jsonb))::text || '|t|t|1',
  'the grade keeps the score, the feedback and the results by exercise, who graded and when');
select is((select concat_ws('|', a.status, a.revision - b.revision) from app.assignments a, asg_before b where a.id = pg_temp.id('as_s1_vt')), 'graded|1',
  'the assignment goes from submitted to graded, one revision up');
select is((select t::text = b.t from app.assignment_attempts t, att_before b where t.id = pg_temp.id('t_s1_vt')), true, 'the attempt itself is not touched');
select is((select s.submitted_at is not null and s.answers = pg_temp.ans(array['x_vt1', 'x_vt2'], 'respuesta final')::jsonb from app.submissions s where s.attempt_id = pg_temp.id('t_s1_vt')), true,
  'nor are the answers that were submitted');
select is((select (i ->> 'graded') || ':' || (i ->> 'score') from jsonb_array_elements(pg_temp.as_user('teach', pg_temp.q_list('a_vt')) -> 'items') i where i ->> 'studentId' = pg_temp.id('s1')::text),
  'true:7', 'the list says it is graded, with the score');
select is(pg_temp.as_user('teach', pg_temp.q_get('t_s1_vt')) #>> '{grade,revision}', '1', 'and the read for grading shows the grade');
select is((select count(*) from app.audit_log l where l.institution_id = pg_temp.id('i_n') and l.action = 'grade_attempt'), 0::bigint, 'grading discloses nothing, so it logs nothing');

-- ---------------------------------------------------------------------------------------------
-- The first grade again, and the revision of the next ones
-- ---------------------------------------------------------------------------------------------
create function pg_temp.first_again(p_feedback text, p_results text, p_score text) returns text language sql as $$
  select pg_temp.refused('teach', pg_temp.q_grade('t_s1_vt', p_feedback, p_results, p_score, 'null')) $$;
create temp table first as select r.* from (values (
  'Muy bien, revisá el signo.',
  jsonb_build_object(pg_temp.id('x_vt1')::text, jsonb_build_object('status', 'correct', 'errors', '[]'::jsonb),
                     pg_temp.id('x_vt2')::text, jsonb_build_object('status', 'partial', 'errors', '["signo", "calculo"]'::jsonb))::text, '7')) as r(feedback, results, score);
select is((select pg_temp.first_again(feedback, results, score) from first), 'ok changed=false', 'the first grade sent again with the same content (a second click, a retry) changes nothing');
select is(pg_temp.as_user('teach', pg_temp.q_grade('t_s1_vt', (select feedback from first), (select results from first), '7', 'null')), jsonb_build_object('attemptId', pg_temp.id('t_s1_vt'), 'revision', 1),
  'and answers the same grade');
select is((select pg_temp.first_again(feedback || ' ', results, score) from first)
          || '|' || (select pg_temp.first_again(feedback, results, '8') from first)
          || '|' || (select pg_temp.first_again(feedback, results, 'null') from first)
          || '|' || (select pg_temp.first_again(feedback, pg_temp.results(array['x_vt1'], 'correct'), score) from first),
  repeat('CONFLICT revision_mismatch changed=false|', 3) || 'CONFLICT revision_mismatch changed=false',
  'with another feedback, another score, no score or other results it is CONFLICT revision_mismatch: somebody already wrote that grade');
select is(pg_temp.refused('teach', pg_temp.q_grade('t_s1_vt', 'Otra', '{}', '5', '2')) || '|' || pg_temp.refused('teach', pg_temp.q_grade('t_s1_vt', 'Otra', '{}', '5', '0')),
  'CONFLICT revision_mismatch changed=false|CONFLICT revision_mismatch changed=false', 'a revision that is not the grade''s (from the future or zero) is revision_mismatch');
select pg_temp.keepr('g2', pg_temp.as_user('teach', pg_temp.q_grade('t_s1_vt', 'Corregido: está bien.', pg_temp.results(array['x_vt1', 'x_vt2'], 'correct'), '9', '1')));
select is(pg_temp.r('g2'), jsonb_build_object('attemptId', pg_temp.id('t_s1_vt'), 'revision', 2), 'with the revision it read, the grade is edited: revision 2');
select is(pg_temp.grade_row('t_s1_vt'), '9|Corregido: está bien.|' || pg_temp.results(array['x_vt1', 'x_vt2'], 'correct') || '|t|t|2', 'with the new content');
select is((select a.status || ':' || (a.revision - b.revision) from app.assignments a, asg_before b where a.id = pg_temp.id('as_s1_vt')), 'graded:1', 'editing the grade does not touch the assignment again');
select is(pg_temp.refused('teach', pg_temp.q_grade('t_s1_vt', 'Corregido otra vez', '{}', '4', '1')), 'CONFLICT revision_mismatch changed=false', 'a stale revision is CONFLICT revision_mismatch and the grade stays as it is');
select is((select pg_temp.first_again(feedback, results, score) from first), 'CONFLICT revision_mismatch changed=false',
  'the first grade, sent late by a slow copy after the edit, is not applied again: revision_mismatch');
select is(pg_temp.refused('teach', pg_temp.q_grade('t_s1_vt', 'Corregido: está bien.', pg_temp.results(array['x_vt1', 'x_vt2'], 'correct'), '9', 'null')), 'ok changed=false',
  'while the content that is the grade of today, sent with no revision, answers it');
-- Only feedback, no score and no results: a grade is also that. The ends of the scale.
select is(pg_temp.as_user('teach', pg_temp.q_grade('t_s1_vt', 'Solo un comentario.', '{}', 'null', '2')), jsonb_build_object('attemptId', pg_temp.id('t_s1_vt'), 'revision', 3), 'a grade can be only feedback: no score, no results');
select is(pg_temp.grade_row('t_s1_vt'), 'null|Solo un comentario.|{}|t|t|3', 'and it is stored like that: the score is null, not a zero');
select is((pg_temp.as_user('teach', pg_temp.q_grade('t_s1_vt', 'Mínima', '{}', '1', '3')) ->> 'revision') || (pg_temp.as_user('teach', pg_temp.q_grade('t_s1_vt', 'Máxima', '{}', '10', '4')) ->> 'revision'),
  '45', 'the scale goes from 1 to 10');

-- A grade for an attempt with no grade, with a revision: there is nothing to compare with.
select pg_temp.as_user('stu_b', pg_temp.q_submit('t_s2_vt', '2'));
select is(pg_temp.refused('teach', pg_temp.q_grade('t_s2_vt', 'Bien', '{}', '5', '1')), 'CONFLICT revision_mismatch changed=false',
  'a revision for a grade that does not exist is CONFLICT revision_mismatch, and no grade is made');

-- ---------------------------------------------------------------------------------------------
-- Attempts that are not in force are graded too
-- ---------------------------------------------------------------------------------------------
update app.assignments set status = 'withdrawn', revision = revision + 1 where id = pg_temp.id('as_s2_vt');
select is(pg_temp.as_user('teach', pg_temp.q_grade('t_s2_vt', repeat('a', 5000), '{}', '6', 'null')) ->> 'revision', '1',
  'a submitted attempt of a withdrawn assignment is graded, with a feedback of exactly 5000 characters');
select is((select char_length(g.feedback) from app.grades g where g.attempt_id = pg_temp.id('t_s2_vt')), 5000, 'which is kept whole');
select is((select a.status from app.assignments a where a.id = pg_temp.id('as_s2_vt')), 'withdrawn', 'and the assignment stays withdrawn');
select pg_temp.as_user('stu_c', pg_temp.q_start('t_s3_vt'));
select pg_temp.as_user('stu_c', pg_temp.q_submit('t_s3_vt', '1'));
update app.assignment_attempts set superseded_at = clock_timestamp() where id = pg_temp.id('t_s3_vt');
select is(pg_temp.as_user('teach', pg_temp.q_grade('t_s3_vt', repeat(chr(128512), 5000), '{}', '5', 'null')) ->> 'revision', '1',
  'a submitted attempt that was replaced is graded, with a feedback of 5000 emoji (5000 code points)');
select is((select a.status from app.assignments a where a.id = pg_temp.id('as_s3_vt')), 'submitted', 'and the assignment keeps waiting for the attempt in force: it is not marked graded');
update app.publications set withdrawn_at = clock_timestamp() where id = pg_temp.id('p_vt');
select is(pg_temp.as_user('teach', pg_temp.q_grade('t_s1_vt', 'Con la publicación retirada.', '{}', '8', '5')) ->> 'revision', '6', 'a grade of a withdrawn publication is edited');

-- ---------------------------------------------------------------------------------------------
-- The guards of the table, as its owner: they answer P0004 (a bug, never a user error)
-- ---------------------------------------------------------------------------------------------
select throws_ok(format('update app.grades set attempt_id = %L where attempt_id = %L', pg_temp.id('t_s2_vt'), pg_temp.id('t_s1_vt')), 'P0004', null,
  'a grade never moves to another attempt');
select throws_ok(format('update app.grades set attempt_id = %L where attempt_id = %L', pg_temp.id('t_s1_vg'), pg_temp.id('t_s3_vt')), 'P0004', null,
  'not even to an attempt that nobody has graded');
select is((select g.attempt_id from app.grades g where g.attempt_id = pg_temp.id('t_s1_vt') and g.revision = 6)::text, pg_temp.id('t_s1_vt')::text, 'and the grade stayed on its attempt');
select throws_ok(format('insert into app.grades (institution_id, attempt_id) values (%L, %L)', pg_temp.id('i_n'), pg_temp.id('t_s1_vg')), 'P0004', null,
  'a grade cannot be born on an attempt that was only opened');
select pg_temp.as_user('stu_a', pg_temp.q_start('t_s1_vg'));
select throws_ok(format('insert into app.grades (institution_id, attempt_id) values (%L, %L)', pg_temp.id('i_n'), pg_temp.id('t_s1_vg')), 'P0004', null,
  'nor on one that was started and not submitted');
select throws_ok(format('insert into app.grades (institution_id, attempt_id) values (%L, %L)', pg_temp.id('i_n'), gen_random_uuid()), 'P0004', null,
  'nor on one that does not exist');
select lives_ok(format('update app.grades set feedback = feedback where attempt_id = %L', pg_temp.id('t_s1_vt')), 'the guard lets the owner change anything else (the retention and the erasure need it)');

select * from finish();
rollback;
