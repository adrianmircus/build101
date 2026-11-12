-- T1.4e: answer keys. Immutable revisions with their correspondence to the exercises, the questions and the
-- instructions of the version; edit and confirm with CAS on the base revision; the key a generation records
-- (current only if the generation is in force and its snapshot still corresponds, obsolete otherwise); approve;
-- get. Plus the matrix by RPC, the guards (as the owner, P0004) and the AI output validators of T1.4d that
-- T1.4e replaced (018b). Placeholder text only. Races with two connections are in
-- tests/integration/races/answer-keys.test.ts. The whole file is rolled back.
begin;
select plan(195);

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
create function pg_temp.as_anon(p_sql text) returns jsonb language sql
  as $$ select pg_temp.rpc(null, 'anon', p_sql) $$;
create function pg_temp.keys(p_obj jsonb) returns text language sql
  as $$ select string_agg(k, ',' order by k) from jsonb_object_keys(p_obj) k $$;
create function pg_temp.keep(p_key text, p_res jsonb) returns jsonb language plpgsql as $$
begin
  insert into ids (k, id) values (p_key, (p_res ->> 'id')::uuid);
  return p_res;
end $$;

insert into ids (k, id) select k, gen_random_uuid() from unnest(array[
  'admin', 'teach', 'other', 'incl', 'userb', 'nobody', 'ghost', 'adm2', 'stu_a', 'stu_b'
]) as k;
insert into auth.users (id, email) select id, k || '@t1-4e.invalid' from ids where k <> 'ghost' and k not like 'stu\_%';
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

