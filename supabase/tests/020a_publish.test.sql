-- T1.5a: publish_version, first half. The checks (each one with its code and reason, and the proof that nothing
-- changed), what the copy carries and does not carry, the attempts and the key each one takes, the idempotency by op_key
-- (op_identity, op_attempts) and republishing. The permission matrix, the NULLs, the guards (as the owner, P0004) and the
-- lock order are in 020b. Races with two connections are in tests/integration/races/publish*.test.ts.
-- Placeholder text only. The whole file is rolled back.
begin;
-- Phase 1 links ordinary accounts (any email) to students; the shape guard of phase 2 (T2.5a) is off in this file. 040_f2_contract covers it.
alter table app.account_provisioning disable trigger student_auth_link_guard;
select plan(104);

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
insert into auth.users (id, email) select id, k || '@t1-5a.invalid' from ids where k <> 'ghost';
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
insert into ids (k, id) select 'i_n', (pg_temp.as_service($$ select api.internal_create_institution('Liceo N', 't1-5a', 'school') $$) ->> 'id')::uuid;
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
-- The revision a publication copied, as an SQL literal.
create function pg_temp.prev(p_pub text) returns text language sql as $$ select version_revision::text from app.publications where id = pg_temp.id(p_pub) $$;
create function pg_temp.npub(p_ver text) returns bigint language sql as $$ select count(*) from app.publications p where p.version_id = pg_temp.id(p_ver) $$;

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'api' and p.proname = 'publish_version'
              and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
              and not has_function_privilege('service_role', p.oid, 'execute')), 1::bigint,
  'authenticated executes publish_version; anon and service_role do not');

-- ---------------------------------------------------------------------------------------------
-- The happy path, typed: vt has two exercises and the recipients s1 and s2 (no generation: no consent is needed).
-- The seeds: a change with its reason on an adapted exercise, the configuration of the version has an interest, and
-- the assessment has instructions that are not the version's.
-- ---------------------------------------------------------------------------------------------
select pg_temp.mkv('g_n', 'vt', 2, 'typed', true, 'Instrucciones del práctico');
select pg_temp.edit_instr('vt', 'Instrucciones de la versión');
update app.version_exercises set changes = '[{"what":"centinela-cambio","why":"centinela-motivo"}]' where version_id = pg_temp.id('vt');
select pg_temp.recip('vt', array['s1', 's2']);
select pg_temp.apv('vt');
select is(pg_temp.keys(pg_temp.keepp('p1', pg_temp.pub('vt', quote_literal(gen_random_uuid())))), 'attempts,publicationId', 'publishing answers exactly its keys');
select is((select count(*) from app.publications where version_id = pg_temp.id('vt')), 1::bigint, 'one publication');
select is((select concat_ws('|', p.version_revision = v.revision, p.answer_mode, p.answer_key_revision_id is null, p.aids, p.published_by = pg_temp.id('teach'), p.withdrawn_at is null,
                             p.op_key is not null, p.op_identity ~ '^[0-9a-f]{64}$', p.op_attempts)
             from app.publications p join app.versions v on v.id = p.version_id where p.id = pg_temp.id('p1')),
  't|typed|t|{"readAloud": true}|t|t|t|t|2', 'it copies the approved revision, the mode and the aids, with no key; who published it; not withdrawn; and its op_key, identity and attempts');
select is((select p.assessment_id = a.id from app.publications p join app.assessments a on a.id = pg_temp.id('a_vt') where p.id = pg_temp.id('p1')), true, 'of its assessment');
select is((select p.content ->> 'generalInstructions' from app.publications p where p.id = pg_temp.id('p1')), 'Instrucciones de la versión', 'the copy carries the instructions of the VERSION, not the assessment''s');
select is((select (p.content -> 'exercises') from app.publications p where p.id = pg_temp.id('p1')),
  jsonb_build_array(jsonb_build_object('id', pg_temp.id('x_vt1'), 'label', '1', 'body', 'Adaptado 1'), jsonb_build_object('id', pg_temp.id('x_vt2'), 'label', '2', 'body', 'Adaptado 2')),
  'the adapted exercises, in the order of the original, with their label and text');
