-- T1.5b: the student's side of an attempt (open, start, save the draft, submit). Who may call (nobody but the student, from
-- every other caller, with the proof that nothing changed), the protocol step by step, the shape of the draft with its
-- NULLs, the ids of another publication, the draft that another tab saved, the second click and a late submission. The
-- table of what can be done at each moment, cell by cell, is in 021b. The races with two connections are in
-- tests/integration/races/attempts*.test.ts. The RPCs run as tiza_student: 005_student_role checks the role has no more
-- than what they need. Placeholder text only. The whole file is rolled back.
begin;
select plan(53);

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
  'admin', 'teach', 'incl', 'userb', 'nobody', 'ghost', 'stu_a', 'stu_b', 'stu_c', 'stu_x'
]) as k;
insert into auth.users (id, email) select id, k || '@t1-5b.invalid' from ids where k <> 'ghost' and k not like 'stu\_%';
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
insert into ids (k, id) select 'i_n', (pg_temp.as_service($$ select api.internal_create_institution('Liceo N', 't1-5b', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, %L)', pg_temp.id('i_n'), pg_temp.id(u.k), u.role))
  from (values ('admin', 'admin'), ('teach', 'teacher'), ('incl', 'inclusion')) as u(k, role);
insert into ids (k, id) values
  ('g_n', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid);
insert into ids (k, id)
  select 's' || n, (pg_temp.as_user('teach', format('select api.create_student(%L, %L, %L, gen_random_uuid())', pg_temp.id('g_n'), 'Estudiante ' || n, 'est.' || n)) ->> 'id')::uuid
    from generate_series(1, 3) n;
select pg_temp.link_student(pg_temp.id(l.s), pg_temp.id(l.u))
  from (values ('s1', 'stu_a'), ('s2', 'stu_b'), ('s3', 'stu_c')) as l(s, u);
insert into ids (k, id) select 'i_b', (pg_temp.as_service($$ select api.internal_create_institution('Liceo B', 't1-5b-b', 'school') $$) ->> 'id')::uuid;
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

-- Everything the attempt protocol can write, as one string: the assignments, the attempts and the drafts of the institution.
create function pg_temp.digest() returns text language sql as $$
  select md5(coalesce((select string_agg(a::text, ';' order by a.id) from app.assignments a where a.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(t::text, ';' order by t.id) from app.assignment_attempts t where t.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(s::text, ';' order by s.id) from app.submissions s where s.institution_id = pg_temp.id('i_n')), ''))
$$;
-- A student call: the user (null: a session of nobody) and the RPC with its arguments as SQL.
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

-- The RPCs of the test, as the SQL a caller sends.
create function pg_temp.q_open(p_assignment text) returns text language sql as $$
  select format('select api.student_open_attempt(%L)', pg_temp.id(p_assignment)) $$;
create function pg_temp.q_start(p_attempt text) returns text language sql as $$
  select format('select api.student_start_attempt(%L)', pg_temp.id(p_attempt)) $$;
create function pg_temp.q_save(p_attempt text, p_rev text, p_answers text, p_choices text) returns text language sql as $$
  select format('select api.student_save_draft(%L, %s, %L::jsonb, %L::jsonb)', pg_temp.id(p_attempt), p_rev, p_answers, p_choices) $$;
create function pg_temp.q_submit(p_attempt text, p_rev text) returns text language sql as $$
  select format('select api.student_submit_attempt(%L, %s)', pg_temp.id(p_attempt), p_rev) $$;
-- The revision of the draft of an attempt, as SQL text.
create function pg_temp.draft(p_attempt text) returns text language sql as $$
  select s.revision::text from app.submissions s where s.attempt_id = pg_temp.id(p_attempt) $$;
-- An answers document with one typed answer for each exercise given.
create function pg_temp.ans(p_exercises text[], p_text text) returns text language sql as $$
  select coalesce(jsonb_object_agg(pg_temp.id(x)::text, jsonb_build_object('text', p_text, 'mode', 'typed')), '{}'::jsonb)::text from unnest(p_exercises) x $$;
-- Every caller that is not the student: the same call from each one, with what each one gets and whether anything changed.
create function pg_temp.others(p_sql text) returns text language sql as $$
  select string_agg(coalesce(u, '(sin sesión)') || '=' || pg_temp.refused(u, p_sql), ';' order by u nulls last)
    from unnest(array['admin', 'incl', 'nobody', 'stu_b', 'stu_c', 'stu_x', 'teach', 'userb', 'ghost', null]) u $$;
create function pg_temp.denied() returns text language sql as $$
  select string_agg(coalesce(u, '(sin sesión)') || '=' || case when u is null or u = 'ghost' then 'FORBIDDEN no_session' else 'NOT_FOUND not_found' end || ' changed=false', ';' order by u nulls last)
    from unnest(array['admin', 'incl', 'nobody', 'stu_b', 'stu_c', 'stu_x', 'teach', 'userb', 'ghost', null]) u $$;

-- A typed version for s1 and s2, and a gaze one (one question, options A, B and C) for s1.
select pg_temp.publish('vt', 2, 'typed', array['s1', 's2']);
select pg_temp.publish('vg', 1, 'gaze', array['s1']);
select pg_temp.remember('vt', 's1');
select pg_temp.remember('vt', 's2');
select pg_temp.remember('vg', 's1');

-- ---------------------------------------------------------------------------------------------
-- Privileges and who calls
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_proc p
            where p.pronamespace = 'api'::regnamespace
              and p.proname in ('student_open_attempt', 'student_start_attempt', 'student_save_draft', 'student_submit_attempt')
              and p.prosecdef and p.proowner = 'tiza_student'::regrole
              and has_function_privilege('authenticated', p.oid, 'execute')
              and not has_function_privilege('anon', p.oid, 'execute')
              and not has_function_privilege('service_role', p.oid, 'execute')), 4::bigint,
  'the four RPCs are SECURITY DEFINER of tiza_student; authenticated executes them, anon and service_role do not');

