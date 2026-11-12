-- T1.5d: the four DTOs of the student (student_home, student_task_list, student_task, student_grades), first half. Who may
-- call them (a teacher, inclusion, another institution, no session, anon and another student cannot), that each student sees
-- only their own, the exact keys of every DTO (the lists of lib/domain/delivery/student-dto.ts; the integration test checks
-- the same JSON against its strict zod schemas), what they say (interface, answer mode, aids, dictation consent, draft,
-- title, status, grades) and that the reads change nothing. What student_task answers at each moment (before publish_at,
-- in date, overdue, withdrawn, replaced) is in 023b. The leak test with two students of different profiles is in
-- tests/integration/student-dto-leaks.test.ts. Placeholder text only. The whole file is rolled back.
begin;
-- Phase 1 links ordinary accounts (any email) to students; the shape guard of phase 2 (T2.5a) is off in this file. 040_f2_contract covers it.
alter table app.account_provisioning disable trigger student_auth_link_guard;
select plan(57);

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
  'admin', 'teach', 'incl', 'userb', 'nobody', 'ghost', 'stu_a', 'stu_b', 'stu_c', 'stu_d'
]) as k;
insert into auth.users (id, email) select id, k || '@t1-5d.invalid' from ids where k <> 'ghost';
do $$
declare
  k text;
begin
  for k in select ids.k from ids where ids.k <> 'ghost' loop
    perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;

-- Institution n: admin, the teacher teach (group g_n), inclusion. Students s1 (account stu_a), s2 (stu_b), s3 (stu_c) and
-- s4 (stu_d, archived later) in g_n. Institution b: the teacher userb. Placeholder names only.
insert into ids (k, id) select 'i_n', (pg_temp.as_service($$ select api.internal_create_institution('Liceo N', 't1-5d', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, %L)', pg_temp.id('i_n'), pg_temp.id(u.k), u.role))
  from (values ('admin', 'admin'), ('teach', 'teacher'), ('incl', 'inclusion')) as u(k, role);
insert into ids (k, id) values
  ('g_n', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid);
insert into ids (k, id)
  select 's' || n, (pg_temp.as_user('teach', format('select api.create_student(%L, %L, %L, gen_random_uuid())', pg_temp.id('g_n'), 'Estudiante ' || n, 'est.' || n)) ->> 'id')::uuid
    from generate_series(1, 4) n;
select pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id(l.s), pg_temp.id(l.u)))
  from (values ('s1', 'stu_a'), ('s2', 'stu_b'), ('s3', 'stu_c'), ('s4', 'stu_d')) as l(s, u);
