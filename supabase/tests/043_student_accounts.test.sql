-- T2.5a: the student account RPCs (docs/contratos/fase-2.md, «Cuentas de estudiantes (T2.5a)», «Emitir tarjetas», «Cómo entra un
-- estudiante», «Aprovisionar una cuenta de estudiante», «Sesión vigente en la base») with the common rules of phase 1: the happy
-- path, every role that is denied, another institution, a repeated op_key, the audit rows and what does not change. The accounts
-- of the students here have the canonical shape of phase 2 (their id is remembered before the row of Auth is born, the email is
-- <id>@estudiantes.usetiza.app, no password), so student_auth_link_guard stays ON. The two connections of the locks are in
-- tests/integration/races. Placeholder data only. The whole file is rolled back.
begin;
select plan(255);

-- Calls an RPC the way PostgREST would: claims for p_user (null = none) with the session if given, and SET LOCAL ROLE p_role.
create function pg_temp.rpc(p_user uuid, p_role text, p_session uuid, p_sql text) returns jsonb
language plpgsql as $f$
declare
  v_res jsonb; v_state text; v_message text; v_detail text;
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else jsonb_strip_nulls(jsonb_build_object('sub', p_user, 'role', p_role, 'session_id', p_session))::text end, true);
  execute format('set local role %I', p_role);
  execute p_sql into v_res;
  reset role;
  return v_res;
exception when others or assert_failure then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  reset role;
  return jsonb_build_object('error', v_state || ' ' || v_message || ' ' || coalesce(v_detail, ''));
end
$f$;
-- «CODE reason» for an expected error, the SQLSTATE and message for any other; null when there was none.
create function pg_temp.err(p_res jsonb) returns text language sql as $$
  select case when p_res ? 'error'
              then case when p_res ->> 'error' like 'P0001 %' then btrim(substr(p_res ->> 'error', 7))
                        when p_res ->> 'error' like '42501%' then '42501'
                        else left(p_res ->> 'error', 5) end end
$$;
create function pg_temp.st(p_sql text) returns text
language plpgsql as $f$
declare
  v_state text;
begin
  execute p_sql;
  return 'ok';
exception
  when assert_failure then return 'P0004';
  when others then
    get stacked diagnostics v_state = returned_sqlstate;
    return v_state;
end
$f$;

create temp table ids (k text primary key, id uuid not null);
create function pg_temp.id(p_key text) returns uuid language sql as $$ select id from ids where k = p_key $$;
create function pg_temp.u(p_user text, p_sql text) returns jsonb language sql
  as $$ select pg_temp.rpc(pg_temp.id(p_user), 'authenticated', null, p_sql) $$;
create function pg_temp.s(p_sql text) returns jsonb language sql as $$ select pg_temp.rpc(null, 'service_role', null, p_sql) $$;
create function pg_temp.new_session(p_user uuid) returns uuid language sql as $$
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), p_user, now(), now()) returning id
$$;
create function pg_temp.hex(p_seed text) returns text language sql as $$ select encode(sha256(convert_to('t2-5a:' || p_seed, 'utf8')), 'hex') $$;
create function pg_temp.bytea_of(p_seed text) returns bytea language sql as $$ select decode(pg_temp.hex(p_seed), 'hex') $$;
create function pg_temp.scrypt(p_seed text) returns text language sql as $$
  select format('scrypt$15$8$1$%s$%s',
    replace(encode(substr(sha256(convert_to(p_seed, 'utf8')), 1, 16), 'base64'), E'\n', ''),
    replace(encode(sha256(convert_to(p_seed || 'a', 'utf8')) || sha256(convert_to(p_seed || 'b', 'utf8')), 'base64'), E'\n', '')) $$;
create function pg_temp.key(p_seed text) returns uuid language sql as $$ select md5('t2-5a:' || p_seed)::uuid $$;
-- One card of the request: the student (by key), and the token and password of a seed.
create function pg_temp.card(p_student text, p_seed text) returns jsonb language sql as $$
  select jsonb_build_object('studentId', pg_temp.id(p_student), 'tokenHash', pg_temp.hex('tok-' || p_seed), 'passwordHash', pg_temp.scrypt('pw-' || p_seed)) $$;
create function pg_temp.issue(p_user text, p_group text, p_cards jsonb, p_key text, p_session uuid default null) returns jsonb language sql as $$
  select pg_temp.rpc(pg_temp.id(p_user), 'authenticated', p_session,
    format('select api.issue_access_cards(%L, %L::jsonb, %L)', pg_temp.id(p_group), p_cards::text, pg_temp.key(p_key))) $$;

-- ---- The world: a school with two groups, its staff, another school, a sandbox. ----
insert into ids (k, id) select k, gen_random_uuid() from unnest(array['teach', 'teach2', 'adm', 'incl', 'outsider', 'sbxowner', 'staffer']) as k;
insert into auth.users (id, email) select id, k || '@t2-5a.invalid' from ids;
select pg_temp.s(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k)) from (values ('teach'), ('teach2'), ('adm'), ('incl'), ('outsider'), ('sbxowner'), ('staffer')) as t(k);
insert into ids (k, id) select 'inst', (pg_temp.s($$ select api.internal_create_institution('Colegio T25a', 't25a', 'school') $$) ->> 'id')::uuid;
insert into ids (k, id) select 'inst2', (pg_temp.s($$ select api.internal_create_institution('Colegio Otro', 't25a-otro', 'school') $$) ->> 'id')::uuid;
insert into ids (k, id) select 'sbx', (pg_temp.s(format($$ select api.internal_create_institution('Demo T25a', 't25a-demo', 'sandbox', now() + interval '1 day', %L) $$, pg_temp.id('sbxowner'))) ->> 'id')::uuid;
select pg_temp.s(format('select api.internal_add_membership(%L, %L, %L)', pg_temp.id('inst'), pg_temp.id(m.k), m.r))
  from (values ('teach', 'teacher'), ('teach2', 'teacher'), ('adm', 'admin'), ('incl', 'inclusion')) as m(k, r);
select pg_temp.s(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('inst2'), pg_temp.id('outsider')));
select pg_temp.s(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('sbx'), pg_temp.id('sbxowner')));
insert into ids (k, id) select 'g1', (pg_temp.u('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('inst'))) ->> 'id')::uuid;
insert into ids (k, id) select 'g2', (pg_temp.u('teach2', format('select api.create_group(%L, ''3.º B'', ''math'', 2026, gen_random_uuid())', pg_temp.id('inst'))) ->> 'id')::uuid;
insert into ids (k, id) select 'gsbx', (pg_temp.u('sbxowner', format('select api.create_group(%L, ''Demo'', ''math'', 2026, gen_random_uuid())', pg_temp.id('sbx'))) ->> 'id')::uuid;

-- Students of g1 by key and username; s4 is in g2 and ssb in the sandbox.
create function pg_temp.mk(p_key text, p_teacher text, p_group text, p_name text, p_username text) returns void language plpgsql as $f$
begin
  insert into ids (k, id) values (p_key, (pg_temp.u(p_teacher, format('select api.create_student(%L, %L, %L, gen_random_uuid())', pg_temp.id(p_group), p_name, p_username)) ->> 'id')::uuid);
end $f$;
select pg_temp.mk('s1', 'teach', 'g1', 'Lucía Fernández', 'luciaf');
select pg_temp.mk('s2', 'teach', 'g1', 'Mateo Rossi', 'mateor');
select pg_temp.mk('s3', 'teach', 'g1', 'Ana Pérez', 'anap');
select pg_temp.mk('sarch', 'teach', 'g1', 'Archivado Uno', 'luciaf2');
select pg_temp.mk('s4', 'teach2', 'g2', 'Otro Grupo', 'otrog');
select pg_temp.mk('ssb', 'sbxowner', 'gsbx', 'Demo Uno', 'demou');
select pg_temp.mk('sdel', 'teach', 'g1', 'Suprimido Uno', 'suprimido');
select pg_temp.mk('sgone', 'teach', 'g1', 'Perdida Uno', 'perdida');
select pg_temp.mk('sfail', 'teach', 'g1', 'Fallida Uno', 'fallida');

-- The canonical account of a student: the id is remembered by the RPC first, then the row of Auth is born, then the link.
create function pg_temp.provision(p_student text) returns void language plpgsql as $f$
declare
  v_prov uuid;
  v_acct uuid := gen_random_uuid();
  v_res jsonb;
begin
  select ap.id into v_prov from app.account_provisioning ap where ap.student_id = pg_temp.id(p_student);
  v_res := pg_temp.s(format('select api.internal_remember_student_account(%L, %L)', v_prov, v_acct));
  if v_res ->> 'ok' is distinct from 'true' then
    raise exception 'provision: remember answered %', v_res;
  end if;
  insert into auth.users (id, email) values (v_acct, v_acct::text || '@estudiantes.usetiza.app');
  perform pg_temp.s(format('select api.internal_upsert_app_user(%L, %L)', v_acct, 'Cuenta de estudiante'));
  perform pg_temp.s(format('select api.internal_link_student_user(%L, %L)', pg_temp.id(p_student), v_acct));
  insert into ids (k, id) values ('u_' || p_student, v_acct);
end $f$;
select pg_temp.provision(k) from (values ('s1'), ('s2'), ('s4'), ('sarch'), ('sgone')) as t(k);
select is((select count(*) from app.account_provisioning where student_id in (pg_temp.id('s1'), pg_temp.id('s2'), pg_temp.id('s4'), pg_temp.id('sarch'), pg_temp.id('sgone')) and status = 'active'), 5::bigint,
  'setup: five students have a canonical account and their provisioning row is active (the link guard is on)');
select is((select count(*) from app.account_provisioning where student_id in (pg_temp.id('s3'), pg_temp.id('sfail')) and status = 'pending'), 2::bigint, 'setup: s3 and sfail are still pending');
select pg_temp.u('teach', format('select api.archive_student(%L, 1)', pg_temp.id('sarch')));

-- =============================================================================================
-- 1. Privileges.
-- =============================================================================================
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p
            where p.pronamespace = 'api'::regnamespace and p.proname in ('list_taken_usernames', 'list_group_accounts', 'issue_access_cards')
              and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
              and not has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('tiza_student', p.oid, 'execute')),
  array['issue_access_cards', 'list_group_accounts', 'list_taken_usernames'], 'the three user RPCs: authenticated executes them, nobody else does');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'api'::regnamespace
     and p.proname in ('internal_get_student_accounts', 'internal_remember_student_account', 'internal_fail_student_account', 'internal_list_unfinished_accounts',
                       'internal_find_institution', 'internal_get_student_login', 'internal_bind_student_session', 'internal_resolve_access_card')
     and (not has_function_privilege('service_role', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('tiza_student', p.oid, 'execute')
          or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))
