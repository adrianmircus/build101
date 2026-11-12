-- T1.F8 (F1-4): ownership guards. The columns that say whom a row belongs to never move to another parent: an UPDATE as the
-- table owner (the grants of the roles stop it earlier with 42501, which would pass even with no guard) has to fail with P0004.
-- The only changes allowed are the documented ones of the erasure and of the foreign keys that set an actor to NULL.
-- Placeholder data only. The whole file is rolled back.
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
  'admin', 'teach', 'incl', 'userb', 'nobody', 'ghost', 'stu_a', 'stu_b', 'stu_c', 'stu_d'
]) as k;
insert into auth.users (id, email) select id, k || '@t1-f7c.invalid' from ids where k <> 'ghost' and k not like 'stu\_%';
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
select pg_temp.link_student(pg_temp.id(l.s), pg_temp.id(l.u))
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
-- Setup: a second group and a second student with an attempt, as the table owner would find them
-- ---------------------------------------------------------------------------------------------
-- The SQLSTATE of a statement run as the owner, or 'ok'. A failed statement leaves no trace (the function is a subtransaction).
create function pg_temp.st(p_sql text) returns text
language plpgsql as $f$
declare
  v_state text;
begin
  execute p_sql;
  return 'ok';
exception
  when assert_failure then
    return 'P0004';  -- the guards raise P0004, which is ASSERT_FAILURE and not covered by OTHERS
  when others then
    get stacked diagnostics v_state = returned_sqlstate;
    return v_state;
end
$f$;
create function pg_temp.i(p_key text) returns text language sql as $$ select quote_literal(pg_temp.id(p_key)) $$;

insert into ids (k, id) select 'g2', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º B'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid;
select pg_temp.as_user('stu_b', pg_temp.q_start('t_s2_vt'));
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_n'), pg_temp.id('nobody')));
select pg_temp.as_user('teach', format('select api.add_group_staff(%L, %L, ''co_teacher'')', pg_temp.id('g_n'), pg_temp.id('nobody')));

-- ---------------------------------------------------------------------------------------------
-- enrollments, group_staff, submissions (the three of the review)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.st(format('update app.enrollments set group_id = %s where student_id = %s and group_id = %s', pg_temp.i('g2'), pg_temp.i('s1'), pg_temp.i('g_n'))), 'P0004',
  'enrollments: an enrollment does not move to another group');
select is(pg_temp.st(format('update app.enrollments set student_id = %s where student_id = %s and group_id = %s', pg_temp.i('s3'), pg_temp.i('s1'), pg_temp.i('g_n'))), 'P0004',
  'enrollments: nor to another student');
select is(pg_temp.st(format('update app.enrollments set ended_at = now() where student_id = %s and group_id = %s', pg_temp.i('s1'), pg_temp.i('g_n'))), 'ok',
  'control: ending an enrollment is still an update of the row');
select is(pg_temp.st(format('update app.group_staff set group_id = %s where user_id = %s and group_id = %s', pg_temp.i('g2'), pg_temp.i('nobody'), pg_temp.i('g_n'))), 'P0004',
  'group_staff: a staff row does not move to another group');
select is(pg_temp.st(format('update app.group_staff set user_id = %s where user_id = %s and group_id = %s', pg_temp.i('incl'), pg_temp.i('nobody'), pg_temp.i('g_n'))), 'P0004',
  'group_staff: nor to another person');
select is(pg_temp.st(format('update app.group_staff set removed_at = now() where user_id = %s and group_id = %s', pg_temp.i('nobody'), pg_temp.i('g_n'))), 'ok',
  'control: removing a person from the staff is still an update of the row');
select is((select count(*) from app.submissions where attempt_id in (pg_temp.id('t_s1_vg'), pg_temp.id('t_s2_vt'))), 2::bigint, 'control: both attempts have their draft');
select is(pg_temp.st(format('update app.submissions set attempt_id = %s where attempt_id = %s', pg_temp.i('t_s2_vt'), pg_temp.i('t_s1_vg'))), 'P0004',
  'submissions: a draft does not move to the attempt of another student');
select is((select count(*) from app.submissions where attempt_id = pg_temp.id('t_s1_vg')), 1::bigint, 'and it is where it was');

