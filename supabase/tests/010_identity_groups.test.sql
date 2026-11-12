-- T1.2a: identity and groups, through the RPCs, as each role of the matrix would call them.
-- Everything is created here with its own institutions (through the internal RPCs, the same way the
-- factories will) and rolled back, so the file depends on no other test and clobbers none.
begin;
select plan(117);

-- Calls an RPC the way PostgREST would: claims for p_user (null = no session) and p_role switched
-- with SET LOCAL ROLE. Returns the jsonb result, or {"error": "<sqlstate> <message> <detail>"}.
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

-- Same as above for code that runs as the owner (the factories' service_role is exercised separately).
create function pg_temp.err(p_sql text) returns text
language plpgsql as $f$
declare
  v_state text; v_message text; v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return v_state || ' ' || v_message || ' ' || coalesce(v_detail, '');
end
$f$;

create temp table ids (k text primary key, id uuid not null);
create function pg_temp.id(p_key text) returns uuid language sql as $$ select id from ids where k = p_key $$;
-- Shorthands: the user as authenticated, and the service role (for the internal RPCs).
create function pg_temp.as_user(p_user text, p_sql text) returns jsonb language sql
  as $$ select pg_temp.rpc(pg_temp.id(p_user), 'authenticated', p_sql) $$;
create function pg_temp.as_service(p_sql text) returns jsonb language sql
  as $$ select pg_temp.rpc(null, 'service_role', p_sql) $$;

-- Users. Auth rows come first (the real ones are made by Auth); app_users through the RPC.
insert into ids (k, id) select k, gen_random_uuid() from unnest(array[
  'admin', 'owner', 'co', 'other', 'incl', 'stud', 'userb', 'visitor', 'nobody', 'ghost'
]) as k;
insert into auth.users (id, email) select id, k || '@t1-2a.invalid' from ids where k <> 'ghost';
do $$
declare
  k text;
begin
  foreach k in array array['admin', 'owner', 'co', 'other', 'incl', 'stud', 'userb', 'visitor', 'nobody'] loop
    perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- internal_create_institution
-- ---------------------------------------------------------------------------------------------
insert into ids (k, id) select 'instA', (pg_temp.as_service($$ select api.internal_create_institution('Liceo A', 'T1-2A-LICEO-A', 'school') $$) ->> 'id')::uuid;
insert into ids (k, id) select 'instB', (pg_temp.as_service($$ select api.internal_create_institution('Liceo B', 't1-2a-liceo-b', 'school') $$) ->> 'id')::uuid;

select is((select code from app.institutions where id = pg_temp.id('instA')), 't1-2a-liceo-a',
  'internal_create_institution normalizes the code to lower case');
select is(pg_temp.as_service($$ select api.internal_create_institution('Liceo A', 't1-2a-liceo-a', 'school') $$) ->> 'id',
  pg_temp.id('instA')::text, 'the same code with the same data returns the same institution');
select is(pg_temp.as_service($$ select api.internal_create_institution('Otro nombre', 't1-2a-liceo-a', 'school') $$) ->> 'error',
  'P0001 CONFLICT op_key_reused', 'the same code with other data is CONFLICT op_key_reused');
select is(left(pg_temp.as_service($$ select api.internal_create_institution('Demo', 't1-2a-bad', 'sandbox') $$) ->> 'error', 5),
  '23514', 'a sandbox needs an owner and an expiry (the table check answers)');
select is(pg_temp.as_service(format($$ select api.internal_create_institution('Demo', 't1-2a-demo', 'sandbox', now() + interval '1 day', %L) $$, gen_random_uuid())) ->> 'error',
  'P0001 NOT_FOUND not_found', 'a sandbox owner that is not an app user is NOT_FOUND');
insert into ids (k, id) select 'instS', (pg_temp.as_service(format(
  $$ select api.internal_create_institution('Demo del visitante', 't1-2a-demo', 'sandbox', now() + interval '1 day', %L) $$, pg_temp.id('visitor'))) ->> 'id')::uuid;
select is((select kind || ':' || (owner_user_id = pg_temp.id('visitor'))::text from app.institutions where id = pg_temp.id('instS')),
  'sandbox:true', 'the sandbox keeps its owner');

-- ---------------------------------------------------------------------------------------------
-- internal_upsert_app_user
-- ---------------------------------------------------------------------------------------------
select is((select display_name from app.app_users where id = pg_temp.id('admin')), 'Persona admin',
  'internal_upsert_app_user creates the app user with its name');
select is(pg_temp.as_service(format($$ select api.internal_upsert_app_user(%L, 'Nombre nuevo') $$, pg_temp.id('nobody'))) ->> 'id',
  pg_temp.id('nobody')::text, 'upserting again returns the same user');
select is((select revision || ':' || display_name from app.app_users where id = pg_temp.id('nobody')), '2:Nombre nuevo',
  'a new name updates the row and bumps the revision');
do $$ begin
  perform pg_temp.as_service(format($q$ select api.internal_upsert_app_user(%L) $q$, pg_temp.id('nobody')));
  perform pg_temp.as_service(format($q$ select api.internal_upsert_app_user(%L, 'Nombre nuevo') $q$, pg_temp.id('nobody')));
end $$;
select is((select revision || ':' || display_name from app.app_users where id = pg_temp.id('nobody')), '2:Nombre nuevo',
  'a null or unchanged name neither wipes the name nor bumps the revision');
select is(pg_temp.as_service(format($$ select api.internal_upsert_app_user(%L, 'X') $$, pg_temp.id('ghost'))) ->> 'error',
  'P0001 NOT_FOUND not_found', 'a user that has no Auth account is NOT_FOUND');

-- ---------------------------------------------------------------------------------------------
-- internal_add_membership
-- ---------------------------------------------------------------------------------------------
create function pg_temp.add_member(p_inst text, p_user text, p_role text) returns uuid language sql as $$
  select (pg_temp.as_service(format('select api.internal_add_membership(%L, %L, %L)',
    pg_temp.id(p_inst), pg_temp.id(p_user), p_role)) ->> 'id')::uuid
$$;
insert into ids (k, id) values
  ('m_admin', pg_temp.add_member('instA', 'admin', 'admin')),
  ('m_owner', pg_temp.add_member('instA', 'owner', 'teacher')),
  ('m_co', pg_temp.add_member('instA', 'co', 'teacher')),
  ('m_other', pg_temp.add_member('instA', 'other', 'teacher')),
  ('m_incl', pg_temp.add_member('instA', 'incl', 'inclusion')),
  ('m_stud', pg_temp.add_member('instA', 'stud', 'student')),
  ('m_userb', pg_temp.add_member('instB', 'userb', 'teacher')),
  ('m_visitor', pg_temp.add_member('instS', 'visitor', 'teacher'));

select is(pg_temp.add_member('instA', 'owner', 'teacher'), pg_temp.id('m_owner'),
  'internal_add_membership with the same role returns the same membership');
select isnt(pg_temp.add_member('instA', 'admin', 'teacher'), pg_temp.id('m_admin'),
  'the same person can hold another role (an admin who also teaches)');
select is(pg_temp.as_service(format($$ select api.internal_add_membership(%L, %L, 'teacher') $$, gen_random_uuid(), pg_temp.id('owner'))) ->> 'error',
  'P0001 NOT_FOUND not_found', 'a membership in an unknown institution is NOT_FOUND');
select is(pg_temp.as_service(format($$ select api.internal_add_membership(%L, %L, 'teacher') $$, pg_temp.id('instA'), gen_random_uuid())) ->> 'error',
  'P0001 NOT_FOUND not_found', 'a membership for an unknown user is NOT_FOUND');
select is(left(pg_temp.as_service(format($$ select api.internal_add_membership(%L, %L, 'janitor') $$, pg_temp.id('instA'), pg_temp.id('owner'))) ->> 'error', 5),
  '23514', 'an unknown role is refused by the table check');

-- A person is not a student and staff in the same institution, whichever side comes second.
select is(left(pg_temp.as_service(format($$ select api.internal_add_membership(%L, %L, 'student') $$, pg_temp.id('instA'), pg_temp.id('owner'))) ->> 'error', 5),
  '23514', 'a teacher cannot also become a student of the institution');
select is(left(pg_temp.as_service(format($$ select api.internal_add_membership(%L, %L, 'inclusion') $$, pg_temp.id('instA'), pg_temp.id('stud'))) ->> 'error', 5),
  '23514', 'a student cannot also become staff of the institution');
-- The admin also teaches (two staff memberships), so turning one of them into a student role is refused.
select is(left(pg_temp.err(format($$ update app.memberships set role = 'student' where id = %L $$, pg_temp.id('m_admin'))), 5),
  '23514', 'changing a staff membership into a student one is refused too');
-- The same account may be a student in one institution and staff in another.
select ok(pg_temp.add_member('instB', 'stud', 'teacher') is not null,
  'the rule is per institution: a student of one can teach in another');
-- A student row already tied to the account blocks staff roles before the membership exists.
insert into app.students (id, institution_id, display_name, username, user_id)
  values (gen_random_uuid(), pg_temp.id('instB'), 'Est B', 'est.b.t1', null);
select is(left(pg_temp.err(format($$ update app.students set user_id = %L where username = 'est.b.t1' and institution_id = %L $$,
    pg_temp.id('userb'), pg_temp.id('instB'))), 5),
  '23514', 'a student row cannot be tied to an account that is staff in that institution');
update app.students set user_id = pg_temp.id('nobody') where username = 'est.b.t1' and institution_id = pg_temp.id('instB');
select is(left(pg_temp.as_service(format($$ select api.internal_add_membership(%L, %L, 'teacher') $$, pg_temp.id('instB'), pg_temp.id('nobody'))) ->> 'error', 5),
  '23514', 'an account tied to a student row cannot become staff of that institution');

-- ---------------------------------------------------------------------------------------------
-- internal_revoke_membership
-- ---------------------------------------------------------------------------------------------
insert into ids (k, id) values ('m_temp', pg_temp.add_member('instB', 'visitor', 'inclusion'));
select is(pg_temp.as_service(format($$ select api.internal_revoke_membership(%L) $$, pg_temp.id('m_temp'))) ->> 'id',
  pg_temp.id('m_temp')::text, 'internal_revoke_membership returns the membership');
select ok((select revoked_at is not null and revision = 2 from app.memberships where id = pg_temp.id('m_temp')),
  'the row stays, revoked, with its revision bumped');
select is(pg_temp.as_service(format($$ select api.internal_revoke_membership(%L) $$, pg_temp.id('m_temp'))) ->> 'id',
  pg_temp.id('m_temp')::text, 'revoking twice returns the same membership');
select is((select revision from app.memberships where id = pg_temp.id('m_temp')), 2, 'and does not bump it again');
select is(pg_temp.as_service(format($$ select api.internal_revoke_membership(%L) $$, gen_random_uuid())) ->> 'error',
  'P0001 NOT_FOUND not_found', 'revoking an unknown membership is NOT_FOUND');
-- After revoking, the same role can be granted again as a new row.
select isnt(pg_temp.add_member('instB', 'visitor', 'inclusion'), pg_temp.id('m_temp'),
  'a revoked role can be granted again as a new membership');

-- ---------------------------------------------------------------------------------------------
-- internal_* are for service_role only
-- ---------------------------------------------------------------------------------------------
select is(
  (select string_agg(p.proname, ',' order by p.proname) from pg_proc p
    where p.pronamespace = 'api'::regnamespace and starts_with(p.proname, 'internal_')
      and p.proname in ('internal_create_institution', 'internal_upsert_app_user', 'internal_add_membership', 'internal_revoke_membership')
      and has_function_privilege('service_role', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')),
  'internal_add_membership,internal_create_institution,internal_revoke_membership,internal_upsert_app_user',
  'the four internal RPCs of T1.2a: EXECUTE for service_role and nobody else');
select is(
  (select string_agg(left(pg_temp.rpc(pg_temp.id('owner'), 'authenticated', s) ->> 'error', 5), ',')
     from unnest(array[
       'select api.internal_create_institution(''X'', ''t1-2a-x'', ''school'')',
       format('select api.internal_upsert_app_user(%L)', pg_temp.id('owner')),
       format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('instA'), pg_temp.id('owner')),
       format('select api.internal_revoke_membership(%L)', pg_temp.id('m_owner'))
     ]) as s),
  '42501,42501,42501,42501', 'authenticated is refused (42501) on all four internal RPCs');
select is(
  (select string_agg(left(pg_temp.rpc(null, 'anon', s) ->> 'error', 5), ',')
     from unnest(array[
       'select api.internal_create_institution(''X'', ''t1-2a-x'', ''school'')',
       format('select api.internal_upsert_app_user(%L)', pg_temp.id('owner')),
       format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('instA'), pg_temp.id('owner')),
       format('select api.internal_revoke_membership(%L)', pg_temp.id('m_owner'))
     ]) as s),
  '42501,42501,42501,42501', 'anon is refused (42501) on all four internal RPCs');
select is(
  (select count(*) from app.institutions where code = 't1-2a-x'), 0::bigint, 'and the refused calls created nothing');

-- ---------------------------------------------------------------------------------------------
-- list_my_institutions
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.as_user('owner', 'select api.list_my_institutions()'),
  jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
    'id', pg_temp.id('instA'), 'name', 'Liceo A', 'kind', 'school', 'roles', jsonb_build_array('teacher')))),
  'a teacher sees their institution with their role, and no other');