select is(pg_temp.others(pg_temp.q_open('as_s1_vt')), pg_temp.denied(),
  'open: nobody but the student gets the assignment (another student, another institution, staff, no student row, no app user, no session), and nothing changes');
select is(pg_temp.others(pg_temp.q_start('t_s1_vt')), pg_temp.denied(),
  'start: nobody but the student starts the attempt, and nothing changes');
select is(pg_temp.others(pg_temp.q_save('t_s1_vt', '1', '{}', '{}')), pg_temp.denied(),
  'save: nobody but the student saves the draft, and nothing changes');
select is(pg_temp.others(pg_temp.q_submit('t_s1_vt', '1')), pg_temp.denied(),
  'submit: nobody but the student submits, and nothing changes');
select is(
  pg_temp.refused('stu_a', 'select api.student_open_attempt(gen_random_uuid())') || '|' || pg_temp.refused('stu_a', 'select api.student_open_attempt(null)') || '|'
  || pg_temp.refused('stu_a', 'select api.student_start_attempt(gen_random_uuid())') || '|' || pg_temp.refused('stu_a', 'select api.student_start_attempt(null)') || '|'
  || pg_temp.refused('stu_a', 'select api.student_save_draft(gen_random_uuid(), 1, ''{}'', ''{}'')') || '|' || pg_temp.refused('stu_a', 'select api.student_save_draft(null, 1, ''{}'', ''{}'')') || '|'
  || pg_temp.refused('stu_a', 'select api.student_submit_attempt(gen_random_uuid(), 1)') || '|' || pg_temp.refused('stu_a', 'select api.student_submit_attempt(null, 1)'),
  repeat('NOT_FOUND not_found changed=false|', 7) || 'NOT_FOUND not_found changed=false',
  'an id that does not exist, or none at all, is NOT_FOUND in the four RPCs');