select is((select p.content -> 'questions' from app.publications p where p.id = pg_temp.id('p1')), '[]'::jsonb, 'typed has no questions');
select is((select string_agg(k, ',' order by k) from (select jsonb_object_keys(p.content) k from app.publications p where p.id = pg_temp.id('p1')) t), 'exercises,generalInstructions,questions',
  'the copy has exactly three keys: no config, no changes, no recipients');
select is((select count(*) from app.publications p, jsonb_array_elements(p.content -> 'exercises') e
            where p.id = pg_temp.id('p1') and (select string_agg(k, ',' order by k) from jsonb_object_keys(e) k) = 'body,id,label'), 2::bigint, 'and each exercise has exactly id, label and body');
select is((select p.content::text !~* '(centinela|changes|config|motor|profiles|interests|correct)' from app.publications p where p.id = pg_temp.id('p1')), true,
  'the copy does not mention the changes, their reasons, the configuration, a profile or a correct option');
select is((select p.aids::text !~* '(motor|dyslexia|adhd|asd|dysgraphia)' from app.publications p where p.id = pg_temp.id('p1')), true, 'and the aids do not name a profile');
select is((select count(*) from app.assignments a where a.assessment_id = pg_temp.id('a_vt')), 2::bigint, 'two assignments, one per recipient');
select is((select string_agg(a.status, ',') from app.assignments a where a.assessment_id = pg_temp.id('a_vt')), 'assigned,assigned', 'assigned');
select is(pg_temp.att('s1', 'p1'), '1|opened|t|t|1', 'the first student has attempt 1, opened, on the publication, with its key (none)');
select is(pg_temp.att('s2', 'p1'), '1|opened|t|t|1', 'and the second one too');
select is((select count(*) from app.assignment_attempts t where t.publication_id = pg_temp.id('p1') and t.first_viewed_at is null and t.started_at is null and t.submitted_at is null and not t.late), 2::bigint,
  'untouched by the student: not viewed, not started, not submitted');
select is((select count(*) from app.audit_log l where l.institution_id = pg_temp.id('i_n') and l.action like '%publish%'), 0::bigint, 'publishing is not an audited read: no disclosure row');
select is((select p.id from app.publications p where p.op_key = (select op_key from app.publications where id = pg_temp.id('p1'))), pg_temp.id('p1'), 'the op_key points at it');

-- revealWarnings does not block: a text that says the solution is published anyway (the service warns, T4.7).
select pg_temp.mkv('g_n', 'vw', 1, 'typed', false, 'Todo bien');
select pg_temp.edit_ex('x_vw1', 'La respuesta correcta es 4');
select pg_temp.recip('vw', array['s3']);
select pg_temp.apv('vw');
select is(pg_temp.err(pg_temp.pub('vw')), null, 'a text that reveals the solution does not block the publication');

-- A version with no recipients publishes with no attempts.
select pg_temp.ready('v0', 1, 'typed', array[]::text[]);
select is(pg_temp.keepp('p0', pg_temp.pub('v0')) ->> 'attempts', '0', 'a version with no recipients publishes and creates no attempt');
select is((select count(*) from app.assignments a where a.assessment_id = pg_temp.id('a_v0')), 0::bigint, 'nor an assignment');

-- ---------------------------------------------------------------------------------------------
-- Gaze: questions without the correct option, the key of the publication on each attempt
-- ---------------------------------------------------------------------------------------------
select pg_temp.ready('vg', 2, 'gaze', array['s3', 's4']);
select is(pg_temp.err(pg_temp.pub('vg')), null, 'sanity: the gaze version is publishable');
select is((select count(*) from app.publications where version_id = pg_temp.id('vg')), 1::bigint, 'and published once');
select is((select concat_ws('|', p.answer_mode, p.answer_key_revision_id = pg_temp.curid('vg')) from app.publications p where p.version_id = pg_temp.id('vg')), 'gaze|t',
  'a gaze publication without an explicit key takes the current revision of the answer key');