select is(pg_temp.as_user('admin', 'select api.list_my_institutions()') -> 'items' -> 0 -> 'roles', '["admin", "teacher"]'::jsonb,
  'an admin who also teaches appears once, with both roles');
select is(pg_temp.as_user('stud', 'select api.list_my_institutions()') -> 'items' -> 0 -> 'roles', '["student"]'::jsonb,
  'a student sees their institution (their own)');
select is(jsonb_array_length(pg_temp.as_user('visitor', 'select api.list_my_institutions()') -> 'items'), 2,
  'a sandbox visitor sees their sandbox while it is open (and the institution where they hold a role)');
update app.institutions set expires_at = now() - interval '1 minute' where id = pg_temp.id('instS');
select is((select string_agg(e ->> 'kind', ',') from jsonb_array_elements(pg_temp.as_user('visitor', 'select api.list_my_institutions()') -> 'items') e),
  'school', 'an expired sandbox does not appear');
update app.institutions set expires_at = now() + interval '1 day' where id = pg_temp.id('instS');
select is(pg_temp.as_user('nobody', 'select api.list_my_institutions()') -> 'items', '[]'::jsonb,
  'a user with no memberships gets an empty list');
select is(pg_temp.rpc(pg_temp.id('ghost'), 'authenticated', 'select api.list_my_institutions()') ->> 'error',
  'P0001 FORBIDDEN no_session', 'an Auth user with no app user row is FORBIDDEN no_session');
