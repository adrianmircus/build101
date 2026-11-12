-- T1.F8 (F1-2): student_save_draft validates the graph of an answer with app.is_graph_spec and student_task projects with
-- app.project_graph and validates the projection, both through helpers tiza_student may run by name. Regressions for the nulls the
-- old check accepted. Placeholder text only. The whole file is rolled back.
begin;
-- Phase 1 links ordinary accounts (any email) to students; the shape guard of phase 2 (T2.5a) is off in this file. 040_f2_contract covers it.
alter table app.account_provisioning disable trigger student_auth_link_guard;
select plan(21);

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
insert into auth.users (id, email) select id, k || '@t1-f7c.invalid' from ids where k <> 'ghost';
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
-- The profiles decide how each one answers: motor looks, dysgraphia dictates, dyslexia types.
select pg_temp.as_user('teach', format('select api.set_student_needs(%L, %L::text[], array[]::text[], array[]::text[], gen_random_uuid(), null, null)', pg_temp.id(n.s), n.p))
  from (values ('s1', array['motor']), ('s2', array['dyslexia']), ('s3', array['dysgraphia'])) as n(s, p);

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

create function pg_temp.opts(p_attempt text) returns jsonb language sql as $$
  select pg_temp.j('stu_a', pg_temp.q_task(p_attempt)) #> '{questions,0,options}' $$;
create function pg_temp.draft(p_attempt text) returns jsonb language sql as $$
  select pg_temp.j('stu_a', pg_temp.q_task(p_attempt)) -> 'draft' $$;
select pg_temp.as_user('stu_a', pg_temp.q_start('t_s1_vg'));

-- ---------------------------------------------------------------------------------------------
-- The helpers: tiza_student runs them by name, and only pure ones
-- ---------------------------------------------------------------------------------------------
select is((select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) from pg_proc p
            where p.pronamespace = 'app'::regnamespace and p.proname in
              ('js_length', 'is_js_number', 'is_optional_text', 'is_graph_spec', 'leaf_text', 'leaf_number', 'leaf_optional_text', 'project_graph')
              and has_function_privilege('tiza_student', p.oid, 'execute') and not p.prosecdef and p.provolatile = 'i'),
  array['app.is_graph_spec(jsonb)', 'app.is_js_number(jsonb)', 'app.is_optional_text(jsonb,text,integer)', 'app.js_length(text)',
        'app.leaf_number(jsonb)', 'app.leaf_optional_text(jsonb,text,integer)', 'app.leaf_text(jsonb,integer)', 'app.project_graph(jsonb)'],
  'tiza_student can execute the eight graph helpers, each SECURITY INVOKER and IMMUTABLE');
select is((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in
            ('is_question_option', 'is_strict_option_list', 'project_option', 'publication_content', 'is_option_list', 'is_answer_key_content')
            and has_function_privilege('tiza_student', p.oid, 'execute')), 0::bigint,
  'and nothing around them: the validators of the teacher side and the publication builder stay closed to the student role');
-- The role runs them for real: two student-style RPCs made here (rolled back), one that uses the helpers and one that reaches for another app function.
select app.begin_student_rpc_change();
create function api.student_zz_helpers() returns jsonb language plpgsql security definer set search_path = '' as $f$
begin
  return jsonb_build_object('ok', app.is_graph_spec('{"functions":[],"points":[]}'::jsonb),
    'bad', app.is_graph_spec('{"functions":null,"points":null}'::jsonb),
    'p', app.project_graph('{"functions":[{"expr":"x"}],"points":[]}'::jsonb));
end
$f$;
create function api.student_zz_closed() returns jsonb language plpgsql security definer set search_path = '' as $f$
begin
  return to_jsonb(app.publication_content(gen_random_uuid()));
end
$f$;
grant execute on function api.student_zz_helpers(), api.student_zz_closed() to authenticated;
select app.end_student_rpc_change();
select is(pg_temp.as_user('stu_a', 'select api.student_zz_helpers()'),
  '{"ok":true,"bad":false,"p":{"functions":[{"expr":"x"}],"points":[]}}'::jsonb, 'the role really runs them');
select is(left(pg_temp.as_user('stu_a', 'select api.student_zz_closed()') ->> 'error', 5), '42501', 'while another app function is still 42501');

-- ---------------------------------------------------------------------------------------------
-- Saving: the nulls the old check accepted (projection = original) are refused, leaf by leaf
-- ---------------------------------------------------------------------------------------------
create function pg_temp.save(p_rev text, p_graph text) returns text language sql as $$
  select pg_temp.refused('stu_a', pg_temp.q_save('t_s1_vg', p_rev,
    format('{"%s":{"text":"a","mode":"typed","graph":%s}}', pg_temp.id('x_vg1'), p_graph), '{}')) $$;
