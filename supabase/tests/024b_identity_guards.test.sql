-- T1.F10 (F1-4, round 3): the last immutability guards. Technical identities, ownership and the identity of an operation
-- never change; the only transitions allowed are the documented ones to NULL. Every UPDATE runs as the table owner (as
-- authenticated it would fail earlier with 42501 and pass even without the guard) and has to fail with P0004.
-- Placeholder data only. The whole file is rolled back.
begin;
select plan(84);

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
exception when assert_failure or others then  -- a guard's P0004 is ASSERT_FAILURE, which OTHERS does not cover
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  reset role;
  return jsonb_build_object('error', v_state || ' ' || v_message || ' ' || coalesce(v_detail, ''));
end
$f$;

create temp table ids (k text primary key, id uuid not null);
create function pg_temp.id(p_key text) returns uuid language sql as $$ select id from ids where k = p_key $$;
create function pg_temp.i(p_key text) returns text language sql as $$ select quote_literal(pg_temp.id(p_key)) $$;
create function pg_temp.as_user(p_user text, p_sql text) returns jsonb language sql
  as $$ select pg_temp.rpc(pg_temp.id(p_user), 'authenticated', p_sql) $$;
create function pg_temp.as_service(p_sql text) returns jsonb language sql
  as $$ select pg_temp.rpc(null, 'service_role', p_sql) $$;
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

insert into ids (k, id) select k, gen_random_uuid() from unnest(array['teach', 'other']) as k;
insert into auth.users (id, email) select id, k || '@t1-f10.invalid' from ids;
do $$
declare
  k text;
begin
  for k in select ids.k from ids loop
    perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;

-- The accounts of the students have the canonical shape of phase 2 (docs/contratos/fase-2.md, «Cómo entra un estudiante»), like the
-- provisioning of T2.5a leaves them: the id is remembered in the provisioning row of the student first, then the row of Auth is born
-- with the email <id>@estudiantes.usetiza.app (no password), with its app_users row. The link of the student comes afterwards, through the
-- RPC, or not at all. So student_auth_link_guard stays on; only the staff (teach, other) are ordinary accounts.
create function pg_temp.student_account(p_student uuid, p_user uuid, p_name text) returns void language plpgsql as $$
begin
  perform pg_temp.as_service(format('select api.internal_remember_student_account(%L, %L)',
    (select ap.id from app.account_provisioning ap where ap.student_id = p_student), p_user));
  insert into auth.users (id, email) values (p_user, p_user::text || '@estudiantes.usetiza.app');
  perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', p_user, p_name));
end
$$;