select is((select jsonb_array_length(p.content -> 'questions') from app.publications p where p.version_id = pg_temp.id('vg')), 2, 'the copy carries both questions');
select is((select count(*) from app.publications p, jsonb_array_elements(p.content -> 'questions') q
            where p.version_id = pg_temp.id('vg') and (select string_agg(k, ',' order by k) from jsonb_object_keys(q) k) = 'exerciseId,id,options,stem'), 2::bigint,
  'each question has exactly its id, its exercise, its stem and its options');
select is((select count(*) from app.publications p, jsonb_array_elements(p.content -> 'questions') q, jsonb_array_elements(q -> 'options') o
            where p.version_id = pg_temp.id('vg') and (select string_agg(k, ',' order by k) from jsonb_object_keys(o) k) = 'id,text'), 6::bigint,
  'and each option exactly its id and its text: nothing says which one is right');
select is((select (p.content -> 'questions' -> 0 ->> 'id')::uuid = pg_temp.id('q_vg1') and (p.content -> 'questions' -> 0 ->> 'exerciseId')::uuid = pg_temp.id('x_vg1')
             from app.publications p where p.version_id = pg_temp.id('vg')), true, 'the questions point at the adapted exercises, in order');
select is((select count(*) from app.assignment_attempts t join app.publications p on p.id = t.publication_id
            where p.version_id = pg_temp.id('vg') and t.answer_key_revision_id = p.answer_key_revision_id), 2::bigint, 'each attempt carries the key revision of its publication');
select is((select p.content::text !~* '(correct|"B"[^,]*key|answer)' from app.publications p where p.version_id = pg_temp.id('vg')), true, 'no correct option or answer anywhere in the copy');
-- A version whose profile list has dyslexia gets read aloud.
select pg_temp.mkv('g_n', 'vd', 1);
select pg_temp.as_user('teach', format($q$ select api.update_version_config(%L, %s, '{"profiles":["dyslexia","motor"],"supports":[],"interests":[]}'::jsonb, 'typed') $q$, pg_temp.id('vd'), pg_temp.rev('vd')));
select pg_temp.edit_ex('x_vd1', 'Adaptado de nuevo');
select pg_temp.apv('vd');
select pg_temp.keepp('pd', pg_temp.pub('vd'));
select is((select aids from app.publications where id = pg_temp.id('pd')), '{"readAloud": true}'::jsonb, 'a configuration with dyslexia has read aloud on, without naming the profile (T1.F5: it is on for everybody, see 020c)');