$$, 'the eight internal RPCs: service_role only (no authenticated, anon, tiza_student or PUBLIC)');
select is((select count(*) from pg_proc p where p.pronamespace = 'api'::regnamespace
            and p.proname in ('list_taken_usernames', 'list_group_accounts', 'issue_access_cards', 'internal_get_student_accounts', 'internal_remember_student_account',
                              'internal_fail_student_account', 'internal_list_unfinished_accounts', 'internal_find_institution', 'internal_get_student_login',
                              'internal_bind_student_session', 'internal_resolve_access_card')
            and p.prosecdef and p.prolang = (select oid from pg_language where lanname = 'plpgsql') and pg_get_userbyid(p.proowner) = 'postgres'
            and coalesce('search_path=""' = any (p.proconfig), false)), 11::bigint, 'the eleven are plpgsql, SECURITY DEFINER, owned by postgres, with search_path pinned');
select is((select count(*) from pg_proc p where p.pronamespace = 'api'::regnamespace
            and p.proname in ('list_taken_usernames', 'list_group_accounts', 'issue_access_cards', 'internal_get_student_accounts', 'internal_remember_student_account',
                              'internal_fail_student_account', 'internal_list_unfinished_accounts', 'internal_find_institution', 'internal_get_student_login',
                              'internal_bind_student_session', 'internal_resolve_access_card')
            and lower(regexp_replace(substring(p.prosrc from '(?i)\mbegin\M\s*([^;]*;)'), '\s+', ' ', 'g')) = 'perform app.rpc_begin();'), 11::bigint,
  'each one starts with perform app.rpc_begin()');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p
            where p.pronamespace = 'api'::regnamespace and p.prosrc ilike '%password_hash%'),
  array['internal_get_student_login', 'issue_access_cards'], 'only internal_get_student_login reads a password hash back (issue_access_cards writes it)');

-- =============================================================================================
-- 2. list_taken_usernames
-- =============================================================================================
select is(pg_temp.u('teach', format('select api.list_taken_usernames(%L, array[''luciaf'', ''mateor''])', pg_temp.id('inst'))) -> 'items',
  '["luciaf", "luciaf2", "mateor"]'::jsonb, 'a base and the base followed by digits (an archived student counts)');
select is(pg_temp.u('teach', format('select api.list_taken_usernames(%L, array[''lucia''])', pg_temp.id('inst'))) -> 'items', '[]'::jsonb,
  'a shorter base does not match «luciaf» (only digits may follow the base)');
select is(pg_temp.u('teach', format('select api.list_taken_usernames(%L, array[''luciaf'', ''luciaf'', ''anap''])', pg_temp.id('inst'))) -> 'items',
  '["anap", "luciaf", "luciaf2"]'::jsonb, 'a repeated base answers each username once, in order');
select is(pg_temp.u('adm', format('select api.list_taken_usernames(%L, array[''otrog''])', pg_temp.id('inst'))) -> 'items', '["otrog"]'::jsonb, 'an admin sees the usernames of the whole institution');
select is(pg_temp.u('teach', format('select api.list_taken_usernames(%L, array[''demou''])', pg_temp.id('inst'))) -> 'items', '[]'::jsonb, 'and nothing of another institution');
select is(pg_temp.u('sbxowner', format('select api.list_taken_usernames(%L, array[''demou''])', pg_temp.id('sbx'))) -> 'items', '["demou"]'::jsonb, 'the visitor of a sandbox asks about his own');
select is(pg_temp.err(pg_temp.u('incl', format('select api.list_taken_usernames(%L, array[''luciaf''])', pg_temp.id('inst')))), 'FORBIDDEN forbidden', 'inclusion is a member but not an admin or a teacher: FORBIDDEN');
select is(pg_temp.err(pg_temp.u('outsider', format('select api.list_taken_usernames(%L, array[''luciaf''])', pg_temp.id('inst')))), 'NOT_FOUND not_found', 'another institution does not see this one: NOT_FOUND');
select is(pg_temp.err(pg_temp.u('staffer', format('select api.list_taken_usernames(%L, array[''luciaf''])', pg_temp.id('inst')))), 'NOT_FOUND not_found', 'a person with no membership: NOT_FOUND');
select is(pg_temp.err(pg_temp.u('u_s1', format('select api.list_taken_usernames(%L, array[''luciaf''])', pg_temp.id('inst')))), 'FORBIDDEN forbidden', 'a student of the institution: FORBIDDEN');
select is(pg_temp.err(pg_temp.rpc(gen_random_uuid(), 'authenticated', null, format('select api.list_taken_usernames(%L, array[''luciaf''])', pg_temp.id('inst')))), 'FORBIDDEN no_session', 'a user with no app_users row: no_session');
select is(pg_temp.err(pg_temp.rpc(null, 'anon', null, format('select api.list_taken_usernames(%L, array[''luciaf''])', pg_temp.id('inst')))), '42501', 'anon cannot execute it');
select is(pg_temp.err(pg_temp.u('teach', format('select api.list_taken_usernames(%L, array[]::text[])', pg_temp.id('inst')))), 'INVALID invalid_username', 'no bases is invalid');
select is(pg_temp.err(pg_temp.u('teach', format('select api.list_taken_usernames(%L, null)', pg_temp.id('inst')))), 'INVALID invalid_username', 'null bases too');
select is(pg_temp.err(pg_temp.u('teach', format('select api.list_taken_usernames(%L, array[''Luciaf''])', pg_temp.id('inst')))), 'INVALID invalid_username', 'a base in upper case is invalid');
select is(pg_temp.err(pg_temp.u('teach', format('select api.list_taken_usernames(%L, array[''luciaf'', null])', pg_temp.id('inst')))), 'INVALID invalid_username', 'a null base is invalid');
select is(pg_temp.err(pg_temp.u('teach', format('select api.list_taken_usernames(%L, array[''luciaf%%''])', pg_temp.id('inst')))), 'INVALID invalid_username', 'a base with a LIKE wildcard is invalid');
select is(pg_temp.err(pg_temp.u('teach', format('select api.list_taken_usernames(%L, (select array_agg(''b'' || n) from generate_series(1, 201) n))', pg_temp.id('inst')))), 'INVALID invalid_username', 'more than 200 bases is invalid');
select is(pg_temp.err(pg_temp.u('teach', format('select api.list_taken_usernames(%L, array[%L])', pg_temp.id('inst'), repeat('a', 41)))), 'INVALID invalid_username', 'a base of 41 characters is invalid');
select is(pg_temp.err(pg_temp.u('teach', 'select api.list_taken_usernames(null, array[''luciaf''])')), 'NOT_FOUND not_found', 'a null institution is NOT_FOUND');

-- =============================================================================================
-- 3. list_group_accounts
-- =============================================================================================
select is(pg_temp.u('teach', format('select api.list_group_accounts(%L)', pg_temp.id('g1'))) - 'items',
  '{"groupName": "3.º A", "institutionCode": "t25a", "canIssueCards": true}'::jsonb, 'the group, the school code and canIssueCards for the teacher of the group');
select is((select jsonb_agg(i ->> 'username' order by i ->> 'username') from jsonb_array_elements(pg_temp.u('teach', format('select api.list_group_accounts(%L)', pg_temp.id('g1'))) -> 'items') i),
  '["anap", "fallida", "luciaf", "mateor", "perdida", "suprimido"]'::jsonb, 'it lists the students enrolled now, without the archived one');