-- One institution with a teacher, a group, a student created through the RPC (it leaves its account_provisioning row), a
-- practice with an exercise and a version, and one generation with an actor. Placeholder names only.
insert into ids (k, id) select 'i_n', (pg_temp.as_service($$ select api.internal_create_institution('Liceo F10', 't1-f10', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_n'), pg_temp.id('teach')));
insert into ids (k, id) values
  ('g_n', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid);
insert into ids (k, id) values
  ('s1', (pg_temp.as_user('teach', format('select api.create_student(%L, ''Estudiante 1'', ''est.1'', gen_random_uuid())', pg_temp.id('g_n'))) ->> 'id')::uuid);
insert into ids (k, id) values
  ('a1', (pg_temp.as_user('teach', format('select api.create_assessment(%L, ''worksheet'', ''Repaso'', ''Instrucciones'', gen_random_uuid())', pg_temp.id('g_n'))) ->> 'id')::uuid);
select pg_temp.as_user('teach', format('select api.add_exercise(%L, ''1'', ''Enunciado'', gen_random_uuid(), null)', pg_temp.id('a1')));
insert into ids (k, id) values
  ('v1', (pg_temp.as_user('teach', format($q$ select api.create_version(%L, '{"profiles":["motor"],"supports":[],"interests":[]}'::jsonb, 'gaze', gen_random_uuid(), null) $q$, pg_temp.id('a1'))) ->> 'id')::uuid);
insert into ids (k, id) values
  ('gen', (pg_temp.as_service(format('select api.internal_create_generation(%L, ''version'', gen_random_uuid(), ''{}''::jsonb, repeat(''a'', 64), ''r1'', ''p1'', 2, null, %L)',
    pg_temp.id('v1'), pg_temp.id('teach'))) ->> 'id')::uuid);

select is((select count(*) from app.account_provisioning ap where ap.student_id = pg_temp.id('s1') and ap.op_identity is not null), 1::bigint, 'there is a provisioning row with an op_identity');
select is((select g.requested_by from app.generations g where g.id = pg_temp.id('gen')), pg_temp.id('teach'), 'there is a generation with an actor');

-- ---------------------------------------------------------------------------------------------
-- 1. account_provisioning.auth_user_id: once set it never changes, not even to NULL
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.st(format('update app.account_provisioning set auth_user_id = ''00000000-0000-4000-8000-0000000000f1'' where student_id = %s', pg_temp.i('s1'))), 'ok',
  'control: an account is linked once (NULL to a value)');
select is(pg_temp.st(format('update app.account_provisioning set auth_user_id = ''00000000-0000-4000-8000-0000000000f2'' where student_id = %s', pg_temp.i('s1'))), 'P0004',
  'account_provisioning: a linked account is not swapped for another');
select is(pg_temp.st(format('update app.account_provisioning set auth_user_id = null where student_id = %s', pg_temp.i('s1'))), 'P0004',
  'account_provisioning: nor emptied (the contract keeps the UUID after the Auth account is deleted)');
select is(pg_temp.st(format('update app.account_provisioning set auth_user_id = auth_user_id, status = ''failed'', error_code = ''auth_unavailable'' where student_id = %s', pg_temp.i('s1'))), 'ok',
  'control: the same value and the rest of the row can still be updated');
select is((select ap.auth_user_id from app.account_provisioning ap where ap.student_id = pg_temp.id('s1')), '00000000-0000-4000-8000-0000000000f1'::uuid, 'and the UUID is still there');

-- ---------------------------------------------------------------------------------------------
-- 4a. account_provisioning.op_key and op_identity (outside an erasure)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.st(format('update app.account_provisioning set op_key = gen_random_uuid() where student_id = %s', pg_temp.i('s1'))), 'P0004',
  'account_provisioning: op_key never changes');
select is(pg_temp.st(format('update app.account_provisioning set op_key = null where student_id = %s', pg_temp.i('s1'))), 'P0004',
  'account_provisioning: op_key is not forgotten either');
select is(pg_temp.st(format('update app.account_provisioning set op_identity = repeat(''0'', 64) where student_id = %s', pg_temp.i('s1'))), 'P0004',
  'account_provisioning: op_identity is not rewritten');
select is(pg_temp.st(format('update app.account_provisioning set op_identity = null where student_id = %s', pg_temp.i('s1'))), 'P0004',
  'account_provisioning: nor forgotten outside the erasure of its institution');

-- ---------------------------------------------------------------------------------------------
-- 2. generations.requested_by
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_constraint c where c.conrelid = 'app.generations'::regclass and c.contype = 'f'
             and c.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = 'app.generations'::regclass and a.attname = 'requested_by')]),
  0::bigint, 'generations.requested_by has no foreign key: it is a historical actor, like the ones of the history tables');
select is(pg_temp.st(format('update app.generations set requested_by = %s where id = %s', pg_temp.i('other'), pg_temp.i('gen'))), 'P0004',
  'generations: requested_by is not handed to another person');
select is(pg_temp.st(format('update app.generations set requested_by = null where id = %s', pg_temp.i('gen'))), 'P0004',
  'generations: nor emptied');
select is(pg_temp.st(format('update app.generations set requested_by = requested_by where id = %s', pg_temp.i('gen'))), 'ok',
  'control: an update that keeps it is still an update of the row');