-- ---------------------------------------------------------------------------------------------
-- Open
-- ---------------------------------------------------------------------------------------------
select pg_temp.keepr('open1', pg_temp.as_user('stu_a', pg_temp.q_open('as_s1_vt')));
select is(pg_temp.keys(pg_temp.r('open1')), 'attemptId,status', 'open answers exactly its keys');
select is(pg_temp.r('open1'), jsonb_build_object('attemptId', pg_temp.id('t_s1_vt'), 'status', 'opened'), 'the student gets the attempt in force of the assignment, still opened');
select is((select concat_ws('|', t.first_viewed_at is not null, t.status, t.started_at is null, t.revision) from app.assignment_attempts t where t.id = pg_temp.id('t_s1_vt')),
  't|opened|t|1', 'the first look stamps first_viewed_at and nothing else: still opened, not started, same revision');
create temp table seen as select t.first_viewed_at from app.assignment_attempts t where t.id = pg_temp.id('t_s1_vt');
select is(pg_temp.refused('stu_a', pg_temp.q_open('as_s1_vt')), 'ok changed=false', 'a second look changes nothing');
select is((select t.first_viewed_at = s.first_viewed_at from app.assignment_attempts t, seen s where t.id = pg_temp.id('t_s1_vt')), true, 'and the first look stays the first');

-- ---------------------------------------------------------------------------------------------
-- Start
-- ---------------------------------------------------------------------------------------------
select pg_temp.keepr('start1', pg_temp.as_user('stu_a', pg_temp.q_start('t_s1_vt')));
select is(pg_temp.keys(pg_temp.r('start1')), 'attemptId,draftRevision,status', 'start answers exactly its keys');
select is(pg_temp.r('start1'), jsonb_build_object('attemptId', pg_temp.id('t_s1_vt'), 'status', 'started', 'draftRevision', 1), 'start: started, with the draft at revision 1');
select is((select concat_ws('|', t.status, t.started_at is not null, t.first_viewed_at is not null, t.submitted_at is null, t.late, t.revision, t.publication_id = pg_temp.id('p_vt'))
             from app.assignment_attempts t where t.id = pg_temp.id('t_s1_vt')),
  'started|t|t|t|f|2|t', 'the attempt is started, with its time, and keeps its publication; its revision went up by one');
select is((select concat_ws('|', count(*), min(s.revision), min(s.answers::text), min(s.choices::text), count(s.submitted_at))
             from app.submissions s where s.attempt_id = pg_temp.id('t_s1_vt')),
  '1|1|{}|{}|0', 'the draft exists: revision 1, empty, not submitted');
select is((select a.status || '|' || a.revision from app.assignments a where a.id = pg_temp.id('as_s1_vt')), 'in_progress|2', 'the assignment is in progress');
select is(pg_temp.refused('stu_a', pg_temp.q_start('t_s1_vt')), 'ok changed=false', 'starting again changes nothing');
select is(pg_temp.as_user('stu_a', pg_temp.q_start('t_s1_vt')), pg_temp.r('start1'), 'and answers the same');
select is((select a.status || '|' || a.revision from app.assignments a where a.id = pg_temp.id('as_s2_vt')), 'assigned|1', 'the other student''s assignment did not move');

-- ---------------------------------------------------------------------------------------------
-- Save
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.refused('stu_b', pg_temp.q_save('t_s2_vt', '1', pg_temp.ans(array['x_vt1'], 'a'), '{}')), 'CONFLICT attempt_not_started changed=false',
  'saving an opened attempt (not started) is CONFLICT attempt_not_started');
select is(pg_temp.refused('stu_b', pg_temp.q_submit('t_s2_vt', '1')), 'CONFLICT attempt_not_started changed=false',
  'and so is submitting it');

