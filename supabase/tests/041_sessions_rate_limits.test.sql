-- T2.7: the session of the JWT must still exist in auth.sessions (app.rpc_begin, app.session_alive) and the attempt counters
-- (internal_rate_limit_hit and _clear) and the revoke of sessions (internal_revoke_user_sessions) work and are closed to everyone
-- but service_role. Sessions are rows inserted into auth.sessions here (the pgTAP helper for it is in this file).
-- Placeholder data only. The whole file is rolled back.
begin;
select plan(51);

-- Runs a statement as `p_role` with the claims of `p_user` and, if given, of that session. Returns its jsonb, or {"error": ...}.
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
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  reset role;
  return jsonb_build_object('error', v_state || ' ' || v_message || ' ' || coalesce(v_detail, ''));
end
$f$;
create function pg_temp.err(p_res jsonb) returns text language sql
  as $$ select nullif(btrim(regexp_replace(p_res ->> 'error', '^P0001 ', '')), '') $$;
-- The SQLSTATE of a statement run as postgres, or 'ok'.
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
-- The helper of sessions: a row of auth.sessions for a user (Auth would insert it at sign-in).
create function pg_temp.new_session(p_user uuid) returns uuid language sql as $$
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), p_user, now(), now()) returning id
$$;
create function pg_temp.key(p_bucket text, p_seed text) returns text language sql as $$
  select p_bucket || ':' || encode(sha256(convert_to(p_seed, 'utf8')), 'hex') $$;
create function pg_temp.hit(p_keys text[], p_limits integer[], p_window integer default 900) returns jsonb language sql as $$
  select pg_temp.rpc(null, 'service_role', null, format('select api.internal_rate_limit_hit(%L::text[], %L::integer[], %s)', p_keys, p_limits, p_window)) $$;

create temp table ids (k text primary key, id uuid not null);
create function pg_temp.id(p_key text) returns uuid language sql as $$ select id from ids where k = p_key $$;
insert into ids (k, id) select k, gen_random_uuid() from unnest(array['teach', 'other', 'stu']) as k;
insert into auth.users (id, email) select id, k || '@t2-7.invalid' from ids where k <> 'stu';
select pg_temp.rpc(null, 'service_role', null, format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k)) from (values ('teach'), ('other')) as u(k);
insert into ids (k, id) select 'inst', (pg_temp.rpc(null, 'service_role', null, $$ select api.internal_create_institution('Liceo T27', 't2-7', 'school') $$) ->> 'id')::uuid;
select pg_temp.rpc(null, 'service_role', null, format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('inst'), pg_temp.id('teach')));
insert into ids (k, id) select 'grp', (pg_temp.rpc(pg_temp.id('teach'), 'authenticated', null,
  format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('inst'))) ->> 'id')::uuid;
insert into ids (k, id) select 'student', (pg_temp.rpc(pg_temp.id('teach'), 'authenticated', null,
  format('select api.create_student(%L, ''Estudiante 1'', ''est.1'', gen_random_uuid())', pg_temp.id('grp'))) ->> 'id')::uuid;
-- The account of the student has the canonical shape of phase 2 (docs/contratos/fase-2.md, «Cómo entra un estudiante»), like the provisioning of T2.5a
-- leaves it: its id is remembered first, then the row of Auth is born with the email <id>@estudiantes.usetiza.app, then the student is linked.
-- So student_auth_link_guard stays on; only the staff are ordinary accounts.
select pg_temp.rpc(null, 'service_role', null, format('select api.internal_remember_student_account(%L, %L)',
  (select ap.id from app.account_provisioning ap where ap.student_id = pg_temp.id('student')), pg_temp.id('stu')));
insert into auth.users (id, email) values (pg_temp.id('stu'), pg_temp.id('stu')::text || '@estudiantes.usetiza.app');
select pg_temp.rpc(null, 'service_role', null, format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id('stu'), 'Persona stu'));
select pg_temp.rpc(null, 'service_role', null, format('select api.internal_link_student_user(%L, %L)', pg_temp.id('student'), pg_temp.id('stu')));
insert into ids (k, id) values ('s_teach', pg_temp.new_session(pg_temp.id('teach'))), ('s_stu', pg_temp.new_session(pg_temp.id('stu')));
-- The student is registered like the login does (T2.5a): a credential and the bind of his session.
insert into ids (k, id) values ('issue', gen_random_uuid());
insert into app.access_card_issues (id, institution_id, group_id, op_key, op_identity)
  values (pg_temp.id('issue'), pg_temp.id('inst'), pg_temp.id('grp'), gen_random_uuid(), repeat('a', 64));
