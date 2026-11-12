-- T1.F5: fixes from Codex's review of T1.5a, in pgTAP. P-1: the options of a question cannot carry anything nested in
-- `graph` that GraphSpec does not allow, neither by the teacher's edit nor in an output of the AI (discarded), and even if
-- a row seeded as the table owner has it, the publication projects the options and does not copy it. P-2: read aloud is
-- on in every publication, with and without dyslexia. P-3: the first publication makes the assessment 'published'.
-- The lock order and the races are in tests/integration/races/publish*.test.ts. Placeholder text only. Rolled back.
begin;
select plan(61);

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
insert into auth.users (id, email) select id, k || '@t1-f5.invalid' from ids where k <> 'ghost' and k not like 'stu\_%';
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
select pg_temp.link_student(pg_temp.id('s1'), pg_temp.id('stu_a'));
select pg_temp.link_student(pg_temp.id('sx'), pg_temp.id('stu_b'));
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

-- ---------------------------------------------------------------------------------------------
-- Builders of this file
-- ---------------------------------------------------------------------------------------------
-- Edit the options of a question of the version as the teacher, with the revision of today.
create function pg_temp.uvq(p_q text, p_options text) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format('select api.update_version_question(%L, %s, ''Pregunta'', %L::jsonb, gen_random_uuid())', pg_temp.id(p_q),
    (select q.revision from app.version_questions q where q.id = pg_temp.id(p_q)), p_options))
$$;
-- Two options, the first with the graph given (a jsonb literal).
create function pg_temp.og(p_graph text) returns text language sql as $$
  select format('[{"id":"A","text":"Uno","graph":%s},{"id":"B","text":"Dos"}]', p_graph)
$$;
-- A version with one exercise (gaze) and a generation of the AI that answers p_out as its gaze questions: what was decided.
create function pg_temp.ai(p_key text, p_out text) returns text language plpgsql as $$
begin
  perform pg_temp.mkv('g_n', p_key, 1, 'gaze', false);
  perform pg_temp.keep('g_' || p_key, pg_temp.as_service(format('select api.internal_create_generation(%L, ''version'', gen_random_uuid(), ''{}''::jsonb, repeat(''a'', 64), ''r1'', ''p1'', 2, null, null)', pg_temp.id(p_key))));
  return pg_temp.as_service(format('select api.internal_record_generation_output(%L, ''gaze_questions'', %L::jsonb, %L)', pg_temp.id('g_' || p_key), p_out, pg_temp.id('x_' || p_key || '1'))) ->> 'outcome';
end $$;
create function pg_temp.qout(p_graph text) returns text language sql as $$
  select format('{"questions":[{"stem":"Elegí el gráfico","options":[{"id":"A","text":"Uno","graph":%s},{"id":"B","text":"Dos"}]}]}', p_graph)
$$;
create function pg_temp.opts_of(p_ver text) returns jsonb language sql as $$
  select q.options from app.version_questions q where q.version_id = pg_temp.id(p_ver) order by q.position, q.id limit 1
$$;