-- ---------------------------------------------------------------------------------------------
-- Identity of the student: pseudonym, provisioning, the account
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.st(format('update app.student_pseudonyms set student_id = %s where student_id = %s', pg_temp.i('s2'), pg_temp.i('s1'))), 'P0004',
  'student_pseudonyms: a pseudonym does not pass to another student');
select is(pg_temp.st(format('update app.student_pseudonyms set student_id = null, unlinked_at = now() where student_id = %s', pg_temp.i('s4'))), 'ok',
  'control: the erasure unlinks it (student_id goes to NULL)');
select is(pg_temp.st(format('update app.student_pseudonyms set student_id = %s where student_id is null and id in (select id from app.student_pseudonyms where unlinked_at is not null)', pg_temp.i('s2'))), 'P0004',
  'and an unlinked pseudonym is not linked again');
select is((select count(*) from app.student_pseudonyms where unlinked_at is not null) > 0, true, 'there is an unlinked pseudonym to try');
select is(pg_temp.st('update app.student_pseudonyms p set institution_id = (select i.id from app.institutions i where i.id <> p.institution_id limit 1) where p.unlinked_at is not null'), 'P0004',
  'student_pseudonyms: an unlinked pseudonym does not move to another institution');
select is(pg_temp.st(format('update app.student_pseudonyms set created_at = now() - interval ''1 day'' where student_id = %s', pg_temp.i('s1'))), 'P0004',
  'student_pseudonyms: its creation date is frozen too');
select is(pg_temp.st(format('update app.account_provisioning set auth_user_id = coalesce(auth_user_id, ''00000000-0000-4000-8000-0000000000f1'') where student_id = %s', pg_temp.i('s1'))), 'ok',
  'control: an account is linked once');
select is(pg_temp.st(format('update app.account_provisioning set auth_user_id = ''00000000-0000-4000-8000-0000000000f2'' where student_id = %s', pg_temp.i('s1'))), 'P0004',
  'account_provisioning: a linked account is not swapped for another');
select is(pg_temp.st(format('update app.account_provisioning set auth_user_id = null where student_id = %s', pg_temp.i('s1'))), 'P0004',
  'account_provisioning: nor is it emptied (T1.F10: the contract keeps the UUID after the Auth account is deleted)');
select is(pg_temp.st(format('update app.account_provisioning set student_id = %s where student_id = %s', pg_temp.i('s2'), pg_temp.i('s1'))), 'P0004',
  'account_provisioning: a provisioning row does not pass to another student');
select is(pg_temp.st(format('update app.account_provisioning set student_id = null, status = ''deleted'' where student_id = %s', pg_temp.i('s4'))), 'P0004',
  'account_provisioning: student_id goes to NULL only when the student is deleted (T1.F12; 002 covers the FK path)');
select is(pg_temp.st(format('update app.students set user_id = %s where id = %s', pg_temp.i('stu_c'), pg_temp.i('s2'))), 'P0004',
  'students: an account tied to a student is not moved to another account');
select is(pg_temp.st(format('update app.students set user_id = null where id = %s', pg_temp.i('s4'))), 'P0004',
  'students: it is not untied while its account exists (only deleting the account empties it, T1.F11)');

-- ---------------------------------------------------------------------------------------------
-- groups, files, syllabi
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.st(format('update app.groups set subject_id = ''physics'' where id = %s', pg_temp.i('g_n'))), 'P0004', 'groups: a group does not change its subject');
select is(pg_temp.st(format('update app.groups set created_by = %s where id = %s', pg_temp.i('incl'), pg_temp.i('g_n'))), 'P0004', 'groups: created_by is not handed to another person');
select is(pg_temp.st(format('update app.groups set created_by = null where id = %s', pg_temp.i('g2'))), 'ok', 'control: the foreign key sets it to NULL when the account goes');

insert into ids (k, id) select k, gen_random_uuid() from unnest(array['f_syl', 'f_con']) as k;
insert into app.files (id, institution_id, bucket, path, purpose, group_id, max_bytes, mime_type, reserved_by)
  values (pg_temp.id('f_syl'), pg_temp.id('i_n'), 'uploads', pg_temp.id('i_n')::text || '/' || pg_temp.id('f_syl')::text, 'syllabus', pg_temp.id('g_n'), 1000, 'application/pdf', pg_temp.id('teach'));