insert into ids (k, id) select 'i_b', (pg_temp.as_service($$ select api.internal_create_institution('Liceo B', 't1-5d-b', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_b'), pg_temp.id('userb')));
-- The profiles and the accessibility setting are independent (T1.F8): the staff picks the interface, the profile does not derive it.
select pg_temp.as_user('teach', format('select api.set_student_needs(%L, %L::text[], array[]::text[], array[]::text[], gen_random_uuid(), null, null)', pg_temp.id(n.s), n.p))
  from (values ('s1', array['motor']), ('s2', array['dyslexia']), ('s3', array['dysgraphia'])) as n(s, p);
select pg_temp.as_user('teach', format('select api.set_student_interface(%L, %L, 1)', pg_temp.id(n.s), n.i))
  from (values ('s1', 'gaze'), ('s3', 'voice')) as n(s, i);

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
  perform pg_temp.mk_asm('a_' || p, 'Instrucciones de ' || p);
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
-- Remembers the attempt in force (t_<student>_<p>) and the assignment (as_<student>_<p>) of a student on the assessment of p.
create function pg_temp.remember(p text, p_student text) returns void language plpgsql as $$
begin
  insert into ids (k, id)
    select 't_' || p_student || '_' || p, t.id from app.assignment_attempts t join app.assignments a on a.id = t.assignment_id
     where a.student_id = pg_temp.id(p_student) and a.assessment_id = pg_temp.id('a_' || p) and t.superseded_at is null;
  insert into ids (k, id)
    select 'as_' || p_student || '_' || p, a.id from app.assignments a
     where a.student_id = pg_temp.id(p_student) and a.assessment_id = pg_temp.id('a_' || p);
end $$;
create function pg_temp.digest() returns text language sql as $$
  select md5(coalesce((select string_agg(a::text, ';' order by a.id) from app.assignments a where a.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(t::text, ';' order by t.id) from app.assignment_attempts t where t.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(s::text, ';' order by s.id) from app.submissions s where s.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(g::text, ';' order by g.id) from app.grades g where g.institution_id = pg_temp.id('i_n')), ''))
$$;

-- The calls, as the SQL a caller sends.
create function pg_temp.q(p_rpc text) returns text language sql as $$ select format('select api.%s()', p_rpc) $$;
create function pg_temp.q_task(p_attempt text) returns text language sql as $$
  select format('select api.student_task(%L)', pg_temp.id(p_attempt)) $$;
create function pg_temp.q_start(p_attempt text) returns text language sql as $$
  select format('select api.student_start_attempt(%L)', pg_temp.id(p_attempt)) $$;
create function pg_temp.q_save(p_attempt text, p_rev text, p_answers text, p_choices text) returns text language sql as $$
  select format('select api.student_save_draft(%L, %s, %L::jsonb, %L::jsonb)', pg_temp.id(p_attempt), p_rev, p_answers, p_choices) $$;
create function pg_temp.q_submit(p_attempt text, p_rev text) returns text language sql as $$
  select format('select api.student_submit_attempt(%L, %s)', pg_temp.id(p_attempt), p_rev) $$;
create function pg_temp.ans(p_exercises text[], p_text text) returns text language sql as $$
  select coalesce(jsonb_object_agg(pg_temp.id(x)::text, jsonb_build_object('text', p_text, 'mode', 'typed')), '{}'::jsonb)::text from unnest(p_exercises) x $$;
-- A refused call: its error and whether it changed anything.
create function pg_temp.refused(p_user text, p_sql text) returns text language plpgsql as $$
declare
  v_before text := pg_temp.digest();
  v_err text;
begin
  v_err := pg_temp.err(case when p_user is null then pg_temp.rpc(null, 'authenticated', p_sql) else pg_temp.as_user(p_user, p_sql) end);
  return coalesce(v_err, 'ok') || ' changed=' || (v_before <> pg_temp.digest())::text;
end $$;
-- The four reads of a user, as "error | error | error | error".
create function pg_temp.four(p_user text) returns text language sql as $$
  select pg_temp.refused(p_user, pg_temp.q('student_home')) || ' | ' || pg_temp.refused(p_user, pg_temp.q('student_task_list')) || ' | '
      || pg_temp.refused(p_user, pg_temp.q('student_grades')) || ' | ' || pg_temp.refused(p_user, pg_temp.q_task('t_s1_vg')) $$;

-- s1 (motor, gaze): two exercises with a question each. s2 (dyslexia, typed) and s3 (dysgraphia, voice): one exercise.
select pg_temp.publish('vg', 2, 'gaze', array['s1']);
select pg_temp.publish('vt', 1, 'typed', array['s2']);
select pg_temp.publish('vv', 1, 'voice', array['s3']);
select pg_temp.remember('vg', 's1');
select pg_temp.remember('vt', 's2');
select pg_temp.remember('vv', 's3');
update app.students set archived_at = clock_timestamp() where id = pg_temp.id('s4');

create temp table before_reads as select pg_temp.digest() as d;
create function pg_temp.j(p_user text, p_sql text) returns jsonb language sql as $$ select pg_temp.as_user(p_user, p_sql) $$;

-- ---------------------------------------------------------------------------------------------
-- Who calls
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.four('teach'), 'FORBIDDEN not_a_student changed=false | FORBIDDEN not_a_student changed=false | FORBIDDEN not_a_student changed=false | NOT_FOUND not_found changed=false',
  'a teacher cannot read what a student reads: FORBIDDEN not_a_student, and NOT_FOUND for an attempt');
select is(pg_temp.four('incl'), 'FORBIDDEN not_a_student changed=false | FORBIDDEN not_a_student changed=false | FORBIDDEN not_a_student changed=false | NOT_FOUND not_found changed=false',
  'nor can inclusion');
select is(pg_temp.four('admin'), 'FORBIDDEN not_a_student changed=false | FORBIDDEN not_a_student changed=false | FORBIDDEN not_a_student changed=false | NOT_FOUND not_found changed=false',
  'nor the admin');
select is(pg_temp.four('userb'), 'FORBIDDEN not_a_student changed=false | FORBIDDEN not_a_student changed=false | FORBIDDEN not_a_student changed=false | NOT_FOUND not_found changed=false',
  'nor a teacher of another institution');
select is(pg_temp.four('nobody'), 'FORBIDDEN not_a_student changed=false | FORBIDDEN not_a_student changed=false | FORBIDDEN not_a_student changed=false | NOT_FOUND not_found changed=false',
  'nor a user with no membership');
select is(pg_temp.four('ghost'), 'FORBIDDEN no_session changed=false | FORBIDDEN no_session changed=false | FORBIDDEN no_session changed=false | FORBIDDEN no_session changed=false',
  'a session of someone with no app user is FORBIDDEN no_session');
select is(pg_temp.four(null), 'FORBIDDEN no_session changed=false | FORBIDDEN no_session changed=false | FORBIDDEN no_session changed=false | FORBIDDEN no_session changed=false',
  'no session at all is FORBIDDEN no_session');
select is(pg_temp.four('stu_d'), 'FORBIDDEN not_a_student changed=false | FORBIDDEN not_a_student changed=false | FORBIDDEN not_a_student changed=false | NOT_FOUND not_found changed=false',
  'an archived student reads nothing');
select is(pg_temp.four('stu_b'), 'ok changed=false | ok changed=false | ok changed=false | NOT_FOUND not_found changed=false',
  'a student reads their own, and the attempt of another student is NOT_FOUND (the same as one that does not exist)');
select is(pg_temp.refused('stu_a', format('select api.student_task(%L)', gen_random_uuid())) || '|' || pg_temp.refused('stu_a', 'select api.student_task(null)'),
  'NOT_FOUND not_found changed=false|NOT_FOUND not_found changed=false', 'an attempt that does not exist, or none at all, is NOT_FOUND');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('stu_a'), 'anon', 'select api.student_home()')) ~ '^42501' and pg_temp.err(pg_temp.rpc(null, 'anon', pg_temp.q_task('t_s1_vg'))) ~ '^42501', true,
  'anon cannot even execute them');