-- ---------------------------------------------------------------------------------------------
-- P-1 (a): the edit. Everything GraphSpec does not allow is INVALID invalid_options, and nothing changes.
-- ---------------------------------------------------------------------------------------------
select pg_temp.mkv('g_n', 'ved', 1, 'gaze');
select pg_temp.gazeq('ved', 1);
create temp table before_opts as select pg_temp.opts_of('ved') as o;
select is(pg_temp.uvq('q_ved1', pg_temp.og('{"functions":[],"points":[],"correctOptionId":"B"}')) ->> 'error', 'P0001 INVALID invalid_options', 'a key outside GraphSpec in graph (correctOptionId) is refused');
select is(pg_temp.uvq('q_ved1', pg_temp.og(format('{"functions":[],"points":[],"recipients":["%s"]}', gen_random_uuid()))) ->> 'error', 'P0001 INVALID invalid_options', 'and a list of recipients too');
select is(pg_temp.uvq('q_ved1', pg_temp.og('{"correctOptionId":"B","functions":[],"recipients":["x"]}')) ->> 'error', 'P0001 INVALID invalid_options', 'the case of the review: functions empty, no points, two keys of the world outside');
select is(pg_temp.uvq('q_ved1', pg_temp.og('{"functions":[{"expr":"x","correct":true}],"points":[]}')) ->> 'error', 'P0001 INVALID invalid_options', 'an extra key in a function');
select is(pg_temp.uvq('q_ved1', pg_temp.og('{"functions":[],"points":[{"x":1,"y":2,"profile":"adhd"}]}')) ->> 'error', 'P0001 INVALID invalid_options', 'in a point');
select is(pg_temp.uvq('q_ved1', pg_temp.og('{"functions":[],"points":[],"window":{"xMin":0,"xMax":1,"yMin":0,"yMax":1,"note":"a"}}')) ->> 'error', 'P0001 INVALID invalid_options', 'in the window');
select is(pg_temp.uvq('q_ved1', pg_temp.og('{"functions":[],"points":[],"window":{"xMin":0,"xMax":1,"yMin":0}}')) ->> 'error', 'P0001 INVALID invalid_options', 'a window with a number missing');
select is(pg_temp.uvq('q_ved1', pg_temp.og('{"functions":[],"points":[{"x":"1","y":2}]}')) ->> 'error', 'P0001 INVALID invalid_options', 'a coordinate that is not a number');
select is(pg_temp.uvq('q_ved1', pg_temp.og('{"functions":[],"points":[{"x":1e400,"y":2}]}')) ->> 'error', 'P0001 INVALID invalid_options', 'or one that is not a finite double (JavaScript would read Infinity)');
select is(pg_temp.uvq('q_ved1', pg_temp.og('{"points":[]}')) ->> 'error', 'P0001 INVALID invalid_options', 'a graph without functions');
select is(pg_temp.uvq('q_ved1', pg_temp.og('{"functions":[]}')) ->> 'error', 'P0001 INVALID invalid_options', 'without points');
select is(pg_temp.uvq('q_ved1', pg_temp.og('[]')) ->> 'error', 'P0001 INVALID invalid_options', 'a graph that is a list');
select is(pg_temp.uvq('q_ved1', pg_temp.og('null')) ->> 'error', 'P0001 INVALID invalid_options', 'or a JSON null');
select is(pg_temp.uvq('q_ved1', pg_temp.og(format('{"functions":[%s],"points":[]}', (select string_agg('{"expr":"x"}', ',') from generate_series(1, 6))))) ->> 'error', 'P0001 INVALID invalid_options', 'six functions (the limit is five)');
select is(pg_temp.uvq('q_ved1', pg_temp.og(format('{"functions":[],"points":[%s]}', (select string_agg('{"x":1,"y":1}', ',') from generate_series(1, 21))))) ->> 'error', 'P0001 INVALID invalid_options', 'twenty-one points (the limit is twenty)');
select is(pg_temp.uvq('q_ved1', pg_temp.og(format('{"functions":[{"expr":"%s"}],"points":[]}', repeat('x', 201)))) ->> 'error', 'P0001 INVALID invalid_options', 'an expression of 201 characters');
select is(pg_temp.uvq('q_ved1', pg_temp.og(format('{"functions":[{"expr":"x","label":"%s"}],"points":[]}', repeat('l', 61)))) ->> 'error', 'P0001 INVALID invalid_options', 'a label of 61 characters');
select is(pg_temp.uvq('q_ved1', pg_temp.og('{"functions":[{"expr":"x","label":null}],"points":[]}')) ->> 'error', 'P0001 INVALID invalid_options', 'a null label (zod does not accept it)');
select is(pg_temp.uvq('q_ved1', format('[{"id":"A","text":"%s"},{"id":"B","text":"Dos"}]', repeat('😀', 2001))) ->> 'error', 'P0001 INVALID invalid_options', 'a text counted by code points, as zod does: 2001 emojis are 2001 characters, over the limit of 2000');
select is((select o from before_opts) = pg_temp.opts_of('ved'), true, 'no refusal changed the options of the question');
select is(pg_temp.uvq('q_ved1', format('[{"id":"A","text":"%s"},{"id":"B","text":"Dos"}]', repeat('😀', 2000))) ->> 'error', null, 'but 2000 emojis, which are exactly 2000 characters, are accepted');
select is(pg_temp.uvq('q_ved1', pg_temp.og('{"functions":[{"expr":"x^2 - 2*x","label":"f"}],"points":[{"x":0,"y":0,"label":"raíz"},{"x":2,"y":0}],"window":{"xMin":-1,"xMax":3,"yMin":-2,"yMax":2}}')) ->> 'error', null,
  'a complete valid graph is accepted');