select is(pg_temp.st(format('update app.generations set status = ''failed'', error_code = ''no_disponible'', finished_at = now() where id = %s', pg_temp.i('gen'))), 'ok',
  'control: a generation still finishes');

-- ---------------------------------------------------------------------------------------------
-- 3. invitations.email
-- ---------------------------------------------------------------------------------------------
insert into app.invitations (id, institution_id, email, role, token_hash, expires_at, invited_by)
  values (gen_random_uuid(), pg_temp.id('i_n'), 'persona@ejemplo.invalid', 'teacher', decode(repeat('00', 32), 'hex'), now() + interval '1 day', pg_temp.id('teach'));
select is(pg_temp.st('update app.invitations set email = ''otra@ejemplo.invalid'''), 'P0004', 'invitations: the addressee does not change while it is pending');
select is(pg_temp.st(format('update app.invitations set status = ''accepted'', accepted_at = now(), accepted_by = %s', pg_temp.i('other'))), 'ok', 'control: accepting is still an update of the row');
select is(pg_temp.st('update app.invitations set email = ''otra@ejemplo.invalid'''), 'P0004', 'invitations: nor after it was accepted');
select is(pg_temp.st('update app.invitations set email = null'), 'P0004', 'invitations: nor emptied');
select is(pg_temp.st('update app.invitations set email = email, expires_at = now() + interval ''2 days'''), 'ok', 'control: the same email and the rest of the row can still be updated');
-- 3b. invitations.accepted_by and accepted_at (T1.F11): only the acceptance sets them; no A → NULL → B.
select is(pg_temp.st('update app.invitations set accepted_by = null'), 'P0004', 'invitations: accepted_by does not go to NULL while its account exists');
select is(pg_temp.st(format('update app.invitations set accepted_by = %s', pg_temp.i('teach'))), 'P0004', 'invitations: nor to another person after the acceptance');
select is(pg_temp.st('update app.invitations set accepted_at = now() - interval ''1 day'''), 'P0004', 'invitations: accepted_at never changes once set');

-- 3c. students.user_id (T1.F11): it is emptied only when its account is deleted, and a student once linked is never
-- linked to another account. The first link is remembered in account_provisioning.auth_user_id.
insert into ids (k, id) values
  ('s2', (pg_temp.as_user('teach', format('select api.create_student(%L, ''Estudiante 2'', ''est.2'', gen_random_uuid())', pg_temp.id('g_n'))) ->> 'id')::uuid);
insert into ids (k, id) values ('acct2', gen_random_uuid());
select pg_temp.student_account(pg_temp.id('s2'), pg_temp.id('acct2'), 'Persona acct2');
select is(pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('s2'), pg_temp.id('acct2'))) ->> 'error', null,
  'control: a student is linked to an account');
select is((select ap.auth_user_id from app.account_provisioning ap where ap.student_id = pg_temp.id('s2')), pg_temp.id('acct2'),
  'and the link is remembered in its provisioning row');
select is(pg_temp.st(format('update app.students set user_id = null where id = %s', pg_temp.i('s2'))), 'P0004',
  'students: user_id does not go to NULL while its account exists');
select is(pg_temp.st(format('update app.students set user_id = %s where id = %s', pg_temp.i('teach'), pg_temp.i('s2'))), 'P0004',
  'students: nor moves to another account');
select is(pg_temp.st(format('update app.students set user_id = %s where id = %s', pg_temp.i('other'), pg_temp.i('s1'))), 'P0004',
  'students: a student whose provisioning remembers another account is not linked to a new one');
insert into ids (k, id) values ('gone', gen_random_uuid());
insert into ids (k, id) values
  ('s3', (pg_temp.as_user('teach', format('select api.create_student(%L, ''Estudiante 3'', ''est.3'', gen_random_uuid())', pg_temp.id('g_n'))) ->> 'id')::uuid);
