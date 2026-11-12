-- Contract of phase 2 (docs/contratos/fase-2.md, version 9; supabase/migrations/20261114100000_f2_contract.sql): the closed
-- tables access_card_issues, access_cards, student_credentials and invitation_tokens, the new columns of invitations, their
-- guards, and the stubs of the 26 new RPCs.
-- Guards are tested as the table owner and must fail with P0004 (as authenticated the UPDATE fails earlier with 42501
-- and would pass even without the guard). Placeholder data only. The whole file is rolled back.
begin;
select plan(180);

create function pg_temp.rpc(p_user uuid, p_role text, p_sql text) returns jsonb
language plpgsql as $f$
declare
  v_res jsonb;
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else jsonb_build_object('sub', p_user, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  execute p_sql into v_res;
  reset role;
  return v_res;
end
$f$;
create temp table ids (k text primary key, id uuid not null);
create function pg_temp.id(p_key text) returns uuid language sql as $$ select id from ids where k = p_key $$;
create function pg_temp.i(p_key text) returns text language sql as $$ select quote_literal(pg_temp.id(p_key)) $$;
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
create function pg_temp.ident(p_seed text) returns text language sql as $$ select encode(sha256(convert_to(p_seed, 'utf8')), 'hex') $$;
create function pg_temp.hash(p_seed text) returns text language sql as $$ select format('''\x%s''::bytea', encode(sha256(convert_to(p_seed, 'utf8')), 'hex')) $$;

-- 1. The tables.
select has_table('app', 'access_card_issues', 'access_card_issues exists');
select has_table('app', 'access_cards', 'access_cards exists');
select columns_are('app', 'access_card_issues',
  array['id', 'institution_id', 'group_id', 'op_key', 'op_identity', 'issued_by', 'created_at'],
  'access_card_issues has exactly the columns of the contract');
select columns_are('app', 'access_cards',
  array['id', 'institution_id', 'student_id', 'issue_id', 'token_hash', 'status', 'created_at', 'revoked_at'],
  'access_cards has exactly the columns of the contract');
select columns_are('app', 'student_credentials', array['id', 'institution_id', 'student_id', 'password_hash', 'version', 'issue_id', 'created_at', 'updated_at'], 'student_credentials has exactly the columns of the contract');
select col_type_is('app', 'access_cards', 'token_hash', 'bytea', 'the token is stored as a hash');
select is((select count(*) from pg_attribute a where a.attrelid = 'app.access_card_issues'::regclass and a.attname in ('student_ids', 'lease_until', 'status', 'finished_at') and not a.attisdropped), 0::bigint,
  'an issue keeps no student ids, no lease and no state: it is one transaction and never changes');
select col_type_is('app', 'access_card_issues', 'op_identity', 'text', 'its identity is a hash');
select col_default_is('app', 'student_credentials', 'version', '1', 'a credential starts at version 1');
select has_table('app', 'invitation_tokens', 'invitation_tokens exists');
select columns_are('app', 'invitation_tokens', array['id', 'token_hash', 'institution_id', 'invitation_id', 'created_at'], 'with exactly the columns of the contract');
select is((select count(*) from pg_attribute a where a.attrelid = 'app.account_provisioning'::regclass and a.attname in ('lease_until', 'lease_holder') and not a.attisdropped), 0::bigint, 'account_provisioning has no lease: nothing writes in Auth under a reservation any more');
select ok(exists (select 1 from pg_indexes where schemaname = 'app' and tablename = 'access_cards' and indexname = 'access_cards_active_key'
                    and indexdef ilike '%unique%(student_id)%status = ''active''%'),
  'one active card per student');
select is((select count(*) from pg_indexes where schemaname = 'app' and tablename = 'access_cards' and indexname = 'access_cards_pending_key'), 0::bigint, 'there is no pending card: a card is born active');
select is((select count(*) from pg_class c where c.oid in ('app.access_card_issues'::regclass, 'app.access_cards'::regclass, 'app.invitation_tokens'::regclass, 'app.student_credentials'::regclass)
            and c.relrowsecurity and c.relforcerowsecurity), 4::bigint, 'all four have RLS enabled and forced');
select is((select count(*) from pg_policy where polrelid in ('app.access_card_issues'::regclass, 'app.access_cards'::regclass, 'app.invitation_tokens'::regclass, 'app.student_credentials'::regclass)),
  0::bigint, 'and no policies');
select is((select count(*) from pg_attribute a where a.attrelid in ('app.access_card_issues'::regclass, 'app.access_cards'::regclass, 'app.invitation_tokens'::regclass)
            and a.attname in ('updated_at', 'revision') and not a.attisdropped),
  0::bigint, 'nobody edits a card or an issue as a document: no updated_at, no revision');

select is_empty($$
  select t.tbl || ' ' || r.role_name || ' ' || p.priv
    from (values ('app.access_card_issues'), ('app.access_cards'), ('app.invitation_tokens'), ('app.student_credentials')) as t(tbl)
   cross join (values ('anon'), ('authenticated'), ('service_role'), ('tiza_student')) as r(role_name)
   cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')) as p(priv)
   where has_table_privilege(r.role_name, t.tbl, p.priv)
$$, 'anon, authenticated, service_role and tiza_student have no privilege on any of them');
select is_empty($$
  select t.tbl || ' ' || r.role_name || ' ' || a.attname
    from (values ('app.access_card_issues'), ('app.access_cards'), ('app.invitation_tokens'), ('app.student_credentials')) as t(tbl)
   cross join (values ('anon'), ('authenticated'), ('service_role'), ('tiza_student')) as r(role_name)
   cross join pg_attribute a
   where a.attrelid = t.tbl::regclass and a.attnum > 0 and not a.attisdropped
     and (has_column_privilege(r.role_name, t.tbl, a.attname, 'select') or has_column_privilege(r.role_name, t.tbl, a.attname, 'update'))
$$, 'nor on any column');
select is_empty($$
  select r.role_name || ' ' || a.attname from (values ('anon'), ('authenticated'), ('service_role'), ('tiza_student')) as r(role_name)
   cross join (values ('op_key'), ('op_identity'), ('sent_at')) as a(attname)
   where has_column_privilege(r.role_name, 'app.invitations', a.attname, 'select')
      or has_column_privilege(r.role_name, 'app.invitations', a.attname, 'update')
$$, 'nor on the new columns of invitations');

select is((select count(*) from pg_trigger t where t.tgrelid in ('app.access_card_issues'::regclass, 'app.access_cards'::regclass, 'app.invitation_tokens'::regclass, 'app.student_credentials'::regclass)
            and t.tgfoid = 'app.no_truncate'::regproc and not t.tgisinternal and t.tgenabled <> 'D'),
  4::bigint, 'all four refuse TRUNCATE (app.no_truncate)');
select is_empty($$
  select f.name from (values ('access_card_issues_frozen'), ('access_card_issues_kept')) as f(name)
   where not exists (select 1 from pg_trigger t where t.tgrelid = 'app.access_card_issues'::regclass and t.tgname = f.name and t.tgenabled <> 'D')
$$, 'access_card_issues has its frozen and kept guards');
select is_empty($$
  select f.name from (values ('access_cards_born'), ('access_cards_frozen'), ('access_cards_kept')) as f(name)
   where not exists (select 1 from pg_trigger t where t.tgrelid = 'app.access_cards'::regclass and t.tgname = f.name and t.tgenabled <> 'D')
$$, 'access_cards has its born, frozen and kept guards');

select is_empty($$
  select f.name from (values ('invitation_tokens_frozen'), ('invitation_tokens_kept')) as f(name)
   where not exists (select 1 from pg_trigger t where t.tgrelid = 'app.invitation_tokens'::regclass and t.tgname = f.name and t.tgenabled <> 'D')
$$, 'invitation_tokens has its frozen and kept guards');
select is_empty($$
  select f.name from (values ('invitations_born'), ('invitations_frozen'), ('invitations_kept'), ('invitations_register_hash')) as f(name)
   where not exists (select 1 from pg_trigger t where t.tgrelid = 'app.invitations'::regclass and t.tgname = f.name and t.tgenabled <> 'D')
$$, 'and invitations has its born, frozen and kept guards');

-- 2. The new columns of invitations.
select col_type_is('app', 'invitations', 'op_key', 'uuid', 'invitations.op_key is a uuid');
select col_type_is('app', 'invitations', 'op_identity', 'text', 'invitations.op_identity is text');
select col_type_is('app', 'invitations', 'sent_at', 'timestamp with time zone', 'invitations.sent_at is a timestamptz');
select ok(exists (select 1 from pg_indexes where schemaname = 'app' and tablename = 'invitations' and indexname = 'invitations_op_key'
                    and indexdef ilike '%unique%(institution_id, op_key)%op_key is not null%'),
  'invitations_op_key is unique per institution where op_key is not null');

-- 3. The stubs: signature, shape, nobody but the owner can run them, and they answer UNAVAILABLE/not_implemented.
create temp table stubs (proname text primary key, args text not null);
insert into stubs (proname, args) values
  ('internal_revoke_user_sessions', 'p_user_id uuid'),
  ('internal_rate_limit_hit', 'p_keys text[], p_limits integer[], p_window_seconds integer'),
  ('internal_rate_limit_clear', 'p_keys text[]'),
  ('create_invitation', 'p_institution_id uuid, p_email text, p_role text, p_token_hash bytea, p_op_key uuid'),
  ('resend_invitation', 'p_invitation_id uuid, p_revision integer, p_token_hash bytea'),
  ('revoke_invitation', 'p_invitation_id uuid, p_revision integer'),
  ('mark_invitation_sent', 'p_invitation_id uuid, p_revision integer'),
  ('list_invitations', 'p_institution_id uuid'),
  ('list_institution_staff', 'p_institution_id uuid'),
  ('get_institution_summary', 'p_institution_id uuid'),
  ('internal_get_invitation', 'p_token_hash bytea'),
  ('internal_create_invitation', 'p_institution_id uuid, p_email text, p_role text, p_token_hash bytea'),
  ('list_enabled_subjects', ''),
  ('internal_finish_invitation_signup', 'p_token_hash bytea, p_user_id uuid, p_display_name text'),
  ('accept_invitation', 'p_token_hash bytea'),
  ('list_taken_usernames', 'p_institution_id uuid, p_bases text[]'),
  ('list_group_accounts', 'p_group_id uuid'),
  ('issue_access_cards', 'p_group_id uuid, p_cards jsonb, p_op_key uuid'),
  ('internal_bind_student_session', 'p_auth_user_id uuid, p_session_id uuid, p_version integer'),
  ('internal_get_student_accounts', 'p_student_ids uuid[]'),
  ('internal_remember_student_account', 'p_provisioning_id uuid, p_auth_user_id uuid'),
  ('internal_fail_student_account', 'p_provisioning_id uuid, p_error_code text'),
  ('internal_list_unfinished_accounts', 'p_limit integer'),
  ('internal_find_institution', 'p_code text'),
  ('internal_get_student_login', 'p_code text, p_username text'),
  ('internal_resolve_access_card', 'p_token_hash bytea');

select is((select count(*) from stubs), 26::bigint, 'the contract lists 26 new RPCs');
select is_empty($$ select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'api'::regnamespace
                    and p.proname in ('internal_rate_limit_status', 'internal_find_auth_user', 'internal_claim_card_password', 'internal_claim_provisioning', 'internal_extend_provisioning', 'internal_extend_card_issue', 'begin_access_cards', 'finish_access_cards', 'internal_claim_account', 'internal_resolve_student_login') $$,
  'the RPCs of the earlier drafts are gone');
select is_empty($$ select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'api'::regnamespace and ((p.proname = 'mark_invitation_sent' and pg_get_function_identity_arguments(p.oid) = 'p_invitation_id uuid')
         or (p.proname in ('internal_remember_student_account', 'internal_fail_student_account') and pg_get_function_identity_arguments(p.oid) like '%p_holder%')) $$,
  'and the old signatures of mark_invitation_sent, internal_remember_student_account and internal_fail_student_account are gone');

select is_empty($$
  select s.proname from stubs s
   where not exists (select 1 from pg_proc p where p.pronamespace = 'api'::regnamespace and p.proname = s.proname
                       and pg_get_function_identity_arguments(p.oid) = s.args)
$$, 'every new RPC exists in api with the exact signature of the contract');
select is_empty($$
  select s.proname from stubs s join pg_proc p on p.pronamespace = 'api'::regnamespace and p.proname = s.proname
   where not (p.prosecdef and p.prorettype = 'jsonb'::regtype and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
              and coalesce('search_path=""' = any (p.proconfig), false))
$$, 'each one is plpgsql, security definer, returns jsonb and pins search_path');
select is_empty($$
  select s.proname from stubs s join pg_proc p on p.pronamespace = 'api'::regnamespace and p.proname = s.proname
   where pg_get_userbyid(p.proowner) <> 'postgres'
$$, 'postgres owns every new RPC');

-- Nobody but the owner: no grant to PUBLIC, anon, authenticated or service_role until the implementing ticket grants. These
-- checks look at the RPCs that are still stubs: a ticket that replaces one (and grants it) does not break this file, which keeps
-- the signatures for good.
select is_empty($$
  select s.proname || ' ' || coalesce(a.grantee::regrole::text, 'PUBLIC')
    from stubs s join pg_proc p on p.pronamespace = 'api'::regnamespace and p.proname = s.proname
   cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where a.grantee <> p.proowner and p.prosrc like '%''not_implemented''%'
$$, 'no ACL entry on a stub besides its owner (PUBLIC revoked, nothing granted)');
select is_empty($$
  select s.proname || ' ' || r.role_name
    from stubs s join pg_proc p on p.pronamespace = 'api'::regnamespace and p.proname = s.proname
   cross join (values ('anon'), ('authenticated'), ('service_role'), ('tiza_student')) as r(role_name)
   where has_function_privilege(r.role_name, p.oid, 'execute') and p.prosrc like '%''not_implemented''%'
$$, 'neither anon, authenticated, service_role nor tiza_student can execute a stub');
select is_empty($$
  select s.proname from stubs s join pg_proc p on p.pronamespace = 'api'::regnamespace and p.proname = s.proname
   where not has_function_privilege('postgres', p.oid, 'execute')
$$, 'the owner can');

-- Each stub, called as the owner with null arguments, answers UNAVAILABLE / not_implemented.
create function pg_temp.stub_answer(p_name text) returns text
language plpgsql as $f$
declare
  v_sql text;
  v_state text;
  v_message text;
  v_detail text;
begin
  -- an RPC that a ticket already implemented is not called with nulls: only the stubs are
  if not exists (select 1 from pg_proc p where p.pronamespace = 'api'::regnamespace and p.proname = p_name and p.prosrc like '%''not_implemented''%') then
    return 'P0001 UNAVAILABLE not_implemented';
  end if;
  select format('select api.%I(%s)', s.proname, coalesce((select string_agg('null::' || split_part(trim(a), ' ', 2), ', ')
                                                from unnest(string_to_array(s.args, ',')) as a where trim(a) <> ''), ''))
    into v_sql from stubs s where s.proname = p_name;
  execute v_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return v_state || ' ' || v_message || ' ' || coalesce(v_detail, '');
end
$f$;
select is_empty($$ select s.proname || ': ' || pg_temp.stub_answer(s.proname) from stubs s
                    where exists (select 1 from pg_proc p where p.pronamespace = 'api'::regnamespace and p.proname = s.proname and p.prosrc like '%''not_implemented''%')
                      and pg_temp.stub_answer(s.proname) <> 'P0001 UNAVAILABLE not_implemented' $$,
  'every RPC that is still a stub answers UNAVAILABLE / not_implemented');
select is_empty($$
  select s.proname from stubs s join pg_proc p on p.pronamespace = 'api'::regnamespace and p.proname = s.proname
   where coalesce(lower(regexp_replace(substring(p.prosrc from '(?i)\mbegin\M\s*([^;]*;)'), '\s+', ' ', 'g')), '') <> 'perform app.rpc_begin();'
$$, 'every stub starts with perform app.rpc_begin()');

-- 4. Guards. Institution A: a teacher, a group, two students. Institution B: a teacher, a group, a student.
insert into ids (k, id) select k, gen_random_uuid() from unnest(array['teach', 'userx', 'teachb']) as k;
insert into auth.users (id, email) select id, k || '@f2-contract.invalid' from ids;
do $$
declare
  k text;
begin
  for k in select ids.k from ids loop
    perform pg_temp.rpc(null, 'service_role', format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;
insert into ids (k, id) select 'i_a', (pg_temp.rpc(null, 'service_role', $$ select api.internal_create_institution('Liceo F2 A', 'f2-a', 'school') $$) ->> 'id')::uuid;
insert into ids (k, id) select 'i_b', (pg_temp.rpc(null, 'service_role', $$ select api.internal_create_institution('Liceo F2 B', 'f2-b', 'school') $$) ->> 'id')::uuid;
select pg_temp.rpc(null, 'service_role', format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_a'), pg_temp.id('teach')));
select pg_temp.rpc(null, 'service_role', format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_b'), pg_temp.id('teachb')));
insert into ids (k, id) select 'g_a', (pg_temp.rpc(pg_temp.id('teach'), 'authenticated', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_a'))) ->> 'id')::uuid;
insert into ids (k, id) select 'g_b', (pg_temp.rpc(pg_temp.id('teachb'), 'authenticated', format('select api.create_group(%L, ''3.º B'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_b'))) ->> 'id')::uuid;
insert into ids (k, id) select 's1', (pg_temp.rpc(pg_temp.id('teach'), 'authenticated', format('select api.create_student(%L, ''Estudiante 1'', ''est.1'', gen_random_uuid())', pg_temp.id('g_a'))) ->> 'id')::uuid;
insert into ids (k, id) select 's2', (pg_temp.rpc(pg_temp.id('teach'), 'authenticated', format('select api.create_student(%L, ''Estudiante 2'', ''est.2'', gen_random_uuid())', pg_temp.id('g_a'))) ->> 'id')::uuid;
insert into ids (k, id) select 's3', (pg_temp.rpc(pg_temp.id('teachb'), 'authenticated', format('select api.create_student(%L, ''Estudiante 3'', ''est.3'', gen_random_uuid())', pg_temp.id('g_b'))) ->> 'id')::uuid;
insert into ids (k, id) select k, gen_random_uuid() from unnest(array['issue_a', 'issue_a2', 'issue_b']) as k;

create function pg_temp.scrypt(p_seed text) returns text language sql as $$
  select format('scrypt$15$8$1$%s$%s',
    replace(encode(substr(sha256(convert_to(p_seed, 'utf8')), 1, 16), 'base64'), E'
', ''),
    replace(encode(sha256(convert_to(p_seed || 'a', 'utf8')) || sha256(convert_to(p_seed || 'b', 'utf8')), 'base64'), E'
', '')) $$;

-- 4a. Issues: one transaction, kept for idempotency. It never changes.
select is(pg_temp.st(format('insert into app.access_card_issues (id, institution_id, group_id, op_key, op_identity, issued_by) values (%s, %s, %s, ''00000000-0000-0000-0000-0000000000f1'', %L, %s)',
  pg_temp.i('issue_a'), pg_temp.i('i_a'), pg_temp.i('g_a'), pg_temp.ident('a'), pg_temp.i('teach'))), 'ok', 'control: an issue is born with its identity and its issuer');
select is(pg_temp.st(format('insert into app.access_card_issues (institution_id, group_id, op_key, op_identity) values (%s, %s, ''00000000-0000-0000-0000-0000000000f1'', %L)',
  pg_temp.i('i_a'), pg_temp.i('g_a'), pg_temp.ident('b'))), '23505', 'the same op_key in the same institution is one issue');
select is(pg_temp.st(format('insert into app.access_card_issues (institution_id, group_id, op_key, op_identity) values (%s, %s, gen_random_uuid(), %L)',
  pg_temp.i('i_a'), pg_temp.i('g_b'), pg_temp.ident('c'))), '23503', 'an issue cannot point at a group of another institution');
select is(pg_temp.st(format('insert into app.access_card_issues (institution_id, group_id, op_key, op_identity) values (%s, %s, gen_random_uuid(), ''abc'')',
  pg_temp.i('i_a'), pg_temp.i('g_a'))), '23514', 'an identity is 64 hex digits');
select is(pg_temp.st(format('insert into app.access_card_issues (institution_id, group_id, op_key, op_identity) values (%s, %s, gen_random_uuid(), %L)',
  pg_temp.i('i_a'), pg_temp.i('g_a'), upper(pg_temp.ident('c')))), '23514', 'in lower case');

select is(pg_temp.st(format('update app.access_card_issues set institution_id = %s where id = %s', pg_temp.i('i_b'), pg_temp.i('issue_a'))), 'P0004', 'issue: institution_id never changes');
select is(pg_temp.st(format('update app.access_card_issues set group_id = %s where id = %s', pg_temp.i('g_b'), pg_temp.i('issue_a'))), 'P0004', 'group_id never changes');
select is(pg_temp.st(format('update app.access_card_issues set op_key = gen_random_uuid() where id = %s', pg_temp.i('issue_a'))), 'P0004', 'op_key never changes');
select is(pg_temp.st(format('update app.access_card_issues set op_identity = %L where id = %s', pg_temp.ident('otra'), pg_temp.i('issue_a'))), 'P0004', 'op_identity never changes');
select is(pg_temp.st(format('update app.access_card_issues set created_at = now() - interval ''1 day'' where id = %s', pg_temp.i('issue_a'))), 'P0004', 'created_at never changes');
select is(pg_temp.st(format('update app.access_card_issues set id = gen_random_uuid() where id = %s', pg_temp.i('issue_a'))), 'P0004', 'nor does id');
select is(pg_temp.st(format('update app.access_card_issues set issued_by = %s where id = %s', pg_temp.i('userx'), pg_temp.i('issue_a'))), 'P0004', 'issued_by is not replaced by another actor');
select is(pg_temp.st(format('update app.access_card_issues set issued_by = null where id = %s', pg_temp.i('issue_a'))), 'P0004', 'nor goes to NULL while the account exists');
select is(pg_temp.st(format('update app.access_card_issues set op_identity = op_identity where id = %s', pg_temp.i('issue_a'))), 'ok', 'control: an update that changes nothing is no change');
select is(pg_temp.st(format('delete from app.access_card_issues where id = %s', pg_temp.i('issue_a'))), 'P0004', 'an issue is not deleted by hand while its group exists');

-- 4b. Cards: born active, active goes to revoked and no further.
select is(pg_temp.st(format('insert into app.access_cards (institution_id, student_id, issue_id, token_hash) values (%s, %s, %s, %s)',
  pg_temp.i('i_a'), pg_temp.i('s1'), pg_temp.i('issue_a'), pg_temp.hash('c1'))), 'ok', 'control: a card is born active');
select is(pg_temp.st(format('insert into app.access_cards (institution_id, student_id, issue_id, token_hash) values (%s, %s, %s, %s)',
  pg_temp.i('i_a'), pg_temp.i('s2'), pg_temp.i('issue_a'), pg_temp.hash('c2'))), 'ok', 'control: one per student of the issue');
select is((select status from app.access_cards where token_hash = decode(pg_temp.ident('c1'), 'hex')), 'active', 'and it is active');
select is(pg_temp.st(format('insert into app.access_cards (institution_id, student_id, issue_id, token_hash, status, revoked_at) values (%s, %s, %s, %s, ''revoked'', now())',
  pg_temp.i('i_a'), pg_temp.i('s1'), pg_temp.i('issue_a'), pg_temp.hash('c1r'))), 'P0004', 'a card is not born revoked');
select is(pg_temp.st(format('insert into app.access_cards (institution_id, student_id, issue_id, token_hash, status) values (%s, %s, %s, %s, ''pending'')',
  pg_temp.i('i_a'), pg_temp.i('s1'), pg_temp.i('issue_a'), pg_temp.hash('c1p'))), 'P0004', 'there is no pending card: a card is born active');
select is(pg_temp.st(format('insert into app.access_cards (institution_id, student_id, issue_id, token_hash) values (%s, %s, %s, %s)',
  pg_temp.i('i_a'), pg_temp.i('s1'), pg_temp.i('issue_a'), pg_temp.hash('c1b'))), '23505', 'a second active card for the same student is refused');
select is(pg_temp.st(format('insert into app.access_cards (institution_id, student_id, issue_id, token_hash) values (%s, %s, %s, %s)',
  pg_temp.i('i_a'), pg_temp.i('s3'), pg_temp.i('issue_a'), pg_temp.hash('c3'))), '23503', 'a card cannot point at a student of another institution');
select is(pg_temp.st(format('insert into app.access_cards (institution_id, student_id, issue_id, token_hash) values (%s, %s, %s, ''\x0102''::bytea)',
  pg_temp.i('i_a'), pg_temp.i('s1'), pg_temp.i('issue_a'))), '23514', 'a token hash is exactly 32 bytes');

select is(pg_temp.st(format('update app.access_cards set institution_id = %s where student_id = %s', pg_temp.i('i_b'), pg_temp.i('s1'))), 'P0004', 'card: institution_id never changes');
select is(pg_temp.st(format('update app.access_cards set student_id = %s where student_id = %s', pg_temp.i('s3'), pg_temp.i('s1'))), 'P0004', 'student_id never moves to a student of another institution');
select is(pg_temp.st(format('update app.access_cards set student_id = %s where token_hash = %s', pg_temp.i('s2'), pg_temp.hash('c1'))), 'P0004', 'nor to another one of the same');
select is(pg_temp.st(format('update app.access_cards set issue_id = %s where student_id = %s', pg_temp.i('issue_a2'), pg_temp.i('s1'))), 'P0004', 'issue_id never changes');
select is(pg_temp.st(format('update app.access_cards set token_hash = %s where student_id = %s', pg_temp.hash('otro'), pg_temp.i('s1'))), 'P0004', 'token_hash never changes');
select is(pg_temp.st(format('update app.access_cards set id = gen_random_uuid() where student_id = %s', pg_temp.i('s1'))), 'P0004', 'id never changes');
select is(pg_temp.st(format('update app.access_cards set created_at = now() - interval ''1 day'' where student_id = %s', pg_temp.i('s1'))), 'P0004', 'created_at never changes');
select is(pg_temp.st(format('update app.access_cards set status = ''revoked'' where student_id = %s', pg_temp.i('s2'))), '23514', 'revoked needs its revoked_at (the table refuses it)');

select is(pg_temp.st(format('update app.access_cards set status = ''revoked'', revoked_at = now() where token_hash = %s', pg_temp.hash('c1'))), 'ok', 'control: active goes to revoked');
select is(pg_temp.st(format('update app.access_cards set status = ''active'', revoked_at = null where token_hash = %s', pg_temp.hash('c1'))), 'P0004', 'a revoked card is never revived');
select is(pg_temp.st(format('update app.access_cards set revoked_at = now() + interval ''1 hour'' where token_hash = %s', pg_temp.hash('c1'))), 'P0004', 'nor is its revocation moved');
select is(pg_temp.st(format('insert into app.access_cards (institution_id, student_id, issue_id, token_hash) values (%s, %s, %s, %s)',
  pg_temp.i('i_a'), pg_temp.i('s1'), pg_temp.i('issue_a'), pg_temp.hash('c1n'))), 'ok', 'control: once the old one is revoked, a new one is active');
select is(pg_temp.st(format('delete from app.access_cards where token_hash = %s', pg_temp.hash('c1'))), 'P0004', 'a revoked card is not deleted by hand: its hash never comes back as a current one');
select is(pg_temp.st(format('delete from app.access_cards where token_hash = %s', pg_temp.hash('c1n'))), 'P0004', 'nor an active one');

insert into app.access_card_issues (id, institution_id, group_id, op_key, op_identity) values (pg_temp.id('issue_a2'), pg_temp.id('i_a'), pg_temp.id('g_a'), gen_random_uuid(), pg_temp.ident('a2'));

-- 4c. Credentials: the scrypt hash of the password of a student; only the server writes it, only the student's erasure deletes it.
select is(pg_temp.st(format('insert into app.student_credentials (institution_id, student_id, password_hash, issue_id) values (%s, %s, %L, %s)',
  pg_temp.i('i_a'), pg_temp.i('s1'), pg_temp.scrypt('p1'), pg_temp.i('issue_a'))), 'ok', 'control: a credential is stored');
select is(pg_temp.st(format('insert into app.student_credentials (institution_id, student_id, password_hash, issue_id) values (%s, %s, %L, %s)',
  pg_temp.i('i_a'), pg_temp.i('s1'), pg_temp.scrypt('p1b'), pg_temp.i('issue_a'))), '23505', 'one per student');
select is(pg_temp.st(format('insert into app.student_credentials (institution_id, student_id, password_hash, issue_id) values (%s, %s, ''nube-tigre-47'', %s)',
  pg_temp.i('i_a'), pg_temp.i('s2'), pg_temp.i('issue_a'))), '23514', 'a plain password is not accepted: only the scrypt format');
select is(pg_temp.st(format('insert into app.student_credentials (institution_id, student_id, password_hash, issue_id) values (%s, %s, ''scrypt$14$8$1$AAAA$AAAA'', %s)',
  pg_temp.i('i_a'), pg_temp.i('s2'), pg_temp.i('issue_a'))), '23514', 'nor other parameters than N = 2^15, r = 8, p = 1');
select is(pg_temp.st(format('insert into app.student_credentials (institution_id, student_id, password_hash, issue_id) values (%s, %s, %L, %s)',
  pg_temp.i('i_a'), pg_temp.i('s3'), pg_temp.scrypt('p3'), pg_temp.i('issue_a'))), '23503', 'a credential cannot point at a student of another institution');
select is(pg_temp.st(format('update app.student_credentials set password_hash = %L where student_id = %s', pg_temp.scrypt('p1new'), pg_temp.i('s1'))), 'P0004', 'a new hash alone is refused: it comes with another issue and the next version');
select is(pg_temp.st(format('update app.student_credentials set password_hash = %L, issue_id = %s where student_id = %s', pg_temp.scrypt('p1new'), pg_temp.i('issue_a2'), pg_temp.i('s1'))), 'P0004', 'a new hash and issue without the next version is refused');
select is(pg_temp.st(format('update app.student_credentials set version = version + 1 where student_id = %s', pg_temp.i('s1'))), 'P0004', 'a version alone is refused');
select is(pg_temp.st(format('update app.student_credentials set password_hash = %L, version = version + 1 where student_id = %s', pg_temp.scrypt('p1new'), pg_temp.i('s1'))), 'P0004', 'a hash and version in the same issue are refused: the issue is another one');
select is(pg_temp.st(format('update app.student_credentials set issue_id = %s where student_id = %s', pg_temp.i('issue_a2'), pg_temp.i('s1'))), 'P0004', 'an issue alone is refused');
select is(pg_temp.st(format('update app.student_credentials set password_hash = %L, issue_id = %s, version = version + 2 where student_id = %s', pg_temp.scrypt('p1new'), pg_temp.i('issue_a2'), pg_temp.i('s1'))), 'P0004', 'the version goes up by exactly one');
select is(pg_temp.st(format('update app.student_credentials set password_hash = %L, issue_id = %s, version = version + 1 where student_id = %s', pg_temp.scrypt('p1new'), pg_temp.i('issue_a2'), pg_temp.i('s1'))), 'ok', 'control: a new card changes hash, issue and version together');
select is((select version from app.student_credentials where student_id = pg_temp.id('s1')), 2, 'and the version is the next one');
select is(pg_temp.st(format('update app.student_credentials set institution_id = %s where student_id = %s', pg_temp.i('i_b'), pg_temp.i('s1'))), 'P0004', 'credential: institution_id never changes');
select is(pg_temp.st(format('update app.student_credentials set student_id = %s where student_id = %s', pg_temp.i('s2'), pg_temp.i('s1'))), 'P0004', 'student_id never changes');
select is(pg_temp.st(format('delete from app.student_credentials where student_id = %s', pg_temp.i('s1'))), 'P0004', 'a credential is not deleted by hand');

select is(pg_temp.st('truncate app.access_cards'), 'P0004', 'access_cards is never truncated');
select is(pg_temp.st('truncate app.student_credentials'), 'P0004', 'nor student_credentials');
-- access_card_issues and invitations are referenced by other tables, so Postgres refuses these before any trigger (the triggers are checked above).
select is(pg_temp.st('truncate app.access_card_issues'), '0A000', 'nor access_card_issues');
select is(pg_temp.st('truncate app.invitations'), '0A000', 'nor invitations');

-- 4d. Deleting an account, a student, a group: what goes with them.
select is(pg_temp.st(format('delete from auth.users where id = %s', pg_temp.i('teach'))), 'ok', 'control: the account of the issuer is deleted');
select is((select count(*) from app.access_card_issues where issued_by is not null), 0::bigint, 'the issues it made stay with no issuer');
select is(pg_temp.st(format('insert into app.access_card_issues (id, institution_id, group_id, op_key, op_identity) values (%s, %s, %s, gen_random_uuid(), %L)',
  pg_temp.i('issue_b'), pg_temp.i('i_b'), pg_temp.i('g_b'), pg_temp.ident('d'))), 'ok', 'control: an issue of the other institution');
select is(pg_temp.st(format('insert into app.access_cards (institution_id, student_id, issue_id, token_hash) values (%s, %s, %s, %s)',
  pg_temp.i('i_b'), pg_temp.i('s3'), pg_temp.i('issue_b'), pg_temp.hash('c3'))), 'ok', 'and its card');
select is(pg_temp.st(format('insert into app.student_credentials (institution_id, student_id, password_hash, issue_id) values (%s, %s, %L, %s)',
  pg_temp.i('i_b'), pg_temp.i('s3'), pg_temp.scrypt('p3'), pg_temp.i('issue_b'))), 'ok', 'and its credential');
-- The erasure order of phase 1: unlink the pseudonym and mark the account deleted, then the student goes.
update app.student_pseudonyms set student_id = null, unlinked_at = now() where student_id = pg_temp.id('s3');
update app.account_provisioning set status = 'deleted', revision = revision + 1 where student_id = pg_temp.id('s3');
select is(pg_temp.st(format('delete from app.students where id = %s', pg_temp.i('s3'))), 'ok', 'control: the student is deleted (the erasure)');
select is(pg_temp.st(format('delete from app.account_provisioning where institution_id = %s and status = ''deleted'' and student_id is null', pg_temp.i('i_b'))), 'P0004', 'a deleted mark is not deleted while its institution exists, even without its student');
select is((select count(*) from app.access_cards where institution_id = pg_temp.id('i_b')), 0::bigint, 'his cards go with him, by the cascade');
select is((select count(*) from app.student_credentials where institution_id = pg_temp.id('i_b')), 0::bigint, 'and his credential');
select is(pg_temp.st(format('delete from app.groups where id = %s', pg_temp.i('g_b'))), 'ok', 'control: the group is deleted');
select is((select count(*) from app.access_card_issues where institution_id = pg_temp.id('i_b')), 0::bigint, 'and its issues go with it, by the cascade');
select is((select count(*) from app.access_cards where institution_id = pg_temp.id('i_a')), 3::bigint, 'nothing of the other institution was lost');

-- 5. invitations: op_key and op_identity never change; accepted and revoked are final; expired goes back with a new hash.
create function pg_temp.inv(p_email text, p_extra text default '') returns text language sql as $$
  select format('insert into app.invitations (institution_id, email, role, token_hash, expires_at %s) values (%s, %L, ''teacher'', %s, now() + interval ''7 days'' %s)',
    case when p_extra = '' then '' else ', ' || split_part(p_extra, '|', 1) end, pg_temp.i('i_b'), p_email || '@f2-contract.invalid', pg_temp.hash(p_email),
    case when p_extra = '' then '' else ', ' || split_part(p_extra, '|', 2) end) $$;
create function pg_temp.inv_where(p_email text) returns text language sql as $$ select format('where email = %L', p_email || '@f2-contract.invalid') $$;

select is(pg_temp.st(pg_temp.inv('a', 'op_key, op_identity|' || quote_literal(pg_temp.id('userx')) || ', ''id-a''')), 'ok', 'control: an invitation is born with its op_key and op_identity');
select is(pg_temp.st(pg_temp.inv('b', 'op_key|' || quote_literal(pg_temp.id('userx')))), '23505', 'the same op_key in the same institution is one invitation');
select is(pg_temp.st(replace(pg_temp.inv('b', 'op_key|' || quote_literal(pg_temp.id('userx'))), pg_temp.i('i_b'), pg_temp.i('i_a'))), 'ok', 'control: the same op_key in another institution is another');
select is(pg_temp.st(pg_temp.inv('c', 'status|''accepted''')), 'P0004', 'an invitation is not born accepted');
select is(pg_temp.st(pg_temp.inv('d', 'status|''revoked''')), 'P0004', 'nor revoked');
select is(pg_temp.st('update app.invitations set op_key = gen_random_uuid() ' || pg_temp.inv_where('a')), 'P0004', 'op_key never changes');
select is(pg_temp.st('update app.invitations set op_key = null ' || pg_temp.inv_where('a')), 'P0004', 'nor goes back to NULL');
select is(pg_temp.st('update app.invitations set op_identity = ''otra'' ' || pg_temp.inv_where('a')), 'P0004', 'op_identity never changes');
select is(pg_temp.st(pg_temp.inv('e')), 'ok', 'control: one with no op_key (the admin command)');
select is(pg_temp.st('update app.invitations set op_key = gen_random_uuid() ' || pg_temp.inv_where('e')), 'P0004', 'an op_key is not added afterwards');
select is(pg_temp.st('update app.invitations set sent_at = now() ' || pg_temp.inv_where('a')), 'ok', 'control: sent_at is set by mark_invitation_sent');
select is(pg_temp.st('update app.invitations set email = ''z@f2-contract.invalid'' ' || pg_temp.inv_where('a')), 'P0004', 'the guards of phase 1 are still there: the email never changes');
select is(pg_temp.st(format('update app.invitations set accepted_by = %s %s', pg_temp.i('userx'), pg_temp.inv_where('a'))), 'P0004', 'and accepted_by is set only by the acceptance');