select is((select i ->> 'accountStatus' from jsonb_array_elements(pg_temp.u('teach', format('select api.list_group_accounts(%L)', pg_temp.id('g1'))) -> 'items') i where i ->> 'username' = 'luciaf'), 'active', 'an active account');
select is((select i ->> 'accountStatus' from jsonb_array_elements(pg_temp.u('teach', format('select api.list_group_accounts(%L)', pg_temp.id('g1'))) -> 'items') i where i ->> 'username' = 'anap'), 'pending', 'a pending one');
update app.account_provisioning set status = 'failed', attempts = 1, error_code = 'boom', revision = revision + 1 where student_id = pg_temp.id('sfail');
select is((select i ->> 'accountStatus' from jsonb_array_elements(pg_temp.u('teach', format('select api.list_group_accounts(%L)', pg_temp.id('g1'))) -> 'items') i where i ->> 'username' = 'fallida'), 'failed', 'a failed one');
select is((select count(*) from jsonb_array_elements(pg_temp.u('teach', format('select api.list_group_accounts(%L)', pg_temp.id('g1'))) -> 'items') i where i ->> 'accountStatus' = 'none'), 0::bigint, 'none is only for a sandbox');
select is((select (i ->> 'hasSignedIn')::boolean from jsonb_array_elements(pg_temp.u('teach', format('select api.list_group_accounts(%L)', pg_temp.id('g1'))) -> 'items') i where i ->> 'username' = 'luciaf'), false, 'nobody signed in yet');
update auth.users set last_sign_in_at = now() where id = pg_temp.id('u_s1');
select is((select (i ->> 'hasSignedIn')::boolean from jsonb_array_elements(pg_temp.u('teach', format('select api.list_group_accounts(%L)', pg_temp.id('g1'))) -> 'items') i where i ->> 'username' = 'luciaf'), true, 'hasSignedIn follows last_sign_in_at of his account');
select is((select i -> 'lastCardAt' from jsonb_array_elements(pg_temp.u('teach', format('select api.list_group_accounts(%L)', pg_temp.id('g1'))) -> 'items') i where i ->> 'username' = 'luciaf'), 'null'::jsonb, 'no card yet: lastCardAt is null');
select is((select array_agg(k order by k) from (select jsonb_object_keys(i) as k from jsonb_array_elements(pg_temp.u('teach', format('select api.list_group_accounts(%L)', pg_temp.id('g1'))) -> 'items') i limit 6) x),
  array['accountStatus', 'displayName', 'hasSignedIn', 'lastCardAt', 'studentId', 'username'], 'a row has exactly the fields of the contract (nothing about the profile)');
select is((pg_temp.u('adm', format('select api.list_group_accounts(%L)', pg_temp.id('g1'))) ->> 'canIssueCards')::boolean, true, 'an admin of the institution sees the group and can issue');
select is(pg_temp.err(pg_temp.u('incl', format('select api.list_group_accounts(%L)', pg_temp.id('g1')))), 'FORBIDDEN forbidden', 'inclusion sees the group but is not staff of it: FORBIDDEN');
select is(pg_temp.err(pg_temp.u('teach2', format('select api.list_group_accounts(%L)', pg_temp.id('g1')))), 'NOT_FOUND not_found', 'a teacher of another group: NOT_FOUND');
select is(pg_temp.err(pg_temp.u('outsider', format('select api.list_group_accounts(%L)', pg_temp.id('g1')))), 'NOT_FOUND not_found', 'another institution: NOT_FOUND');
select is(pg_temp.err(pg_temp.u('u_s1', format('select api.list_group_accounts(%L)', pg_temp.id('g1')))), 'FORBIDDEN forbidden', 'a student of the group: FORBIDDEN');
select is(pg_temp.err(pg_temp.rpc(null, 'anon', null, format('select api.list_group_accounts(%L)', pg_temp.id('g1')))), '42501', 'anon cannot execute it');
select is(pg_temp.err(pg_temp.u('teach', 'select api.list_group_accounts(null)')), 'NOT_FOUND not_found', 'a null group is NOT_FOUND');
select is((pg_temp.u('sbxowner', format('select api.list_group_accounts(%L)', pg_temp.id('gsbx'))) ->> 'canIssueCards')::boolean, false, 'in a sandbox canIssueCards is false');
select is((select i ->> 'accountStatus' from jsonb_array_elements(pg_temp.u('sbxowner', format('select api.list_group_accounts(%L)', pg_temp.id('gsbx'))) -> 'items') i), 'none', 'and the not_applicable row reads as none');
update app.account_provisioning set status = 'deleted', revision = revision + 1 where student_id = pg_temp.id('sdel');
select is((select count(*) from jsonb_array_elements(pg_temp.u('teach', format('select api.list_group_accounts(%L)', pg_temp.id('g1'))) -> 'items') i where i ->> 'username' = 'suprimido'), 0::bigint, 'a student being erased (deleted row) is not listed');
update app.enrollments set ended_at = now() where student_id = pg_temp.id('sgone') and group_id = pg_temp.id('g1');
select is((select count(*) from jsonb_array_elements(pg_temp.u('teach', format('select api.list_group_accounts(%L)', pg_temp.id('g1'))) -> 'items') i where i ->> 'username' = 'perdida'), 0::bigint, 'a student who left the group is not listed');
-- A school student with no provisioning row is a data error (F2C-83); in a sandbox it reads as none.
insert into app.students (id, institution_id, display_name, username) values (gen_random_uuid(), pg_temp.id('inst'), 'Sin fila', 'sinfila');
insert into app.enrollments (institution_id, group_id, student_id) select institution_id, pg_temp.id('g1'), id from app.students where username = 'sinfila' and institution_id = pg_temp.id('inst');
select is(pg_temp.err(pg_temp.u('teach', format('select api.list_group_accounts(%L)', pg_temp.id('g1')))), 'P0004', 'a school student without a provisioning row is a data error: P0004');
delete from app.enrollments where student_id = (select id from app.students where username = 'sinfila' and institution_id = pg_temp.id('inst'));
delete from app.students where username = 'sinfila' and institution_id = pg_temp.id('inst');
select is((pg_temp.u('teach', format('select api.list_group_accounts(%L)', pg_temp.id('g1'))) -> 'items') is not null, true, 'and without it the list works again');

-- =============================================================================================
-- 4. issue_access_cards
-- =============================================================================================
-- A session of s1 that is open and registered before the card: it has to die with the card.
insert into app.access_card_issues (id, institution_id, group_id, op_key, op_identity)
  values (gen_random_uuid(), pg_temp.id('inst'), pg_temp.id('g1'), pg_temp.key('seed-issue'), repeat('0', 64));
insert into app.student_credentials (institution_id, student_id, password_hash, issue_id)
  select pg_temp.id('inst'), pg_temp.id('s1'), pg_temp.scrypt('first-s1'), i.id from app.access_card_issues i where i.op_key = pg_temp.key('seed-issue');
insert into ids (k, id) values ('sess_s1', pg_temp.new_session(pg_temp.id('u_s1')));
insert into ids (k, id) values ('sess_s1b', pg_temp.new_session(pg_temp.id('u_s1')));
select is((pg_temp.s(format('select api.internal_bind_student_session(%L, %L, 1)', pg_temp.id('u_s1'), pg_temp.id('sess_s1'))) ->> 'ok')::boolean, true, 'setup: the session of s1 is bound to version 1');
insert into ids (k, id) values ('sess_s2', pg_temp.new_session(pg_temp.id('u_s2')));

select is(pg_temp.err(pg_temp.issue('teach', 'g1', jsonb_build_array(pg_temp.card('s1', 'a1'), pg_temp.card('s2', 'a2')), 'k1', pg_temp.id('sess_s1'))), 'FORBIDDEN no_session',
  'before the card, a teacher token carrying the session of a student is not the session of its sub');
select is(pg_temp.issue('teach', 'g1', jsonb_build_array(pg_temp.card('s2', 'a2'), pg_temp.card('s1', 'a1')), 'k1') - 'items',
  '{"institutionCode": "t25a", "institutionName": "Colegio T25a"}'::jsonb, 'issues cards for two students (any order): the school code and name');
select is((select array_agg(i ->> 'username' order by i ->> 'username') from jsonb_array_elements(pg_temp.u('teach', format('select api.list_group_accounts(%L)', pg_temp.id('g1'))) -> 'items') i where i ->> 'username' in ('luciaf', 'mateor') and (i ->> 'lastCardAt') is not null),
  array['luciaf', 'mateor'], 'lastCardAt is set for both');
select is((select count(*) from app.access_cards where student_id in (pg_temp.id('s1'), pg_temp.id('s2')) and status = 'active'), 2::bigint, 'one active card each');
select is((select count(*) from app.access_cards where student_id = pg_temp.id('s1')), 1::bigint, 'and the card of s1 is the only one (there was none)');
select is((select version from app.student_credentials where student_id = pg_temp.id('s1')), 2, 'the credential of s1 was version 1 and is now 2');
select is((select version from app.student_credentials where student_id = pg_temp.id('s2')), 1, 'the one of s2 is born at version 1');
select is((select password_hash from app.student_credentials where student_id = pg_temp.id('s2')), pg_temp.scrypt('pw-a2'), 'with the hash that came, never the password');
select is((select c.issue_id from app.student_credentials c where c.student_id = pg_temp.id('s2')), (select ac.issue_id from app.access_cards ac where ac.student_id = pg_temp.id('s2')), 'the credential keeps the issue of its card');
select is((select count(*) from app.access_card_issues i where i.op_key = pg_temp.key('k1') and i.op_identity ~ '^[0-9a-f]{64}$' and i.group_id = pg_temp.id('g1') and i.issued_by = pg_temp.id('teach')), 1::bigint, 'one issue, with its identity and the issuer');
select is((select count(*) from auth.sessions where user_id = pg_temp.id('u_s1')), 0::bigint, 'the sessions of s1 in auth.sessions are gone');
select is((select count(*) from app.student_sessions where student_id = pg_temp.id('s1')), 0::bigint, 'and so is his registered session');
select is((select count(*) from auth.sessions where user_id = pg_temp.id('u_s2')), 0::bigint, 'the open session of s2 is gone too');
select is((select count(*) from auth.users where id in (pg_temp.id('u_s1'), pg_temp.id('u_s2')) and encrypted_password is not null), 0::bigint, 'nothing was written in Auth: his account still has no password');
select is((select count(*) from app.audit_log where action = 'access_card.issued' and entity = 'access_card_issue' and institution_id = pg_temp.id('inst') and actor_user_id = pg_temp.id('teach')
             and student_ids = (select array_agg(x order by x) from unnest(array[pg_temp.id('s1'), pg_temp.id('s2')]) x)), 1::bigint,
  'audit_log has one row with the sorted set of students');