select pg_temp.keepr('save1', pg_temp.as_user('stu_a', pg_temp.q_save('t_s1_vt', '1', pg_temp.ans(array['x_vt1'], '2 + 2 = 4'), '{}')));
select is(pg_temp.r('save1'), '{"revision": 2}'::jsonb, 'saving answers exactly its keys: the new revision of the draft');
select is((select s.answers = pg_temp.ans(array['x_vt1'], '2 + 2 = 4')::jsonb and s.choices = '{}'::jsonb and s.revision = 2 and s.submitted_at is null
             from app.submissions s where s.attempt_id = pg_temp.id('t_s1_vt')), true, 'the draft keeps what was saved, one revision up');
select is((select t.revision from app.assignment_attempts t where t.id = pg_temp.id('t_s1_vt')), 2, 'saving does not touch the attempt');
select is(pg_temp.refused('stu_a', pg_temp.q_save('t_s1_vt', '1', pg_temp.ans(array['x_vt1'], 'viejo'), '{}')), 'CONFLICT revision_mismatch changed=false',
  'a save with an older revision is CONFLICT revision_mismatch and changes nothing');
select pg_temp.keepr('save2', pg_temp.as_user('stu_a', pg_temp.q_save('t_s1_vt', '2',
  jsonb_build_object(pg_temp.id('x_vt2')::text, jsonb_build_object('text', 'x = 3', 'mode', 'voice', 'transcript', 'equis igual a tres', 'graph',
    jsonb_build_object('functions', jsonb_build_array(jsonb_build_object('expr', 'x')), 'points', '[]'::jsonb)))::text, '{}')));
select is(pg_temp.r('save2'), '{"revision": 3}'::jsonb, 'a dictated answer with its transcript and a graph is saved');
select is((select s.answers ? pg_temp.id('x_vt1')::text from app.submissions s where s.attempt_id = pg_temp.id('t_s1_vt')), false, 'the draft is replaced as a whole: what was not sent is gone');
select is(pg_temp.as_user('stu_a', pg_temp.q_save('t_s1_vt', '3', '{}', '{}')), '{"revision": 4}'::jsonb, 'an empty draft is valid: it clears the answers');

-- The shape: the repo validates with zod first, this is the second wall. A NULL never gets through.
select is_empty($$
  select v.label from (values
    ('revision null', 'null', '{}', '{}'),
    ('answers null', '4', null, '{}'),
    ('choices null', '4', '{}', null),
    ('answers is a list', '4', '[]', '{}'),
    ('answers is a string', '4', '"texto"', '{}'),
    ('choices is a list', '4', '{}', '["A"]'),
    ('an answer is not an object', '4', '{"00000000-0000-0000-0000-000000000001": "texto"}', '{}'),
    ('an answer is null', '4', '{"00000000-0000-0000-0000-000000000001": null}', '{}'),
    ('an answer has no text', '4', '{"00000000-0000-0000-0000-000000000001": {"mode": "typed"}}', '{}'),
    ('an answer has no mode', '4', '{"00000000-0000-0000-0000-000000000001": {"text": "a"}}', '{}'),
    ('the mode is not one of the two', '4', '{"00000000-0000-0000-0000-000000000001": {"text": "a", "mode": "gaze"}}', '{}'),
    ('the text is a number', '4', '{"00000000-0000-0000-0000-000000000001": {"text": 5, "mode": "typed"}}', '{}'),
    ('the text is longer than 20000', '4', '{"00000000-0000-0000-0000-000000000001": {"text": "' || repeat('a', 20001) || '", "mode": "typed"}}', '{}'),
    ('an answer has an extra key', '4', '{"00000000-0000-0000-0000-000000000001": {"text": "a", "mode": "typed", "nota": "b"}}', '{}'),
    ('the transcript is a number', '4', '{"00000000-0000-0000-0000-000000000001": {"text": "a", "mode": "voice", "transcript": 7}}', '{}'),
    ('the graph is a string', '4', '{"00000000-0000-0000-0000-000000000001": {"text": "a", "mode": "typed", "graph": "x"}}', '{}'),
    ('a choice is a number', '4', '{}', '{"00000000-0000-0000-0000-000000000001": 1}'),
    ('a choice is null', '4', '{}', '{"00000000-0000-0000-0000-000000000001": null}'),
    ('a choice is lowercase', '4', '{}', '{"00000000-0000-0000-0000-000000000001": "a"}'),
    ('a choice has two letters', '4', '{}', '{"00000000-0000-0000-0000-000000000001": "AB"}')
  ) as v(label, rev, answers, choices)
  where pg_temp.refused('stu_a', pg_temp.q_save('t_s1_vt', v.rev,  v.answers, v.choices))
        <> case when v.rev = 'null' then 'INVALID revision_required changed=false'
                when v.label like 'choice%' or v.label like 'a choice%' then 'INVALID invalid_choices changed=false'
                else 'INVALID invalid_answers changed=false' end
$$, 'a draft with the wrong shape (or a NULL anywhere) is INVALID and changes nothing');