select is(pg_temp.st('update app.invitations set token_hash = ' || pg_temp.hash('a2') || ' ' || pg_temp.inv_where('a')), 'ok', 'control: a pending invitation takes a new hash (the resend)');
select is(pg_temp.st('update app.invitations set status = ''expired'' ' || pg_temp.inv_where('a')), 'ok', 'control: pending goes to expired');
select is(pg_temp.st('update app.invitations set status = ''pending'' ' || pg_temp.inv_where('a')), 'P0004', 'expired goes back to pending only with a new hash');
select is(pg_temp.st('update app.invitations set status = ''accepted'' ' || pg_temp.inv_where('a')), 'P0004', 'expired is not accepted');
select is(pg_temp.st('update app.invitations set token_hash = ' || pg_temp.hash('a3') || ' ' || pg_temp.inv_where('a')), 'P0004', 'an expired invitation does not change its hash without going back to pending');
select is(pg_temp.st('update app.invitations set status = ''pending'', token_hash = ' || pg_temp.hash('a3') || ' ' || pg_temp.inv_where('a')), 'ok', 'control: expired goes back to pending with a new hash');
select is(pg_temp.st('update app.invitations set status = ''revoked'' ' || pg_temp.inv_where('a')), 'ok', 'control: pending is revoked');
select is(pg_temp.st('update app.invitations set status = ''pending'', token_hash = ' || pg_temp.hash('a4') || ' ' || pg_temp.inv_where('a')), 'P0004', 'revoked is final');
select is(pg_temp.st('update app.invitations set token_hash = ' || pg_temp.hash('a5') || ' ' || pg_temp.inv_where('a')), 'P0004', 'and its hash does not change');
select is(pg_temp.st(format('update app.invitations set status = ''accepted'', accepted_at = now(), accepted_by = %s %s', pg_temp.i('userx'), pg_temp.inv_where('e'))), 'ok', 'control: pending is accepted');
select is(pg_temp.st('update app.invitations set status = ''pending'', accepted_at = null ' || pg_temp.inv_where('e')), 'P0004', 'accepted is final');
select is(pg_temp.st('update app.invitations set status = ''revoked'', accepted_at = null ' || pg_temp.inv_where('e')), 'P0004', 'it is not revoked afterwards');
select is(pg_temp.st('update app.invitations set token_hash = ' || pg_temp.hash('e2') || ' ' || pg_temp.inv_where('e')), 'P0004', 'nor does its hash change');