-- ---------------------------------------------------------------------------------------------
-- The checks, one by one. Each answers its code and reason and changes nothing.
-- ---------------------------------------------------------------------------------------------
select pg_temp.ready('vc', 1, 'typed', array['s5']);
select is(pg_temp.pe('vc', quote_literal(gen_random_uuid()), 'null', (pg_temp.rev('vc')::integer - 1)::text), 'P0001 CONFLICT revision_mismatch changed=false', 'an old revision is CONFLICT revision_mismatch');
select is(pg_temp.pe('vc', quote_literal(gen_random_uuid()), 'null', (pg_temp.rev('vc')::integer + 1)::text), 'P0001 CONFLICT revision_mismatch changed=false', 'and so is a revision from the future');
-- content_incomplete: the ticket's case, a typed version with a recipient and exercises that are still pending.
select pg_temp.mkv('g_n', 'vp', 2, 'typed', false);
select pg_temp.recip('vp', array['s1']);
select is(pg_temp.pe('vp'), 'P0001 CONFLICT content_incomplete changed=false', 'typed with a recipient and pending exercises is CONFLICT content_incomplete');
select pg_temp.edit_ex('x_vp1', 'Solo uno');
select is(pg_temp.pe('vp'), 'P0001 CONFLICT content_incomplete changed=false', 'with only one of the two ready it still is');
update app.version_exercises set status = 'error', error_code = 'generation_failed' where id = pg_temp.id('x_vp2');
select is(pg_temp.pe('vp'), 'P0001 CONFLICT content_incomplete changed=false', 'an exercise in error too');
select pg_temp.edit_ex('x_vp2', 'El otro');
select is(pg_temp.pe('vp'), 'P0001 CONFLICT not_approved changed=false', 'complete but never approved is CONFLICT not_approved');
-- not_approved: edited after approving, rejected, and recipients changed after approving.
select pg_temp.apv('vp');
select is(pg_temp.err(pg_temp.pub('vp')), null, 'sanity: approved, it publishes');
select pg_temp.edit_ex('x_vc1', 'Cambiado después de aprobar');
select is(pg_temp.pe('vc'), 'P0001 CONFLICT not_approved changed=false', 'edited after approving: CONFLICT not_approved, with the revision of today');
select pg_temp.apv('vc');
select pg_temp.as_user('teach', format('select api.reject_version(%L, %s, ''{no_adapta}'', gen_random_uuid())', pg_temp.id('vc'), pg_temp.rev('vc')));
select is(pg_temp.pe('vc'), 'P0001 CONFLICT not_approved changed=false', 'rejected: CONFLICT not_approved');
select pg_temp.apv('vc');
select pg_temp.recip('vc', array['s5', 's4']);
select is(pg_temp.pe('vc'), 'P0001 CONFLICT not_approved changed=false', 'the recipients changed after approving: CONFLICT not_approved');
select pg_temp.recip('vc', array['s5']);
select pg_temp.apv('vc');
-- missing_questions and the key, in gaze mode.
select pg_temp.mkv('g_n', 'vm', 2, 'gaze');
select pg_temp.gazeq('vm', 1);
select pg_temp.ek('vm');
select pg_temp.recip('vm', array['s1']);
select pg_temp.apv('vm');
select is(pg_temp.pe('vm'), 'P0001 CONFLICT missing_questions changed=false', 'gaze with an exercise that has no question is CONFLICT missing_questions');
select pg_temp.mkv('g_n', 'vq', 1, 'gaze');
select pg_temp.recip('vq', array['s1']);
select pg_temp.apv('vq');
select is(pg_temp.pe('vq'), 'P0001 CONFLICT missing_questions changed=false', 'and with no question at all');
select pg_temp.mkv('g_n', 'vk', 1, 'gaze');
select pg_temp.gazeq('vk', 1);
select pg_temp.recip('vk', array['s1']);
select pg_temp.apv('vk');
select is(pg_temp.pe('vk'), 'P0001 CONFLICT no_answer_key changed=false', 'gaze with no key at all is CONFLICT no_answer_key');
select is(pg_temp.pe('vk', quote_literal(gen_random_uuid()), quote_literal(gen_random_uuid())), 'P0001 NOT_FOUND not_found changed=false', 'and a key revision that does not exist is NOT_FOUND');
select is(pg_temp.pe('vk', quote_literal(gen_random_uuid()), quote_literal(pg_temp.curid('vg'))), 'P0001 NOT_FOUND not_found changed=false', 'or one of another version');

-- stale_answer_key. The ticket's case: the instructions change after the key was approved, so the key must be confirmed.
select pg_temp.ready('vs', 1, 'gaze', array['s2']);
select pg_temp.keepp('ps0', pg_temp.pub('vs', quote_literal(gen_random_uuid()), 'null', null, 'teach'));
select pg_temp.ak('vs');
select is((select k.approved_revision_id = k.current_revision_id from app.answer_keys k where k.version_id = pg_temp.id('vs')), true, 'sanity: the key is approved');
select pg_temp.edit_instr('vs', 'Ahora respondé en metros');
select pg_temp.apv('vs');
select is(pg_temp.pe('vs', quote_literal(gen_random_uuid()), quote_literal(pg_temp.curid('vs'))), 'P0001 CONFLICT stale_answer_key changed=false', 'after changing the instructions the approved key is CONFLICT stale_answer_key');
select is(pg_temp.pe('vs'), 'P0001 CONFLICT stale_answer_key changed=false', 'also when it is the default one (the current revision)');
select pg_temp.ck('vs');
select is(pg_temp.pe('vs', quote_literal(gen_random_uuid()), quote_literal((select r.id from app.answer_key_revisions r join app.answer_keys k on k.id = r.answer_key_id
                                                                              where k.version_id = pg_temp.id('vs') and r.number = 1))), 'P0001 CONFLICT stale_answer_key changed=false',
  'the old revision is still stale after confirming');