select is(left(pg_temp.rpc(null, 'anon', 'select api.list_my_institutions()') ->> 'error', 5), '42501',
  'anon cannot execute list_my_institutions');

-- ---------------------------------------------------------------------------------------------
-- create_group
-- ---------------------------------------------------------------------------------------------
create function pg_temp.new_group(p_user text, p_inst text, p_name text default '3.º A') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.create_group(%L, %L, ''math'', 2026)', pg_temp.id(p_inst), p_name))
$$;
insert into ids (k, id) select 'g', (pg_temp.new_group('owner', 'instA') ->> 'id')::uuid;
select is((select g.name || ':' || g.revision || ':' || (g.created_by = pg_temp.id('owner'))::text from app.groups g where g.id = pg_temp.id('g')),
  '3.º A:1:true', 'create_group stores the group with its creator');
select is((select gs.user_id = pg_temp.id('owner') and gs.role = 'owner' and gs.removed_at is null
             from app.group_staff gs where gs.group_id = pg_temp.id('g')),
  true, 'the creator is the owner');
select is(pg_temp.new_group('owner', 'instA', '  3.º B  ') ->> 'revision', '1', 'create_group answers the id and the revision');
select is((select count(*) from app.groups where institution_id = pg_temp.id('instA') and name = '3.º B'), 1::bigint,
  'the name is trimmed');