select is((select jsonb_build_array(a.action, a.entity) from app.audit_log a where a.action = 'access_card.issued' limit 1), '["access_card.issued", "access_card_issue"]'::jsonb, 'and says what happened, with no token and no password');

-- Replay of the op_key.
select is(pg_temp.err(pg_temp.issue('teach', 'g1', jsonb_build_array(pg_temp.card('s1', 'b1'), pg_temp.card('s2', 'b2')), 'k1')), 'CONFLICT card_issue_done', 'the same op_key and the same set: card_issue_done (the passwords were not kept)');
select is(pg_temp.err(pg_temp.issue('teach', 'g1', jsonb_build_array(pg_temp.card('s2', 'b2'), pg_temp.card('s1', 'b1')), 'k1')), 'CONFLICT card_issue_done', 'in any order: the identity is of the sorted set');
select is(pg_temp.err(pg_temp.issue('teach', 'g1', jsonb_build_array(pg_temp.card('s1', 'b1')), 'k1')), 'CONFLICT op_key_reused', 'the same op_key with another set: op_key_reused');
select is(pg_temp.err(pg_temp.issue('adm', 'g2', jsonb_build_array(pg_temp.card('s4', 'b4')), 'k1')), 'CONFLICT op_key_reused', 'and with another group');
select is((select version from app.student_credentials where student_id = pg_temp.id('s1')), 2, 'a repeat changed nothing');
update app.students set archived_at = now() where id = pg_temp.id('s2');
select is(pg_temp.err(pg_temp.issue('teach', 'g1', jsonb_build_array(pg_temp.card('s1', 'c1'), pg_temp.card('s2', 'c2')), 'k1')), 'CONFLICT card_issue_done', 'a repeat does not depend on what changed since: s2 is archived now and the answer is the same');
update app.students set archived_at = null where id = pg_temp.id('s2');

-- A new card of one student: the old one is revoked, the version goes up, the hash is the new one.
select is(pg_temp.issue('teach', 'g1', jsonb_build_array(pg_temp.card('s1', 'd1')), 'k2') -> 'items' -> 0 ->> 'username', 'luciaf', 'a new card for s1 alone answers his username and name');
select is((select array_agg(status order by status) from app.access_cards where student_id = pg_temp.id('s1')), array['active', 'revoked'], 'the old card is revoked and the new one is active');
select is((select count(*) from app.access_cards where student_id = pg_temp.id('s1') and status = 'active' and token_hash = pg_temp.bytea_of('tok-d1')), 1::bigint, 'the active one is the new one');
select is((select count(*) from app.access_cards where student_id = pg_temp.id('s1') and status = 'revoked' and revoked_at is not null and token_hash = pg_temp.bytea_of('tok-a1')), 1::bigint, 'the revoked one is the old one, with its date');
select is((select version from app.student_credentials where student_id = pg_temp.id('s1')), 3, 'the version went up by one');
select is((select password_hash from app.student_credentials where student_id = pg_temp.id('s1')), pg_temp.scrypt('pw-d1'), 'and the hash is the new one: the old password no longer matches');
select is((select count(*) from app.access_cards where student_id = pg_temp.id('s2')), 1::bigint, 'the card of s2 was not touched');
select is((select version from app.student_credentials where student_id = pg_temp.id('s2')), 1, 'nor his credential');
select is((select count(*) from app.access_card_issues where institution_id = pg_temp.id('inst') and op_key <> pg_temp.key('seed-issue')), 2::bigint, 'two issues so far');

-- Who is refused.
select is(pg_temp.err(pg_temp.issue('teach', 'g1', jsonb_build_array(pg_temp.card('s3', 'e3')), 'k3')), 'INVALID not_enrolled', 'a student whose account is pending gets no card');
select is(pg_temp.err(pg_temp.issue('teach', 'g1', jsonb_build_array(pg_temp.card('sfail', 'e5')), 'k3b')), 'INVALID not_enrolled', 'nor one whose account failed');
select is(pg_temp.err(pg_temp.issue('teach', 'g1', jsonb_build_array(pg_temp.card('sarch', 'e4')), 'k4')), 'INVALID not_enrolled', 'nor an archived one');
select is(pg_temp.err(pg_temp.issue('teach', 'g1', jsonb_build_array(pg_temp.card('s4', 'e6')), 'k5')), 'INVALID not_enrolled', 'nor a student of another group of the same institution');
select is(pg_temp.err(pg_temp.issue('adm', 'g1', jsonb_build_array(pg_temp.card('s4', 'e6')), 'k5')), 'INVALID not_enrolled', 'not even for an admin: he has to be enrolled in the group of the request');
select is(pg_temp.err(pg_temp.issue('teach', 'g1', jsonb_build_array(pg_temp.card('sgone', 'e7')), 'k6')), 'INVALID not_enrolled', 'nor one who left the group');
select is(pg_temp.err(pg_temp.issue('teach', 'g1', jsonb_build_array(pg_temp.card('s1', 'e8'), pg_temp.card('s3', 'e9')), 'k7')), 'INVALID not_enrolled', 'one student who does not qualify refuses the whole request');
select is((select version from app.student_credentials where student_id = pg_temp.id('s1')), 3, 'and nothing was issued for the one who did qualify');
select is((select count(*) from app.access_card_issues where op_key = pg_temp.key('k7')), 0::bigint, 'no issue was left either');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('teach'), 'authenticated', null, format('select api.issue_access_cards(%L, %L::jsonb, %L)', pg_temp.id('g1'),
  jsonb_build_array(jsonb_build_object('studentId', gen_random_uuid(), 'tokenHash', pg_temp.hex('x'), 'passwordHash', pg_temp.scrypt('x')))::text, pg_temp.key('k8')))), 'INVALID not_enrolled', 'a student id that does not exist: not_enrolled too');

-- Who is denied (before anything is read of the cards).
select is(pg_temp.err(pg_temp.issue('teach2', 'g1', jsonb_build_array(pg_temp.card('s1', 'f1')), 'k10')), 'NOT_FOUND not_found', 'a teacher of another group: NOT_FOUND');
select is(pg_temp.err(pg_temp.issue('outsider', 'g1', jsonb_build_array(pg_temp.card('s1', 'f1')), 'k10')), 'NOT_FOUND not_found', 'another institution: NOT_FOUND');
select is(pg_temp.err(pg_temp.issue('incl', 'g1', jsonb_build_array(pg_temp.card('s1', 'f1')), 'k10')), 'FORBIDDEN forbidden', 'inclusion: FORBIDDEN');
select is(pg_temp.err(pg_temp.issue('u_s1', 'g1', jsonb_build_array(pg_temp.card('s1', 'f1')), 'k10')), 'FORBIDDEN forbidden', 'a student of the group: FORBIDDEN (his token has no registered session here, but the answer is the same)');
select is(pg_temp.err(pg_temp.rpc(null, 'anon', null, format('select api.issue_access_cards(%L, %L::jsonb, %L)', pg_temp.id('g1'), jsonb_build_array(pg_temp.card('s1', 'f1'))::text, pg_temp.key('k10')))), '42501', 'anon cannot execute it');
select is(pg_temp.err(pg_temp.issue('sbxowner', 'gsbx', jsonb_build_array(pg_temp.card('ssb', 'f2')), 'k11')), 'FORBIDDEN sandbox_restricted', 'in a sandbox: FORBIDDEN sandbox_restricted');
select is(pg_temp.err(pg_temp.issue('teach', 'g1', jsonb_build_array(pg_temp.card('s1', 'f1')), 'k10') ), null, 'control: the teacher of the group can');
select is(pg_temp.err(pg_temp.u('teach', format('select api.issue_access_cards(%L, %L::jsonb, null)', pg_temp.id('g1'), jsonb_build_array(pg_temp.card('s1', 'f3'))::text))), 'INVALID invalid_op_key', 'a null op_key is invalid');
select is(pg_temp.err(pg_temp.u('teach', 'select api.issue_access_cards(null, ''[]''::jsonb, gen_random_uuid())')), 'NOT_FOUND not_found', 'a null group is NOT_FOUND');

-- The shape of p_cards: INVALID invalid_cards in every bad form, with nothing written.
create function pg_temp.bad(p_cards text, p_key text) returns text language sql as $$
  select pg_temp.err(pg_temp.u('teach', format('select api.issue_access_cards(%L, %L::jsonb, %L)', pg_temp.id('g1'), p_cards, pg_temp.key(p_key)))) $$;