select is(pg_temp.err(pg_temp.keepp('ps1', pg_temp.pub('vs'))), null, 'confirmed, it publishes with the current revision');
select is((select p.answer_key_revision_id = pg_temp.curid('vs') from app.publications p where p.id = pg_temp.id('ps1')), true, 'the one just confirmed');
-- Swapping two options (same ids) also makes it stale; and a typed version that is given a stale key.
select pg_temp.as_user('teach', format($q$ select api.update_version_question(%L, %s, 'Enunciado', '[{"id":"B","text":"4"},{"id":"A","text":"3"},{"id":"C","text":"5"}]'::jsonb, gen_random_uuid()) $q$,
  pg_temp.id('q_vs1'), (select revision from app.version_questions where id = pg_temp.id('q_vs1'))));
select pg_temp.apv('vs');
select is(pg_temp.pe('vs'), 'P0001 CONFLICT stale_answer_key changed=false', 'swapping two options (same ids) makes the key stale too');
select pg_temp.ready('vy', 1, 'typed', array['s4']);
select pg_temp.as_user('teach', format('select api.edit_answer_key(%L, %L::jsonb, null)', pg_temp.id('vy'), pg_temp.kc('vy')));
select pg_temp.edit_ex('x_vy1', 'Otro texto');
select pg_temp.apv('vy');
select is(pg_temp.pe('vy', quote_literal(gen_random_uuid()), quote_literal(pg_temp.curid('vy'))), 'P0001 CONFLICT stale_answer_key changed=false', 'a typed version given a key that no longer corresponds is CONFLICT stale_answer_key');
select is(pg_temp.err(pg_temp.keepp('py', pg_temp.pub('vy'))), null, 'and without a key (the default in typed mode) it publishes');
select is((select answer_key_revision_id from app.publications where id = pg_temp.id('py')), null, 'with no key: in typed mode it is optional and null means none');
select pg_temp.ck('vy');
select is(pg_temp.err(pg_temp.keepp('py2', pg_temp.pub('vy', quote_literal(gen_random_uuid()), pg_temp.cur('vy')))), null, 'a typed version with a key that corresponds publishes it');
select is((select answer_key_revision_id = pg_temp.curid('vy') from app.publications where id = pg_temp.id('py2')), true, 'and the publication carries it');
select is((select t.answer_key_revision_id = pg_temp.curid('vy') from app.assignment_attempts t where t.publication_id = pg_temp.id('py2')), true, 'and so does the attempt');

-- not_enrolled and missing_consent.
select pg_temp.ready('ve', 1, 'typed', array['s2', 's3']);
select pg_temp.as_user('teach', format('select api.unenroll_student(%L, %L)', pg_temp.id('g_n'), pg_temp.id('s3')));
select is(pg_temp.pe('ve'), 'P0001 CONFLICT not_enrolled changed=false', 'a recipient who is no longer enrolled is CONFLICT not_enrolled');
select pg_temp.as_user('teach', format('select api.enroll_student(%L, %L)', pg_temp.id('g_n'), pg_temp.id('s3')));
select is(pg_temp.err(pg_temp.pub('ve')), null, 'enrolled again, it publishes');
select pg_temp.ready('va', 1, 'typed', array['s4']);
select pg_temp.as_user('teach', format('select api.archive_student(%L, %s)', pg_temp.id('s4'), (select revision from app.students where id = pg_temp.id('s4'))));
select is(pg_temp.pe('va'), 'P0001 CONFLICT not_enrolled changed=false', 'an archived recipient is CONFLICT not_enrolled too');
select pg_temp.as_user('teach', format('select api.restore_student(%L, %s)', pg_temp.id('s4'), (select revision from app.students where id = pg_temp.id('s4'))));