select is(pg_temp.opts_of('ved') -> 0 -> 'graph' -> 'window', '{"xMin":-1,"xMax":3,"yMin":-2,"yMax":2}'::jsonb, 'and stored');

-- ---------------------------------------------------------------------------------------------
-- P-1 (a): the output of the AI. What GraphSpec does not allow is discarded, nothing is written, a valid graph is applied.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.ai('ai1', pg_temp.qout('{"functions":[],"points":[],"correctOptionId":"B","recipients":["x"]}')), 'discarded', 'the output of the AI with forbidden keys in the graph is discarded');
select is((select count(*) from app.version_questions q where q.version_id = pg_temp.id('ai1')), 0::bigint, 'and no question was written');
select is((select o.outcome from app.generation_outputs o where o.generation_id = pg_temp.id('g_ai1')), 'discarded', 'the output is stored as discarded');
select is(pg_temp.ai('ai2', pg_temp.qout('{"functions":[{"expr":"x","secret":1}],"points":[]}')), 'discarded', 'an extra key in a function of the AI is discarded');
select is(pg_temp.ai('ai3', pg_temp.qout('{"functions":[],"points":[],"window":{"xMin":0,"xMax":1,"yMin":0,"yMax":1,"z":1}}')), 'discarded', 'in the window too');
select is(pg_temp.ai('ai4', pg_temp.qout('{"functions":[]}')), 'discarded', 'a graph without points');
select is(pg_temp.ai('ai5', pg_temp.qout('{"functions":[],"points":[{"x":"a","y":1}]}')), 'discarded', 'a coordinate that is not a number');
select is(pg_temp.ai('ai6', pg_temp.qout('null')), 'discarded', 'a graph that is a JSON null');
select is(pg_temp.ai('ai7', pg_temp.qout('{"functions":[{"expr":"x^2","label":"f"}],"points":[{"x":0,"y":0}]}')), 'applied', 'a valid graph is applied');
select is(pg_temp.opts_of('ai7') -> 0 -> 'graph', '{"functions":[{"expr":"x^2","label":"f"}],"points":[{"x":0,"y":0}]}'::jsonb, 'and stored as it came');

-- ---------------------------------------------------------------------------------------------
-- P-1 (b): the projection. A row seeded as the owner with everything nested is not copied.
-- ---------------------------------------------------------------------------------------------
select pg_temp.mkv('g_n', 'vs', 2, 'gaze');
select pg_temp.gazeq('vs', 2);
update app.version_questions q set options = jsonb_build_array(
    jsonb_build_object('id', 'A', 'text', 'Uno', 'correct', true, 'graph', jsonb_build_object(
      'functions', jsonb_build_array(jsonb_build_object('expr', 'x', 'label', 'f', 'secret', 1)),
      'points', jsonb_build_array(jsonb_build_object('x', 1, 'y', 2, 'label', 'p', 'profile', 'adhd')),
      'window', jsonb_build_object('xMin', 0, 'xMax', 1, 'yMin', 0, 'yMax', 1, 'note', 'n'),
      'correctOptionId', 'B', 'recipients', jsonb_build_array(pg_temp.id('s1')))),
    jsonb_build_object('id', 'B', 'text', 'Dos', 'recipients', jsonb_build_array(pg_temp.id('s1'))))
  where q.id = pg_temp.id('q_vs1');