-- The ids have to be of the publication of the attempt.
select is_empty($$
  select v.label from (values
    ('an exercise of another publication', pg_temp.ans(array['x_vg1'], 'a'), '{}'),
    ('an exercise that does not exist', '{"00000000-0000-0000-0000-00000000dead": {"text": "a", "mode": "typed"}}', '{}'),
    ('a key that is not an id', '{"uno": {"text": "a", "mode": "typed"}}', '{}'),
    ('one good exercise and one of another publication', pg_temp.ans(array['x_vt1', 'x_vg1'], 'a'), '{}'),
    ('a question of another publication', '{}', jsonb_build_object(pg_temp.id('q_vg1')::text, 'B')::text),
    ('a question that does not exist', '{}', '{"00000000-0000-0000-0000-00000000dead": "A"}'),
    ('an exercise id used as a question', '{}', jsonb_build_object(pg_temp.id('x_vt1')::text, 'A')::text)
  ) as v(label, answers, choices)
  where pg_temp.refused('stu_a', pg_temp.q_save('t_s1_vt', '4', v.answers, v.choices)) <> 'INVALID unknown_exercise changed=false'
$$, 'an id of another publication (or none at all) is INVALID unknown_exercise and nothing is saved');
select is((select s.revision from app.submissions s where s.attempt_id = pg_temp.id('t_s1_vt')), 4, 'after all the refusals the draft is where it was');

-- Gaze: the choices.
select is(pg_temp.as_user('stu_a', pg_temp.q_start('t_s1_vg')), jsonb_build_object('attemptId', pg_temp.id('t_s1_vg'), 'status', 'started', 'draftRevision', 1), 'the same student starts the attempt of the gaze version');
select is(pg_temp.as_user('stu_a', pg_temp.q_save('t_s1_vg', '1', '{}', jsonb_build_object(pg_temp.id('q_vg1')::text, 'C')::text)), '{"revision": 2}'::jsonb, 'a choice among the options of its question is saved');
select is((select s.choices from app.submissions s where s.attempt_id = pg_temp.id('t_s1_vg')), jsonb_build_object(pg_temp.id('q_vg1')::text, 'C'), 'as chosen');
select is(pg_temp.refused('stu_a', pg_temp.q_save('t_s1_vg', '2', '{}', jsonb_build_object(pg_temp.id('q_vg1')::text, 'Z')::text)), 'INVALID unknown_choice changed=false',
  'an option the question does not have is INVALID unknown_choice');
select is(pg_temp.refused('stu_a', pg_temp.q_save('t_s1_vg', '2', pg_temp.ans(array['x_vt1'], 'a'), '{}')), 'INVALID unknown_exercise changed=false',
  'and the exercises of the typed version are not exercises of this attempt either');

-- ---------------------------------------------------------------------------------------------
-- Submit
-- ---------------------------------------------------------------------------------------------
select pg_temp.as_user('stu_a', pg_temp.q_save('t_s1_vt', '4', pg_temp.ans(array['x_vt1', 'x_vt2'], 'final'), '{}'));
select is(pg_temp.refused('stu_a', pg_temp.q_submit('t_s1_vt', '4')), 'CONFLICT draft_outdated changed=false',
  'another tab saved a newer draft: submitting with the older revision is CONFLICT draft_outdated and submits nothing');