select is(pg_temp.bad('[]', 'b1'), 'INVALID invalid_cards', 'no cards');
select is(pg_temp.bad('null', 'b2'), 'INVALID invalid_cards', 'null');
select is(pg_temp.bad('{}', 'b3'), 'INVALID invalid_cards', 'an object instead of an array');
select is(pg_temp.bad('["x"]', 'b4'), 'INVALID invalid_cards', 'a card that is not an object');
select is(pg_temp.bad((select jsonb_agg(pg_temp.card('s1', 'n' || n))::text from generate_series(1, 61) n), 'b5'), 'INVALID invalid_cards', 'more than 60 cards');
select is(pg_temp.bad(jsonb_build_array(pg_temp.card('s1', 'x') || '{"extra": 1}'::jsonb)::text, 'b6'), 'INVALID invalid_cards', 'an extra key');
select is(pg_temp.bad(jsonb_build_array(pg_temp.card('s1', 'x') - 'passwordHash')::text, 'b7'), 'INVALID invalid_cards', 'a missing key');
select is(pg_temp.bad(jsonb_build_array(pg_temp.card('s1', 'x') || jsonb_build_object('tokenHash', 'abc'))::text, 'b8'), 'INVALID invalid_cards', 'a token hash that is not 64 hex digits');
select is(pg_temp.bad(jsonb_build_array(pg_temp.card('s1', 'x') || jsonb_build_object('tokenHash', upper(pg_temp.hex('x'))))::text, 'b9'), 'INVALID invalid_cards', 'a token hash in upper case');
select is(pg_temp.bad(jsonb_build_array(pg_temp.card('s1', 'x') || jsonb_build_object('passwordHash', 'sol-nube-tigre-47'))::text, 'b10'), 'INVALID invalid_cards', 'a plain password instead of the scrypt hash');
select is(pg_temp.bad(jsonb_build_array(pg_temp.card('s1', 'x') || jsonb_build_object('passwordHash', 'scrypt$14$8$1$AAAA$AAAA'))::text, 'b11'), 'INVALID invalid_cards', 'a scrypt hash with other parameters');
select is(pg_temp.bad(jsonb_build_array(pg_temp.card('s1', 'x') || jsonb_build_object('studentId', 'no-es-uuid'))::text, 'b12'), 'INVALID invalid_cards', 'a student id that is not a uuid');
select is(pg_temp.bad(jsonb_build_array(pg_temp.card('s1', 'x') || jsonb_build_object('studentId', 7))::text, 'b13'), 'INVALID invalid_cards', 'a student id that is not a string');
select is(pg_temp.bad(jsonb_build_array(pg_temp.card('s1', 'x') || jsonb_build_object('tokenHash', null))::text, 'b14'), 'INVALID invalid_cards', 'a null field');
select is(pg_temp.bad(jsonb_build_array(pg_temp.card('s1', 'x'), pg_temp.card('s1', 'y'))::text, 'b15'), 'INVALID invalid_cards', 'the same student twice');
select is(pg_temp.bad(jsonb_build_array(pg_temp.card('s1', 'x'), pg_temp.card('s2', 'x'))::text, 'b16'), 'INVALID invalid_cards', 'the same token twice');
select is(pg_temp.bad(jsonb_build_array(pg_temp.card('s1', 'a2'))::text, 'b17'), 'INVALID invalid_cards', 'a token that already exists (the first card of s2 is still in the table, revoked or not)');
select is((select count(*) from app.access_card_issues where op_key in (pg_temp.key('b6'), pg_temp.key('b17'))), 0::bigint, 'and none of them left an issue');
select is((select version from app.student_credentials where student_id = pg_temp.id('s1')), 4, 'the one control issue (k10) is the only one that changed s1 (version 4)');
-- Atomic: the second student of the request has a token that exists, so nothing of the first one stays.
select is(pg_temp.err(pg_temp.issue('teach', 'g1', jsonb_build_array(pg_temp.card('s1', 'z1'), pg_temp.card('s2', 'a2')), 'k20')), 'INVALID invalid_cards', 'a token that exists in the second card of the request refuses the whole request');
select is((select version from app.student_credentials where student_id = pg_temp.id('s1')), 4, 'and the first student kept his credential');
select is((select count(*) from app.access_cards where student_id = pg_temp.id('s1') and token_hash = pg_temp.bytea_of('tok-z1')), 0::bigint, 'and got no card');
select is((select count(*) from app.access_card_issues where op_key = pg_temp.key('k20')), 0::bigint, 'and the issue was not left behind');

-- A group with issues is not deleted: it is archived (F2C-73).
select is(pg_temp.st(format('delete from app.groups where id = %s', quote_literal(pg_temp.id('g1')))), '23503', 'a group with issues is not deleted');

-- =============================================================================================
-- 5. internal_get_student_accounts
-- =============================================================================================
select is(pg_temp.s(format('select api.internal_get_student_accounts(array[%L, %L, %L]::uuid[])', pg_temp.id('s1'), pg_temp.id('s3'), pg_temp.id('ssb'))) -> 'items' -> 0 ->> 'studentId', least(pg_temp.id('s1'), pg_temp.id('s3'))::text, 'items come ordered by student id');
select is(jsonb_array_length(pg_temp.s(format('select api.internal_get_student_accounts(array[%L, %L, %L]::uuid[])', pg_temp.id('s1'), pg_temp.id('s3'), pg_temp.id('ssb'))) -> 'items'), 2, 'the row of a sandbox (not_applicable) is not an account: 2 of 3');
select is((select i ->> 'status' from jsonb_array_elements(pg_temp.s(format('select api.internal_get_student_accounts(array[%L]::uuid[])', pg_temp.id('s1'))) -> 'items') i), 'active', 'the status of an active account');
select is((select i ->> 'authUserId' from jsonb_array_elements(pg_temp.s(format('select api.internal_get_student_accounts(array[%L]::uuid[])', pg_temp.id('s1'))) -> 'items') i), pg_temp.id('u_s1')::text, 'and its authUserId');
select is((select i -> 'authUserId' from jsonb_array_elements(pg_temp.s(format('select api.internal_get_student_accounts(array[%L]::uuid[])', pg_temp.id('s3'))) -> 'items') i), 'null'::jsonb, 'a pending one that never started has none');
select is((select i ->> 'provisioningId' from jsonb_array_elements(pg_temp.s(format('select api.internal_get_student_accounts(array[%L]::uuid[])', pg_temp.id('s3'))) -> 'items') i), (select id::text from app.account_provisioning where student_id = pg_temp.id('s3')), 'and its provisioningId');
select is((select i ->> 'status' from jsonb_array_elements(pg_temp.s(format('select api.internal_get_student_accounts(array[%L]::uuid[])', pg_temp.id('sdel'))) -> 'items') i), 'deleted', 'a deleted one is listed as deleted (the service stops there)');
select is(jsonb_array_length(pg_temp.s(format('select api.internal_get_student_accounts(array[%L]::uuid[])', gen_random_uuid())) -> 'items'), 0, 'an id that is no student: no row');
select is(pg_temp.err(pg_temp.s('select api.internal_get_student_accounts(array[]::uuid[])')), 'P0004', 'no ids is a bug: P0004');
select is(pg_temp.err(pg_temp.s('select api.internal_get_student_accounts(null)')), 'P0004', 'null too');
select is(pg_temp.err(pg_temp.s('select api.internal_get_student_accounts((select array_agg(gen_random_uuid()) from generate_series(1, 61)))')), 'P0004', 'and more than 60');
select is(pg_temp.err(pg_temp.u('teach', format('select api.internal_get_student_accounts(array[%L]::uuid[])', pg_temp.id('s1')))), '42501', 'a teacher cannot call it');