select is((select jsonb_array_length(q.options) from app.version_questions q where q.id = pg_temp.id('q_vs1')), 2, 'sanity: the owner seeded dirty options in the first question');
select pg_temp.ek('vs');
select pg_temp.recip('vs', array['s1']);
select pg_temp.apv('vs');
select is(pg_temp.err(pg_temp.pub('vs')), null, 'a version with those options publishes');
select is((select p.content -> 'questions' -> 0 -> 'options' from app.publications p where p.version_id = pg_temp.id('vs')),
  '[{"id":"A","text":"Uno","graph":{"functions":[{"expr":"x","label":"f"}],"points":[{"x":1,"y":2,"label":"p"}],"window":{"xMin":0,"xMax":1,"yMin":0,"yMax":1}}},{"id":"B","text":"Dos"}]'::jsonb,
  'the copy has the projection: id, text and the graph with its allowed keys, and nothing else');
select is((select p.content::text !~ '(secret|profile|note|correct|recipients)' from app.publications p where p.version_id = pg_temp.id('vs')), true, 'and no forbidden key survives anywhere in the copy');
select is((select string_agg(k, ',' order by k) from (select jsonb_object_keys(p.content -> 'questions' -> 0 -> 'options' -> 0 -> 'graph') k from app.publications p where p.version_id = pg_temp.id('vs')) t), 'functions,points,window', 'the graph has exactly its three keys');
-- A valid graph passes through the projection intact.
select pg_temp.mkv('g_n', 'vk', 1, 'gaze');
select pg_temp.gazeq('vk', 1);
select pg_temp.uvq('q_vk1', pg_temp.og('{"functions":[{"expr":"x^2 - 2*x","label":"f"}],"points":[{"x":0,"y":0,"label":"raíz"},{"x":2,"y":0}],"window":{"xMin":-1,"xMax":3,"yMin":-2,"yMax":2}}'));
select pg_temp.as_user('teach', format('select api.set_question_key(%L, ''B'', null)', pg_temp.id('q_vk1')));
select pg_temp.ek('vk');
select pg_temp.recip('vk', array['s2']);
select pg_temp.apv('vk');
select is(pg_temp.err(pg_temp.pub('vk')), null, 'sanity: the version with a valid graph publishes');
select is((select p.content -> 'questions' -> 0 -> 'options' -> 0 -> 'graph' from app.publications p where p.version_id = pg_temp.id('vk')),
  '{"functions":[{"expr":"x^2 - 2*x","label":"f"}],"points":[{"x":0,"y":0,"label":"raíz"},{"x":2,"y":0}],"window":{"xMin":-1,"xMax":3,"yMin":-2,"yMax":2}}'::jsonb, 'a valid graph is copied intact');

-- ---------------------------------------------------------------------------------------------
-- P-2: read aloud is on in every publication, with and without dyslexia, in any mode.
-- ---------------------------------------------------------------------------------------------
create function pg_temp.aid(p text, p_profiles text) returns jsonb language plpgsql as $$
begin
  perform pg_temp.mkv('g_n', p, 1);
  perform pg_temp.as_user('teach', format($q$ select api.update_version_config(%L, %s, '{"profiles":%s,"supports":[],"interests":[]}'::jsonb, 'typed') $q$, pg_temp.id(p), pg_temp.rev(p), p_profiles));
  perform pg_temp.edit_ex('x_' || p || '1', 'Adaptado de nuevo');
  perform pg_temp.apv(p);
  perform pg_temp.keepp('p_' || p, pg_temp.pub(p));
  return (select aids from app.publications where id = pg_temp.id('p_' || p));