-- Institution n: admin, teachers teach (g_n, g_z) and other (go_n), inclusion; adm2 is an admin who teaches
-- go_n. s1 (stu_a) is in g_n and sx (stu_b) in go_n. Institution b: userb.
insert into ids (k, id) select 'i_n', (pg_temp.as_service($$ select api.internal_create_institution('Liceo N', 't1-4e', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, %L)', pg_temp.id('i_n'), pg_temp.id(u.k), u.role))
  from (values ('admin', 'admin'), ('teach', 'teacher'), ('other', 'teacher'), ('adm2', 'admin'), ('incl', 'inclusion')) as u(k, role);
insert into ids (k, id) values
  ('g_n', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid),
  ('g_z', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º Z'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid),
  ('go_n', (pg_temp.as_user('other', format('select api.create_group(%L, ''3.º B'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid);
select pg_temp.as_user('other', format('select api.add_group_staff(%L, %L, ''co_teacher'')', pg_temp.id('go_n'), pg_temp.id('adm2')));
insert into ids (k, id) values
  ('s1', (pg_temp.as_user('teach', format('select api.create_student(%L, ''Estudiante 1'', ''est.1'', gen_random_uuid())', pg_temp.id('g_n'))) ->> 'id')::uuid),
  ('sx', (pg_temp.as_user('other', format('select api.create_student(%L, ''Estudiante X'', ''est.x'', gen_random_uuid())', pg_temp.id('go_n'))) ->> 'id')::uuid);
select pg_temp.link_student(pg_temp.id('s1'), pg_temp.id('stu_a'));
select pg_temp.link_student(pg_temp.id('sx'), pg_temp.id('stu_b'));
insert into ids (k, id) select 'i_b', (pg_temp.as_service($$ select api.internal_create_institution('Liceo B', 't1-4e-b', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_b'), pg_temp.id('userb')));

create function pg_temp.mk_asm(p_user text, p_group text, p_key text, p_instr text default '') returns void language plpgsql as $$
begin
  perform pg_temp.keep(p_key, pg_temp.as_user(p_user, format('select api.create_assessment(%L, ''worksheet'', ''Repaso'', %L, gen_random_uuid())', pg_temp.id(p_group), p_instr)));
end $$;
create function pg_temp.mk_ex(p_user text, p_asm text, p_key text, p_body text) returns void language plpgsql as $$
begin
  perform pg_temp.keep(p_key, pg_temp.as_user(p_user, format('select api.add_exercise(%L, %L, %L, gen_random_uuid(), null)', pg_temp.id(p_asm), right(p_key, 1), p_body)));
end $$;
-- A version of its own assessment with p_n exercises, an answer key row, and one question (options A, B, C)
-- in its first adapted exercise, written as the owner. Keys: the version p, its exercises x_p1.., its question q_p.
create function pg_temp.mkv(p_user text, p_group text, p text, p_n integer default 1, p_mode text default 'typed') returns void language plpgsql as $$
declare
  i integer;
begin
  perform pg_temp.mk_asm(p_user, p_group, 'a_' || p, 'Instrucciones');
  for i in 1..p_n loop
    perform pg_temp.mk_ex(p_user, 'a_' || p, 'e_' || p || i, 'Enunciado ' || i);
  end loop;
  perform pg_temp.keep(p, pg_temp.as_user(p_user, format($q$ select api.create_version(%L, '{"profiles":["motor"],"supports":[],"interests":[]}'::jsonb, %L, gen_random_uuid(), null) $q$,
    pg_temp.id('a_' || p), p_mode)));
  insert into ids (k, id) select 'x_' || p || row_number() over (order by e.position), ve.id
    from app.version_exercises ve join app.assessment_exercises e on e.id = ve.exercise_id where ve.version_id = pg_temp.id(p);
  insert into ids (k, id) values ('q_' || p, gen_random_uuid());
  insert into app.version_questions (id, institution_id, version_id, version_exercise_id, position, stem, options)
    select pg_temp.id('q_' || p), ve.institution_id, ve.version_id, ve.id, 0, '¿Cuánto es 2 + 2?', '[{"id":"A","text":"3"},{"id":"B","text":"4"},{"id":"C","text":"5"}]'::jsonb
      from app.version_exercises ve where ve.id = pg_temp.id('x_' || p || '1');
  insert into app.answer_keys (institution_id, version_id) select v.institution_id, v.id from app.versions v where v.id = pg_temp.id(p);
end $$;
select pg_temp.mkv('teach', 'g_n', 'va', 3);
select pg_temp.mkv('teach', 'g_n', 'vb', 2, 'gaze');
select pg_temp.mkv('teach', 'g_n', 'vg', 2, 'gaze');
select pg_temp.mkv('teach', 'g_n', 'vc', 1);
select pg_temp.mkv('other', 'go_n', 'vo', 1);
select pg_temp.mkv('teach', 'g_n', 'vs1', 1);
select pg_temp.mkv('teach', 'g_n', 'vs2', 1);
select pg_temp.mkv('teach', 'g_z', 'vs3', 1);
insert into ids (k, id) select 'op' || n, gen_random_uuid() from generate_series(1, 120) n;
create function pg_temp.op(p_n integer) returns text language sql as $$ select quote_literal(pg_temp.id('op' || p_n)) $$;

-- The calls under test. Revisions and op ids are SQL.
create function pg_temp.uvi(p_user text, p_ver text, p_rev text, p_text text, p_op text default 'gen_random_uuid()') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.update_version_instructions(%L, %s, %L, %s)', pg_temp.id(p_ver), p_rev, p_text, p_op))
$$;
create function pg_temp.uve(p_user text, p_x text, p_rev text, p_body text, p_op text default 'gen_random_uuid()') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.update_version_exercise(%L, %s, %L, %s)', pg_temp.id(p_x), p_rev, p_body, p_op))
$$;
create function pg_temp.uvq(p_user text, p_q text, p_rev text, p_stem text, p_options text, p_op text default 'gen_random_uuid()') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.update_version_question(%L, %s, %L, %L::jsonb, %s)', pg_temp.id(p_q), p_rev, p_stem, p_options, p_op))
$$;
create function pg_temp.sqk(p_user text, p_q text, p_opt text, p_rev text default 'null') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.set_question_key(%L, %L, %s)', pg_temp.id(p_q), p_opt, p_rev))
$$;
create function pg_temp.apv(p_user text, p_ver text, p_rev text, p_op text default 'gen_random_uuid()') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.approve_version(%L, %s, %s)', pg_temp.id(p_ver), p_rev, p_op))
$$;
create function pg_temp.rjv(p_user text, p_ver text, p_rev text, p_reasons text, p_op text default 'gen_random_uuid()') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.reject_version(%L, %s, %L::text[], %s)', pg_temp.id(p_ver), p_rev, p_reasons, p_op))
$$;
create function pg_temp.lv(p_asm text) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format('select api.list_versions(%L)', pg_temp.id(p_asm)))
$$;
create function pg_temp.gv(p_ver text) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format('select api.get_version(%L)', pg_temp.id(p_ver)))
$$;
-- The current revision of a version, to call as the teacher who just read it.
create function pg_temp.rev(p_ver text) returns text language sql as $$ select v.revision::text from app.versions v where v.id = pg_temp.id(p_ver) $$;

select pg_temp.mkv('teach', 'g_n', 'vn', 1);
delete from app.answer_keys where version_id = pg_temp.id('vn');
select pg_temp.mkv('teach', 'g_n', 'vh', 2);
select pg_temp.mkv('teach', 'g_n', 'vi', 1);
select pg_temp.mkv('teach', 'g_n', 'vr1', 2, 'gaze');
select pg_temp.mkv('teach', 'g_n', 'vr2', 2, 'gaze');
select pg_temp.mkv('teach', 'g_n', 'vr3', 2, 'gaze');
select pg_temp.mkv('teach', 'g_n', 'vr4', 2, 'gaze');
select pg_temp.mkv('teach', 'g_n', 'vr5', 2, 'gaze');
select pg_temp.mkv('teach', 'g_n', 'vr6', 2, 'gaze');
select pg_temp.mkv('teach', 'g_n', 'vr7', 2, 'gaze');
select pg_temp.mkv('teach', 'g_n', 'vr8', 2, 'gaze');

-- ---------------------------------------------------------------------------------------------
-- The calls under test.
-- ---------------------------------------------------------------------------------------------
-- A content for a version: the same answer for each adapted exercise and, with p_opt, the correct option of its question.
create function pg_temp.kc(p_ver text, p_ans text default 'Respuesta', p_opt text default null, p_q text default null) returns text language sql as $$
  select jsonb_build_object(
    'exercises', coalesce((select jsonb_object_agg(ve.id::text, jsonb_build_object('answer', p_ans)) from app.version_exercises ve where ve.version_id = pg_temp.id(p_ver)), '{}'::jsonb),
    'questions', case when p_opt is null then '{}'::jsonb else jsonb_build_object(pg_temp.id(coalesce(p_q, 'q_' || p_ver))::text, p_opt) end)::text
$$;
-- The current revision of a version as an SQL literal (null when it has none).
create function pg_temp.cur(p_ver text) returns text language sql as $$
  select coalesce(quote_literal(k.current_revision_id), 'null') from app.answer_keys k where k.version_id = pg_temp.id(p_ver)
$$;
create function pg_temp.curid(p_ver text) returns uuid language sql as $$ select k.current_revision_id from app.answer_keys k where k.version_id = pg_temp.id(p_ver) $$;
create function pg_temp.rv(p_ver text, p_n integer) returns uuid language sql as $$
  select r.id from app.answer_key_revisions r join app.answer_keys k on k.id = r.answer_key_id where k.version_id = pg_temp.id(p_ver) and r.number = p_n
$$;
create function pg_temp.ek(p_user text, p_ver text, p_content text, p_base text default 'null') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.edit_answer_key(%L, %L::jsonb, %s)', pg_temp.id(p_ver), p_content, p_base))
$$;
create function pg_temp.ck(p_user text, p_ver text, p_base text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.confirm_answer_key(%L, %s)', pg_temp.id(p_ver), p_base))
$$;
create function pg_temp.ak(p_user text, p_ver text, p_rev text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.approve_answer_key(%L, %s)', pg_temp.id(p_ver), p_rev))
$$;
create function pg_temp.gk(p_user text, p_ver text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.get_answer_key(%L)', pg_temp.id(p_ver)))
$$;
create function pg_temp.cg(p_ver text) returns jsonb language sql as $$
  select pg_temp.as_service(format('select api.internal_create_generation(%L, ''answer_key'', gen_random_uuid(), ''{}''::jsonb, repeat(''a'', 64), ''r1'', ''p1'', 1, null, null)', pg_temp.id(p_ver)))
$$;
create function pg_temp.mkg(p_key text, p_ver text) returns jsonb language sql as $$ select pg_temp.keep(p_key, pg_temp.cg(p_ver)) $$;
create function pg_temp.rk(p_gen text, p_content text) returns jsonb language sql as $$
  select pg_temp.as_service(format('select api.internal_record_answer_key_revision(%L, %L::jsonb)', pg_temp.id(p_gen), p_content))
$$;
create function pg_temp.fg(p_gen text, p_status text) returns jsonb language sql as $$
  select pg_temp.as_service(format('select api.internal_finish_generation(%L, %L, null)', pg_temp.id(p_gen), p_status))
$$;
create function pg_temp.sv(p_ver text) returns text language sql as $$
  select concat_ws('|', k.status, k.stale, k.current_revision_id is not null, k.approved_revision_id is not null, k.current_generation_id is not null, k.revision)
    from app.answer_keys k where k.version_id = pg_temp.id(p_ver)
$$;
create function pg_temp.matches(p_ver text, p_n integer) returns boolean language sql as $$
  select app.answer_key_matches(pg_temp.rv(p_ver, p_n), pg_temp.id(p_ver))
$$;
create function pg_temp.nrev(p_ver text) returns bigint language sql as $$
  select count(*) from app.answer_key_revisions r where r.version_id = pg_temp.id(p_ver)
$$;
-- A hand edit of the content, as the teacher.
create function pg_temp.edit_ex(p_x text, p_body text) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format('select api.update_version_exercise(%L, %s, %L, gen_random_uuid())', pg_temp.id(p_x),
    (select revision from app.version_exercises where id = pg_temp.id(p_x)), p_body))
$$;
create function pg_temp.edit_instr(p_v text, p_text text) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format('select api.update_version_instructions(%L, %s, %L, gen_random_uuid())', pg_temp.id(p_v),
    (select instructions_revision from app.versions where id = pg_temp.id(p_v)), p_text))
$$;
create function pg_temp.swap(p_q text) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format($q$ select api.update_version_question(%L, %s, 'Enunciado', '[{"id":"B","text":"4"},{"id":"A","text":"3"},{"id":"C","text":"5"}]'::jsonb, gen_random_uuid()) $q$,
    pg_temp.id(p_q), (select revision from app.version_questions where id = pg_temp.id(p_q))))
$$;
create function pg_temp.set_key(p_q text, p_opt text) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format('select api.set_question_key(%L, %L, %s)', pg_temp.id(p_q), p_opt,
    coalesce((select k.revision::text from app.question_keys k where k.question_id = pg_temp.id(p_q)), 'null')))
$$;

-- Everything these RPCs can change, as one string.
create function pg_temp.digest() returns text language sql as $$
  select md5(coalesce((select string_agg(concat_ws('|', v.id, v.revision, v.instructions_revision, v.status, v.stale, v.archived_at), ';' order by v.id)
                         from app.versions v where v.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', ve.id, ve.revision), ';' order by ve.id) from app.version_exercises ve where ve.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', q.id, q.revision, q.options::text), ';' order by q.id) from app.version_questions q where q.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', k.question_id, k.correct_option_id, k.revision), ';' order by k.question_id) from app.question_keys k where k.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', a.id, a.status, a.stale, a.current_revision_id, a.approved_revision_id, a.current_generation_id, a.revision, a.error_code), ';' order by a.id)
                         from app.answer_keys a where a.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', r.id, r.number, r.source, r.content::text), ';' order by r.id) from app.answer_key_revisions r where r.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', g.id, g.status), ';' order by g.id) from app.generations g where g.institution_id = pg_temp.id('i_n')), '')
          || (select count(*) from app.generation_outputs o where o.institution_id = pg_temp.id('i_n'))::text
          || (select count(*) from app.version_events e where e.institution_id = pg_temp.id('i_n'))::text
          || (select count(*) from app.audit_log a where a.institution_id = pg_temp.id('i_n'))::text)
