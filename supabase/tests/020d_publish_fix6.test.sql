-- T1.F6: closes P-1 (Codex, T1.5a). The copy of a publication is rebuilt leaf by leaf with its GraphSpec type: a leaf of
-- another type is not copied, and an option whose graph does not pass app.is_graph_spec after the projection blocks the
-- publication (CONFLICT invalid_option_graph) without creating anything. Rows are seeded as the table owner (old data that
-- got in through the RPCs before T1.F5). Placeholder text only. Rolled back.
begin;
-- Phase 1 links ordinary accounts (any email) to students; the shape guard of phase 2 (T2.5a) is off in this file. 040_f2_contract covers it.
alter table app.account_provisioning disable trigger student_auth_link_guard;
select plan(35);

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
create function pg_temp.err(p_res jsonb) returns text language sql as $$ select p_res ->> 'error' $$;

insert into ids (k, id) select k, gen_random_uuid() from unnest(array[
  'admin', 'teach', 'other', 'incl', 'userb', 'nobody', 'ghost', 'adm2', 'stu_a', 'stu_b'
]) as k;
insert into auth.users (id, email) select id, k || '@t1-f5.invalid' from ids where k <> 'ghost';
do $$
declare
  k text;
begin
  for k in select ids.k from ids where ids.k <> 'ghost' loop
    perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;