select pg_temp.student_account(pg_temp.id('s3'), pg_temp.id('gone'), 'Persona gone');
select pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('s3'), pg_temp.id('gone')));
select is(pg_temp.st(format('delete from app.app_users where id = %s', pg_temp.i('gone'))), 'ok',
  'control: deleting the account empties the link through its foreign key');
select is((select s.user_id from app.students s where s.id = pg_temp.id('s3')), null::uuid, 'and the student is unlinked');
select is((select ap.auth_user_id from app.account_provisioning ap where ap.student_id = pg_temp.id('s3')), pg_temp.id('gone'),
  'and the provisioning row still remembers which account it was');

-- 3d. That memory lives as long as the student (T1.F12, round 5): it is not detached nor deleted, and a student without
-- it is never linked. The path of the review, through the RPC: detach the row, delete Auth A, link to B.
insert into ids (k, id) values ('b2', gen_random_uuid());
-- B is the canonical account of another student (sb2: its id remembered, its row of Auth born, not linked), so that what refuses
-- the link of s3 is the memory of its own account and not the shape of B.
insert into ids (k, id) values
  ('sb2', (pg_temp.as_user('teach', format('select api.create_student(%L, ''Estudiante B2'', ''est.b2'', gen_random_uuid())', pg_temp.id('g_n'))) ->> 'id')::uuid);
select pg_temp.student_account(pg_temp.id('sb2'), pg_temp.id('b2'), 'Persona b2');
select is(pg_temp.st(format('update app.account_provisioning set status = ''deleted'', student_id = null where student_id = %s', pg_temp.i('s3'))), 'P0004',
  'account_provisioning: student_id does not go to NULL while the student exists');
select is(pg_temp.st(format('delete from app.account_provisioning where student_id = %s', pg_temp.i('s3'))), 'P0004',
  'account_provisioning: nor is the row deleted while the student exists');
select matches(pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('s3'), pg_temp.id('b2'))) ->> 'error', '^P0004',
  'internal_link_student_user: the student whose account was deleted is not linked to another one');
-- A row lost some other way (simulated with the guard off): the link is refused, not read as "never linked".
alter table app.account_provisioning disable trigger account_provisioning_kept;
delete from app.account_provisioning where student_id = pg_temp.id('s3');
alter table app.account_provisioning enable trigger account_provisioning_kept;
select matches(pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('s3'), pg_temp.id('b2'))) ->> 'error', '^P0004',
  'internal_link_student_user: a student without its provisioning row is not linked');
select is((select s.user_id from app.students s where s.id = pg_temp.id('s3')), null::uuid, 'and the student is still unlinked');

-- 3e. TRUNCATE runs no row guard (T1.F13, round 6): no table of app is ever truncated, and a provisioning row recreated
-- for a linked student remembers its account.
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'app' and c.relkind in ('r', 'p')
              and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal and t.tgenabled <> 'D'
                                and t.tgfoid = 'app.no_truncate'::regproc)),
  0::bigint, 'every table of app refuses TRUNCATE');
select is(pg_temp.st('truncate app.account_provisioning'), 'P0004', 'account_provisioning: the memory is not truncated away');
alter table app.account_provisioning disable trigger account_provisioning_kept;
delete from app.account_provisioning where student_id = pg_temp.id('s2');
alter table app.account_provisioning enable trigger account_provisioning_kept;
select is(pg_temp.st(format('insert into app.account_provisioning (institution_id, student_id, op_key) select institution_id, id, gen_random_uuid() from app.students where id = %s', pg_temp.i('s2'))), 'P0004',
  'account_provisioning: an empty row is not recreated for a linked student');
select is(pg_temp.st(format('insert into app.account_provisioning (institution_id, student_id, op_key, auth_user_id) select institution_id, id, gen_random_uuid(), user_id from app.students where id = %s', pg_temp.i('s2'))), 'ok',
  'control: recreated with the account the student has, it is accepted');