select pg_temp.ready('vn', 1, 'typed', array['s1', 's2']);
select pg_temp.gen('vn');
select is(pg_temp.pe('vn'), 'P0001 CONFLICT missing_consent changed=false', 'a version with a generation and recipients without consent is CONFLICT missing_consent');
select pg_temp.consent('s1');
select is(pg_temp.pe('vn'), 'P0001 CONFLICT missing_consent changed=false', 'with one of the two it still is');
select pg_temp.consent('s2');
select is(pg_temp.err(pg_temp.pub('vn')), null, 'with both it publishes');
select pg_temp.as_user('teach', format('select api.revoke_consent(%L, %s)', (select c.id from app.consents c where c.student_id = pg_temp.id('s2') and c.status = 'granted'), 1));
select is(pg_temp.pe('vn'), 'P0001 CONFLICT missing_consent changed=false', 'a consent that was revoked does not count');
-- An expired consent (written as the owner: the RPC refuses a past expiry) does not count either.
insert into app.consents (institution_id, student_id, purpose, text_version, status, valid_from, valid_until, revoked_at)
  values (pg_temp.id('i_n'), pg_temp.id('s5'), 'ai_adaptation', '2026-01', 'granted', now() - interval '2 days', now() - interval '1 day', null);
select pg_temp.ready('vx', 1, 'typed', array['s5']);
select pg_temp.gen('vx');
select is(pg_temp.pe('vx'), 'P0001 CONFLICT missing_consent changed=false', 'an expired consent does not count');
select is((select count(*) from app.consents where student_id = pg_temp.id('s1') and purpose = 'ai_dictation'), 0::bigint, 'sanity: s1 has no dictation consent');
select pg_temp.as_user('teach', format('select api.record_consent(%L, ''ai_dictation'', ''2026-11'', null, null)', pg_temp.id('s5')));
select is(pg_temp.pe('vx'), 'P0001 CONFLICT missing_consent changed=false', 'a consent for another purpose does not count');

-- State of the assessment, the group and the version.
select pg_temp.ready('vr', 1, 'typed', array['s2']);
select pg_temp.as_user('teach', format('select api.archive_version(%L, %s)', pg_temp.id('vr'), pg_temp.rev('vr')));
select is(pg_temp.pe('vr', quote_literal(gen_random_uuid()), 'null', (select (revision - 1)::text from app.versions where id = pg_temp.id('vr'))), 'P0001 INVALID version_archived changed=false', 'an archived version is INVALID version_archived');
select pg_temp.ready('vz', 1, 'typed', array['s2']);
select pg_temp.as_user('teach', format('select api.archive_assessment(%L, %s)', pg_temp.id('a_vz'), (select revision from app.assessments where id = pg_temp.id('a_vz'))));
select is(pg_temp.pe('vz'), 'P0001 INVALID assessment_archived changed=false', 'an archived assessment is INVALID assessment_archived');
select is((select count(*) from app.publications where version_id in (pg_temp.id('vr'), pg_temp.id('vz'))), 0::bigint, 'and neither published');

-- ---------------------------------------------------------------------------------------------
-- Idempotency: op_key with its op_identity and op_attempts (T1.F3). vo has recipients s1 and s2.
-- ---------------------------------------------------------------------------------------------
select pg_temp.ready('vo', 2, 'typed', array['s1', 's2']);
select pg_temp.ready('vo2', 1, 'typed', array['s3']);
insert into ids (k, id) values ('opa', gen_random_uuid()), ('opb', gen_random_uuid()), ('opc', gen_random_uuid());
select pg_temp.keepp('po1', pg_temp.pub('vo', quote_literal(pg_temp.id('opa'))));
select is((select op_attempts from app.publications where id = pg_temp.id('po1')), 2, 'the first publish stores 2 attempts');
select is((select op_identity from app.publications where id = pg_temp.id('po1')),
  encode(sha256(convert_to(jsonb_build_array('publish_version', pg_temp.id('vo'), (select approved_revision from app.versions where id = pg_temp.id('vo')), null::uuid)::text, 'utf8')), 'hex'),
  'its identity is the sha256 of the RPC, the version, the revision and the key revision (null)');