-- Institution n: admin, teachers teach (g_n) and other (go_n), inclusion; adm2 is an admin who teaches go_n. Students
-- s1 to s5 are in g_n (s1 has the account stu_a) and sx in go_n (account stu_b). Institution b: userb.
insert into ids (k, id) select 'i_n', (pg_temp.as_service($$ select api.internal_create_institution('Liceo N', 't1-f5', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, %L)', pg_temp.id('i_n'), pg_temp.id(u.k), u.role))
  from (values ('admin', 'admin'), ('teach', 'teacher'), ('other', 'teacher'), ('adm2', 'admin'), ('incl', 'inclusion')) as u(k, role);
insert into ids (k, id) values
  ('g_n', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid),
  ('go_n', (pg_temp.as_user('other', format('select api.create_group(%L, ''3.º B'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid);
select pg_temp.as_user('other', format('select api.add_group_staff(%L, %L, ''co_teacher'')', pg_temp.id('go_n'), pg_temp.id('adm2')));
insert into ids (k, id)
  select 's' || n, (pg_temp.as_user('teach', format('select api.create_student(%L, %L, %L, gen_random_uuid())', pg_temp.id('g_n'), 'Estudiante ' || n, 'est.' || n)) ->> 'id')::uuid
    from generate_series(1, 5) n;
insert into ids (k, id) values
  ('sx', (pg_temp.as_user('other', format('select api.create_student(%L, ''Estudiante X'', ''est.x'', gen_random_uuid())', pg_temp.id('go_n'))) ->> 'id')::uuid);
select pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('s1'), pg_temp.id('stu_a')));
select pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('sx'), pg_temp.id('stu_b')));
insert into ids (k, id) select 'i_b', (pg_temp.as_service($$ select api.internal_create_institution('Liceo B', 't1-5a-b', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_b'), pg_temp.id('userb')));
insert into ids (k, id) values
  ('g_b', (pg_temp.as_user('userb', format('select api.create_group(%L, ''1.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_b'))) ->> 'id')::uuid);

-- ---------------------------------------------------------------------------------------------
-- Builders: only through the RPCs, except the gaze questions and the seeds that have no RPC yet (T1.4d writes them).
-- ---------------------------------------------------------------------------------------------
create function pg_temp.mk_asm(p_user text, p_group text, p_key text, p_instr text) returns void language plpgsql as $$
begin
  perform pg_temp.keep(p_key, pg_temp.as_user(p_user, format('select api.create_assessment(%L, ''worksheet'', ''Repaso'', %L, gen_random_uuid())', pg_temp.id(p_group), p_instr)));
end $$;
create function pg_temp.mk_ex(p_user text, p_asm text, p_key text, p_body text) returns void language plpgsql as $$
begin
  perform pg_temp.keep(p_key, pg_temp.as_user(p_user, format('select api.add_exercise(%L, %L, %L, gen_random_uuid(), null)', pg_temp.id(p_asm), right(p_key, 1), p_body)));
end $$;
-- A version p of its own assessment with p_n exercises; with p_fill the adapted ones get their text (ready).
create function pg_temp.mkv(p_group text, p text, p_n integer default 1, p_mode text default 'typed', p_fill boolean default true, p_instr text default 'Instrucciones')
returns void language plpgsql as $$
declare
  i integer;
begin
  perform pg_temp.mk_asm('teach', p_group, 'a_' || p, p_instr);
  for i in 1..p_n loop
    perform pg_temp.mk_ex('teach', 'a_' || p, 'e_' || p || i, 'Enunciado ' || i);
  end loop;
  perform pg_temp.keep(p, pg_temp.as_user('teach', format($q$ select api.create_version(%L, '{"profiles":["motor"],"supports":[],"interests":["centinela-config"]}'::jsonb, %L, gen_random_uuid(), null) $q$,
    pg_temp.id('a_' || p), p_mode)));
  insert into ids (k, id) select 'x_' || p || row_number() over (order by e.position), ve.id
    from app.version_exercises ve join app.assessment_exercises e on e.id = ve.exercise_id where ve.version_id = pg_temp.id(p);
  if p_fill then
    for i in 1..p_n loop
      perform pg_temp.as_user('teach', format('select api.update_version_exercise(%L, %s, %L, gen_random_uuid())', pg_temp.id('x_' || p || i),
        (select revision from app.version_exercises where id = pg_temp.id('x_' || p || i)), 'Adaptado ' || i));
    end loop;
  end if;
end $$;
-- A question (options A, B, C) in each of the first p_n adapted exercises, with its correct option B.
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
create function pg_temp.recip(p_ver text, p_students text[]) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format('select api.set_version_recipients(%L, %s, array[%s]::uuid[], gen_random_uuid())', pg_temp.id(p_ver), pg_temp.rev(p_ver),
    coalesce((select string_agg(quote_literal(pg_temp.id(s)), ',') from unnest(p_students) s), '')))
$$;
create function pg_temp.apv(p_ver text) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format('select api.approve_version(%L, %s, gen_random_uuid())', pg_temp.id(p_ver), pg_temp.rev(p_ver)))
$$;
-- The content of a key for a version: an answer for each adapted exercise and the correct option of each question.
create function pg_temp.kc(p_ver text) returns text language sql as $$
  select jsonb_build_object(
    'exercises', coalesce((select jsonb_object_agg(ve.id::text, jsonb_build_object('answer', 'Respuesta')) from app.version_exercises ve where ve.version_id = pg_temp.id(p_ver)), '{}'::jsonb),
    'questions', coalesce((select jsonb_object_agg(k.question_id::text, k.correct_option_id) from app.question_keys k where k.version_id = pg_temp.id(p_ver)), '{}'::jsonb))::text
$$;
create function pg_temp.curid(p_ver text) returns uuid language sql as $$ select k.current_revision_id from app.answer_keys k where k.version_id = pg_temp.id(p_ver) $$;
create function pg_temp.cur(p_ver text) returns text language sql as $$ select coalesce(quote_literal(pg_temp.curid(p_ver)), 'null') $$;
create function pg_temp.ek(p_ver text) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format('select api.edit_answer_key(%L, %L::jsonb, %s)', pg_temp.id(p_ver), pg_temp.kc(p_ver), pg_temp.cur(p_ver)))
$$;
create function pg_temp.ck(p_ver text) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format('select api.confirm_answer_key(%L, %s)', pg_temp.id(p_ver), pg_temp.cur(p_ver)))
$$;
create function pg_temp.ak(p_ver text) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format('select api.approve_answer_key(%L, %s)', pg_temp.id(p_ver), pg_temp.cur(p_ver)))
$$;
-- A ready, approved version: p_n exercises, gaze with a question each and its key, the recipients and the approval.
create function pg_temp.ready(p text, p_n integer, p_mode text, p_students text[]) returns void language plpgsql as $$
begin
  perform pg_temp.mkv('g_n', p, p_n, p_mode);
  if p_mode = 'gaze' then
    perform pg_temp.gazeq(p, p_n);
    perform pg_temp.ek(p);
  end if;
  perform pg_temp.recip(p, p_students);
  perform pg_temp.apv(p);