select is((select string_agg(p.proname || ':' || r.rolname || ':' || p.prosecdef, ',' order by p.proname)
             from pg_proc p join pg_roles r on r.oid = p.proowner
            where p.pronamespace = 'api'::regnamespace and p.proname in ('student_home', 'student_task_list', 'student_task', 'student_grades')),
  'student_grades:tiza_student:true,student_home:tiza_student:true,student_task:tiza_student:true,student_task_list:tiza_student:true',
  'the four are SECURITY DEFINER and owned by tiza_student: they run with its privileges');
select is((select string_agg(p.proname || ':' || has_function_privilege('authenticated', p.oid, 'execute') || has_function_privilege('anon', p.oid, 'execute') || has_function_privilege('service_role', p.oid, 'execute'), ',' order by p.proname)
             from pg_proc p where p.pronamespace = 'api'::regnamespace and p.proname in ('student_home', 'student_task_list', 'student_task', 'student_grades')),
  'student_grades:truefalsefalse,student_home:truefalsefalse,student_task:truefalsefalse,student_task_list:truefalsefalse', 'only authenticated may execute them');

-- ---------------------------------------------------------------------------------------------
-- Each student sees only their own
-- ---------------------------------------------------------------------------------------------
select is((select string_agg(u || ':' || (pg_temp.j(u, pg_temp.q('student_task_list')) -> 'tasks' -> 0 ->> 'attemptId')::uuid::text, ',' order by u)
             from unnest(array['stu_a', 'stu_b', 'stu_c']) u),
  'stu_a:' || pg_temp.id('t_s1_vg') || ',stu_b:' || pg_temp.id('t_s2_vt') || ',stu_c:' || pg_temp.id('t_s3_vv'), 'each student lists their own task');