$$;
create temp table before_val (n serial, d text);
create function pg_temp.mark() returns void language sql as $$ insert into before_val (d) select pg_temp.digest() $$;
create function pg_temp.unchanged() returns boolean language sql as $$
  select (select d from before_val order by n desc limit 1) = pg_temp.digest()
$$;
create function pg_temp.err(p_res jsonb) returns text language sql as $$ select p_res ->> 'error' $$;

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'api' and p.proname in ('get_answer_key', 'edit_answer_key', 'confirm_answer_key', 'approve_answer_key')
              and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
              and not has_function_privilege('service_role', p.oid, 'execute')), 4::bigint,
  'authenticated executes the four teacher RPCs; anon and service_role do not');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'api' and p.proname = 'internal_record_answer_key_revision'
              and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
              and not has_function_privilege('anon', p.oid, 'execute')), 1::bigint,
  'only service_role executes internal_record_answer_key_revision');
select pg_temp.mkg('gp', 'vc');
select pg_temp.mark();
select is(pg_temp.err(pg_temp.as_user('teach', format('select api.internal_record_answer_key_revision(%L, %L::jsonb)', pg_temp.id('gp'), pg_temp.kc('vc')))) like '42501%', true, 'a teacher cannot record a generated key');
select is(pg_temp.err(pg_temp.rpc(null, 'anon', format('select api.internal_record_answer_key_revision(%L, %L::jsonb)', pg_temp.id('gp'), pg_temp.kc('vc')))) like '42501%', true, 'nor anon');
select is(pg_temp.err(pg_temp.as_service(format('select api.edit_answer_key(%L, %L::jsonb, null)', pg_temp.id('vc'), pg_temp.kc('vc')))) like '42501%', true, 'and service_role cannot edit one: it is the teacher''s RPC');
select ok(pg_temp.unchanged(), 'nothing changed');

-- ---------------------------------------------------------------------------------------------
-- The permission matrix by RPC: each role that must be denied, with code and reason, and the proof that
-- nothing changed (keys, revisions, generations, outputs, events and audit rows).
-- ---------------------------------------------------------------------------------------------
create function pg_temp.denied(p_sql text, p_users text[]) returns text language plpgsql as $$
declare
  v_before text := pg_temp.digest();
  v_out text;
begin
  select string_agg(u.k || '=' || coalesce(pg_temp.as_user(u.k, p_sql) ->> 'error', 'ALLOWED'), ';' order by u.n) into v_out
    from unnest(p_users) with ordinality as u(k, n);
  return v_out || ' changed=' || (v_before <> pg_temp.digest())::text;
end
$$;
create function pg_temp.expect(p_users text[], p_codes text) returns text language sql as $$
  select string_agg(u.k || '=P0001 ' || case substr(p_codes, u.n::integer, 1)
                      when 'F' then 'FORBIDDEN forbidden' when 'N' then 'NOT_FOUND not_found'
                      when 'S' then 'FORBIDDEN no_session' end, ';' order by u.n) || ' changed=false'
    from unnest(p_users) with ordinality as u(k, n)