select is(pg_temp.pub('vo', quote_literal(pg_temp.id('opa'))), jsonb_build_object('publicationId', pg_temp.id('po1'), 'attempts', 2), 'the same op_key and the same data answer the same publication and attempts');
select is(pg_temp.pe('vo2', quote_literal(pg_temp.id('opa'))), 'P0001 CONFLICT op_key_reused changed=false', 'the same op_key on another version is CONFLICT op_key_reused');
select is(pg_temp.pe('vo', quote_literal(pg_temp.id('opa')), 'null', (pg_temp.rev('vo')::integer - 1)::text), 'P0001 CONFLICT op_key_reused changed=false', 'the same op_key with another revision too (the identity is checked before the revision)');
select is(pg_temp.pe('vo', quote_literal(pg_temp.id('opa')), quote_literal(gen_random_uuid())), 'P0001 CONFLICT op_key_reused changed=false', 'and with another key revision');
select is((select count(*) from app.publications where version_id = pg_temp.id('vo')), 1::bigint, 'one publication in the end');
-- A later publication moves the attempts: the replay of the first still answers what it did.
select pg_temp.keepp('po2', pg_temp.pub('vo', quote_literal(pg_temp.id('opb'))));
select is(pg_temp.att('s1', 'po2'), '1|opened|t|t|2', 'a second publication moves the unstarted attempt to itself (and bumps its revision)');
select is(pg_temp.pub('vo', quote_literal(pg_temp.id('opa')), 'null', pg_temp.prev('po1')), jsonb_build_object('publicationId', pg_temp.id('po1'), 'attempts', 2),
  'the replay of the first still answers its publication and its 2 attempts, as stored');
-- It does not depend on what changed afterwards: the version edited, the assessment archived.
select pg_temp.edit_ex('x_vo1', 'Cambio posterior');
select is(pg_temp.pub('vo', quote_literal(pg_temp.id('opa')), 'null', pg_temp.prev('po1')), jsonb_build_object('publicationId', pg_temp.id('po1'), 'attempts', 2),
  'the replay after the version was edited answers the same');
select pg_temp.as_user('teach', format('select api.archive_assessment(%L, %s)', pg_temp.id('a_vo'), (select revision from app.assessments where id = pg_temp.id('a_vo'))));
select is(pg_temp.pub('vo', quote_literal(pg_temp.id('opa')), 'null', pg_temp.prev('po1')), jsonb_build_object('publicationId', pg_temp.id('po1'), 'attempts', 2), 'and after the assessment was archived');
select is(pg_temp.pe('vo', quote_literal(pg_temp.id('opc'))), 'P0001 INVALID assessment_archived changed=false', 'while a new op_key on it is refused');
select is(pg_temp.pe('vo', quote_literal(pg_temp.id('opa')), 'null', pg_temp.prev('po1'), 'stu_a'), 'P0001 FORBIDDEN forbidden changed=false', 'a replay is authorized like the first call: a student of the group cannot');
-- Another institution: the same op_key is its own.
select is(pg_temp.err(pg_temp.as_user('userb', format('select api.publish_version(%L, 1, %L, null)', pg_temp.id('vo'), pg_temp.id('opa')))), 'P0001 NOT_FOUND not_found', 'a teacher of another institution cannot replay it: the version does not exist for them');