select is((select string_agg(u || ':' || jsonb_array_length(pg_temp.j(u, pg_temp.q('student_task_list')) -> 'tasks'), ',' order by u) from unnest(array['stu_a', 'stu_b', 'stu_c']) u),
  'stu_a:1,stu_b:1,stu_c:1', 'and only that one');
select is(pg_temp.j('stu_a', pg_temp.q('student_home')) ->> 'displayName', 'Estudiante 1', 'student_home carries the name of the student who calls');
select is(pg_temp.j('stu_a', pg_temp.q('student_home')) -> 'groups', jsonb_build_array(jsonb_build_object('id', pg_temp.id('g_n'), 'name', '3.º A', 'subjectId', 'math')),
  'with the groups they are in');
select is(pg_temp.err(pg_temp.j('stu_b', pg_temp.q_task('t_s1_vg'))) || '|' || pg_temp.err(pg_temp.j('stu_c', pg_temp.q_task('t_s1_vg'))),
  'NOT_FOUND not_found|NOT_FOUND not_found', 'another student of the same group cannot read the attempt of s1');

-- ---------------------------------------------------------------------------------------------
-- The exact keys of every DTO (lib/domain/delivery/student-dto.ts)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.keys(pg_temp.j('stu_a', pg_temp.q('student_home'))), 'displayName,groups,interface', 'student_home: its keys');
select is(pg_temp.keys(pg_temp.j('stu_a', pg_temp.q('student_home')) -> 'groups' -> 0), 'id,name,subjectId', 'student_home.groups: its keys');
select is(pg_temp.keys(pg_temp.j('stu_a', pg_temp.q('student_task_list'))), 'tasks', 'student_task_list: its keys');
select is(pg_temp.keys(pg_temp.j('stu_a', pg_temp.q('student_task_list')) -> 'tasks' -> 0), 'assignmentId,attemptId,dueAt,kind,late,publishAt,status,subjectId,title',
  'student_task_list.tasks: its keys');
select is(pg_temp.keys(pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg'))),
  'aids,answerMode,assignmentId,attemptId,draft,dueAt,exercises,generalInstructions,kind,late,questions,readOnly,subjectId,submittedAt,title',
  'student_task: its keys (no key, no change, no profile, no version)');
select is(pg_temp.keys(pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) -> 'aids') || '|' || pg_temp.keys(pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) -> 'draft'),
  'readAloud|answers,choices,revision', 'student_task.aids and student_task.draft: their keys');
select is(pg_temp.keys(pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) -> 'exercises' -> 0) || '|' || pg_temp.keys(pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) -> 'questions' -> 0)
          || '|' || pg_temp.keys(pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) -> 'questions' -> 0 -> 'options' -> 0),
  'body,id,label|exerciseId,id,options,stem|id,text', 'student_task: the keys of an exercise, a question and an option (never the correct one)');

-- ---------------------------------------------------------------------------------------------
-- What they say
-- ---------------------------------------------------------------------------------------------
select is((select string_agg(u || ':' || (pg_temp.j(u, pg_temp.q('student_home')) ->> 'interface'), ',' order by u) from unnest(array['stu_a', 'stu_b', 'stu_c']) u),
  'stu_a:gaze,stu_b:standard,stu_c:standard', 'interface comes from students.interface; voice is standard without the dictation consent');
select is(pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) ->> 'answerMode', 'gaze', 'answerMode comes from the publication: gaze');
select is(pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) -> 'aids', '{"readAloud": true}'::jsonb, 'aids: readAloud, the same for everyone');
select is(pg_temp.j('stu_b', pg_temp.q_task('t_s2_vt')) -> 'aids', '{"readAloud": true}'::jsonb, 'also for the student who types, so aids does not say who is who');
select is(jsonb_array_length(pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) -> 'exercises') || '|' || jsonb_array_length(pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) -> 'questions')
          || '|' || (pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) #>> '{questions,0,options}'),
  '2|2|' || '[{"id": "A", "text": "3"}, {"id": "B", "text": "4"}, {"id": "C", "text": "5"}]', 'the gaze task has its exercises and its questions with all the options, in order');