end $$;
create function pg_temp.consent(p_student text) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format('select api.record_consent(%L, ''ai_adaptation'', ''2026-11'', null, null)', pg_temp.id(p_student)))
$$;
-- A generation of the version (the profiles went to the AI): the consent is now required.
create function pg_temp.gen(p_ver text) returns jsonb language sql as $$
  select pg_temp.as_service(format('select api.internal_create_generation(%L, ''answer_key'', gen_random_uuid(), ''{}''::jsonb, repeat(''a'', 64), ''r1'', ''p1'', 1, null, null)', pg_temp.id(p_ver)))
$$;
-- A teacher-side edit of an adapted exercise of the version.
create function pg_temp.edit_ex(p_x text, p_body text) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format('select api.update_version_exercise(%L, %s, %L, gen_random_uuid())', pg_temp.id(p_x),
    (select revision from app.version_exercises where id = pg_temp.id(p_x)), p_body))
$$;
create function pg_temp.edit_instr(p_ver text, p_text text) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format('select api.update_version_instructions(%L, %s, %L, gen_random_uuid())', pg_temp.id(p_ver),
    (select instructions_revision from app.versions where id = pg_temp.id(p_ver)), p_text))
$$;

-- The call under test: the revision defaults to the current one; the op and the key are SQL.
create function pg_temp.pub(p_ver text, p_op text default 'gen_random_uuid()', p_key text default 'null', p_rev text default null, p_user text default 'teach') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.publish_version(%L, %s, %s, %s)', pg_temp.id(p_ver), coalesce(p_rev, pg_temp.rev(p_ver)), p_op, p_key))
$$;
create function pg_temp.keepp(p_key text, p_res jsonb) returns jsonb language plpgsql as $$
begin
  insert into ids (k, id) values (p_key, (p_res ->> 'publicationId')::uuid);
  return p_res;
end $$;
-- The attempt in force of a student: "number|status|is the publication p|has the key of p|revision".
create function pg_temp.att(p_student text, p_pub text) returns text language sql as $$
  select concat_ws('|', t.number, t.status, t.publication_id = pg_temp.id(p_pub), t.answer_key_revision_id is not distinct from p.answer_key_revision_id, t.revision)
    from app.assignment_attempts t
    join app.assignments a on a.id = t.assignment_id
    join app.publications p on p.id = pg_temp.id(p_pub)
   where a.student_id = pg_temp.id(p_student) and t.superseded_at is null and a.assessment_id = p.assessment_id
$$;
-- Everything publishing can change, as one string.
create function pg_temp.digest() returns text language sql as $$
  select md5(coalesce((select string_agg(concat_ws('|', p.id, p.op_key, p.withdrawn_at), ';' order by p.id) from app.publications p where p.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', a.id, a.status, a.revision), ';' order by a.id) from app.assignments a where a.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', t.id, t.publication_id, t.answer_key_revision_id, t.status, t.revision, t.superseded_at), ';' order by t.id)
                         from app.assignment_attempts t where t.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', v.id, v.revision, v.approved_revision, v.status, v.stale), ';' order by v.id) from app.versions v where v.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', k.id, k.current_revision_id, k.revision), ';' order by k.id) from app.answer_keys k where k.institution_id = pg_temp.id('i_n')), '')
          || (select count(*) from app.audit_log l where l.institution_id = pg_temp.id('i_n'))::text
          || (select count(*) from app.version_events e where e.institution_id = pg_temp.id('i_n'))::text)