insert into app.student_credentials (institution_id, student_id, password_hash, issue_id)
  values (pg_temp.id('inst'), pg_temp.id('student'), 'scrypt$15$8$1$AAAA$AAAA', pg_temp.id('issue'));
select pg_temp.rpc(null, 'service_role', null, format('select api.internal_bind_student_session(%L, %L, 1)', pg_temp.id('stu'), pg_temp.id('s_stu')));

-- 1. A staff RPC (list_my_institutions) and a student RPC (student_home, which runs as tiza_student).
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('teach'), 'authenticated', pg_temp.id('s_teach'), 'select api.list_my_institutions()')), null,
  'staff RPC: a live session passes');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('teach'), 'authenticated', null, 'select api.list_my_institutions()')), null,
  'staff RPC: claims without session_id pass');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('stu'), 'authenticated', pg_temp.id('s_stu'), 'select api.student_home()')), null,
  'student RPC: a live session passes');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('stu'), 'authenticated', null, 'select api.student_home()')), null,
  'student RPC: claims without session_id pass');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('teach'), 'authenticated', gen_random_uuid(), 'select api.list_my_institutions()')), 'FORBIDDEN no_session',
  'staff RPC: a session that does not exist is FORBIDDEN no_session');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('stu'), 'authenticated', gen_random_uuid(), 'select api.student_home()')), 'FORBIDDEN no_session',
  'student RPC: a session that does not exist is FORBIDDEN no_session');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('teach'), 'authenticated', pg_temp.id('s_stu'), 'select api.list_my_institutions()')), 'FORBIDDEN no_session',
  'a session of another user is not the session of the sub: refused (T2.5a)');

-- A session that is deleted stops working in the same transaction, and the others of the user are not touched.
insert into ids (k, id) values ('s_teach2', pg_temp.new_session(pg_temp.id('teach')));
delete from auth.sessions where id = pg_temp.id('s_teach2');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('teach'), 'authenticated', pg_temp.id('s_teach2'), 'select api.list_my_institutions()')), 'FORBIDDEN no_session',
  'staff RPC: the session that was deleted is refused');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('teach'), 'authenticated', pg_temp.id('s_teach'), 'select api.list_my_institutions()')), null,
  'and the other session of the same user still passes');
select is(
  (select app.session_alive()), true, 'session_alive as postgres with no claims is true');
select set_config('request.jwt.claims', jsonb_build_object('session_id', 'no-es-un-uuid')::text, true);
select is((select app.session_alive()), false, 'a session_id that is not a uuid is not a live session');
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.id('teach'), 'session_id', pg_temp.id('s_teach'))::text, true);
select is((select app.session_alive()), true, 'session_alive answers for the session of the claim: alive');
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.id('teach'), 'session_id', pg_temp.id('s_teach2'))::text, true);
select is((select app.session_alive()), false, 'session_alive answers for the session of the claim: deleted');
select set_config('request.jwt.claims', '', true);

-- 2. The hit: one statement, the cap, retryAt, the sweep.
select is(pg_temp.hit(array[pg_temp.key('staff_pair', 'a')], array[3]) ->> 'allowed', 'true', 'the first attempt is allowed');
select pg_temp.hit(array[pg_temp.key('staff_pair', 'a')], array[3]);
select is(pg_temp.hit(array[pg_temp.key('staff_pair', 'a')], array[3]) ->> 'allowed', 'true', 'the third attempt (the cap) is allowed');
select is(pg_temp.hit(array[pg_temp.key('staff_pair', 'a')], array[3]) ->> 'allowed', 'false', 'the fourth is not');
select is((select count from app.rate_limits where key = pg_temp.key('staff_pair', 'a')), 4, 'a blocked attempt counts too');
select is(
  (pg_temp.hit(array[pg_temp.key('staff_pair', 'a')], array[3]) ->> 'retryAt')::timestamptz,
  (select window_start + interval '900 seconds' from app.rate_limits where key = pg_temp.key('staff_pair', 'a')),
  'retryAt is the end of the window');
select ok(
  (select window_start <= clock_timestamp() and window_start + interval '900 seconds' > clock_timestamp()
      and extract(epoch from window_start)::bigint % 900 = 0 and window_seconds = 900
     from app.rate_limits where key = pg_temp.key('staff_pair', 'a')),
  'the window is the fixed one of 900 seconds that holds now');