select is(pg_temp.new_group('admin', 'instA', '4.º A') ->> 'revision', '1', 'an admin can create groups');
select is(pg_temp.new_group('incl', 'instA') ->> 'error', 'P0001 FORBIDDEN forbidden', 'inclusion cannot create groups');
select is(pg_temp.new_group('stud', 'instA') ->> 'error', 'P0001 FORBIDDEN forbidden', 'a student cannot create groups');
select is(pg_temp.new_group('userb', 'instA') ->> 'error', 'P0001 NOT_FOUND not_found',
  'a user of another institution gets NOT_FOUND: the institution is not revealed');
select is(pg_temp.as_user('owner', format($$ select api.create_group(%L, 'Física', 'physics', 2026) $$, pg_temp.id('instA'))) ->> 'error',
  'P0001 NOT_FOUND not_found', 'a subject that is not enabled is NOT_FOUND');
select is(pg_temp.rpc(pg_temp.id('ghost'), 'authenticated', 'select api.create_group(gen_random_uuid(), ''x'', ''math'', 2026)') ->> 'error',
  'P0001 FORBIDDEN no_session', 'no app user, no group');
select is(pg_temp.new_group('visitor', 'instS', 'Grupo demo') ->> 'revision', '1', 'a sandbox visitor creates groups in their sandbox');
update app.institutions set expires_at = now() - interval '1 minute' where id = pg_temp.id('instS');
select is(pg_temp.new_group('visitor', 'instS') ->> 'error', 'P0001 NOT_FOUND not_found', 'an expired sandbox is as good as gone');
update app.institutions set expires_at = now() + interval '1 day' where id = pg_temp.id('instS');
select is(left(pg_temp.rpc(null, 'anon', 'select api.create_group(gen_random_uuid(), ''x'', ''math'', 2026)') ->> 'error', 5), '42501',
  'anon cannot execute create_group');

