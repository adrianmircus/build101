-- T1.F7: lengths are counted by code points (app.js_length = char_length, like zod 4) and every projected option is rebuilt by
-- type and validated as a whole: an option whose text is an object (or whose id is not a letter) blocks the publication
-- (CONFLICT invalid_option) without creating anything. Rows are seeded as the table owner. Placeholder text only. Rolled back.
begin;
select plan(24);

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
insert into auth.users (id, email) select id, k || '@t1-f7.invalid' from ids where k <> 'ghost' and k not like 'stu\_%';
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

-- A ready gaze version with one question; the options are then overwritten as the owner.
select pg_temp.mkv('g_n', 'vd', 1, 'gaze');
select pg_temp.gazeq('vd', 1);
select pg_temp.ek('vd');
select pg_temp.recip('vd', array['s1']);
select pg_temp.apv('vd');
create function pg_temp.seto(p_options text) returns void language sql as $$
  update app.version_questions q set options = p_options::jsonb where q.id = pg_temp.id('q_vd1')
$$;
create function pg_temp.badopt(p_options text) returns text language plpgsql as $$
begin
  perform pg_temp.seto(p_options);
  return pg_temp.pe('vd');
end $$;

-- Code points, as zod counts them.
select is(app.js_length('😀😀😀'), 3, 'three emojis are three characters (z.string().max(3) accepts them)');
select is(app.js_length(repeat('😀', 2000)), 2000, 'and 2000 emojis are 2000');
select is(app.js_length(E'é'), 2, 'a combining accent still counts as its own code point, like in zod');
select is(app.js_length(null), null, 'null stays null');
select is(app.is_graph_spec(jsonb_build_object('functions', jsonb_build_array(jsonb_build_object('expr', 'x', 'label', repeat('😀', 60))), 'points', '[]'::jsonb)), true, 'a label of 60 emojis passes GraphSpec');
select is(app.is_graph_spec(jsonb_build_object('functions', jsonb_build_array(jsonb_build_object('expr', 'x', 'label', repeat('😀', 61))), 'points', '[]'::jsonb)), false, 'and 61 does not');
select is(app.is_graph_spec(jsonb_build_object('functions', jsonb_build_array(jsonb_build_object('expr', repeat('😀', 200))), 'points', '[]'::jsonb)), true, 'an expression of 200 emojis passes');
select is(app.is_graph_spec(jsonb_build_object('functions', jsonb_build_array(jsonb_build_object('expr', repeat('😀', 201))), 'points', '[]'::jsonb)), false, 'and 201 does not');
select is(app.is_question_option(jsonb_build_object('id', 'A', 'text', repeat('😀', 2000))), true, 'an option text of 2000 emojis passes');
select is(app.is_question_option(jsonb_build_object('id', 'A', 'text', repeat('😀', 2001))), false, 'and 2001 does not');

-- The projection of an option is rebuilt by type.
select is(app.project_option('{"id":"A","text":{"correctOptionId":"B","recipients":["x"]}}'::jsonb), '{"id":"A","text":null}'::jsonb, 'an object as text comes out as null');
select is(app.project_option('{"id":"A","text":"Uno","correctOptionId":"B","extra":{"a":1}}'::jsonb), '{"id":"A","text":"Uno"}'::jsonb, 'extra keys are dropped');
select is(app.project_option('{"id":{"a":1},"text":7}'::jsonb), '{"id":null,"text":null}'::jsonb, 'an id that is not a letter and a number as text are null');
select is(app.project_option('{"id":"AB","text":"Uno"}'::jsonb) ->> 'id', null, 'an id of two letters is null');
select is(app.project_option('{"id":"A","text":"Uno"}'::jsonb), '{"id":"A","text":"Uno"}'::jsonb, 'a valid option is the same');
select is(app.project_option('"suelto"'::jsonb), '{"id":null,"text":null}'::jsonb, 'an option that is not an object has nothing to copy');

-- (the CHECK of the table already refuses a bad id, a non-object option and a wrong count, so those are only unit-tested above.)
-- Refused options: the publication fails before it writes anything.
select is(pg_temp.badopt(o), 'P0001 CONFLICT invalid_option changed=false', d)
  from (values
    ('[{"id":"A","text":{"correctOptionId":"B","recipients":["otro"]}},{"id":"B","text":"Dos"}]', 'the case of Codex: an object as text'),
    ('[{"id":"A","text":7},{"id":"B","text":"Dos"}]', 'a number as text'),
    ('[{"id":"A","text":null},{"id":"B","text":"Dos"}]', 'a null text'),
    ('[{"id":"A"},{"id":"B","text":"Dos"}]', 'an option without text')
  ) as t(o, d);
select is(pg_temp.badopt(format('[{"id":"A","text":"%s"},{"id":"B","text":"Dos"}]', repeat('😀', 2001))), 'P0001 CONFLICT invalid_option changed=false', 'a text of 2001 emojis (code points)');
select is(pg_temp.badopt('[{"id":"A","text":"Uno","graph":{"functions":[{"expr":{"a":1}}],"points":[]}},{"id":"B","text":"Dos"}]'), 'P0001 CONFLICT invalid_option_graph changed=false', 'a bad graph still says invalid_option_graph');

-- A valid option (with emojis at the limit and a graph label of 31 emojis) publishes and is copied identical.
select pg_temp.seto(format('[{"id":"A","text":"%s","graph":{"functions":[{"expr":"x","label":"%s"}],"points":[]}},{"id":"B","text":"Dos"}]', repeat('😀', 2000), repeat('😀', 31)));
select is(pg_temp.err(pg_temp.pub('vd')), null, 'valid options publish');
select is((select p.content -> 'questions' -> 0 -> 'options' from app.publications p where p.version_id = pg_temp.id('vd')),
  format('[{"id":"A","text":"%s","graph":{"functions":[{"expr":"x","label":"%s"}],"points":[]}},{"id":"B","text":"Dos"}]', repeat('😀', 2000), repeat('😀', 31))::jsonb, 'and the copy is identical');

select * from finish();
rollback;