select is((select count(*) from app.rate_limits where key = pg_temp.key('staff_pair', 'a')), 1::bigint, 'all the attempts share one row');

-- Two keys: one over its cap is enough to block, and each counts on its own.
select pg_temp.hit(array[pg_temp.key('staff_pair', 'b'), pg_temp.key('staff_subject', 'b')], array[1, 30]);
select is(pg_temp.hit(array[pg_temp.key('staff_pair', 'b'), pg_temp.key('staff_subject', 'b')], array[1, 30]) ->> 'allowed', 'false',
  'a key over its cap blocks even if the other is far from its cap');
select is((select count from app.rate_limits where key = pg_temp.key('staff_subject', 'b')), 2, 'and the other key counted both attempts');
select is(pg_temp.hit(array[pg_temp.key('staff_pair', 'b'), pg_temp.key('staff_subject', 'b')], array[30, 1]) ->> 'allowed', 'false',
  'the cap of each key is the one at its own position');

-- Another window length: a one-hour window ends at the end of the hour.
select pg_temp.hit(array[pg_temp.key('reset_email', 'c')], array[3], 3600);
select is(
  (pg_temp.hit(array[pg_temp.key('reset_email', 'c')], array[3], 3600) ->> 'retryAt')::timestamptz,
  (select window_start + interval '3600 seconds' from app.rate_limits where key = pg_temp.key('reset_email', 'c')),
  'retryAt follows the length of the window');

-- Arguments that make no sense are a bug (P0004), not a count.
select is(pg_temp.st(format('select api.internal_rate_limit_hit(array[%L, %L], array[1, 1], 900)', pg_temp.key('staff_pair', 'd'), pg_temp.key('staff_pair', 'd'))), 'P0004', 'the same key twice is refused');
select is(pg_temp.st('select api.internal_rate_limit_hit(array[''juan@example.com''], array[1], 900)'), 'P0004', 'a key that is not bucket:hex is refused (an email never gets in)');
select is(pg_temp.st(format('select api.internal_rate_limit_hit(array[%L], array[1, 2], 900)', pg_temp.key('staff_pair', 'd'))), 'P0004', 'keys and limits of different length are refused');
select is(pg_temp.st(format('select api.internal_rate_limit_hit(array[%L], array[0], 900)', pg_temp.key('staff_pair', 'd'))), 'P0004', 'a cap below 1 is refused');
select is(pg_temp.st(format('select api.internal_rate_limit_hit(array[%L], array[1], 0)', pg_temp.key('staff_pair', 'd'))), 'P0004', 'a window of 0 seconds is refused');

-- The sweep: windows from more than a day ago, 100 per call, and nothing recent.
insert into app.rate_limits (key, window_start, window_seconds, count)
  select pg_temp.key('token_ip', 'old'), now() - interval '26 hours' - n * interval '1 minute', 900, 5 from generate_series(1, 150) n;
insert into app.rate_limits (key, window_start, window_seconds, count)
  values (pg_temp.key('token_ip', 'recent'), now() - interval '23 hours', 900, 5);
select pg_temp.hit(array[pg_temp.key('staff_pair', 'e')], array[3]);
select is((select count(*) from app.rate_limits where key = pg_temp.key('token_ip', 'old')), 50::bigint, 'a call sweeps at most 100 old windows');
select pg_temp.hit(array[pg_temp.key('staff_pair', 'e')], array[3]);
select is((select count(*) from app.rate_limits where key = pg_temp.key('token_ip', 'old')), 0::bigint, 'the next one sweeps the rest');
select is((select count(*) from app.rate_limits where key = pg_temp.key('token_ip', 'recent')), 1::bigint, 'a window from less than a day ago stays');
select is((select count from app.rate_limits where key = pg_temp.key('staff_pair', 'e')), 2, 'and the sweep does not touch the window being counted');

-- 3. The clear.
select pg_temp.hit(array[pg_temp.key('student_pair', 'f'), pg_temp.key('student_subject', 'f')], array[10, 30]);
insert into app.rate_limits (key, window_start, window_seconds, count)
  values (pg_temp.key('student_pair', 'f'), now() - interval '3 hours', 900, 7);
select is(
  pg_temp.rpc(null, 'service_role', null, format('select api.internal_rate_limit_clear(array[%L, %L])', pg_temp.key('student_pair', 'f'), pg_temp.key('student_subject', 'f'))) ->> 'cleared',
  '2', 'clear answers how many current windows it deleted');