$$;
-- g_n has vc; adm2 is an admin who teaches go_n, not g_n; stu_a is a student of g_n; stu_b of go_n.
select pg_temp.ek('teach', 'vc', pg_temp.kc('vc'));
select is(pg_temp.denied(format('select api.get_answer_key(%L)', pg_temp.id('vc')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'),
  'get_answer_key: an admin who does not teach the group, inclusion and a student (of the group or not) are denied; other group, other institution and no membership NOT_FOUND; no session FORBIDDEN');
select is(pg_temp.denied(format('select api.edit_answer_key(%L, %L::jsonb, %L)', pg_temp.id('vc'), pg_temp.kc('vc'), pg_temp.curid('vc')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'edit_answer_key: same');
select is(pg_temp.denied(format('select api.confirm_answer_key(%L, %L)', pg_temp.id('vc'), pg_temp.curid('vc')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'confirm_answer_key: same');
select is(pg_temp.denied(format('select api.approve_answer_key(%L, %L)', pg_temp.id('vc'), pg_temp.curid('vc')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'approve_answer_key: same');
select is(pg_temp.err(pg_temp.rpc(null, 'anon', format('select api.get_answer_key(%L)', pg_temp.id('vc')))) like '42501%'
          and pg_temp.err(pg_temp.rpc(null, 'anon', format('select api.edit_answer_key(%L, %L::jsonb, null)', pg_temp.id('vc'), pg_temp.kc('vc')))) like '42501%'
          and pg_temp.err(pg_temp.rpc(null, 'anon', format('select api.confirm_answer_key(%L, %L)', pg_temp.id('vc'), pg_temp.curid('vc')))) like '42501%'
          and pg_temp.err(pg_temp.rpc(null, 'anon', format('select api.approve_answer_key(%L, %L)', pg_temp.id('vc'), pg_temp.curid('vc')))) like '42501%', true,
  'anon cannot execute any of the four');
select is(pg_temp.err(pg_temp.as_user('other', format('select api.get_answer_key(%L)', pg_temp.id('vc')))), 'P0001 NOT_FOUND not_found', 'a teacher of another group does not even learn that the version exists');
select is(pg_temp.err(pg_temp.ek('adm2', 'vo', pg_temp.kc('vo'))), null, 'an admin who also teaches go_n edits the key of a version of it like a teacher');
select is(pg_temp.err(pg_temp.ek('teach', 'vo', pg_temp.kc('vo'))), 'P0001 NOT_FOUND not_found', 'and the teacher of g_n cannot touch it');

-- ---------------------------------------------------------------------------------------------
-- get_answer_key
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err(pg_temp.gk('teach', 'vn')), 'P0001 NOT_FOUND no_answer_key', 'a version with no key yet is NOT_FOUND no_answer_key: a read never writes');
select is((select count(*) from app.answer_keys where version_id = pg_temp.id('vn')), 0::bigint, 'and it did not create the row');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('teach'), 'authenticated', 'select api.get_answer_key(null)')), 'P0001 NOT_FOUND not_found', 'a null version is NOT_FOUND');
select is(pg_temp.err(pg_temp.as_user('teach', format('select api.get_answer_key(%L)', gen_random_uuid()))), 'P0001 NOT_FOUND not_found', 'and so is an unknown one');
select is(pg_temp.keys(pg_temp.gk('teach', 'vi')), 'approvedRevisionId,current,id,revision,stale,status,versionId', 'a key without revisions answers exactly its keys');
select is(pg_temp.gk('teach', 'vi') ->> 'status', 'empty', 'it is empty');
select is(pg_temp.gk('teach', 'vi') -> 'current', 'null'::jsonb, 'with no current revision');
select is(pg_temp.gk('teach', 'vi') ->> 'stale', 'false', 'and not stale');

-- ---------------------------------------------------------------------------------------------
-- edit_answer_key: shape, references, CAS (va is typed with 3 exercises and one question)
-- ---------------------------------------------------------------------------------------------
select pg_temp.mark();
select is(pg_temp.err(pg_temp.ek('teach', 'va', null)), 'P0001 INVALID invalid_answer_key', 'a null content is INVALID invalid_answer_key');
select is(pg_temp.err(pg_temp.ek('teach', 'va', '[]')), 'P0001 INVALID invalid_answer_key', 'an array too');
select is(pg_temp.err(pg_temp.ek('teach', 'va', '{"exercises": {}}')), 'P0001 INVALID invalid_answer_key', 'a content without questions too');
select is(pg_temp.err(pg_temp.ek('teach', 'va', '{"exercises": {}, "questions": {}, "extra": 1}')), 'P0001 INVALID invalid_answer_key', 'and one with another key');
select is(pg_temp.err(pg_temp.ek('teach', 'va', '{"exercises": {"no-es-un-id": {"answer": "x"}}, "questions": {}}')), 'P0001 INVALID invalid_answer_key', 'an exercise key that is not an id too');
select is(pg_temp.err(pg_temp.ek('teach', 'va', format('{"exercises": {"%s": {"answer": 5}}, "questions": {}}', pg_temp.id('x_va1')))), 'P0001 INVALID invalid_answer_key', 'an answer that is not text too');
select is(pg_temp.err(pg_temp.ek('teach', 'va', format('{"exercises": {"%s": {}}, "questions": {}}', pg_temp.id('x_va1')))), 'P0001 INVALID invalid_answer_key', 'an exercise without answer too');
select is(pg_temp.err(pg_temp.ek('teach', 'va', format('{"exercises": {"%s": {"answer": "%s"}}, "questions": {}}', pg_temp.id('x_va1'), repeat('x', 5001)))), 'P0001 INVALID invalid_answer_key', 'an answer of 5001 characters too');
select is(pg_temp.err(pg_temp.ek('teach', 'va', format('{"exercises": {"%s": {"answer": "x", "rubric": 3}}, "questions": {}}', pg_temp.id('x_va1')))), 'P0001 INVALID invalid_answer_key', 'a rubric that is not text too');
select is(pg_temp.err(pg_temp.ek('teach', 'va', format('{"exercises": {"%s": {"answer": "x", "otro": 3}}, "questions": {}}', pg_temp.id('x_va1')))), 'P0001 INVALID invalid_answer_key', 'an exercise entry with another key too');
select is(pg_temp.err(pg_temp.ek('teach', 'va', format('{"exercises": {}, "questions": {"%s": "a"}}', pg_temp.id('q_va')))), 'P0001 INVALID invalid_answer_key', 'an option that is not a capital letter too');
select is(pg_temp.err(pg_temp.ek('teach', 'va', format('{"exercises": {}, "questions": {"%s": null}}', pg_temp.id('q_va')))), 'P0001 INVALID invalid_answer_key', 'a null option too');
select is(pg_temp.err(pg_temp.ek('teach', 'va', format('{"exercises": {"%s": {"answer": "x"}}, "questions": {}}', pg_temp.id('x_vc1')))), 'P0001 INVALID invalid_answer_key', 'an exercise of another version is INVALID invalid_answer_key');
select is(pg_temp.err(pg_temp.ek('teach', 'va', format('{"exercises": {}, "questions": {"%s": "A"}}', pg_temp.id('q_vc')))), 'P0001 INVALID invalid_answer_key', 'and a question of another version');
select is(pg_temp.err(pg_temp.ek('teach', 'va', pg_temp.kc('va', 'x', 'Z'))), 'P0001 INVALID unknown_option', 'an option the question does not have is INVALID unknown_option');
select is(pg_temp.err(pg_temp.ek('teach', 'vb', pg_temp.kc('vb'))), 'P0001 INVALID key_incomplete', 'in gaze mode a key with a question that has no option is INVALID key_incomplete');
select is(pg_temp.err(pg_temp.ek('teach', 'va', pg_temp.kc('va'), quote_literal(gen_random_uuid()))), 'P0001 CONFLICT revision_mismatch', 'a base when there is no current revision is a CONFLICT');
select is(pg_temp.err(pg_temp.as_user('teach', 'select api.edit_answer_key(null, ''{"exercises": {}, "questions": {}}''::jsonb, null)')), 'P0001 NOT_FOUND not_found', 'a null version is NOT_FOUND');
select ok(pg_temp.unchanged(), 'no refusal changed anything');
-- The first key.
select is(pg_temp.keys(pg_temp.ek('teach', 'va', pg_temp.kc('va', 'Resultado 1', 'B'))), 'number,revisionId', 'the first key answers its revision and number');
select is(pg_temp.sv('va'), 'ready|f|t|f|f|2', 'the key is ready and not stale, with a current revision and no approval');
select is((select r.number from app.answer_key_revisions r where r.id = pg_temp.curid('va')), 1, 'it is revision 1');
select is((select concat_ws('|', r.source, r.author_user_id = pg_temp.id('teach'), r.generation_id is null, r.version_revision = v.revision, r.instructions_revision = v.instructions_revision)
             from app.answer_key_revisions r join app.versions v on v.id = r.version_id where r.id = pg_temp.curid('va')), 'edited|t|t|t|t',
  'edited by the teacher, with the version revision and the instructions revision of today');
select is((select r.exercise_revisions = (select jsonb_object_agg(ve.id::text, ve.revision) from app.version_exercises ve where ve.version_id = pg_temp.id('va'))
              and r.question_revisions = (select jsonb_object_agg(q.id::text, q.revision) from app.version_questions q where q.version_id = pg_temp.id('va'))
              from app.answer_key_revisions r where r.id = pg_temp.curid('va')), true, 'and the revisions of each exercise and question of today');
select is((select r.content -> 'exercises' -> pg_temp.id('x_va1')::text ->> 'answer' from app.answer_key_revisions r where r.id = pg_temp.curid('va')), 'Resultado 1', 'with the content as sent');
select is(pg_temp.matches('va', 1), true, 'the revision corresponds to the version');
select is(pg_temp.gk('teach', 'va') -> 'current' ->> 'number', '1', 'get_answer_key shows it as the current one');
select is(pg_temp.keys(pg_temp.gk('teach', 'va') -> 'current'), 'content,createdAt,exerciseRevisions,id,instructionsRevision,number,questionRevisions,source,versionRevision', 'with exactly the keys of a revision');
select is(pg_temp.gk('teach', 'va') ->> 'stale', 'false', 'and it is not stale');
-- CAS.
select is(pg_temp.err(pg_temp.ek('teach', 'va', pg_temp.kc('va', 'Otro'))), 'P0001 CONFLICT revision_mismatch', 'a second edit that says it is the first (base null) is a CONFLICT');
select is(pg_temp.err(pg_temp.ek('teach', 'va', pg_temp.kc('va', 'Otro'), quote_literal(gen_random_uuid()))), 'P0001 CONFLICT revision_mismatch', 'a base that is not the current one is a CONFLICT');
select is(pg_temp.err(pg_temp.ek('teach', 'vc', pg_temp.kc('vc', 'Otro'), quote_literal(pg_temp.curid('va')))), 'P0001 CONFLICT revision_mismatch', 'and the current revision of another version is not a base either');
select is(pg_temp.nrev('va'), 1::bigint, 'none of them wrote a revision');
select is(pg_temp.ek('teach', 'va', pg_temp.kc('va', 'Resultado 2', 'C'), pg_temp.cur('va')) ->> 'number', '2', 'with the current revision as base the edit is revision 2');
select is(pg_temp.matches('va', 2) and pg_temp.matches('va', 1), true, 'and the first still corresponds to the version: nothing in the content changed');
select is((select r.content ->> 'questions' from app.answer_key_revisions r where r.id = pg_temp.rv('va', 1)), format('{"%s": "B"}', pg_temp.id('q_va')), 'revision 1 keeps its content: a revision is never rewritten');

-- ---------------------------------------------------------------------------------------------
-- Correspondence: what makes a key stop corresponding until it is confirmed (va, typed)
-- ---------------------------------------------------------------------------------------------
select pg_temp.edit_ex('x_va1', 'Texto nuevo del ejercicio');
select is(pg_temp.matches('va', 2), false, 'editing an adapted exercise: the key no longer corresponds');
select is(pg_temp.gk('teach', 'va') ->> 'stale', 'true', 'get_answer_key says stale');
select is(pg_temp.sv('va'), 'ready|t|t|f|f|3', 'the flag is on and the current revision is the same');
select is(pg_temp.ck('teach', 'va', pg_temp.cur('va')) ->> 'number', '3', 'confirming appends revision 3');
select is(pg_temp.matches('va', 3), true, 'it corresponds again, with the revisions of today');
select is(pg_temp.gk('teach', 'va') ->> 'stale', 'false', 'and the key is not stale');
select is((select concat_ws('|', r.source, r.author_user_id = pg_temp.id('teach')) from app.answer_key_revisions r where r.id = pg_temp.rv('va', 3)), 'confirmed|t', 'it is a confirmed revision, with its author');
select is((select r.content -> 'exercises' = (select r2.content -> 'exercises' from app.answer_key_revisions r2 where r2.id = pg_temp.rv('va', 2)) from app.answer_key_revisions r where r.id = pg_temp.rv('va', 3)), true, 'with the exercises of its base');
select is((select r.content -> 'questions' from app.answer_key_revisions r where r.id = pg_temp.rv('va', 3)), '{}'::jsonb, 'and the correct options of question_keys of today (the question has none)');
select pg_temp.edit_instr('va', 'Instrucciones: expresalo en metros');
select is(pg_temp.matches('va', 3), false, 'changing the instructions: the key no longer corresponds');
select is(pg_temp.ck('teach', 'va', pg_temp.cur('va')) ->> 'number', '4', 'until it is confirmed');
select is(pg_temp.matches('va', 4), true, 'when it does');
-- A change of recipients moves the version revision and does not touch the key.
select pg_temp.as_user('teach', format('select api.set_version_recipients(%L, %s, array[%L]::uuid[], gen_random_uuid())', pg_temp.id('va'), pg_temp.rev('va'), pg_temp.id('s1')));
select is(pg_temp.matches('va', 4), true, 'changing the recipients moves the version revision and the key still corresponds');
select is((select r.version_revision < v.revision from app.answer_key_revisions r join app.versions v on v.id = r.version_id where r.id = pg_temp.rv('va', 4)), true, 'because version_revision is only for tracing');
select is(pg_temp.gk('teach', 'va') ->> 'stale', 'false', 'and it is not stale');
select is(pg_temp.err(pg_temp.ck('teach', 'va', 'null')), 'P0001 INVALID revision_required', 'confirm without a base is INVALID revision_required');
select is(pg_temp.err(pg_temp.ck('teach', 'va', quote_literal(pg_temp.rv('va', 3)))), 'P0001 CONFLICT revision_mismatch', 'and with an old revision as base a CONFLICT');
select is(pg_temp.err(pg_temp.ck('teach', 'vn', quote_literal(gen_random_uuid()))), 'P0001 CONFLICT revision_mismatch', 'and with no key at all too');

-- In gaze mode: swapping two options, even with the same ids, and changing the correct one (vb, two exercises, one question)
select pg_temp.set_key('q_vb', 'B');
select pg_temp.ek('teach', 'vb', pg_temp.kc('vb', 'Uno', 'B'));
select is(pg_temp.matches('vb', 1), true, 'a gaze key with the option of every question is saved and corresponds');
select pg_temp.swap('q_vb');
select is(pg_temp.matches('vb', 1), false, 'swapping two options (same ids): the key no longer corresponds');
select is(pg_temp.ck('teach', 'vb', pg_temp.cur('vb')) ->> 'number', '2', 'confirming it appends a revision');
select is(pg_temp.matches('vb', 2), true, 'that corresponds');
select pg_temp.set_key('q_vb', 'C');
select is(pg_temp.matches('vb', 2), false, 'changing the correct option: the key no longer corresponds');
select is(pg_temp.gk('teach', 'vb') ->> 'stale', 'true', 'and it is stale');
select is((select r.content -> 'questions' from app.answer_key_revisions r where r.id = pg_temp.rv('vb', 2)), jsonb_build_object(pg_temp.id('q_vb')::text, 'B'), 'the old revision still says B');
select is(pg_temp.ck('teach', 'vb', pg_temp.cur('vb')) ->> 'number', '3', 'confirming takes the correct option of today');
select is((select r.content -> 'questions' from app.answer_key_revisions r where r.id = pg_temp.rv('vb', 3)), jsonb_build_object(pg_temp.id('q_vb')::text, 'C'), 'which is C');
select is(pg_temp.matches('vb', 3), true, 'and corresponds');
-- Confirm in gaze mode needs a correct option for each question (vg).
select pg_temp.ek('teach', 'vg', pg_temp.kc('vg', 'Uno', 'A'));
select is(pg_temp.err(pg_temp.ck('teach', 'vg', pg_temp.cur('vg'))), 'P0001 INVALID key_incomplete', 'confirming in gaze mode when a question has no key is INVALID key_incomplete');
select is(pg_temp.nrev('vg'), 1::bigint, 'and wrote nothing');
select pg_temp.set_key('q_vg', 'A');
select is(pg_temp.ck('teach', 'vg', pg_temp.cur('vg')) ->> 'number', '2', 'once the question has its option it confirms');
-- The other edits of the content do the same.
select pg_temp.ek('teach', 'vh', pg_temp.kc('vh'));
select pg_temp.as_user('teach', format($q$ select api.update_version_question(%L, %s, 'Enunciado nuevo', '[{"id":"A","text":"3"},{"id":"B","text":"4"}]'::jsonb, gen_random_uuid()) $q$, pg_temp.id('q_vh'), (select revision from app.version_questions where id = pg_temp.id('q_vh'))));
select is(pg_temp.matches('vh', 1), false, 'editing a question: the key no longer corresponds');

-- ---------------------------------------------------------------------------------------------
-- approve_answer_key
-- ---------------------------------------------------------------------------------------------
select pg_temp.mark();
select is(pg_temp.err(pg_temp.ak('teach', 'vn', quote_literal(gen_random_uuid()))), 'P0001 NOT_FOUND no_answer_key', 'approving on a version with no key is NOT_FOUND no_answer_key');
select is(pg_temp.err(pg_temp.ak('teach', 'va', 'null')), 'P0001 INVALID revision_required', 'a null revision is INVALID revision_required');
select is(pg_temp.err(pg_temp.ak('teach', 'va', quote_literal(gen_random_uuid()))), 'P0001 NOT_FOUND not_found', 'a revision that does not exist is NOT_FOUND');
select is(pg_temp.err(pg_temp.ak('teach', 'va', quote_literal(pg_temp.curid('vc')))), 'P0001 NOT_FOUND not_found', 'and one of another version too');
select is(pg_temp.err(pg_temp.ak('teach', 'va', quote_literal(pg_temp.rv('va', 3)))), 'P0001 CONFLICT revision_mismatch', 'a revision that is not the current one is a CONFLICT');
select ok(pg_temp.unchanged(), 'no refusal changed anything');
select is(pg_temp.keys(pg_temp.ak('teach', 'va', pg_temp.cur('va'))), 'answerKeyId,approvedRevisionId,revision', 'approving the current one answers exactly its keys');
select is(pg_temp.gk('teach', 'va') ->> 'approvedRevisionId', pg_temp.curid('va')::text, 'get_answer_key shows it');
select pg_temp.mark();
select is(pg_temp.ak('teach', 'va', pg_temp.cur('va')) ->> 'approvedRevisionId', pg_temp.curid('va')::text, 'approving it again answers the same');
select ok(pg_temp.unchanged(), 'without writing');
select pg_temp.edit_ex('x_va2', 'Otro texto');
select is(pg_temp.err(pg_temp.ak('teach', 'va', pg_temp.cur('va'))), 'P0001 CONFLICT stale_answer_key', 'a revision that no longer corresponds is CONFLICT stale_answer_key');
select is(pg_temp.gk('teach', 'va') ->> 'approvedRevisionId', pg_temp.rv('va', 4)::text, 'the approval of the old one stays marked: publishing compares, it does not trust it');

-- ---------------------------------------------------------------------------------------------
-- A version, assessment or group that is archived takes no write
-- ---------------------------------------------------------------------------------------------
select pg_temp.ek('teach', 'vs1', pg_temp.kc('vs1'));
select pg_temp.ek('teach', 'vs2', pg_temp.kc('vs2'));
select pg_temp.ek('teach', 'vs3', pg_temp.kc('vs3'));
select pg_temp.as_user('teach', format('select api.archive_version(%L, %s)', pg_temp.id('vs1'), pg_temp.rev('vs1')));
select pg_temp.as_user('teach', format('select api.archive_assessment(%L, 1)', pg_temp.id('a_vs2')));
select pg_temp.as_user('teach', format('select api.archive_group(%L, 1)', pg_temp.id('g_z')));
select pg_temp.mark();
select is(pg_temp.err(pg_temp.ek('teach', 'vs1', pg_temp.kc('vs1'), pg_temp.cur('vs1'))), 'P0001 INVALID version_archived', 'an archived version takes no edit');
select is(pg_temp.err(pg_temp.ck('teach', 'vs1', pg_temp.cur('vs1'))), 'P0001 INVALID version_archived', 'no confirmation');
select is(pg_temp.err(pg_temp.ak('teach', 'vs1', pg_temp.cur('vs1'))), 'P0001 INVALID version_archived', 'no approval');
select is(pg_temp.err(pg_temp.ek('teach', 'vs2', pg_temp.kc('vs2'), pg_temp.cur('vs2'))), 'P0001 INVALID assessment_archived', 'an archived assessment takes no edit');
select is(pg_temp.err(pg_temp.ck('teach', 'vs2', pg_temp.cur('vs2'))), 'P0001 INVALID assessment_archived', 'no confirmation');
select is(pg_temp.err(pg_temp.ak('teach', 'vs2', pg_temp.cur('vs2'))), 'P0001 INVALID assessment_archived', 'no approval');
select is(pg_temp.err(pg_temp.ek('teach', 'vs3', pg_temp.kc('vs3'), pg_temp.cur('vs3'))), 'P0001 INVALID archived', 'an archived group takes no edit');
select is(pg_temp.err(pg_temp.ck('teach', 'vs3', pg_temp.cur('vs3'))), 'P0001 INVALID archived', 'no confirmation');
select is(pg_temp.err(pg_temp.ak('teach', 'vs3', pg_temp.cur('vs3'))), 'P0001 INVALID archived', 'no approval');
select ok(pg_temp.unchanged(), 'and nothing changed');
select is(pg_temp.gk('teach', 'vs1') -> 'current' ->> 'number', '1', 'but the key can still be read');

-- ---------------------------------------------------------------------------------------------
-- internal_record_answer_key_revision: shape and references
-- ---------------------------------------------------------------------------------------------
select pg_temp.mkg('g1', 'vr1');
select pg_temp.mkg('gv', 'vr7');
select pg_temp.as_service(format('select api.internal_create_generation(%L, ''version'', gen_random_uuid(), ''{}''::jsonb, repeat(''a'', 64), ''r1'', ''p1'', 1)', pg_temp.id('vr7')));
select pg_temp.mark();
select is(pg_temp.err(pg_temp.as_service('select api.internal_record_answer_key_revision(null, ''{"exercises": {}, "questions": {}}''::jsonb)')), 'P0001 INVALID invalid_output', 'a null generation is INVALID invalid_output');
select is(pg_temp.err(pg_temp.as_service(format('select api.internal_record_answer_key_revision(%L, null)', pg_temp.id('g1')))), 'P0001 INVALID invalid_answer_key', 'a null content is INVALID invalid_answer_key');
select is(pg_temp.err(pg_temp.rk('g1', '{"exercises": {}}')), 'P0001 INVALID invalid_answer_key', 'a content that is not the shape asked for too: there is no revision to return for a discarded one');
select is(pg_temp.err(pg_temp.as_service(format('select api.internal_record_answer_key_revision(%L, %L::jsonb)', gen_random_uuid(), pg_temp.kc('vr1')))), 'P0001 NOT_FOUND not_found', 'a generation that does not exist is NOT_FOUND');
select is((select count(*) from app.generations g where g.version_id = pg_temp.id('vr7') and g.kind = 'version' and g.status = 'running'), 1::bigint, 'the version generation of vr7 is running');
select is(pg_temp.err(pg_temp.as_service(format('select api.internal_record_answer_key_revision(%L, %L::jsonb)',
  (select g.id from app.generations g where g.version_id = pg_temp.id('vr7') and g.kind = 'version' and g.status = 'running'), pg_temp.kc('vr7')))), 'P0001 INVALID invalid_generation', 'the generation of an adaptation is INVALID invalid_generation');
select ok(pg_temp.unchanged(), 'no refusal changed anything');

-- The happy case and its retry (vr1)
select is(pg_temp.keys(pg_temp.rk('g1', pg_temp.kc('vr1', 'Generada', 'B'))), 'number,outcome,revisionId', 'a generated key answers its revision, number and outcome');
select is((select o.outcome from app.generation_outputs o where o.generation_id = pg_temp.id('g1') and o.kind = 'answer_key'), 'applied', 'it is applied: the generation is in force and its snapshot corresponds');
select is(pg_temp.sv('vr1'), 'generating|f|t|f|t|2', 'the key points at it and still says generating until the generation closes');
select is((select concat_ws('|', r.source, r.number, r.generation_id = pg_temp.id('g1'), r.author_user_id is null, r.version_revision = g.target_revision)
             from app.answer_key_revisions r join app.generations g on g.id = r.generation_id where r.id = pg_temp.curid('vr1')), 'generated|1|t|t|t', 'a generated revision keeps its generation and the version revision the generation started from');
select is((select r.exercise_revisions = (g.inputs -> 'exerciseRevisions') and r.question_revisions = (g.inputs -> 'questionRevisions') and r.instructions_revision = (g.inputs ->> 'instructionsRevision')::integer
             from app.answer_key_revisions r join app.generations g on g.id = r.generation_id where r.id = pg_temp.curid('vr1')), true, 'and the snapshot of the inputs of its generation');
select is(pg_temp.matches('vr1', 1), true, 'which corresponds to the version');
select is((select o.output = r.content and o.expected_revision = g.target_revision from app.generation_outputs o join app.answer_key_revisions r on r.generation_id = o.generation_id join app.generations g on g.id = o.generation_id where o.generation_id = pg_temp.id('g1')), true, 'the output is stored as it arrived');
select pg_temp.mark();
select is(pg_temp.rk('g1', pg_temp.kc('vr1', 'Generada', 'B')), jsonb_build_object('revisionId', pg_temp.curid('vr1'), 'number', 1, 'outcome', 'applied'), 'a retry of the same job answers the stored revision');
select is(pg_temp.rk('g1', pg_temp.kc('vr1', 'Otra cosa', 'C')) ->> 'revisionId', pg_temp.curid('vr1')::text, 'even with another content: the stored one counts');
select ok(pg_temp.unchanged(), 'and writes nothing');
select is(pg_temp.fg('g1', 'done') ->> 'changed', 'true', 'the generation closes');
select is(pg_temp.sv('vr1'), 'ready|f|t|f|t|2', 'and the key is ready');
select is(pg_temp.gk('teach', 'vr1') -> 'current' ->> 'source', 'generated', 'the teacher reads the generated key');

-- A generated key that arrives after a change of content is obsolete: it keeps its own snapshot and is not current
select pg_temp.mkg('g2', 'vr2');
select pg_temp.edit_ex('x_vr21', 'La profe cambió el ejercicio');
select is(pg_temp.rk('g2', pg_temp.kc('vr2', 'Generada', 'B')) ->> 'outcome', 'obsolete', 'an exercise edited while the key was being made: the key is obsolete');
select is(pg_temp.sv('vr2'), 'generating|t|f|f|t|1', 'it is not the current revision of the key and the key is still stale');
select is((select r.exercise_revisions = g.inputs -> 'exerciseRevisions' and r.exercise_revisions <> (select jsonb_object_agg(ve.id::text, ve.revision) from app.version_exercises ve where ve.version_id = r.version_id)
             from app.answer_key_revisions r join app.generations g on g.id = r.generation_id where r.generation_id = pg_temp.id('g2')), true, 'it is stored with the snapshot of its generation, not with today''s');
select is((select o.outcome from app.generation_outputs o where o.generation_id = pg_temp.id('g2') and o.kind = 'answer_key'), 'obsolete', 'and the output says obsolete');
select is(pg_temp.matches('vr2', 1), false, 'it does not correspond to the version');
select is(pg_temp.gk('teach', 'vr2') -> 'current', 'null'::jsonb, 'get_answer_key has no current revision');
select pg_temp.mkg('g3', 'vr3');
select pg_temp.edit_instr('vr3', 'Nuevas instrucciones');
select is(pg_temp.rk('g3', pg_temp.kc('vr3', 'Generada', 'B')) ->> 'outcome', 'obsolete', 'instructions changed meanwhile: obsolete');
select pg_temp.mkg('g4', 'vr4');
select pg_temp.swap('q_vr4');
select is(pg_temp.rk('g4', pg_temp.kc('vr4', 'Generada', 'B')) ->> 'outcome', 'obsolete', 'two options swapped meanwhile: obsolete');
select pg_temp.mkg('g5', 'vr5');
select pg_temp.set_key('q_vr5', 'C');
select is(pg_temp.rk('g5', pg_temp.kc('vr5', 'Generada', 'B')) ->> 'outcome', 'obsolete', 'the correct option changed meanwhile: obsolete');
select is((select count(*) from app.answer_keys k where k.version_id in (pg_temp.id('vr2'), pg_temp.id('vr3'), pg_temp.id('vr4'), pg_temp.id('vr5')) and k.current_revision_id is not null), 0::bigint, 'none of the four became current');
-- The person wins over a running generation (vr8).
select pg_temp.mkg('g8', 'vr8');
select pg_temp.set_key('q_vr8', 'B');
select is(pg_temp.ek('teach', 'vr8', pg_temp.kc('vr8', 'De la profe', 'B')) ->> 'number', '1', 'the teacher edits the key while a generation runs');
select is(pg_temp.sv('vr8'), 'ready|f|t|f|f|2', 'the key no longer points at the generation');
select is((select g.status from app.generations g where g.id = pg_temp.id('g8')), 'superseded', 'which is superseded');
select is(pg_temp.rk('g8', pg_temp.kc('vr8', 'De la IA', 'B')) ->> 'outcome', 'obsolete', 'what it records afterwards is obsolete, even though nothing in the content changed');
select is(pg_temp.rv('vr8', 1) = pg_temp.curid('vr8') and (select r.source from app.answer_key_revisions r where r.id = pg_temp.rv('vr8', 2)) = 'generated', true, 'the teacher''s revision is still the current one and the generated one is kept as number 2');
select is(pg_temp.fg('g8', 'done') ->> 'changed', 'false', 'closing the superseded generation changes nothing');
-- A generation that is not running, or was replaced by a newer one, records an obsolete one (vr6).
select pg_temp.mkg('g6', 'vr6');
select pg_temp.fg('g6', 'done');
select is(pg_temp.rk('g6', pg_temp.kc('vr6', 'Tarde', 'B')) ->> 'outcome', 'obsolete', 'a key that arrives after its generation closed is obsolete');
select pg_temp.mkg('g6a', 'vr6');
select pg_temp.mkg('g6b', 'vr6');
select is(pg_temp.rk('g6a', pg_temp.kc('vr6', 'Vieja', 'B')) ->> 'outcome', 'obsolete', 'one of a generation that a newer one replaced is obsolete');
select is(pg_temp.rk('g6b', pg_temp.kc('vr6', 'Nueva', 'B')) ->> 'outcome', 'applied', 'and the newer one applies');
select is((select count(*) from app.answer_key_revisions r where r.version_id = pg_temp.id('vr6')), 3::bigint, 'the three are stored, numbered one by one');
-- A content that does not fit the version today is stored, obsolete.
select pg_temp.mkg('g7a', 'vi');
select is(pg_temp.rk('g7a', format('{"exercises": {"%s": {"answer": "x"}}, "questions": {}}', pg_temp.id('x_vc1'))) ->> 'outcome', 'obsolete', 'a key that names an exercise of another version is stored as obsolete');
select pg_temp.mkg('g7b', 'vr7');
select is(pg_temp.rk('g7b', pg_temp.kc('vr7')) ->> 'outcome', 'obsolete', 'a gaze key that leaves a question without option too');
select pg_temp.mkg('g7c', 'vh');
select is(pg_temp.rk('g7c', pg_temp.kc('vh', 'x', 'Z')) ->> 'outcome', 'obsolete', 'and one with an option the question does not have');
select is((select count(*) from app.answer_keys k where k.version_id in (pg_temp.id('vi'), pg_temp.id('vr7')) and k.current_revision_id is not null), 0::bigint, 'none became current');

-- ---------------------------------------------------------------------------------------------
-- Guards, as the owner of the tables: a revision cannot be modified (P0004)
-- ---------------------------------------------------------------------------------------------
select throws_ok(format('update app.answer_key_revisions set content = ''{}'' where id = %L', pg_temp.rv('va', 1)), 'P0004', null, 'the content of a revision cannot be modified');
select throws_ok(format('update app.answer_key_revisions set number = 9 where id = %L', pg_temp.rv('va', 1)), 'P0004', null, 'nor its number');
select throws_ok(format('update app.answer_key_revisions set exercise_revisions = ''{}'' where id = %L', pg_temp.rv('va', 1)), 'P0004', null, 'nor its snapshot');
select throws_ok(format('update app.answer_key_revisions set instructions_revision = 9 where id = %L', pg_temp.rv('va', 1)), 'P0004', null, 'nor its instructions revision');
select throws_ok(format('update app.answer_key_revisions set source = ''edited'' where id = %L', pg_temp.rv('vr1', 1)), 'P0004', null, 'nor its source');
select throws_ok(format('update app.answer_keys set version_id = %L where version_id = %L', pg_temp.id('vc'), pg_temp.id('va')), 'P0004', null, 'a key never changes version');
select throws_ok(format($q$ insert into app.answer_key_revisions (institution_id, version_id, answer_key_id, number, source, content, version_revision, exercise_revisions, instructions_revision)
  select k.institution_id, k.version_id, k.id, 9, 'edited', '{}', 1, '{}', 1 from app.answer_keys k where k.version_id = %L $q$, pg_temp.id('va')), 'P0004', null, 'a revision with a number that skips is refused');
select throws_ok(format($q$ insert into app.answer_key_revisions (institution_id, version_id, answer_key_id, number, source, content, version_revision, exercise_revisions, instructions_revision)
  select k.institution_id, k.version_id, k.id, 1, 'edited', '{}', 1, '{}', 1 from app.answer_keys k where k.version_id = %L $q$, pg_temp.id('va')), 'P0004', null, 'and one that repeats a number');
select throws_ok(format($q$ insert into app.answer_key_revisions (institution_id, version_id, answer_key_id, number, source, content, version_revision, exercise_revisions, instructions_revision, generation_id)
  select k.institution_id, k.version_id, k.id, (select max(number) + 1 from app.answer_key_revisions r where r.answer_key_id = k.id), 'generated', '{}', 1, '{}', 1, g.id
    from app.answer_keys k, app.generations g where k.version_id = %L and g.id = %L $q$, pg_temp.id('vr7'), (select g.id from app.generations g where g.version_id = pg_temp.id('vr7') and g.kind = 'version' limit 1)),
  'P0004', null, 'a generated revision that comes from an adaptation generation is refused');
select throws_ok(format($q$ insert into app.answer_key_revisions (institution_id, version_id, answer_key_id, number, source, content, version_revision, exercise_revisions, instructions_revision, generation_id)
  select k.institution_id, k.version_id, k.id, (select max(number) + 1 from app.answer_key_revisions r where r.answer_key_id = k.id), 'generated', '{}', 1, '{}', 1, %L
    from app.answer_keys k where k.version_id = %L $q$, pg_temp.id('g1'), pg_temp.id('vr1')), '23505', null, 'a second revision for the same generation is refused by the unique index');

-- ---------------------------------------------------------------------------------------------
-- 018b. The validators of the outputs of T1.4d that this migration replaced: a missing field or an empty
-- object is discarded, never applied, the target stays whole and the replay has no effect.
-- ---------------------------------------------------------------------------------------------
select pg_temp.mkv('teach', 'g_n', 'vz', 2, 'gaze');
select pg_temp.as_service(format('select api.internal_create_generation(%L, ''version'', gen_random_uuid(), ''{}''::jsonb, repeat(''a'', 64), ''r1'', ''p1'', 3)', pg_temp.id('vz')));
insert into ids (k, id) select 'gz', g.id from app.generations g where g.version_id = pg_temp.id('vz') and g.kind = 'version' and g.status = 'running';
create function pg_temp.ro(p_kind text, p_out text, p_x text default null) returns jsonb language sql as $$
  select pg_temp.as_service(format('select api.internal_record_generation_output(%L, %L, %L::jsonb, %s)', pg_temp.id('gz'), p_kind, p_out,
    case when p_x is null then 'null' else quote_literal(pg_temp.id(p_x)) end))
$$;
create function pg_temp.zdigest() returns text language sql as $$
  select md5(coalesce((select string_agg(concat_ws('|', v.id, v.revision, v.instructions_revision, v.general_instructions, v.status, v.instructions_written_by), ';' order by v.id) from app.versions v where v.id = pg_temp.id('vz')), '')
          || coalesce((select string_agg(concat_ws('|', ve.id, ve.revision, ve.body, ve.status, ve.written_by_generation_id), ';' order by ve.id) from app.version_exercises ve where ve.version_id = pg_temp.id('vz')), '')
          || coalesce((select string_agg(concat_ws('|', q.id, q.revision, q.stem, q.options::text), ';' order by q.id) from app.version_questions q where q.version_id = pg_temp.id('vz')), '')
          || coalesce((select string_agg(concat_ws('|', k.question_id, k.correct_option_id), ';' order by k.question_id) from app.question_keys k where k.version_id = pg_temp.id('vz')), ''))
$$;
create temp table zbefore (d text);
insert into zbefore select pg_temp.zdigest();
select is((select count(*) from app.version_questions where version_id = pg_temp.id('vz')), 1::bigint, 'the version has a question that must survive');
select is(pg_temp.ro('gaze_questions', '{}', 'x_vz1') ->> 'outcome', 'discarded', 'gaze_questions {} is discarded');
select is(pg_temp.ro('gaze_questions', '{"questions": []}', 'x_vz2') ->> 'outcome', 'discarded', 'an empty list of questions too');
select is(pg_temp.ro('exercise', '{}', 'x_vz1') ->> 'outcome', 'discarded', 'exercise {} is discarded');
select is(pg_temp.ro('instructions', '{}') ->> 'outcome', 'discarded', 'instructions {} is discarded, and the output is not lost');
select is(pg_temp.ro('exercise', '{"changes": []}', 'x_vz2') ->> 'outcome', 'discarded', 'an exercise without body too');
select is((select count(*) from app.generation_outputs o where o.generation_id = pg_temp.id('gz') and o.outcome = 'discarded'), 5::bigint, 'the five raw outputs are stored');
select is(pg_temp.zdigest(), (select d from zbefore), 'and the version, its exercises, its question, its key and every revision are intact');
-- Fields that are absent or null, one by one: each case in a generation of its own (an output is unique per
-- generation, kind and exercise, so on the same generation it would only replay the stored one).
create function pg_temp.ro1(p_kind text, p_out text, p_x text default null) returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_service(format('select api.internal_create_generation(%L, ''version'', gen_random_uuid(), ''{}''::jsonb, repeat(''a'', 64), ''r1'', ''p1'', 3)', pg_temp.id('vz')));
  update ids set id = (select g.id from app.generations g where g.version_id = pg_temp.id('vz') and g.kind = 'version' and g.status = 'running') where k = 'gz';
  return pg_temp.ro(p_kind, p_out, p_x);
end $$;
select is(pg_temp.ro1('gaze_questions', '{"questions": [{"options": [{"id": "A", "text": "x"}, {"id": "B", "text": "y"}]}]}', 'x_vz1') ->> 'outcome', 'discarded', 'a question without stem is discarded');
select is(pg_temp.ro1('gaze_questions', '{"questions": [{"stem": "¿Cuánto?"}]}', 'x_vz1') ->> 'outcome', 'discarded', 'a question without options is discarded, not a NOT NULL error');
select is(pg_temp.err(pg_temp.ro1('exercise', '{"body": null}', 'x_vz1')), null, 'a null body does not raise');
select is(pg_temp.ro1('exercise', '{"body": null}', 'x_vz1') ->> 'outcome', 'discarded', 'and is discarded');
select is(pg_temp.ro1('instructions', '{"instructions": null}') ->> 'outcome', 'discarded', 'instructions null are discarded');
select is(pg_temp.ro1('gaze_questions', '{"questions": [{"stem": "x", "options": [{"id": "A", "text": "x"}, {"id": "B"}]}]}', 'x_vz1') ->> 'outcome', 'discarded', 'an option without text too');
select is(pg_temp.ro1('gaze_questions', '{"questions": [{"stem": "x", "options": [{"id": "A", "text": "x"}, {"text": "y"}]}]}', 'x_vz1') ->> 'outcome', 'discarded', 'an option without id too');
select is(pg_temp.ro1('gaze_questions', '{"questions": [{"stem": "x", "correct": "A", "options": [{"id": "A", "text": "x"}, {"id": "B", "text": "y"}]}]}', 'x_vz1') ->> 'outcome', 'discarded', 'a question that carries the correct option is discarded');
select is(pg_temp.ro1('gaze_questions', '{"questions": [{"stem": "x", "options": [{"id": "A", "text": "x", "correct": true}, {"id": "B", "text": "y"}]}]}', 'x_vz1') ->> 'outcome', 'discarded', 'and so is an option that says it is the correct one');
select is(pg_temp.ro1('gaze_questions', '{"questions": [{"stem": "x", "options": [{"id": "A", "text": "x"}]}]}', 'x_vz1') ->> 'outcome', 'discarded', 'a question with one option too');
select is(pg_temp.ro1('gaze_questions', '{"questions": "nada"}', 'x_vz1') ->> 'outcome', 'discarded', 'questions that are not a list too');
select is(pg_temp.ro1('exercise', '{"body": "   "}', 'x_vz1') ->> 'outcome', 'discarded', 'a body of blanks too');
select is(pg_temp.ro1('exercise', '[]', 'x_vz1') ->> 'error', 'P0001 INVALID invalid_output', 'and an output that is not an object is INVALID, as before');
select is(pg_temp.zdigest(), (select d from zbefore), 'the target is still intact after all of them');
-- The replay has no effect.
select pg_temp.ro1('gaze_questions', '{}', 'x_vz1');
select is(pg_temp.ro('gaze_questions', '{}', 'x_vz1') ->> 'outcome', 'discarded', 'a replay answers discarded');
select is(pg_temp.ro('gaze_questions', '{"questions": [{"stem": "Ahora sí", "options": [{"id": "A", "text": "x"}, {"id": "B", "text": "y"}]}]}', 'x_vz1') ->> 'outcome', 'discarded', 'even with a good output: the stored one counts');
select is(pg_temp.zdigest(), (select d from zbefore), 'the replay changed nothing');
select is((select count(*) from app.generation_outputs o where o.generation_id = pg_temp.id('gz')), 1::bigint, 'and wrote no new output');
-- A valid output of the same generation still applies.
select is(pg_temp.ro1('exercise', '{"body": "Texto bueno"}', 'x_vz2') ->> 'outcome', 'applied', 'a valid output of a generation in force still applies');

-- ---------------------------------------------------------------------------------------------
-- Nothing above disclosed a student
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from app.audit_log a where a.institution_id = pg_temp.id('i_n')), 0::bigint, 'none of the five key RPCs wrote an audit row: no student, profile or recipient comes out of them');

select * from finish();
rollback;