-- ---------------------------------------------------------------------------------------------
-- update_group / archive_group / restore_group
-- ---------------------------------------------------------------------------------------------
-- A group staffed by the owner, with a co-teacher, and a student enrolled (who sees it, but only reads).
do $$ begin
  perform pg_temp.as_user('owner', format($q$ select api.add_group_staff(%L, %L, 'co_teacher') $q$, pg_temp.id('g'), pg_temp.id('co')));
end $$;
insert into app.students (id, institution_id, display_name, username, user_id)
  values (gen_random_uuid(), pg_temp.id('instA'), 'Estudiante', 'est.a.t1', pg_temp.id('stud'));
insert into app.enrollments (institution_id, group_id, student_id)
  select pg_temp.id('instA'), pg_temp.id('g'), s.id from app.students s where s.username = 'est.a.t1' and s.institution_id = pg_temp.id('instA');

create function pg_temp.upd(p_user text, p_rev integer, p_name text default 'Nuevo nombre') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.update_group(%L, %s, %L, 2027)', pg_temp.id('g'), p_rev, p_name))
$$;
select is(pg_temp.upd('owner', 1), jsonb_build_object('id', pg_temp.id('g'), 'revision', 2), 'the owner updates the group');
select is((select name || ':' || school_year from app.groups where id = pg_temp.id('g')), 'Nuevo nombre:2027', 'the new data is stored');
select is(pg_temp.upd('owner', 1) ->> 'error', 'P0001 CONFLICT revision_mismatch', 'an old revision is CONFLICT');
select is(pg_temp.upd('owner', 2, 'Otro') ->> 'revision', '3', 'with the current revision it goes through');
select is(pg_temp.upd('co', 3) ->> 'revision', '4', 'a co-teacher updates the group');
select is(pg_temp.upd('admin', 4) ->> 'revision', '5', 'an admin updates a group they do not teach');
select is(pg_temp.upd('other', 5) ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher of another group cannot even see it');
select is(pg_temp.upd('incl', 5) ->> 'error', 'P0001 FORBIDDEN forbidden', 'inclusion sees the group but cannot change it');
select is(pg_temp.upd('stud', 5) ->> 'error', 'P0001 FORBIDDEN forbidden', 'an enrolled student sees the group but cannot change it');
select is(pg_temp.upd('userb', 5) ->> 'error', 'P0001 NOT_FOUND not_found', 'a user of another institution gets NOT_FOUND');
select is(pg_temp.upd('nobody', 5) ->> 'error', 'P0001 NOT_FOUND not_found', 'a member without that group or role gets NOT_FOUND');
select is((select revision from app.groups where id = pg_temp.id('g')), 5, 'none of the refused updates changed the group');

create function pg_temp.arch(p_user text, p_rev integer, p_fn text default 'archive_group') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.%I(%L, %s)', p_fn, pg_temp.id('g'), p_rev))
$$;
select is(pg_temp.arch('owner', 5), jsonb_build_object('id', pg_temp.id('g'), 'revision', 6), 'the owner archives the group');
select ok((select archived_at is not null from app.groups where id = pg_temp.id('g')), 'and it is marked archived');
select is(pg_temp.arch('owner', 5) ->> 'error', 'P0001 CONFLICT revision_mismatch', 'archiving with an old revision is CONFLICT');
select is(pg_temp.arch('owner', 6) ->> 'revision', '6', 'archiving an archived group with the current revision changes nothing');
select is(pg_temp.upd('owner', 6) ->> 'error', 'P0001 INVALID archived', 'an archived group cannot be edited');
select is(pg_temp.arch('other', 6, 'restore_group') ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher of another group cannot restore it');
select is(pg_temp.arch('incl', 6, 'restore_group') ->> 'error', 'P0001 FORBIDDEN forbidden', 'inclusion cannot restore it');
select is(pg_temp.arch('owner', 5, 'restore_group') ->> 'error', 'P0001 CONFLICT revision_mismatch', 'restoring with an old revision is CONFLICT');
select is(pg_temp.arch('admin', 6, 'restore_group'), jsonb_build_object('id', pg_temp.id('g'), 'revision', 7), 'an admin restores it');
select ok((select archived_at is null from app.groups where id = pg_temp.id('g')), 'and it is active again');
select is(pg_temp.arch('co', 7, 'restore_group') ->> 'revision', '7', 'restoring an active group with the current revision changes nothing');
select is(pg_temp.arch('userb', 7) ->> 'error', 'P0001 NOT_FOUND not_found', 'a user of another institution cannot archive it');
select is(pg_temp.arch('stud', 7) ->> 'error', 'P0001 FORBIDDEN forbidden', 'an enrolled student cannot archive it');
select is(pg_temp.as_user('owner', format('select api.archive_group(%L, 7)', gen_random_uuid())) ->> 'error',
  'P0001 NOT_FOUND not_found', 'an unknown group is NOT_FOUND');
select is(
  (select string_agg(left(pg_temp.rpc(null, 'anon', format('select api.%I(gen_random_uuid(), 1)', f)) ->> 'error', 5), ',')
     from unnest(array['archive_group', 'restore_group']) as f),
  '42501,42501', 'anon cannot execute archive_group or restore_group');

-- ---------------------------------------------------------------------------------------------
-- add_group_staff / remove_group_staff
-- ---------------------------------------------------------------------------------------------
create function pg_temp.add_staff(p_user text, p_target text, p_role text default 'co_teacher') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.add_group_staff(%L, %L, %L)', pg_temp.id('g'), pg_temp.id(p_target), p_role))
$$;
create function pg_temp.remove_staff(p_user text, p_target text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.remove_group_staff(%L, %L)', pg_temp.id('g'), pg_temp.id(p_target)))
$$;

insert into ids (k, id) select 'staff_other', (pg_temp.add_staff('owner', 'other') ->> 'id')::uuid;
select is((select role || ':' || (removed_at is null)::text from app.group_staff where id = pg_temp.id('staff_other')),
  'co_teacher:true', 'the owner adds a co-teacher');
select is(pg_temp.add_staff('owner', 'other') ->> 'id', pg_temp.id('staff_other')::text,
  'adding the same person with the same role again returns the same row');
select is((select count(*) from app.group_staff where group_id = pg_temp.id('g') and user_id = pg_temp.id('other')), 1::bigint,
  'and does not duplicate it');
select is(pg_temp.add_staff('owner', 'other', 'owner') ->> 'error', 'P0001 CONFLICT revision_mismatch',
  'adding them with another role is CONFLICT');
select is(pg_temp.add_staff('owner', 'admin', 'owner') ->> 'error', 'P0001 CONFLICT revision_mismatch',
  'a second owner is CONFLICT');
select is(pg_temp.add_staff('owner', 'admin') ->> 'error', null, 'an admin of the institution can be added as staff');
select is(pg_temp.add_staff('owner', 'incl') ->> 'error', 'P0001 INVALID not_a_member', 'inclusion cannot be added as staff');
select is(pg_temp.add_staff('owner', 'stud') ->> 'error', 'P0001 INVALID not_a_member', 'a student cannot be added as staff');
select is(pg_temp.add_staff('owner', 'userb') ->> 'error', 'P0001 INVALID not_a_member', 'a teacher of another institution cannot be added');
select is(pg_temp.add_staff('owner', 'ghost') ->> 'error', 'P0001 INVALID not_a_member', 'a user that does not exist is not a member either');
select is(pg_temp.add_staff('co', 'nobody') ->> 'error', 'P0001 FORBIDDEN forbidden', 'a co-teacher cannot add staff');
select is(pg_temp.add_staff('incl', 'nobody') ->> 'error', 'P0001 FORBIDDEN forbidden', 'inclusion cannot add staff');
select is(pg_temp.add_staff('stud', 'nobody') ->> 'error', 'P0001 FORBIDDEN forbidden', 'a student cannot add staff');
select is(pg_temp.add_staff('userb', 'other') ->> 'error', 'P0001 NOT_FOUND not_found', 'a user of another institution gets NOT_FOUND');
-- The teacher of another group: only after being removed from this one, so first remove them.
select is(pg_temp.remove_staff('owner', 'other') ->> 'id', pg_temp.id('staff_other')::text, 'the owner removes a co-teacher');
select ok((select removed_at is not null and revision = 2 from app.group_staff where id = pg_temp.id('staff_other')), 'the row stays, removed');
select is(pg_temp.remove_staff('owner', 'other') ->> 'id', pg_temp.id('staff_other')::text, 'removing again returns the same row');
select is(pg_temp.upd('other', 5) ->> 'error', 'P0001 NOT_FOUND not_found', 'once removed, they no longer see the group');
select is(pg_temp.add_staff('other', 'nobody') ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher of another group cannot add staff');
select is(pg_temp.remove_staff('other', 'co') ->> 'error', 'P0001 NOT_FOUND not_found', 'nor remove it');
select is(pg_temp.remove_staff('owner', 'nobody') ->> 'error', 'P0001 NOT_FOUND not_found', 'removing someone who was never staff is NOT_FOUND');
select is(pg_temp.remove_staff('co', 'owner') ->> 'error', 'P0001 FORBIDDEN forbidden', 'a co-teacher cannot remove staff');
select is(pg_temp.remove_staff('incl', 'co') ->> 'error', 'P0001 FORBIDDEN forbidden', 'inclusion cannot remove staff');
select is(pg_temp.remove_staff('userb', 'co') ->> 'error', 'P0001 NOT_FOUND not_found', 'a user of another institution gets NOT_FOUND');
select is(pg_temp.remove_staff('owner', 'owner') ->> 'error', 'P0001 FORBIDDEN forbidden', 'the owner cannot remove themselves');
select isnt(pg_temp.add_staff('owner', 'other') ->> 'id', pg_temp.id('staff_other')::text, 'someone removed can be added again, as a new row');
select is(pg_temp.remove_staff('admin', 'owner') ->> 'error', null, 'an admin can remove the owner');
select is(pg_temp.add_staff('admin', 'owner', 'owner') ->> 'error', null, 'and name an owner again');
-- Taking a teacher out of the institution takes all their groups at once, without touching group_staff.
select is(pg_temp.upd('co', 7) ->> 'revision', '8', 'before their membership is revoked, a co-teacher edits the group');
do $$ begin
  perform pg_temp.as_service(format($q$ select api.internal_revoke_membership(%L) $q$, pg_temp.id('m_co')));
end $$;
select is(pg_temp.upd('co', 8) ->> 'error', 'P0001 NOT_FOUND not_found', 'after it is revoked, the group is gone for them');
select is(pg_temp.add_staff('owner', 'co') ->> 'error', 'P0001 INVALID not_a_member', 'a revoked teacher cannot be added again');
-- Archived group: staff is frozen until it is restored.
do $$ begin perform pg_temp.arch('owner', 8); end $$;
select is(pg_temp.add_staff('owner', 'co') ->> 'error', 'P0001 INVALID archived', 'staff cannot be added to an archived group');
do $$ begin perform pg_temp.arch('owner', 9, 'restore_group'); end $$;

-- Sandbox: the visitor is a teacher and owner of their group, but never adds or removes staff.
insert into ids (k, id) select 'gs', (pg_temp.new_group('visitor', 'instS', 'Grupo demo 2') ->> 'id')::uuid;
select is(pg_temp.as_user('visitor', format($$ select api.add_group_staff(%L, %L, 'co_teacher') $$, pg_temp.id('gs'), pg_temp.id('owner'))) ->> 'error',
  'P0001 FORBIDDEN sandbox_restricted', 'nobody is added to a group in a sandbox');
select is(pg_temp.as_user('visitor', format($$ select api.remove_group_staff(%L, %L) $$, pg_temp.id('gs'), pg_temp.id('visitor'))) ->> 'error',
  'P0001 FORBIDDEN sandbox_restricted', 'nobody is removed from a group in a sandbox');
select is(pg_temp.as_user('visitor', format($$ select api.update_group(%L, 1, 'Renombrado', 2026) $$, pg_temp.id('gs'))) ->> 'revision', '2',
  'but the visitor does edit their own group');
update app.institutions set expires_at = now() - interval '1 minute' where id = pg_temp.id('instS');
select is(pg_temp.as_user('visitor', format($$ select api.update_group(%L, 2, 'Tarde', 2026) $$, pg_temp.id('gs'))) ->> 'error',
  'P0001 NOT_FOUND not_found', 'after the sandbox expires, the group is gone for the visitor');
select is(
  (select string_agg(left(pg_temp.rpc(null, 'anon', s) ->> 'error', 5), ',')
     from unnest(array[
       'select api.add_group_staff(gen_random_uuid(), gen_random_uuid(), ''owner'')',
       'select api.remove_group_staff(gen_random_uuid(), gen_random_uuid())',
       'select api.update_group(gen_random_uuid(), 1, ''x'', 2026)'
     ]) as s),
  '42501,42501,42501', 'anon cannot execute the staff or update RPCs');

select * from finish();
rollback;