-- =============================================================================================
-- 6. internal_remember_student_account
-- =============================================================================================
create function pg_temp.prov(p_student text) returns uuid language sql as $$ select id from app.account_provisioning where student_id = pg_temp.id(p_student) $$;
select is(pg_temp.s(format('select api.internal_remember_student_account(%L, %L)', pg_temp.prov('s3'), pg_temp.key('acct-s3'))), jsonb_build_object('ok', true, 'authUserId', pg_temp.key('acct-s3')), 'a pending row with no id remembers the one proposed');
select is((select auth_user_id from app.account_provisioning where student_id = pg_temp.id('s3')), pg_temp.key('acct-s3'), 'and it is stored');
select is((select i ->> 'status' from jsonb_array_elements(pg_temp.s('select api.internal_list_unfinished_accounts(200)') -> 'items') i where (i ->> 'studentId')::uuid = pg_temp.id('s3')), 'pending', 'a pending row with its id remembered is what reconcile picks up (the provisioning started)');
select is(pg_temp.s(format('select api.internal_remember_student_account(%L, %L)', pg_temp.prov('s3'), gen_random_uuid())), jsonb_build_object('ok', true, 'authUserId', pg_temp.key('acct-s3')), 'a second call with another id gets the stored one, never its own');
select is(pg_temp.s(format('select api.internal_remember_student_account(%L, %L)', pg_temp.prov('s3'), pg_temp.key('acct-s3'))), jsonb_build_object('ok', true, 'authUserId', pg_temp.key('acct-s3')), 'and the same id again is the same answer');
select is((select status from app.account_provisioning where student_id = pg_temp.id('s3')), 'pending', 'remembering does not change the status');
select is(pg_temp.s(format('select api.internal_remember_student_account(%L, %L)', pg_temp.prov('sdel'), gen_random_uuid())), '{"ok": false}'::jsonb, 'a deleted row answers ok false');
select is((select auth_user_id from app.account_provisioning where student_id = pg_temp.id('sdel')), null, 'and remembers nothing');
select is(pg_temp.s(format('select api.internal_remember_student_account(%L, %L)', (select id from app.account_provisioning where student_id = pg_temp.id('ssb')), gen_random_uuid())), '{"ok": false}'::jsonb, 'the row of a sandbox (not_applicable) is no account: ok false');
select is(pg_temp.err(pg_temp.s(format('select api.internal_remember_student_account(%L, %L)', gen_random_uuid(), gen_random_uuid()))), 'NOT_FOUND not_found', 'a provisioning row that does not exist: NOT_FOUND');
select is(pg_temp.err(pg_temp.s(format('select api.internal_remember_student_account(null, %L)', gen_random_uuid()))), 'NOT_FOUND not_found', 'null: NOT_FOUND');
select is(pg_temp.err(pg_temp.u('teach', format('select api.internal_remember_student_account(%L, %L)', pg_temp.prov('s3'), gen_random_uuid()))), '42501', 'a teacher cannot call it');
-- An account that is already in Auth with another shape: ok false, not P0004 (F2C-71).
insert into ids (k, id) values ('acct_staff', gen_random_uuid());
insert into auth.users (id, email, encrypted_password) values (pg_temp.id('acct_staff'), 'alguien@t2-5a.invalid', 'a-hash');
select is(pg_temp.s(format('select api.internal_remember_student_account(%L, %L)', pg_temp.prov('sfail'), pg_temp.id('acct_staff'))), '{"ok": false}'::jsonb, 'an id that already has a row of Auth with another email and a password: ok false');
select is((select auth_user_id from app.account_provisioning where student_id = pg_temp.id('sfail')), null, 'and nothing is stored');
-- An id that another row remembers.
select is(pg_temp.s(format('select api.internal_remember_student_account(%L, %L)', pg_temp.prov('sfail'), pg_temp.id('u_s1'))), '{"ok": false}'::jsonb, 'an id that another student remembers: ok false');
-- The order: remember, born in Auth, then the status changes, in one transaction without a deadlock.
select is(pg_temp.s(format('select api.internal_remember_student_account(%L, %L)', pg_temp.prov('sfail'), pg_temp.key('acct-sfail'))) ->> 'ok', 'true', 'the free id is remembered');
select is(pg_temp.st(format('insert into auth.users (id, email, encrypted_password) values (%L, %L, ''createUser-random'')', pg_temp.key('acct-sfail'), pg_temp.key('acct-sfail')::text || '@estudiantes.usetiza.app')), 'ok', 'createUser for a remembered id is born (with the password it makes)...');
select is((select encrypted_password from auth.users where id = pg_temp.key('acct-sfail')), null, '...and the trigger leaves it with no password');
select is(pg_temp.st(format('insert into auth.users (id, email) values (%L, %L)', pg_temp.key('acct-never'), pg_temp.key('acct-never')::text || '@estudiantes.usetiza.app')), 'P0004', 'the account of an id nobody remembered is not born with a synthetic email');
select is(pg_temp.s(format('select api.internal_remember_student_account(%L, %L)', pg_temp.prov('sgone'), pg_temp.key('acct-sfail'))), jsonb_build_object('ok', true, 'authUserId', pg_temp.id('u_sgone')), 'the row that already has its id answers it, whatever is asked');

-- =============================================================================================
-- 7. internal_fail_student_account
-- =============================================================================================
select is(pg_temp.s(format('select api.internal_fail_student_account(%L, ''email_taken'')', pg_temp.prov('s3'))), '{"status": "failed", "attempts": 1}'::jsonb, 'pending -> failed, one attempt');
select is((select error_code from app.account_provisioning where student_id = pg_temp.id('s3')), 'email_taken', 'the code is stored, never a message');
select is(pg_temp.s(format('select api.internal_fail_student_account(%L, ''auth_down'')', pg_temp.prov('s3'))), '{"status": "failed", "attempts": 2}'::jsonb, 'failed -> failed counts another attempt');
select is(pg_temp.s(format('select api.internal_fail_student_account(%L, ''account_mismatch'')', pg_temp.prov('s1'))), '{"status": "active", "attempts": 0}'::jsonb, 'an active row is not changed: a late process never undoes a success');
select is((select error_code from app.account_provisioning where student_id = pg_temp.id('s1')), null, 'and keeps no error');
select is(pg_temp.s(format('select api.internal_fail_student_account(%L, ''x_y'')', pg_temp.prov('sdel'))) ->> 'status', 'deleted', 'a deleted row is not changed either');
select is((select attempts from app.account_provisioning where student_id = pg_temp.id('sdel')), 0, 'its attempts neither');
select is(pg_temp.err(pg_temp.s(format('select api.internal_fail_student_account(%L, ''Mensaje con espacios'')', pg_temp.prov('s3')))), 'INVALID invalid_error_code', 'a code is a reason key, not a message');
select is(pg_temp.err(pg_temp.s(format('select api.internal_fail_student_account(%L, null)', pg_temp.prov('s3')))), 'INVALID invalid_error_code', 'null too');
select is(pg_temp.err(pg_temp.s(format('select api.internal_fail_student_account(%L, ''x_y'')', gen_random_uuid()))), 'NOT_FOUND not_found', 'a row that does not exist: NOT_FOUND');
select is(pg_temp.err(pg_temp.s(format('select api.internal_fail_student_account(%L, ''x_y'')', (select id from app.account_provisioning where student_id = pg_temp.id('ssb'))))), 'NOT_FOUND not_found', 'the row of a sandbox is no account');
select is(pg_temp.err(pg_temp.u('teach', format('select api.internal_fail_student_account(%L, ''x_y'')', pg_temp.prov('s3')))), '42501', 'a teacher cannot call it');

-- =============================================================================================
-- 8. internal_list_unfinished_accounts
-- =============================================================================================
-- Other runs can leave unfinished rows in a shared local database; inside this rolled-back transaction they are
-- pushed past the retry limit so the listing below only sees the rows of this file.
update app.account_provisioning set attempts = 5
 where status in ('pending', 'failed') and attempts < 5
   and student_id is not null and student_id <> all (array[pg_temp.id('s3'), pg_temp.id('sfail')]);
-- s3: failed, id remembered (acct-s3), 2 attempts -> listed. sfail: failed, its id remembered (acct-sfail), 1 attempt -> listed.
select is((select array_agg(i ->> 'studentId' order by i ->> 'studentId') from jsonb_array_elements(pg_temp.s('select api.internal_list_unfinished_accounts(50)') -> 'items') i
            where (i ->> 'studentId')::uuid in (pg_temp.id('s3'), pg_temp.id('sfail'))),
  (select array_agg(x::text order by x::text) from unnest(array[pg_temp.id('s3'), pg_temp.id('sfail')]) x), 'a provisioning that started (its id is remembered) and did not finish is listed');
select is((select array_agg(i ->> 'status' order by i ->> 'status') from jsonb_array_elements(pg_temp.s('select api.internal_list_unfinished_accounts(50)') -> 'items') i
            where (i ->> 'studentId')::uuid in (pg_temp.id('s3'), pg_temp.id('sfail'))), array['failed', 'failed'], 'with their statuses');
select is((select count(*) from jsonb_array_elements(pg_temp.s('select api.internal_list_unfinished_accounts(200)') -> 'items') i where i -> 'authUserId' = 'null'::jsonb), 0::bigint, 'every item carries the id it remembers');
update app.account_provisioning set attempts = 5, revision = revision + 1 where student_id = pg_temp.id('s3');
select is((select count(*) from jsonb_array_elements(pg_temp.s('select api.internal_list_unfinished_accounts(200)') -> 'items') i where (i ->> 'studentId')::uuid = pg_temp.id('s3')), 0::bigint, 'with 5 attempts it is not retried');
select is((select count(*) from jsonb_array_elements(pg_temp.s('select api.internal_list_unfinished_accounts(200)') -> 'items') i where (i ->> 'studentId')::uuid in (pg_temp.id('s4'), pg_temp.id('s1'))), 0::bigint, 'an active account whose Auth account exists is not listed');
select is((select count(*) from jsonb_array_elements(pg_temp.s('select api.internal_list_unfinished_accounts(200)') -> 'items') i where (i ->> 'studentId')::uuid = pg_temp.id('sdel')), 0::bigint, 'never a deleted one');
-- An active account that somebody deleted by hand in Auth (F2C-72).
select is(pg_temp.st(format('delete from auth.users where id = %L', pg_temp.id('u_s4'))), 'ok', 'control: the account of s4 is deleted from Auth by hand');
select is((select i ->> 'status' from jsonb_array_elements(pg_temp.s('select api.internal_list_unfinished_accounts(200)') -> 'items') i where (i ->> 'studentId')::uuid = pg_temp.id('s4')), 'active', 'an active row whose account is not in auth.users is listed, to create the same id again');
select is((select i ->> 'authUserId' from jsonb_array_elements(pg_temp.s('select api.internal_list_unfinished_accounts(200)') -> 'items') i where (i ->> 'studentId')::uuid = pg_temp.id('s4')), pg_temp.id('u_s4')::text, 'with the id it remembers');
update app.students set archived_at = now() where id = pg_temp.id('s4');
select is((select count(*) from jsonb_array_elements(pg_temp.s('select api.internal_list_unfinished_accounts(200)') -> 'items') i where (i ->> 'studentId')::uuid = pg_temp.id('s4')), 0::bigint, 'an archived student is not listed');
select is(jsonb_array_length(pg_temp.s('select api.internal_list_unfinished_accounts(1)') -> 'items') <= 1, true, 'p_limit caps the list');
select is(pg_temp.err(pg_temp.s('select api.internal_list_unfinished_accounts(0)')), 'P0004', 'a limit of 0 is a bug');
select is(pg_temp.err(pg_temp.s('select api.internal_list_unfinished_accounts(201)')), 'P0004', 'and 201');
select is(pg_temp.err(pg_temp.s('select api.internal_list_unfinished_accounts(null)')), 'P0004', 'and null');
select is(pg_temp.err(pg_temp.u('teach', 'select api.internal_list_unfinished_accounts(10)')), '42501', 'a teacher cannot call it');