-- 3f. A student is born unlinked (T1.F14, round 7): inserted with an account it would skip the link that records the
-- memory (then delete Auth A, add an empty provisioning row, link to B).
select is(pg_temp.st(format('insert into app.students (institution_id, display_name, username, user_id) values (%s, ''Estudiante 4'', ''est.4'', %s)', pg_temp.i('i_n'), pg_temp.i('b2'))), 'P0004',
  'students: a student is not inserted already linked to an account');
select is(pg_temp.st(format('insert into app.students (institution_id, display_name, username) values (%s, ''Estudiante 4'', ''est.4'')', pg_temp.i('i_n'))), 'ok',
  'control: inserted unlinked, it is accepted (the link comes afterwards, through the RPC)');

-- 3g. Actors set once by an event are born empty (T1.F15, round 8): born as A they could be replaced by B when the
-- event happens. The race of the first account is in tests/integration/races/first-account.test.ts.
select is(pg_temp.st(format('insert into app.invitations (institution_id, email, role, token_hash, expires_at, accepted_by) values (%s, ''p2@ejemplo.invalid'', ''teacher'', decode(repeat(''01'', 32), ''hex''), now() + interval ''1 day'', %s)', pg_temp.i('i_n'), pg_temp.i('b2'))), 'P0004',
  'invitations: a pending invitation is not born with whoever accepts it');
select is(pg_temp.st(format('insert into app.invitations (institution_id, email, role, token_hash, expires_at) values (%s, ''p2@ejemplo.invalid'', ''teacher'', decode(repeat(''01'', 32), ''hex''), now() + interval ''1 day'')', pg_temp.i('i_n'))), 'ok',
  'control: born without it, it is accepted');
select is(pg_temp.st(format('insert into app.consents (institution_id, student_id, purpose, text_version, revoked_by) values (%s, %s, ''ai_analysis'', ''v1'', %s)', pg_temp.i('i_n'), pg_temp.i('s2'), pg_temp.i('b2'))), 'P0004',
  'consents: a consent is not born with whoever revokes it');
select is(pg_temp.st(format('insert into app.consents (institution_id, student_id, purpose, text_version) values (%s, %s, ''ai_analysis'', ''v1'')', pg_temp.i('i_n'), pg_temp.i('s2'))), 'ok',
  'control: born without it, it is accepted');

-- ---------------------------------------------------------------------------------------------
-- 4b. operations.op_key and kind, import_runs.op_key
-- ---------------------------------------------------------------------------------------------
insert into ids (k, id) select k, gen_random_uuid() from unnest(array['op1', 'imp']) as k;
insert into app.operations (id, institution_id, kind, op_key, group_id, required_parts)
  values (pg_temp.id('op1'), pg_temp.id('i_n'), 'analyze_group', gen_random_uuid(), pg_temp.id('g_n'), 1);
select is(pg_temp.st(format('update app.operations set op_key = gen_random_uuid() where id = %s', pg_temp.i('op1'))), 'P0004', 'operations: op_key never changes');
select is(pg_temp.st(format('update app.operations set kind = ''read_syllabus'' where id = %s', pg_temp.i('op1'))), 'P0004', 'operations: nor does its kind');
select is(pg_temp.st(format('update app.operations set status = ''merging'' where id = %s', pg_temp.i('op1'))), 'ok', 'control: an operation still moves forward');
insert into app.import_runs (id, institution_id, user_id, op_key, format_version, parts_total)
  values (pg_temp.id('imp'), pg_temp.id('i_n'), pg_temp.id('teach'), gen_random_uuid(), 1, 2);
select is(pg_temp.st(format('update app.import_runs set op_key = gen_random_uuid() where id = %s', pg_temp.i('imp'))), 'P0004', 'import_runs: op_key never changes');
select is(pg_temp.st(format('update app.import_runs set parts_done = 1 where id = %s', pg_temp.i('imp'))), 'ok', 'control: an import still counts its parts');