-- 6. The registry of hashes: every hash that is born or arrives at an invitation goes in, once; none comes back.
select is((select count(*) from app.invitation_tokens where institution_id = pg_temp.id('i_b')), 4::bigint,
  'every hash an invitation of i_b ever had is registered (a, a2, a3 and e)');
select is(pg_temp.st(pg_temp.inv('f')), 'ok', 'control: a new invitation registers its hash');
select is(pg_temp.st('update app.invitations set token_hash = ' || pg_temp.hash('a') || ' ' || pg_temp.inv_where('f')), 'P0004', 'a hash that existed is not taken by another invitation');
select is(pg_temp.st(replace(pg_temp.inv('h'), pg_temp.hash('h'), pg_temp.hash('a2'))), 'P0004', 'nor is an invitation born with it');
select is(pg_temp.st('update app.invitations set sent_at = now(), token_hash = token_hash ' || pg_temp.inv_where('f')), 'ok', 'updating a hash to itself is no new hash');
select is(pg_temp.st('delete from app.invitations ' || pg_temp.inv_where('a')), 'P0004', 'an invitation is not deleted while its institution exists');
select is(pg_temp.st('delete from app.invitation_tokens'), 'P0004', 'nor a registered hash');
select is(pg_temp.st('update app.invitation_tokens set created_at = now()'), 'P0004', 'a registered hash never changes');
select is(pg_temp.st('insert into app.invitation_tokens (token_hash, institution_id, invitation_id) select token_hash, institution_id, invitation_id from app.invitation_tokens limit 1'), '23505', 'a hash is registered once');