-- =============================================================================================
-- 9. internal_find_institution
-- =============================================================================================
select is(pg_temp.s('select api.internal_find_institution(''t25a'')'), '{"code": "t25a", "name": "Colegio T25a"}'::jsonb, 'a school is found by its code');
select is(pg_temp.s('select api.internal_find_institution(''  T25A '')'), '{"code": "t25a", "name": "Colegio T25a"}'::jsonb, 'with the code as it is normalized');
select is(pg_temp.err(pg_temp.s('select api.internal_find_institution(''t25a-demo'')')), 'NOT_FOUND not_found', 'a sandbox is not a school: NOT_FOUND');
select is(pg_temp.err(pg_temp.s('select api.internal_find_institution(''no-existe'')')), 'NOT_FOUND not_found', 'a code that does not exist: NOT_FOUND');
select is(pg_temp.err(pg_temp.s('select api.internal_find_institution(null)')), 'NOT_FOUND not_found', 'null too');
select is(pg_temp.err(pg_temp.u('teach', 'select api.internal_find_institution(''t25a'')')), '42501', 'a teacher cannot call it');

-- =============================================================================================
-- 10. internal_get_student_login
-- =============================================================================================
select is(pg_temp.s('select api.internal_get_student_login(''t25a'', ''luciaf'')'),
  jsonb_build_object('institutionFound', true, 'authUserId', pg_temp.id('u_s1'), 'passwordHash', pg_temp.scrypt('pw-f1'), 'version', 4), 'the login data of an active student with a credential: his account, the current hash and version');
select is(pg_temp.s('select api.internal_get_student_login(''  T25A '', '' LuciaF '')') ->> 'version', '4', 'the code and the username are normalized');
select is(pg_temp.s('select api.internal_get_student_login(''t25a'', ''anap'')'), '{"institutionFound": true, "authUserId": null, "passwordHash": null, "version": null}'::jsonb, 'a student with no account active and no credential: the three are null');
select is(pg_temp.s('select api.internal_get_student_login(''t25a'', ''no-existe'')'), '{"institutionFound": true, "authUserId": null, "passwordHash": null, "version": null}'::jsonb, 'a username that does not exist: the same answer');
select is(pg_temp.s('select api.internal_get_student_login(''no-existe'', ''luciaf'')'), '{"institutionFound": false, "authUserId": null, "passwordHash": null, "version": null}'::jsonb, 'a code that does not exist says so (the code is no secret)');
select is(pg_temp.s('select api.internal_get_student_login(''t25a-demo'', ''demou'')') ->> 'institutionFound', 'false', 'a sandbox has no login');
update app.students set archived_at = now() where id = pg_temp.id('s1');
select is(pg_temp.s('select api.internal_get_student_login(''t25a'', ''luciaf'')'), '{"institutionFound": true, "authUserId": null, "passwordHash": null, "version": null}'::jsonb, 'an archived student does not log in');
update app.students set archived_at = null where id = pg_temp.id('s1');
update app.account_provisioning set status = 'failed', attempts = 1, error_code = 'x_y', revision = revision + 1 where student_id = pg_temp.id('s1');
select is(pg_temp.s('select api.internal_get_student_login(''t25a'', ''luciaf'')') -> 'passwordHash', 'null'::jsonb, 'an account that is not active does not log in');
update app.account_provisioning set status = 'active', error_code = null, revision = revision + 1 where student_id = pg_temp.id('s1');
select is(pg_temp.s('select api.internal_get_student_login(''t25a'', ''luciaf'')') ->> 'version', '4', 'and is back when it is');
select is(pg_temp.err(pg_temp.u('teach', 'select api.internal_get_student_login(''t25a'', ''luciaf'')')), '42501', 'a teacher cannot call it: only service_role gets a hash');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('u_s1'), 'authenticated', null, 'select api.internal_get_student_login(''t25a'', ''luciaf'')')), '42501', 'nor the student himself');
select is((select count(*) from (select pg_temp.u('teach', format('select api.list_group_accounts(%L)', pg_temp.id('g1')))::text as t
                                  union all select pg_temp.issue('teach', 'g1', jsonb_build_array(pg_temp.card('s2', 'g2')), 'k30')::text) r where r.t like '%scrypt%'), 0::bigint,
  'no other answer carries a password hash: not the list of the group, not the issue');

-- =============================================================================================
-- 11. internal_resolve_access_card
-- =============================================================================================
select is(pg_temp.s(format('select api.internal_resolve_access_card(%L)', pg_temp.bytea_of('tok-f1'))), '{"institutionCode": "t25a", "institutionName": "Colegio T25a", "username": "luciaf"}'::jsonb, 'a current card gives the school and the username, never the name');
select is(pg_temp.err(pg_temp.s(format('select api.internal_resolve_access_card(%L)', pg_temp.bytea_of('tok-d1')))), 'NOT_FOUND not_found', 'an old card (revoked by the new one) does not resolve');
select is(pg_temp.err(pg_temp.s(format('select api.internal_resolve_access_card(%L)', pg_temp.bytea_of('nunca')))), 'NOT_FOUND not_found', 'a token that never existed: the same');
select is(pg_temp.err(pg_temp.s('select api.internal_resolve_access_card(''\x0102''::bytea)')), 'NOT_FOUND not_found', 'a hash of another length too');
select is(pg_temp.err(pg_temp.s('select api.internal_resolve_access_card(null)')), 'NOT_FOUND not_found', 'null too');
update app.students set archived_at = now() where id = pg_temp.id('s1');
select is(pg_temp.err(pg_temp.s(format('select api.internal_resolve_access_card(%L)', pg_temp.bytea_of('tok-f1')))), 'NOT_FOUND not_found', 'the card of an archived student does not resolve');
update app.students set archived_at = null where id = pg_temp.id('s1');
update app.account_provisioning set status = 'failed', attempts = 1, error_code = 'x_y', revision = revision + 1 where student_id = pg_temp.id('s1');
select is(pg_temp.err(pg_temp.s(format('select api.internal_resolve_access_card(%L)', pg_temp.bytea_of('tok-f1')))), 'NOT_FOUND not_found', 'nor one whose account is not active');
update app.account_provisioning set status = 'active', error_code = null, revision = revision + 1 where student_id = pg_temp.id('s1');
select is(pg_temp.s(format('select api.internal_resolve_access_card(%L)', pg_temp.bytea_of('tok-f1'))) ->> 'username', 'luciaf', 'and it resolves again when everything is');
select is(pg_temp.err(pg_temp.u('teach', format('select api.internal_resolve_access_card(%L)', pg_temp.bytea_of('tok-f1')))), '42501', 'a teacher cannot call it');