select is(pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) ->> 'generalInstructions', 'Instrucciones de vg', 'the instructions of the version');
select is(jsonb_array_length(pg_temp.j('stu_b', pg_temp.q_task('t_s2_vt')) -> 'questions') || '|' || (pg_temp.j('stu_b', pg_temp.q_task('t_s2_vt')) ->> 'answerMode'), '0|typed',
  'a typed task has no questions');
select is(pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) #>> '{exercises,0,body}', 'Adaptado 1', 'the exercise is the adapted text of the publication');
select is(pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) -> 'draft', '{"revision": 1, "answers": {}, "choices": {}}'::jsonb,
  'an attempt that has not started has an empty draft at revision 1');
select is(pg_temp.digest(), (select d from before_reads), 'the reads so far changed nothing (no first_viewed_at, no draft)');
select is((select first_viewed_at is null from app.assignment_attempts where id = pg_temp.id('t_s1_vg')), true, 'student_task does not stamp first_viewed_at: that is student_open_attempt');
select is((pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) ->> 'readOnly') || '|' || (pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) ->> 'late') || '|' || coalesce(pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) ->> 'submittedAt', 'null'),
  'false|false|null', 'an attempt in progress is not read only, not late and not submitted');

-- Title: the topic, or a name for the kind when it has none.
select is(pg_temp.j('stu_a', pg_temp.q('student_task_list')) #>> '{tasks,0,title}', 'Repaso', 'the title is the topic of the assessment');
update app.assessments set topic = '' where id = pg_temp.id('a_vg');
select is(pg_temp.j('stu_a', pg_temp.q('student_task_list')) #>> '{tasks,0,title}' || '|' || (pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) ->> 'title'), 'Práctico|Práctico',
  'without a topic it is Práctico');
update app.assessments set kind = 'exam' where id = pg_temp.id('a_vg');
select is(pg_temp.j('stu_a', pg_temp.q('student_task_list')) #>> '{tasks,0,title}' || '|' || (pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) ->> 'kind'), 'Prueba|exam',
  'and Prueba for an exam');
update app.assessments set topic = 'Repaso', kind = 'worksheet' where id = pg_temp.id('a_vg');

-- Dictation: it needs a consent in force on every read.
select is(pg_temp.j('stu_c', pg_temp.q_task('t_s3_vv')) ->> 'answerMode', 'typed', 'dictation without consent: the task is typed');
select pg_temp.keep('c_dict', pg_temp.as_user('teach', format('select api.record_consent(%L, ''ai_dictation'', ''2026-11'', null, null)', pg_temp.id('s3'))));
select is((pg_temp.j('stu_c', pg_temp.q('student_home')) ->> 'interface') || '|' || (pg_temp.j('stu_c', pg_temp.q_task('t_s3_vv')) ->> 'answerMode'), 'voice|voice',
  'with the consent in force: interface voice and answerMode voice');
select is((pg_temp.j('stu_a', pg_temp.q('student_home')) ->> 'interface') || '|' || (pg_temp.j('stu_b', pg_temp.q('student_home')) ->> 'interface'), 'gaze|standard',
  'the consent of s3 changes nothing for the others');
select is(pg_temp.err(pg_temp.as_user('teach', format('select api.revoke_consent(%L, 1)', pg_temp.id('c_dict')))), null, 'sanity: the teacher revokes the consent');
select is((pg_temp.j('stu_c', pg_temp.q('student_home')) ->> 'interface') || '|' || (pg_temp.j('stu_c', pg_temp.q_task('t_s3_vv')) ->> 'answerMode'), 'standard|typed',
  'revoked: back to standard and typed, on the next read');
insert into app.consents (institution_id, student_id, purpose, text_version, status, valid_from, valid_until)
  values (pg_temp.id('i_n'), pg_temp.id('s3'), 'ai_dictation', '2026-11', 'granted', clock_timestamp() - interval '2 days', clock_timestamp() - interval '1 day');
select is((pg_temp.j('stu_c', pg_temp.q('student_home')) ->> 'interface') || '|' || (pg_temp.j('stu_c', pg_temp.q_task('t_s3_vv')) ->> 'answerMode'), 'standard|typed',
  'an expired consent does not count either');

-- ---------------------------------------------------------------------------------------------
-- Status, draft, submission and grades
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.j('stu_a', pg_temp.q('student_task_list')) #>> '{tasks,0,status}', 'not_started', 'the list: not started');
select pg_temp.as_user('stu_a', pg_temp.q_start('t_s1_vg'));
select is(pg_temp.j('stu_a', pg_temp.q('student_task_list')) #>> '{tasks,0,status}', 'in_progress', 'the list: in progress once started');
select pg_temp.as_user('stu_a', pg_temp.q_save('t_s1_vg', '1', pg_temp.ans(array['x_vg1'], 'mi respuesta'), jsonb_build_object(pg_temp.id('q_vg1')::text, 'B')::text));
select is(pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) -> 'draft',
  jsonb_build_object('revision', 2, 'answers', jsonb_build_object(pg_temp.id('x_vg1')::text, jsonb_build_object('text', 'mi respuesta', 'mode', 'typed')),
                     'choices', jsonb_build_object(pg_temp.id('q_vg1')::text, 'B')),
  'the draft is what the student saved, with its revision');
select pg_temp.as_user('stu_a', pg_temp.q_submit('t_s1_vg', '2'));
select is((pg_temp.j('stu_a', pg_temp.q('student_task_list')) #>> '{tasks,0,status}') || '|' || (pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) ->> 'readOnly'), 'submitted|true',
  'submitted: the list says so and the task is read only');
select is(jsonb_typeof(pg_temp.j('stu_a', pg_temp.q_task('t_s1_vg')) -> 'submittedAt'), 'string', 'with the moment it was submitted');
select is(pg_temp.j('stu_a', pg_temp.q('student_grades')), '{"grades": []}'::jsonb, 'a submission that is not corrected has no grade to show');
select pg_temp.as_user('teach', format('select api.grade_attempt(%L, ''Muy bien'', %L::jsonb, 8, null)', pg_temp.id('t_s1_vg'),
  jsonb_build_object(pg_temp.id('x_vg1')::text, jsonb_build_object('status', 'partial', 'errors', jsonb_build_array('signo')))::text));
select is(pg_temp.j('stu_a', pg_temp.q('student_task_list')) #>> '{tasks,0,status}', 'graded', 'once corrected, the list says graded');
select is(pg_temp.keys(pg_temp.j('stu_a', pg_temp.q('student_grades'))) || '|' || pg_temp.keys(pg_temp.j('stu_a', pg_temp.q('student_grades')) -> 'grades' -> 0)
          || '|' || pg_temp.keys(pg_temp.j('stu_a', pg_temp.q('student_grades')) -> 'grades' -> 0 -> 'exercises' -> 0),
  'grades|assignmentId,attemptId,exercises,feedback,gradedAt,kind,score,subjectId,title|exerciseId,label,status', 'student_grades: its keys, and the errors of an exercise are not among them');
select is((pg_temp.j('stu_a', pg_temp.q('student_grades')) #>> '{grades,0,score}') || '|' || (pg_temp.j('stu_a', pg_temp.q('student_grades')) #>> '{grades,0,feedback}')
          || '|' || (pg_temp.j('stu_a', pg_temp.q('student_grades')) #> '{grades,0,exercises}')::text,
  '8|Muy bien|' || jsonb_build_array(jsonb_build_object('exerciseId', pg_temp.id('x_vg1'), 'label', '1', 'status', 'partial'))::text,
  'the score, the feedback and the status of each exercise the teacher marked (only those)');
select is(pg_temp.j('stu_b', pg_temp.q('student_grades')), '{"grades": []}'::jsonb, 'another student of the group sees none of it');
select is(position('signo' in pg_temp.j('stu_a', pg_temp.q('student_grades'))::text), 0, 'the error tags of the correction never reach the student');
select * from finish();
rollback;