insert into app.files (id, institution_id, bucket, path, purpose, student_id, max_bytes, mime_type, reserved_by)
  values (pg_temp.id('f_con'), pg_temp.id('i_n'), 'consents', pg_temp.id('i_n')::text || '/' || pg_temp.id('f_con')::text, 'consent_form', pg_temp.id('s1'), 1000, 'application/pdf', pg_temp.id('teach'));
select is(pg_temp.st(format('update app.files set group_id = %s where id = %s', pg_temp.i('g2'), pg_temp.i('f_syl'))), 'P0004', 'files: a file does not move to another group');
select is(pg_temp.st(format('update app.files set student_id = %s where id = %s', pg_temp.i('s2'), pg_temp.i('f_con'))), 'P0004', 'files: nor to another student');
select is(pg_temp.st(format('update app.files set reserved_by = %s where id = %s', pg_temp.i('incl'), pg_temp.i('f_syl'))), 'P0004', 'files: reserved_by is not handed to another person');
select is(pg_temp.st(format('update app.files set reserved_by = null where id = %s', pg_temp.i('f_syl'))), 'ok', 'control: reserved_by goes to NULL');

insert into app.syllabi (institution_id, group_id) values (pg_temp.id('i_n'), pg_temp.id('g_n'));
select is(pg_temp.st(format('update app.syllabi set group_id = %s where group_id = %s', pg_temp.i('g2'), pg_temp.i('g_n'))), 'P0004', 'syllabi: a syllabus does not move to another group');

-- ---------------------------------------------------------------------------------------------
-- operations and group analyses
-- ---------------------------------------------------------------------------------------------
insert into ids (k, id) select k, gen_random_uuid() from unnest(array['op1', 'op2']) as k;
insert into app.operations (id, institution_id, kind, op_key, group_id, assessment_id, file_id, requested_by, required_parts)
  values (pg_temp.id('op1'), pg_temp.id('i_n'), 'analyze_group', gen_random_uuid(), pg_temp.id('g_n'), pg_temp.id('a_vg'), pg_temp.id('f_syl'), pg_temp.id('teach'), 1),
         (pg_temp.id('op2'), pg_temp.id('i_n'), 'analyze_group', gen_random_uuid(), pg_temp.id('g_n'), null, null, null, 1);
select is(pg_temp.st(format('update app.operations set group_id = %s where id = %s', pg_temp.i('g2'), pg_temp.i('op1'))), 'P0004', 'operations: an operation does not move to another group');
select is(pg_temp.st(format('update app.operations set assessment_id = %s where id = %s', pg_temp.i('a_vt'), pg_temp.i('op1'))), 'P0004', 'operations: nor to another assessment');
select is(pg_temp.st(format('update app.operations set file_id = %s where id = %s', pg_temp.i('f_con'), pg_temp.i('op1'))), 'P0004', 'operations: nor to another file');
select is(pg_temp.st(format('update app.operations set requested_by = %s where id = %s', pg_temp.i('incl'), pg_temp.i('op1'))), 'P0004', 'operations: requested_by is not handed to another person');
select is(pg_temp.st(format('update app.operations set requested_by = null where id = %s', pg_temp.i('op1'))), 'ok', 'control: requested_by goes to NULL');
select is(pg_temp.st(format('update app.operations set assessment_id = %s, file_id = %s where id = %s', pg_temp.i('a_vt'), pg_temp.i('f_con'), pg_temp.i('op2'))), 'ok',
  'control: a reference that was empty can be filled once');

insert into app.group_analyses (id, institution_id, group_id, assessment_id, operation_id, inputs_hash, analyzer_version, pseudonym_map, result)
  values (gen_random_uuid(), pg_temp.id('i_n'), pg_temp.id('g_n'), pg_temp.id('a_vg'), pg_temp.id('op1'), repeat('0', 64), 'v1', '{}', '{}');
select is(pg_temp.st(format('update app.group_analyses set group_id = %s', pg_temp.i('g2'))), 'P0004', 'group_analyses: an analysis does not move to another group');
select is(pg_temp.st(format('update app.group_analyses set assessment_id = %s', pg_temp.i('a_vt'))), 'P0004', 'group_analyses: nor to another assessment');
select is(pg_temp.st(format('update app.group_analyses set operation_id = %s', pg_temp.i('op2'))), 'P0004', 'group_analyses: nor to another operation');