-- ---------------------------------------------------------------------------------------------
-- 5. technical identities: subjects.id, rate_limits.key and window_start, student_rpc_windows.id and txid
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.st('update app.subjects set id = ''biology'' where id = ''physics'''), 'P0004', 'subjects: a subject does not change its id');
select is(pg_temp.st('update app.subjects set created_at = now() - interval ''1 day'' where id = ''physics'''), 'P0004', 'subjects: nor its creation date');
select is(pg_temp.st('update app.subjects set enabled = not enabled where id = ''physics'''), 'ok', 'control: a subject is still enabled or disabled');

insert into app.rate_limits (id, key, window_start, window_seconds, count)
  values (gen_random_uuid(), 'login:' || repeat('a', 64), '2026-11-13 00:00:00+00', 60, 1);
select is(pg_temp.st('update app.rate_limits set key = ''login:'' || repeat(''b'', 64)'), 'P0004', 'rate_limits: a counter does not change its key');
select is(pg_temp.st('update app.rate_limits set window_start = ''2026-11-13 00:01:00+00'''), 'P0004', 'rate_limits: nor its window');
select is(pg_temp.st('update app.rate_limits set count = count + 1'), 'ok', 'control: the counter still counts');
select is(pg_temp.st('update app.rate_limits set id = gen_random_uuid()'), 'P0004', 'rate_limits: its id is frozen by touch_row');

-- The deferred check of the window never runs: the file rolls back.
insert into app.student_rpc_windows (id, txid) values (gen_random_uuid(), 4000000001);
select is(pg_temp.st('update app.student_rpc_windows set id = gen_random_uuid()'), 'P0004', 'student_rpc_windows: a window does not change its id');
select is(pg_temp.st('update app.student_rpc_windows set txid = 4000000002'), 'P0004', 'student_rpc_windows: nor the transaction it tracks');
select is(pg_temp.st('update app.student_rpc_windows set created_at = now() - interval ''1 day'''), 'P0004', 'student_rpc_windows: nor its creation date');
select is(pg_temp.st('update app.student_rpc_windows set txid = txid'), 'ok', 'control: an update that keeps the row is still an update');

-- ---------------------------------------------------------------------------------------------
-- 6. what the sweep of the 45 tables found: files, institutions, erasures, assessments.source_file_id
-- ---------------------------------------------------------------------------------------------
insert into ids (k, id) select k, gen_random_uuid() from unnest(array['f1', 'f2']) as k;
insert into app.files (id, institution_id, bucket, path, purpose, group_id, max_bytes, mime_type, reserved_by)
  select pg_temp.id(f), pg_temp.id('i_n'), 'uploads', pg_temp.id('i_n')::text || '/' || pg_temp.id(f)::text, 'assessment_source', pg_temp.id('g_n'), 1000, 'application/pdf', pg_temp.id('teach')
    from unnest(array['f1', 'f2']) f;
select is(pg_temp.st(format('update app.files set path = %L where id = %s', pg_temp.id('i_n')::text || '/' || pg_temp.id('f2')::text, pg_temp.i('f1'))), 'P0004', 'files: a file does not point at the object of another');
select is(pg_temp.st(format('update app.files set purpose = ''syllabus'' where id = %s', pg_temp.i('f1'))), 'P0004', 'files: nor change its purpose');
select is(pg_temp.st(format('update app.files set bucket = ''consents'' where id = %s', pg_temp.i('f1'))), 'P0004', 'files: nor its bucket');
select is(pg_temp.st(format('update app.files set status = ''ready'', size_bytes = 10, confirmed_at = now() where id = %s', pg_temp.i('f1'))), 'ok', 'control: a file is still confirmed');

select is(pg_temp.st(format('update app.institutions set code = ''t1-f10-otro'' where id = %s', pg_temp.i('i_n'))), 'P0004', 'institutions: the code (natural key) does not change');
select is(pg_temp.st(format('update app.institutions set kind = ''sandbox'', expires_at = now() + interval ''1 day'' where id = %s', pg_temp.i('i_n'))), 'P0004', 'institutions: a school does not become a sandbox');
select is(pg_temp.st(format('update app.institutions set name = ''Liceo F10 B'' where id = %s', pg_temp.i('i_n'))), 'ok', 'control: the name still changes');