select is((select count(*) from app.rate_limits where key in (pg_temp.key('student_pair', 'f'), pg_temp.key('student_subject', 'f')) and window_start > now() - interval '1 hour'),
  0::bigint, 'the current window of the keys is gone');
select is((select count(*) from app.rate_limits where key = pg_temp.key('student_pair', 'f')), 1::bigint, 'an old window is not the current one: it stays');
select is(pg_temp.hit(array[pg_temp.key('student_pair', 'f')], array[1]) ->> 'allowed', 'true', 'after a clear the subject starts from zero');
select is(pg_temp.rpc(null, 'service_role', null, format('select api.internal_rate_limit_clear(array[%L])', pg_temp.key('student_pair', 'zz'))) ->> 'cleared', '0', 'clearing a key with no window answers 0');
select is(pg_temp.st('select api.internal_rate_limit_clear(array[''x''])'), 'P0004', 'clear refuses a key that is not bucket:hex');

-- 4. Revoke sessions.
insert into ids (k, id) values ('s_other', pg_temp.new_session(pg_temp.id('other')));
select is(pg_temp.rpc(null, 'service_role', null, format('select api.internal_revoke_user_sessions(%L)', pg_temp.id('teach'))) ->> 'revoked', '1',
  'revoke deletes the sessions of the user and says how many (the first one was already deleted by this test)');
select is((select count(*) from auth.sessions where user_id = pg_temp.id('teach')), 0::bigint, 'none is left');
select is((select count(*) from auth.sessions where user_id = pg_temp.id('other')), 1::bigint, 'the sessions of another user stay');
select is(pg_temp.err(pg_temp.rpc(pg_temp.id('teach'), 'authenticated', pg_temp.id('s_teach'), 'select api.list_my_institutions()')), 'FORBIDDEN no_session',
  'after the revoke the token of the user does not pass the RPCs');
select is(pg_temp.rpc(null, 'service_role', null, format('select api.internal_revoke_user_sessions(%L)', gen_random_uuid())) ->> 'revoked', '0', 'a user with no sessions: 0');

-- 5. Privileges.
select is_empty($$
  select p.oid::regprocedure::text || ' ' || r.role_name
    from pg_proc p cross join (values ('anon'), ('authenticated')) r(role_name)
   where p.pronamespace = 'api'::regnamespace and p.proname in ('internal_rate_limit_hit', 'internal_rate_limit_clear', 'internal_revoke_user_sessions')
     and has_function_privilege(r.role_name, p.oid, 'execute')
$$, 'anon and authenticated cannot execute the internal RPCs of T2.7');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'api'::regnamespace and p.proname in ('internal_rate_limit_hit', 'internal_rate_limit_clear', 'internal_revoke_user_sessions')
     and (not has_function_privilege('service_role', p.oid, 'execute') or has_function_privilege('tiza_student', p.oid, 'execute')
          or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))
$$, 'service_role executes them, tiza_student and PUBLIC do not');
select is(
  (select array_agg(r.role_name order by r.role_name) from (values ('anon'), ('authenticated'), ('service_role'), ('tiza_student'), ('postgres')) r(role_name)
    where has_function_privilege(r.role_name, 'app.session_alive()', 'execute')),
  array['postgres', 'tiza_student'], 'app.session_alive is executable by its owner and tiza_student only');
select is((select count(*) from aclexplode((select proacl from pg_proc where oid = 'app.session_alive()'::regprocedure)) a where a.grantee = 0), 0::bigint, 'PUBLIC does not execute app.session_alive');
select ok((select p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres' and p.pronargs = 0 and p.proconfig = array['search_path=""']
             from pg_proc p where p.oid = 'app.session_alive()'::regprocedure),
  'app.session_alive is SECURITY DEFINER, owned by postgres, takes no argument and pins search_path');
select is(pg_temp.rpc(pg_temp.id('teach'), 'authenticated', null, format('select api.internal_revoke_user_sessions(%L)', pg_temp.id('other'))) ->> 'error' like '42501%', true,
  'a teacher cannot call internal_revoke_user_sessions');
select is(pg_temp.rpc(pg_temp.id('teach'), 'authenticated', null, format('select api.internal_rate_limit_hit(array[%L], array[1], 900)', pg_temp.key('staff_pair', 'g'))) ->> 'error' like '42501%', true,
  'a teacher cannot call internal_rate_limit_hit');

select * from finish();
rollback;