select is(pg_temp.st(format('delete from app.institutions where id = %s', pg_temp.i('i_b'))), 'ok', 'control: with the institution, everything of it goes by the cascade');
select is((select count(*) from app.invitation_tokens where institution_id = pg_temp.id('i_b')), 0::bigint, 'including its registered hashes');

-- 8. deleted is final, and nobody puts a password on, or changes the email of, the Auth account of a student.
insert into ids (k, id) select k, gen_random_uuid() from unnest(array['acct_s1', 'acct_s2', 'acct_new']) as k;
update app.account_provisioning set auth_user_id = pg_temp.id('acct_s1') where student_id = pg_temp.id('s1');
update app.account_provisioning set auth_user_id = pg_temp.id('acct_s2') where student_id = pg_temp.id('s2');
-- Born after the id is remembered (the provisioning): the email is exactly <id>@estudiantes.usetiza.app, for every remembered id.
select is(pg_temp.st(format('insert into auth.users (id) values (%s)', pg_temp.i('acct_s1'))), 'P0004', 'a remembered account is not born with no email');
select is(pg_temp.st(format('insert into auth.users (id, email) values (%s, ''acct_s1@f2-credentials.invalid'')', pg_temp.i('acct_s1'))), 'P0004', 'nor with an email of another domain');
select is(pg_temp.st(format('insert into auth.users (id, email) values (%s, %L)', pg_temp.i('acct_s1'), pg_temp.id('acct_s2')::text || '@estudiantes.usetiza.app')), 'P0004', 'nor with the synthetic email of another id');
select is(pg_temp.st(format('insert into auth.users (id, email, encrypted_password) values (%s, %L, ''random-hash-of-createUser'')', pg_temp.i('acct_s1'), pg_temp.id('acct_s1')::text || '@estudiantes.usetiza.app')), 'ok', 'control: createUser without a password still makes one: it is accepted...');
select is((select encrypted_password from auth.users where id = pg_temp.id('acct_s1')), null, '...and the trigger erases it before it is stored');
select is(pg_temp.st(format('insert into auth.users (id, email) values (%s, %L)', pg_temp.i('acct_s2'), pg_temp.id('acct_s2')::text || '@estudiantes.usetiza.app')), 'ok', 'control: and without it, too');
select is(pg_temp.st(format('update auth.users set encrypted_password = ''x'' where id = %s', pg_temp.i('acct_s2'))), 'P0004', 'but an UPDATE that leaves a password is refused');
select is(pg_temp.st(format('update app.account_provisioning set status = ''deleted'', revision = revision + 1 where student_id = %s', pg_temp.i('s2'))), 'ok', 'control: a row is marked deleted (the erasure)');
select is(pg_temp.st(format('update app.account_provisioning set status = ''failed'', revision = revision + 1 where student_id = %s', pg_temp.i('s2'))), 'P0004', 'a deleted provisioning row never changes state');
select is(pg_temp.st(format('update app.account_provisioning set status = ''pending'', revision = revision + 1 where student_id = %s', pg_temp.i('s2'))), 'P0004', 'not even back to pending');
select is(pg_temp.st(format('update app.account_provisioning set attempts = attempts + 1, revision = revision + 1 where student_id = %s', pg_temp.i('s2'))), 'ok', 'control: what is not its state still changes');
select is(pg_temp.st(format('update auth.users set encrypted_password = ''x'' where id = %s', pg_temp.i('acct_s1'))), 'P0004', 'the Auth account of a student gets no password, whatever the situation');
select is(pg_temp.st(format('update auth.users set email = ''otro@f2-credentials.invalid'' where id = %s', pg_temp.i('acct_s1'))), 'P0004', 'nor another email');
select is(pg_temp.st(format('update auth.users set encrypted_password = ''x'', email = ''otro@f2-credentials.invalid'' where id = %s', pg_temp.i('acct_s1'))), 'P0004', 'both at once too');
select is(pg_temp.st(format('update auth.users set encrypted_password = ''x'' where id = %s', pg_temp.i('acct_s2'))), 'P0004', 'also when the student was erased');
select is(pg_temp.st(format('update auth.users set last_sign_in_at = now(), updated_at = now() where id = %s', pg_temp.i('acct_s1'))), 'ok', 'control: what is not a credential is not guarded');
select is(pg_temp.st(format('update auth.users set encrypted_password = encrypted_password, email = email, last_sign_in_at = now() where id = %s', pg_temp.i('acct_s1'))), 'ok', 'a rewrite with the same values (a login of GoTrue) is not a change');
select is(pg_temp.st(format('update auth.users set encrypted_password = ''x'', email = ''staff@f2-credentials.invalid'' where id = %s', pg_temp.i('teachb'))), 'ok', 'a staff account changes as ever');
select is(pg_temp.st(format('update auth.users set id = gen_random_uuid() where id = %s', pg_temp.i('acct_s1'))), 'P0004', 'the id of a remembered account never changes');
select is((select bool_and(p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres' and coalesce('search_path=""' = any (p.proconfig), false))
             from pg_proc p where p.oid in ('app.student_auth_guard'::regproc, 'app.student_auth_birth_guard'::regproc)), true,
  'both guards are security definer, owned by postgres, with search_path pinned');
select is((select count(*) from pg_trigger t where t.tgrelid = 'auth.users'::regclass and t.tgname in ('student_auth_guard', 'student_auth_birth_guard') and t.tgenabled <> 'D'), 2::bigint, 'and they are triggers of auth.users');
select is((select t.tgtype & 4 > 0 and t.tgtype & 16 > 0 from pg_trigger t where t.tgrelid = 'auth.users'::regclass and t.tgname = 'student_auth_guard'), true, 'student_auth_guard is BEFORE INSERT OR UPDATE (insert and update)');
select is((select t.tgtype & 4 > 0 and t.tgtype & 16 > 0 from pg_trigger t where t.tgrelid = 'auth.users'::regclass and t.tgname = 'student_auth_birth_guard'), true, 'student_auth_birth_guard fires on insert and on update of id');
select is((select count(*) from pg_trigger t where t.tgrelid = 'auth.users'::regclass and t.tgname = 'student_credentials_guard'), 0::bigint, 'the guard of the leases is gone');

-- The fixed shape of the synthetic email.
select is(pg_temp.st(format('insert into auth.users (id, email) values (gen_random_uuid(), %L)', pg_temp.id('acct_new')::text || '@estudiantes.usetiza.app')), 'P0004', 'a synthetic email of nobody is refused');
select is(pg_temp.st(format('insert into auth.users (id, email) values (%s, ''luciaf@estudiantes.usetiza.app'')', pg_temp.i('acct_new'))), 'P0004', 'a synthetic email that is not the id of its row is refused (what GoTrue would insert for a link of an account that is not there)');
select is(pg_temp.st(format('insert into auth.users (id, email) values (%s, %L)', pg_temp.i('acct_new'), pg_temp.id('acct_new') || '@estudiantes.usetiza.app')), 'P0004', 'the right synthetic email of an id that nobody remembered is refused');

-- An account whose id is remembered in a deleted row is not born (nor armed by an UPDATE); one remembered in a live row, or unknown, is.
select is(pg_temp.st(format('delete from auth.users where id = %s', pg_temp.i('acct_s2'))), 'ok', 'control: an account is deleted from Auth (the erasure deletes it after marking the row)');
select is(pg_temp.st(format('insert into auth.users (id, email) values (%s, ''gone@f2-credentials.invalid'')', pg_temp.i('acct_s2'))), 'P0004', 'the account of an erased student is not born again');
select is(pg_temp.st(format('delete from auth.users where id = %s', pg_temp.i('acct_s1'))), 'ok', 'control: an account that vanished from Auth without an erasure');
select is(pg_temp.st(format('insert into auth.users (id, email) values (%s, %L)', pg_temp.i('acct_s1'), pg_temp.id('acct_s1')::text || '@estudiantes.usetiza.app')), 'ok', 'is born again with the same id and its synthetic email: the student keeps his identity');
select is(pg_temp.st(format('insert into auth.users (id, email) values (%s, ''new@f2-credentials.invalid'')', pg_temp.i('acct_new'))), 'ok', 'an id that nobody remembered (staff, tests) is born');
select is(pg_temp.st(format('update auth.users set id = %s where id = %s', pg_temp.i('acct_s2'), pg_temp.i('acct_new'))), 'P0004', 'and it cannot take the id of an erased student by an UPDATE');
select is((select encrypted_password from auth.users where id = pg_temp.id('acct_s1')), null, 'the account born again has no password either');

select * from finish();
rollback;