select is(pg_temp.refused('stu_a', pg_temp.q_submit('t_s1_vt', '6')), 'CONFLICT draft_outdated changed=false', 'and a revision from the future is not accepted either');
select pg_temp.keepr('submit1', pg_temp.as_user('stu_a', pg_temp.q_submit('t_s1_vt', '5')));
select is(pg_temp.keys(pg_temp.r('submit1')), 'alreadySubmitted,late,submittedAt', 'submit answers exactly its keys');
select is(pg_temp.r('submit1') -> 'alreadySubmitted', 'false'::jsonb, 'the first submission is not a repeat');
select is(pg_temp.r('submit1') -> 'late', 'false'::jsonb, 'on time: the assessment has no due date');
select is((select concat_ws('|', t.status, t.submitted_at = (pg_temp.r('submit1') ->> 'submittedAt')::timestamptz, s.submitted_at = t.submitted_at, t.late, t.revision, a.status, a.revision)
             from app.assignment_attempts t join app.submissions s on s.attempt_id = t.id join app.assignments a on a.id = t.assignment_id where t.id = pg_temp.id('t_s1_vt')),
  'submitted|t|t|f|3|submitted|3', 'submitted: the attempt, its draft (frozen) and the assignment, with the same time');
select is(pg_temp.refused('stu_a', pg_temp.q_submit('t_s1_vt', '5')), 'ok changed=false', 'the second click changes nothing');
select is(pg_temp.as_user('stu_a', pg_temp.q_submit('t_s1_vt', '5')), jsonb_build_object('submittedAt', pg_temp.r('submit1') -> 'submittedAt', 'late', false, 'alreadySubmitted', true),
  'and answers what the first one did, saying it was already submitted');
select is(pg_temp.as_user('stu_a', pg_temp.q_submit('t_s1_vt', '99')) -> 'alreadySubmitted', 'true'::jsonb, 'whatever revision the second click carries');
select is(pg_temp.refused('stu_a', pg_temp.q_save('t_s1_vt', '5', '{}', '{}')), 'CONFLICT already_submitted changed=false', 'after submitting the draft cannot be saved: CONFLICT already_submitted');
select is(pg_temp.refused('stu_a', pg_temp.q_start('t_s1_vt')), 'ok changed=false', 'starting a submitted attempt answers the same and changes nothing');
select is((select s.answers = pg_temp.ans(array['x_vt1', 'x_vt2'], 'final')::jsonb and s.revision = 5 from app.submissions s where s.attempt_id = pg_temp.id('t_s1_vt')), true, 'the answers are the ones that were submitted');

-- Late: the due date has passed (the moment of the call, not the start of the transaction).
update app.assessments set publish_at = clock_timestamp() - interval '2 hours', due_at = clock_timestamp() - interval '1 hour' where id = pg_temp.id('a_vt');
select pg_temp.as_user('stu_b', pg_temp.q_start('t_s2_vt'));
select is(pg_temp.refused('stu_b', pg_temp.q_submit('t_s2_vt', 'null')), 'INVALID revision_required changed=false', 'submitting with no revision is INVALID revision_required');
select pg_temp.keepr('submit2', pg_temp.as_user('stu_b', pg_temp.q_submit('t_s2_vt', '1')));
select is(pg_temp.r('submit2') -> 'late', 'true'::jsonb, 'after due_at it is still accepted, marked late');
select is((select t.late and t.status = 'submitted' from app.assignment_attempts t where t.id = pg_temp.id('t_s2_vt')), true, 'and the attempt says so');
select is((select t.late from app.assignment_attempts t where t.id = pg_temp.id('t_s1_vt')), false, 'while the one submitted before stays on time');
select is(pg_temp.as_user('stu_b', pg_temp.q_submit('t_s2_vt', '1')) -> 'late', 'true'::jsonb, 'and the second click says late too');

select * from finish();
rollback;