insert into ids (k, id) values ('era_i', gen_random_uuid());
insert into app.erasures (id, institution_id, kind) values (pg_temp.id('era_i'), pg_temp.id('i_n'), 'institution');
select is(pg_temp.st(format('update app.erasures set kind = ''student'' where id = %s', pg_temp.i('era_i'))), 'P0004', 'erasures: an erasure keeps its kind');

select is(pg_temp.st(format('update app.assessments set source_file_id = %s where id = %s', pg_temp.i('f1'), pg_temp.i('a1'))), 'ok', 'control: the source of a practice is set once');
select is(pg_temp.st(format('update app.assessments set source_file_id = %s where id = %s', pg_temp.i('f2'), pg_temp.i('a1'))), 'P0004', 'assessments: it does not change to another file');
select is(pg_temp.st(format('update app.assessments set source_file_id = null where id = %s', pg_temp.i('a1'))), 'P0004', 'assessments: nor is it emptied');

-- ---------------------------------------------------------------------------------------------
-- 4c. the erasure: the one documented exception. Last, because an open erasure mode refuses the RPCs.
-- ---------------------------------------------------------------------------------------------
-- The erasure of ANOTHER institution does not open anything here.
insert into ids (k, id) select 'i_b', (pg_temp.as_service($$ select api.internal_create_institution('Liceo F10 B', 't1-f10-b', 'school') $$) ->> 'id')::uuid;
insert into ids (k, id) values ('era_b', gen_random_uuid());
insert into app.erasures (id, institution_id, kind) values (pg_temp.id('era_b'), pg_temp.id('i_b'), 'institution');
select app.begin_erasure(pg_temp.id('era_b'));
select is(pg_temp.st(format('update app.account_provisioning set op_identity = null where student_id = %s', pg_temp.i('s1'))), 'P0004',
  'account_provisioning: the erasure of another institution does not forget the identity');
-- The erasure of its institution does, and only op_identity, and only to NULL.
select app.begin_erasure(pg_temp.id('era_i'));
select is(pg_temp.st(format('update app.account_provisioning set op_key = gen_random_uuid() where student_id = %s', pg_temp.i('s1'))), 'P0004',
  'account_provisioning: inside the erasure op_key still never changes');
select is(pg_temp.st(format('update app.account_provisioning set op_identity = repeat(''0'', 64) where student_id = %s', pg_temp.i('s1'))), 'P0004',
  'account_provisioning: inside the erasure op_identity is not rewritten, only forgotten');
select is(pg_temp.st(format('update app.account_provisioning set auth_user_id = null where student_id = %s', pg_temp.i('s1'))), 'P0004',
  'account_provisioning: inside the erasure auth_user_id is not emptied either');
select is(pg_temp.st(format('update app.account_provisioning set op_identity = null where student_id = %s', pg_temp.i('s1'))), 'ok',
  'account_provisioning: inside the erasure of its institution op_identity goes to NULL');
select is((select ap.op_key is not null from app.account_provisioning ap where ap.student_id = pg_temp.id('s1')), true, 'and the op_key stays (the contract keeps it)');
select is(pg_temp.st(format('update app.account_provisioning set op_identity = repeat(''0'', 64) where student_id = %s', pg_temp.i('s1'))), 'P0004',
  'and once forgotten it is not written again');
select is(pg_temp.st(format('update app.operations set op_key = gen_random_uuid() where id = %s', pg_temp.i('op1'))), 'P0004', 'operations: the erasure does not forget the op_key');
select is(pg_temp.st(format('update app.import_runs set op_key = gen_random_uuid() where id = %s', pg_temp.i('imp'))), 'P0004', 'import_runs: nor the op_key of an import');
select is(pg_temp.st(format('update app.generations set requested_by = null where id = %s', pg_temp.i('gen'))), 'P0004', 'generations: nor the actor of a generation');

select * from finish();
rollback;