-- =============================================================================================
-- 12. internal_bind_student_session and app.session_alive for a student
-- =============================================================================================
-- s1 has version 4 now. A session that Auth made without our server has no registry row.
insert into ids (k, id) values ('sess_a', pg_temp.new_session(pg_temp.id('u_s1')));
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('u_s1'), 'authenticated', pg_temp.id('sess_a'), 'select api.list_my_institutions()')), 'FORBIDDEN no_session', 'a student session with no registry row: list_my_institutions is FORBIDDEN no_session');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('u_s1'), 'authenticated', pg_temp.id('sess_a'), 'select api.student_home()')), 'FORBIDDEN no_session', 'and so is a student_* RPC');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('u_s1'), 'authenticated', null, 'select api.student_home()')), null, 'claims without session_id pass as before (the simulated ones of the older tests)');
select is(pg_temp.s(format('select api.internal_bind_student_session(%L, %L, 4)', pg_temp.id('u_s1'), pg_temp.id('sess_a'))), '{"ok": true}'::jsonb, 'the bind with the current version registers the session');
select is((select version from app.student_sessions where session_id = pg_temp.id('sess_a')), 4, 'with that version');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('u_s1'), 'authenticated', pg_temp.id('sess_a'), 'select api.list_my_institutions()')), null, 'now list_my_institutions passes');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('u_s1'), 'authenticated', pg_temp.id('sess_a'), 'select api.student_home()')), null, 'and a student_* RPC');
select is(pg_temp.s(format('select api.internal_bind_student_session(%L, %L, 4)', pg_temp.id('u_s1'), pg_temp.id('sess_a'))), '{"ok": true}'::jsonb, 'binding it again is the same answer');
select is((select count(*) from app.student_sessions where session_id = pg_temp.id('sess_a')), 1::bigint, 'with one row');
-- Another version: the session is deleted and nothing is registered.
insert into ids (k, id) values ('sess_b', pg_temp.new_session(pg_temp.id('u_s1')));
select is(pg_temp.s(format('select api.internal_bind_student_session(%L, %L, 3)', pg_temp.id('u_s1'), pg_temp.id('sess_b'))), '{"ok": false}'::jsonb, 'the bind with an older version answers ok false');
select is((select count(*) from auth.sessions where id = pg_temp.id('sess_b')), 0::bigint, 'and deletes that session of auth.sessions');
select is((select count(*) from app.student_sessions where session_id = pg_temp.id('sess_b')), 0::bigint, 'registering nothing');
insert into ids (k, id) values ('sess_c', pg_temp.new_session(pg_temp.id('u_s1')));
select is(pg_temp.s(format('select api.internal_bind_student_session(%L, %L, 5)', pg_temp.id('u_s1'), pg_temp.id('sess_c'))), '{"ok": false}'::jsonb, 'a version that does not exist yet: ok false and the session is deleted');
select is((select count(*) from auth.sessions where id = pg_temp.id('sess_c')), 0::bigint, 'deleted');
select is(pg_temp.s(format('select api.internal_bind_student_session(%L, %L, 4)', pg_temp.id('u_s1'), pg_temp.id('sess_c'))), '{"ok": false}'::jsonb, 'a session that is not there is ok false (nothing to register)');
select is(pg_temp.s(format('select api.internal_bind_student_session(%L, %L, 4)', pg_temp.id('u_s1'), gen_random_uuid())), '{"ok": false}'::jsonb, 'nor one that never existed');
-- A session of another user is not bound to this student, and is not deleted by this call.
insert into ids (k, id) values ('sess_t', pg_temp.new_session(pg_temp.id('teach')));
select is(pg_temp.s(format('select api.internal_bind_student_session(%L, %L, 4)', pg_temp.id('u_s1'), pg_temp.id('sess_t'))), '{"ok": false}'::jsonb, 'the session of another user does not bind to the student');
select is((select count(*) from auth.sessions where id = pg_temp.id('sess_t')), 1::bigint, 'and is not deleted: only the sessions of that account are touched');
-- Not a student, or archived.
insert into ids (k, id) values ('sess_t2', pg_temp.new_session(pg_temp.id('teach')));
select is(pg_temp.s(format('select api.internal_bind_student_session(%L, %L, 1)', pg_temp.id('teach'), pg_temp.id('sess_t2'))), '{"ok": false}'::jsonb, 'an account that is not a student never registers a session');
select is((select count(*) from app.student_sessions where session_id = pg_temp.id('sess_t2')), 0::bigint, 'nothing is registered');
insert into ids (k, id) values ('sess_d', pg_temp.new_session(pg_temp.id('u_s1')));
update app.students set archived_at = now() where id = pg_temp.id('s1');
select is(pg_temp.s(format('select api.internal_bind_student_session(%L, %L, 4)', pg_temp.id('u_s1'), pg_temp.id('sess_d'))), '{"ok": false}'::jsonb, 'an archived student does not get a session registered');
select is((select count(*) from auth.sessions where id = pg_temp.id('sess_d')), 0::bigint, 'and it is deleted');
update app.students set archived_at = null where id = pg_temp.id('s1');
select is(pg_temp.err(pg_temp.s(format('select api.internal_bind_student_session(null, %L, 1)', gen_random_uuid()))), 'NOT_FOUND not_found', 'null arguments: NOT_FOUND');
select is(pg_temp.err(pg_temp.u('teach', format('select api.internal_bind_student_session(%L, %L, 1)', pg_temp.id('u_s1'), pg_temp.id('sess_a')))), '42501', 'a teacher cannot call it');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('u_s1'), 'authenticated', pg_temp.id('sess_a'), format('select api.internal_bind_student_session(%L, %L, 4)', pg_temp.id('u_s1'), pg_temp.id('sess_a')))), '42501', 'nor the student: nobody registers his own session');

-- The registry follows the credential and the sessions.
select is(pg_temp.st(format('insert into app.student_sessions (session_id, institution_id, student_id, version) values (%L, %L, %L, 3)', pg_temp.id('sess_t'), pg_temp.id('inst'), pg_temp.id('s1'))), 'P0004', 'as the owner: a session registered with a version that is not the current one is refused by the guard');
select is(pg_temp.st(format('insert into app.student_sessions (session_id, institution_id, student_id, version) values (%L, %L, %L, 1)', gen_random_uuid(), pg_temp.id('inst'), pg_temp.id('s3'))), 'P0004', 'and for a student with no credential');
-- A session of s1 whose registry row has an older version (a credential that moved on) stops passing.
insert into app.access_card_issues (id, institution_id, group_id, op_key, op_identity) values (pg_temp.key('issue-x'), pg_temp.id('inst'), pg_temp.id('g1'), pg_temp.key('issue-x-k'), repeat('1', 64));
update app.student_credentials set password_hash = pg_temp.scrypt('otra'), issue_id = pg_temp.key('issue-x'), version = version + 1 where student_id = pg_temp.id('s1');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('u_s1'), 'authenticated', pg_temp.id('sess_a'), 'select api.list_my_institutions()')), 'FORBIDDEN no_session', 'when the credential moves to another version, the registered session of the old one stops reading');
update app.student_credentials set password_hash = pg_temp.scrypt('otra2'), issue_id = (select id from app.access_card_issues where op_key = pg_temp.key('seed-issue')), version = version + 1 where student_id = pg_temp.id('s1');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('u_s1'), 'authenticated', pg_temp.id('sess_a'), 'select api.student_home()')), 'FORBIDDEN no_session', 'and it does not come back with another version either');

-- The user of the session has to be the sub of the JWT.
insert into ids (k, id) values ('sess_s2b', pg_temp.new_session(pg_temp.id('u_s2')));
select is(pg_temp.s(format('select api.internal_bind_student_session(%L, %L, 2)', pg_temp.id('u_s2'), pg_temp.id('sess_s2b'))), '{"ok": true}'::jsonb, 'setup: the session of s2 is bound');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('u_s2'), 'authenticated', pg_temp.id('sess_s2b'), 'select api.student_home()')), null, 'his session reads');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('u_sgone'), 'authenticated', pg_temp.id('sess_s2b'), 'select api.list_my_institutions()')), 'FORBIDDEN no_session', 'the same session with the claims of another student does not pass: its user is not the sub');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('teach'), 'authenticated', pg_temp.id('sess_s2b'), 'select api.list_my_institutions()')), 'FORBIDDEN no_session', 'nor with the claims of a teacher');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('u_s2'), 'authenticated', pg_temp.id('sess_t'), 'select api.list_my_institutions()')), 'FORBIDDEN no_session', 'and the session of a teacher with the claims of a student does not either');
select set_config('request.jwt.claims', jsonb_build_object('session_id', pg_temp.id('sess_t'))::text, true);
select is((select app.session_alive()), false, 'claims with a session_id and no sub are no live session');
select set_config('request.jwt.claims', jsonb_build_object('sub', 'no-es-uuid', 'session_id', pg_temp.id('sess_t'))::text, true);
select is((select app.session_alive()), false, 'nor with a sub that is not a uuid');
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.id('teach'), 'session_id', pg_temp.id('sess_t'))::text, true);
select is((select app.session_alive()), true, 'a teacher with his own session passes (the check of the student only applies to students)');
select set_config('request.jwt.claims', '', true);
-- Signing out (the session leaves auth.sessions) takes the registry row with it.
select is(pg_temp.st(format('delete from auth.sessions where id = %L', pg_temp.id('sess_s2b'))), 'ok', 'control: the session of s2 is deleted from auth.sessions (a sign out)');
select is((select count(*) from app.student_sessions where session_id = pg_temp.id('sess_s2b')), 0::bigint, 'its registry row goes with it (cascade)');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('u_s2'), 'authenticated', pg_temp.id('sess_s2b'), 'select api.student_home()')), 'FORBIDDEN no_session', 'and the old JWT stops reading');
-- And a new card does the same (the same RPC, in its own transaction): s2 with a live registered session.
insert into ids (k, id) values ('sess_s2c', pg_temp.new_session(pg_temp.id('u_s2')));
select is(pg_temp.s(format('select api.internal_bind_student_session(%L, %L, 2)', pg_temp.id('u_s2'), pg_temp.id('sess_s2c'))) ->> 'ok', 'true', 'setup: a new session of s2 is bound');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('u_s2'), 'authenticated', pg_temp.id('sess_s2c'), 'select api.student_home()')), null, 'it reads');
select is(pg_temp.err(pg_temp.issue('teach', 'g1', jsonb_build_array(pg_temp.card('s2', 'h2')), 'k40')), null, 'the teacher issues a new card for s2');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('u_s2'), 'authenticated', pg_temp.id('sess_s2c'), 'select api.student_home()')), 'FORBIDDEN no_session', 'the token of his session stops reading at once');

select * from finish();
rollback;