$$;
-- A refused call: its error and whether it changed anything (the digest before and after the call).
create function pg_temp.pe(p_ver text, p_op text default 'gen_random_uuid()', p_key text default 'null', p_rev text default null, p_user text default 'teach') returns text language plpgsql as $$
declare
  v_before text := pg_temp.digest();
  v_err text;
begin
  v_err := pg_temp.err(pg_temp.pub(p_ver, p_op, p_key, p_rev, p_user));
  return coalesce(v_err, 'ok') || ' changed=' || (v_before <> pg_temp.digest())::text;
end $$;

-- A ready gaze version with one question; the options are then overwritten as the owner.
select pg_temp.mkv('g_n', 'vd', 1, 'gaze');
select pg_temp.gazeq('vd', 1);
select pg_temp.ek('vd');
select pg_temp.recip('vd', array['s1']);
select pg_temp.apv('vd');
create function pg_temp.setg(p_graph text) returns void language sql as $$
  update app.version_questions q set options = format('[{"id":"A","text":"Uno","graph":%s},{"id":"B","text":"Dos"}]', p_graph)::jsonb
   where q.id = pg_temp.id('q_vd1')
$$;
-- Refused graphs: is_graph_spec says no, publishing says invalid_option_graph and creates nothing.
create function pg_temp.bad(p_graph text) returns text language plpgsql as $$
begin
  perform pg_temp.setg(p_graph);
  return app.is_graph_spec(p_graph::jsonb)::text || ' ' || pg_temp.pe('vd');
end $$;

select is(pg_temp.bad(g), 'false P0001 CONFLICT invalid_option_graph changed=false', d)
  from (values
    ('{"functions":[{"expr":{"correctOptionId":"B"}}],"points":[]}', 'the exact case of Codex: an object in expr'),
    ('{"functions":[{"expr":7}],"points":[]}', 'a number in expr'),
    ('{"functions":[{"expr":null}],"points":[]}', 'a null in expr'),
    ('{"functions":[{}],"points":[]}', 'a function without expr'),
    ('{"functions":[{"expr":"x","label":{"a":1}}],"points":[]}', 'an object in the label of a function'),
    ('{"functions":[{"expr":"x","label":["a"]}],"points":[]}', 'a list in the label of a function'),
    ('{"functions":[{"expr":"x","label":null}],"points":[]}', 'a null label'),
    ('{"functions":[],"points":[{"x":{"a":1},"y":0}]}', 'an object in x'),
    ('{"functions":[],"points":[{"x":0,"y":{"a":[1]}}]}', 'an object in y'),
    ('{"functions":[],"points":[{"x":"1","y":0}]}', 'a string in x'),
    ('{"functions":[],"points":[{"x":0,"y":0,"label":{"a":1}}]}', 'an object in the label of a point'),
    ('{"functions":[],"points":[{"x":1e400,"y":0}]}', 'a number that is not a finite double'),
    ('{"functions":[],"points":[],"window":{"xMin":{"a":1},"xMax":1,"yMin":0,"yMax":1}}', 'an object in a limit of the window'),
    ('{"functions":[],"points":[],"window":{"xMin":0,"xMax":"1","yMin":0,"yMax":1}}', 'a string in a limit of the window'),
    ('{"functions":[],"points":[],"window":{"xMin":0,"xMax":1,"yMin":0}}', 'a window without a limit'),
    ('{"functions":[],"points":[],"window":[1]}', 'a window that is a list'),
    ('{"functions":[],"points":[],"window":null}', 'a window that is null'),
    ('{"functions":[["x",{"a":1}]],"points":[]}', 'a list with objects inside as a function'),
    ('{"functions":["x"],"points":[]}', 'a string as a function'),
    ('{"functions":[],"points":[[1,2],{"x":1,"y":1}]}', 'a list as a point'),
    ('{"functions":{"expr":"x"},"points":[]}', 'functions that is not a list'),
    ('{"functions":[{"expr":"x"},{"expr":"x"},{"expr":"x"},{"expr":"x"},{"expr":"x"},{"expr":"x"}],"points":[]}', 'six functions are not cut to five'),
    ('{"functions":[],"points":[{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0}]}', 'twenty-one points are not cut to twenty'),
    ('{"points":[]}', 'a graph without functions'),
    ('{"functions":[]}', 'a graph without points'),
    ('[]', 'a graph that is a list'),
    ('null', 'a graph that is null')
  ) as t(g, d);