-- ---------------------------------------------------------------------------------------------
-- Rows of a person: institutions (sandbox owner), invitations, notifications, presets, sandbox sessions, imports, erasures
-- ---------------------------------------------------------------------------------------------
insert into ids (k, id) select 'i_sb', (pg_temp.as_service(format(
  $$ select api.internal_create_institution('Demo F8', 't1f8-sb', 'sandbox', now() + interval '1 day', %L) $$, pg_temp.id('teach'))) ->> 'id')::uuid;
select is(pg_temp.st(format('update app.institutions set owner_user_id = %s where id = %s', pg_temp.i('incl'), pg_temp.i('i_sb'))), 'P0004', 'institutions: a sandbox does not change its owner');
insert into app.sandbox_sessions (id, institution_id, owner_user_id, refresh_token_ciphertext, expires_at)
  values (gen_random_uuid(), pg_temp.id('i_sb'), pg_temp.id('teach'), '\x00', now() + interval '1 day');
select is(pg_temp.st(format('update app.sandbox_sessions set owner_user_id = %s', pg_temp.i('incl'))), 'P0004', 'sandbox_sessions: nor does its session');

insert into app.invitations (id, institution_id, email, role, token_hash, expires_at, invited_by)
  values (gen_random_uuid(), pg_temp.id('i_n'), 'persona@ejemplo.invalid', 'teacher', decode(repeat('00', 32), 'hex'), now() + interval '1 day', pg_temp.id('teach'));
select is(pg_temp.st(format('update app.invitations set invited_by = %s', pg_temp.i('incl'))), 'P0004', 'invitations: invited_by is not handed to another person');
select is(pg_temp.st(format('update app.invitations set status = ''accepted'', accepted_at = now(), accepted_by = %s', pg_temp.i('incl'))), 'ok', 'control: accepting sets accepted_by once');
select is(pg_temp.st(format('update app.invitations set accepted_by = %s', pg_temp.i('nobody'))), 'P0004', 'invitations: and it is not handed to someone else afterwards');
select is(pg_temp.st('update app.invitations set invited_by = null'), 'ok', 'control: invited_by goes to NULL');
select is(pg_temp.st('update app.invitations set accepted_by = null'), 'P0004', 'invitations: accepted_by does not go to NULL while its account exists (T1.F11)');

insert into app.notifications (id, institution_id, user_id, kind, entity, entity_id)
  values (gen_random_uuid(), pg_temp.id('i_n'), pg_temp.id('teach'), 'task_new', 'assignment', gen_random_uuid());
select is(pg_temp.st(format('update app.notifications set user_id = %s', pg_temp.i('incl'))), 'P0004', 'notifications: a notification does not pass to another person');
insert into app.presets (id, institution_id, owner_user_id, name, config)
  values (gen_random_uuid(), pg_temp.id('i_n'), pg_temp.id('teach'), 'Preset', '{}');
select is(pg_temp.st(format('update app.presets set owner_user_id = %s', pg_temp.i('incl'))), 'P0004', 'presets: nor a preset');
insert into app.import_runs (id, institution_id, user_id, op_key, format_version, parts_total)
  values (gen_random_uuid(), pg_temp.id('i_n'), pg_temp.id('teach'), gen_random_uuid(), 1, 1);
select is(pg_temp.st(format('update app.import_runs set user_id = %s', pg_temp.i('incl'))), 'P0004', 'import_runs: nor an import');
select is(pg_temp.st('update app.import_runs set user_id = null'), 'ok', 'control: user_id goes to NULL');
insert into app.erasures (id, institution_id, kind, pseudonym_id)
  values (pg_temp.id('op1'), pg_temp.id('i_n'), 'student', (select p.id from app.student_pseudonyms p where p.student_id = pg_temp.id('s3')));
select is(pg_temp.st('update app.erasures set pseudonym_id = gen_random_uuid()'), 'P0004', 'erasures: an erasure keeps its pseudonym');

-- The guards that already existed still answer.
select is(pg_temp.st(format('update app.student_needs set student_id = %s where student_id = %s', pg_temp.i('s3'), pg_temp.i('s1'))), 'P0004', 'the guard of student_needs (T1.3a) still answers');
select is(pg_temp.st(format('update app.assignments set student_id = %s where student_id = %s', pg_temp.i('s3'), pg_temp.i('s1'))), 'P0004', 'and the guard of assignments (T1.5) still answers');

select * from finish();
rollback;