-- ---------------------------------------------------------------------------------------------
-- Republishing: only the attempts nobody started move, with the new key (vr1: gaze, s2, s3, s4)
-- ---------------------------------------------------------------------------------------------
select pg_temp.ready('vrp', 2, 'gaze', array['s2', 's3', 's4']);
select pg_temp.keepp('r1', pg_temp.pub('vrp'));
select is((select op_attempts from app.publications where id = pg_temp.id('r1')), 3, 'the first publication creates 3 attempts');
-- s2 starts (opened -> started) and s3 submits, as the owner (T1.5b writes those RPCs).
update app.assignment_attempts t set status = 'started', started_at = now() from app.assignments a where a.id = t.assignment_id and a.student_id = pg_temp.id('s2') and a.assessment_id = pg_temp.id('a_vrp');
update app.assignment_attempts t set status = 'submitted', started_at = now(), submitted_at = now() from app.assignments a where a.id = t.assignment_id and a.student_id = pg_temp.id('s3') and a.assessment_id = pg_temp.id('a_vrp');
-- The teacher fixes an exercise, confirms the key and approves again.
select pg_temp.edit_ex('x_vrp1', 'Corregido');
select pg_temp.ck('vrp');
select pg_temp.apv('vrp');
select is(pg_temp.keepp('r2', pg_temp.pub('vrp')) ->> 'attempts', '1', 'republishing moves only the attempt nobody started: 1');
select is(pg_temp.att('s4', 'r2'), '1|opened|t|t|2', 'the unstarted one is on the new publication, with the new key');
select is((select t.answer_key_revision_id = pg_temp.curid('vrp') from app.assignment_attempts t join app.assignments a on a.id = t.assignment_id where a.student_id = pg_temp.id('s4') and a.assessment_id = pg_temp.id('a_vrp')), true, 'which is the confirmed revision');
select is(pg_temp.att('s2', 'r1'), '1|started|t|t|1', 'the started one stays on the first publication with its key, untouched');
select is(pg_temp.att('s3', 'r1'), '1|submitted|t|t|1', 'and the submitted one too');
select is((select count(*) from app.assignments a where a.assessment_id = pg_temp.id('a_vrp')), 3::bigint, 'no new assignment');
select is((select count(*) from app.assignment_attempts t where t.assessment_id = pg_temp.id('a_vrp')), 3::bigint, 'and no new attempt');
select is((select p.answer_key_revision_id <> pg_temp.curid('vrp') from app.publications p where p.id = pg_temp.id('r1')), true, 'the first publication keeps its own key revision');
-- A recipient added afterwards gets an assignment and an attempt; one removed keeps what he had.
select pg_temp.recip('vrp', array['s2', 's4', 's5']);
select pg_temp.apv('vrp');
select is(pg_temp.keepp('r3', pg_temp.pub('vrp')) ->> 'attempts', '2', 'a new recipient (created) and the unstarted one (moved): 2');
select is(pg_temp.att('s5', 'r3'), '1|opened|t|t|1', 'the new recipient has attempt 1');
select is(pg_temp.att('s4', 'r3'), '1|opened|t|t|3', 'the unstarted one moved again');
select is(pg_temp.att('s3', 'r1'), '1|submitted|t|t|1', 'the one who is no longer a recipient keeps his submitted attempt on the publication he had');
-- A withdrawn assignment and an assignment with no attempt in force.
update app.assignments set status = 'withdrawn' where assessment_id = pg_temp.id('a_vrp') and student_id = pg_temp.id('s4');
update app.assignment_attempts t set superseded_at = now() from app.assignments a where a.id = t.assignment_id and a.student_id = pg_temp.id('s5') and a.assessment_id = pg_temp.id('a_vrp');
select is(pg_temp.keepp('r4', pg_temp.pub('vrp')) ->> 'attempts', '1', 'a withdrawn assignment is not touched and one with every attempt superseded gets a new one: 1');
select is((select t.number || '|' || t.status || '|' || (t.publication_id = pg_temp.id('r4')) from app.assignment_attempts t join app.assignments a on a.id = t.assignment_id
            where a.student_id = pg_temp.id('s5') and a.assessment_id = pg_temp.id('a_vrp') and t.superseded_at is null), '2|opened|true', 'that one is attempt 2 on the new publication');
select is((select t.publication_id = pg_temp.id('r3') from app.assignment_attempts t join app.assignments a on a.id = t.assignment_id where a.student_id = pg_temp.id('s4') and a.assessment_id = pg_temp.id('a_vrp')), true, 'and the withdrawn one is still on the publication he had');
select is((select t.number from app.assignment_attempts t join app.assignments a on a.id = t.assignment_id where a.student_id = pg_temp.id('s5') and a.assessment_id = pg_temp.id('a_vrp') and t.superseded_at is not null), 1, 'the superseded attempt keeps its number');

select * from finish();
rollback;