-- The projection never copies a subtree and keeps the type of every leaf: a wrong leaf comes out as JSON null.
select is(app.project_graph('{"functions":[{"expr":{"correctOptionId":"B"}}],"points":[]}'::jsonb) -> 'functions' -> 0 -> 'expr', 'null'::jsonb, 'the projection of the case of Codex has null in expr');
select is(app.project_graph('{"functions":[{"expr":{"correctOptionId":"B"}}],"points":[]}'::jsonb)::text !~ 'correctOptionId', true, 'and correctOptionId is nowhere in it');
select is(app.project_graph('{"functions":[{"expr":"x","label":{"a":1}}],"points":[{"x":{"a":1},"y":[1],"label":{"a":1}}],"window":{"xMin":{"a":1},"xMax":1,"yMin":0,"yMax":1}}'::jsonb),
  '{"functions":[{"expr":"x","label":null}],"points":[{"x":null,"y":null,"label":null}],"window":{"xMin":null,"xMax":1,"yMin":0,"yMax":1}}'::jsonb, 'every wrong leaf is null and the right ones are kept');
select is(app.project_graph('{"functions":[{"expr":"x","label":"f","extra":1}],"points":[{"x":1,"y":2,"label":"p","extra":{"a":1}}],"window":{"xMin":0,"xMax":1,"yMin":0,"yMax":1,"extra":2},"extra":3}'::jsonb),
  '{"functions":[{"expr":"x","label":"f"}],"points":[{"x":1,"y":2,"label":"p"}],"window":{"xMin":0,"xMax":1,"yMin":0,"yMax":1}}'::jsonb, 'a valid graph with extra keys keeps its leaves and loses the extra keys');
select is((select bool_and(jsonb_typeof(x) = 'string') from jsonb_path_query(app.project_graph('{"functions":[{"expr":"x","label":"f"}],"points":[{"x":1,"y":2,"label":"p"}]}'::jsonb), '$.functions[*].*') x), true, 'string leaves stay strings');
select is((select bool_and(jsonb_typeof(x) = 'number') from jsonb_path_query(app.project_graph('{"functions":[],"points":[{"x":1,"y":2.5}],"window":{"xMin":0,"xMax":1,"yMin":0,"yMax":1}}'::jsonb), '$.** ? (@.type() != "object" && @.type() != "array")') x), true, 'number leaves stay numbers');

-- A valid graph is copied identical and the publication goes through.
select pg_temp.setg('{"functions":[{"expr":"x^2 - 2*x","label":"f"}],"points":[{"x":0,"y":0,"label":"raíz"},{"x":2.5,"y":0}],"window":{"xMin":-1,"xMax":3,"yMin":-2,"yMax":2}}');
select is(pg_temp.err(pg_temp.pub('vd')), null, 'a valid graph publishes');
select is((select p.content -> 'questions' -> 0 -> 'options' -> 0 -> 'graph' from app.publications p where p.version_id = pg_temp.id('vd')),
  '{"functions":[{"expr":"x^2 - 2*x","label":"f"}],"points":[{"x":0,"y":0,"label":"raíz"},{"x":2.5,"y":0}],"window":{"xMin":-1,"xMax":3,"yMin":-2,"yMax":2}}'::jsonb, 'and it is copied identical');

select * from finish();
rollback;