end $$;
select is(pg_temp.aid('ra1', '["dyslexia"]'), '{"readAloud": true}'::jsonb, 'a version with dyslexia: read aloud on');
select is(pg_temp.aid('ra2', '["dyslexia","adhd"]'), '{"readAloud": true}'::jsonb, 'dyslexia and another profile: on');
select is(pg_temp.aid('ra3', '["adhd"]'), '{"readAloud": true}'::jsonb, 'a version without dyslexia: on too');
select is(pg_temp.aid('ra4', '[]'), '{"readAloud": true}'::jsonb, 'a version with no profile: on');
select is(pg_temp.aid('ra5', '["asd","dysgraphia"]'), '{"readAloud": true}'::jsonb, 'two profiles that are not dyslexia: on');
select is((select aids from app.publications where version_id = pg_temp.id('vs')), '{"readAloud": true}'::jsonb, 'a gaze version (motor): on too');
select is((select count(distinct aids) from app.publications p where p.institution_id = pg_temp.id('i_n')), 1::bigint, 'all the publications of the institution carry the same aids: nothing in them tells a profile apart');

-- ---------------------------------------------------------------------------------------------
-- P-3: the first publication makes the assessment 'published' (same revision); nothing else does.
-- ---------------------------------------------------------------------------------------------
create function pg_temp.asm(p_asm text) returns text language sql as $$
  select a.status || '|' || a.revision from app.assessments a where a.id = pg_temp.id(p_asm)
$$;
select pg_temp.ready('vq', 1, 'typed', array['s3']);
select is(pg_temp.asm('a_vq'), 'draft|1', 'before publishing the assessment is a draft');
select is(pg_temp.pe('vq', 'gen_random_uuid()', 'null', (pg_temp.rev('vq')::integer - 1)::text), 'P0001 CONFLICT revision_mismatch changed=false', 'a publication that is refused');
select is(pg_temp.asm('a_vq'), 'draft|1', 'leaves it a draft');
select is(pg_temp.err(pg_temp.pub('vq', quote_literal('00000000-0000-0000-0000-0000000000f5'))), null, 'the first publication works');
select is(pg_temp.asm('a_vq'), 'published|1', 'and the assessment is published, with the same revision (publishing edits none of its fields)');
select is(pg_temp.as_user('teach', format('select api.get_assessment(%L)', pg_temp.id('a_vq'))) -> 'assessment' ->> 'status', 'published', 'get_assessment says it');
select is((select m ->> 'status' from jsonb_array_elements(pg_temp.as_user('teach', format('select api.list_assessments(%L)', pg_temp.id('g_n'))) -> 'items') m where m ->> 'id' = pg_temp.id('a_vq')::text), 'published', 'and so does list_assessments');
select is(pg_temp.err(pg_temp.pub('vq', quote_literal('00000000-0000-0000-0000-0000000000f5'))), null, 'the replay of the op_key answers');
select is(pg_temp.asm('a_vq'), 'published|1', 'and does not move the assessment');
select is(pg_temp.err(pg_temp.pub('vq')), null, 'another publication of the same version works');
select is(pg_temp.asm('a_vq'), 'published|1', 'and leaves the assessment as it was: only the first one changes the status');
select is(pg_temp.as_user('teach', format('select api.archive_assessment(%L, 1)', pg_temp.id('a_vq'))) ->> 'revision', '2', 'a published assessment can be archived with the revision it has');
select is(pg_temp.pe('vq'), 'P0001 INVALID assessment_archived changed=false', 'and an archived one is not published: INVALID assessment_archived');
select is(pg_temp.asm('a_vq'), 'archived|2', 'it stays archived');

select * from finish();
rollback;