select is(pg_temp.save('1', '{"functions":[{"expr":null}],"points":[]}'), 'INVALID invalid_answers changed=false', 'a null expr in a function is refused (the case of the review)');
select is(pg_temp.save('1', '{"functions":null,"points":null}'), 'INVALID invalid_answers changed=false', 'null lists are refused (the other case of the review)');
select is(pg_temp.save('1', '{"functions":[],"points":null}'), 'INVALID invalid_answers changed=false', 'a null list of points');
select is(pg_temp.save('1', '{"functions":null,"points":[]}'), 'INVALID invalid_answers changed=false', 'a null list of functions');
select is(pg_temp.save('1', '{"functions":[null],"points":[]}'), 'INVALID invalid_answers changed=false', 'a null element of the functions');
select is(pg_temp.save('1', '{"functions":[],"points":[null]}'), 'INVALID invalid_answers changed=false', 'a null element of the points');
select is(pg_temp.save('1', '{"functions":[{"expr":"x","label":null}],"points":[]}'), 'INVALID invalid_answers changed=false', 'a null label of a function');
select is(pg_temp.save('1', '{"functions":[],"points":[{"x":null,"y":1}]}'), 'INVALID invalid_answers changed=false', 'a null coordinate');
select is(pg_temp.save('1', '{"functions":[],"points":[{"x":1,"y":2,"label":null}]}'), 'INVALID invalid_answers changed=false', 'a null label of a point');
select is(pg_temp.save('1', '{"functions":[],"points":[],"window":null}'), 'INVALID invalid_answers changed=false', 'a null window');
select is(pg_temp.save('1', '{"functions":[],"points":[],"window":{"xMin":null,"xMax":1,"yMin":0,"yMax":1}}'), 'INVALID invalid_answers changed=false', 'a null limit of the window');
select is(pg_temp.save('1', '{"functions":[],"points":[]}'), 'ok changed=true', 'while the smallest complete graph is saved');
select is(pg_temp.draft('t_s1_vg') #> array['answers', pg_temp.id('x_vg1')::text, 'graph'], '{"functions":[],"points":[]}'::jsonb, 'and read back identical');

-- ---------------------------------------------------------------------------------------------
-- Reading: a publication and a draft written before, with the same nulls, come out without the graph (the option and the answer stay)
-- ---------------------------------------------------------------------------------------------
alter table app.publications disable trigger publications_guard;
update app.publications p set content = jsonb_set(p.content, '{questions,0,options}', jsonb_build_array(
    jsonb_build_object('id', 'A', 'text', '3', 'graph', '{"functions":[{"expr":null}],"points":[]}'::jsonb),
    jsonb_build_object('id', 'B', 'text', '4', 'graph', '{"functions":null,"points":null}'::jsonb),
    jsonb_build_object('id', 'C', 'text', '5', 'graph', '{"functions":[],"points":[{"x":1,"y":null}],"window":null}'::jsonb),
    jsonb_build_object('id', 'D', 'text', '6', 'graph', '{"functions":[{"expr":"x"}],"points":[],"window":{"xMin":0,"xMax":1,"yMin":0,"yMax":1}}'::jsonb)))
  where p.id = pg_temp.id('p_vg');
alter table app.publications enable trigger publications_guard;
select is(pg_temp.opts('t_s1_vg'), '[{"id":"A","text":"3"},{"id":"B","text":"4"},{"id":"C","text":"5"},{"id":"D","text":"6","graph":{"functions":[{"expr":"x"}],"points":[],"window":{"xMin":0,"xMax":1,"yMin":0,"yMax":1}}}]'::jsonb,
  'options with null leaves, null lists or a null window come out without a graph; the valid one is delivered whole');

update app.submissions s set answers = jsonb_build_object(
    pg_temp.id('x_vg1')::text, '{"text":"a","mode":"typed","graph":{"functions":[{"expr":null}],"points":[]}}'::jsonb,
    pg_temp.id('x_vg2')::text, '{"text":"b","mode":"typed","graph":{"functions":null,"points":null}}'::jsonb)
  where s.attempt_id = pg_temp.id('t_s1_vg');
select is(pg_temp.draft('t_s1_vg') -> 'answers', jsonb_build_object(
    pg_temp.id('x_vg1')::text, '{"text":"a","mode":"typed"}'::jsonb,
    pg_temp.id('x_vg2')::text, '{"text":"b","mode":"typed"}'::jsonb), 'the same in a draft: the answers stay, without the graph');
select is(pg_temp.draft('t_s1_vg')::text ~ 'null', false, 'and no null reaches the student');

-- What both sides agree on: what student_task delivers is always what app.is_graph_spec accepts, so what was saved can be read.
select is((select bool_and(app.is_graph_spec(o -> 'graph')) from jsonb_array_elements(pg_temp.opts('t_s1_vg')) o where o ? 'graph'), true,
  'every graph that is delivered passes app.is_graph_spec');

select * from finish();
rollback;
