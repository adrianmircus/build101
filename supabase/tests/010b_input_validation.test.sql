-- T1.F8 (F1-3): the RPCs of identity and groups refuse the inputs the table checks used to answer (23514, 23502) or a null
-- that skipped a comparison, before writing anything, with INVALID and a reason that has its text. Called directly: zod is not in the way.
-- The whole file is rolled back.
begin;
select plan(48);

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
  'admin', 'owner', 'co', 'other', 'incl', 'stud', 'userb', 'visitor', 'nobody', 'ghost', 'late'
]) as k;
insert into auth.users (id, email) select id, k || '@t1-2a.invalid' from ids where k <> 'ghost';
do $$
declare
  k text;
begin
  foreach k in array array['admin', 'owner', 'co', 'other', 'incl', 'stud', 'userb', 'visitor', 'nobody', 'late'] loop
    perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- internal_create_institution
-- ---------------------------------------------------------------------------------------------
create function pg_temp.inst(p_args text) returns text language sql as $$
  select coalesce(pg_temp.as_service('select api.internal_create_institution(' || p_args || ')') ->> 'error', 'ok')
$$;
create function pg_temp.insts() returns bigint language sql as $$ select count(*) from app.institutions $$;
create temp table before_insts as select pg_temp.insts() as n;

select is(pg_temp.inst($$ null, 't1f8-liceo', 'school' $$), 'P0001 INVALID invalid_name', 'a null name is INVALID invalid_name');
select is(pg_temp.inst($$ '   ', 't1f8-liceo', 'school' $$), 'P0001 INVALID invalid_name', 'a blank name too');
select is(pg_temp.inst(format($$ %L, 't1f8-liceo', 'school' $$, repeat('x', 201))), 'P0001 INVALID invalid_name', 'and one of 201 characters');
select is(pg_temp.inst($$ 'Liceo', null, 'school' $$), 'P0001 INVALID invalid_code', 'a null code is INVALID invalid_code');
select is(pg_temp.inst($$ 'Liceo', 'ab', 'school' $$), 'P0001 INVALID invalid_code', 'a code of two characters');
select is(pg_temp.inst($$ 'Liceo', 'liceo_uno', 'school' $$), 'P0001 INVALID invalid_code', 'a code with an underscore');
select is(pg_temp.inst($$ 'Liceo', '-liceo', 'school' $$), 'P0001 INVALID invalid_code', 'a code that starts with a hyphen');
select is(pg_temp.inst(format($$ 'Liceo', %L, 'school' $$, repeat('a', 33))), 'P0001 INVALID invalid_code', 'and one of 33 characters');
select is(pg_temp.inst($$ 'Liceo', 't1f8-liceo', null $$), 'P0001 INVALID invalid_institution_kind', 'a null kind is INVALID invalid_institution_kind');
select is(pg_temp.inst($$ 'Liceo', 't1f8-liceo', 'academy' $$), 'P0001 INVALID invalid_institution_kind', 'an unknown kind');
select is(pg_temp.inst($$ 'Liceo', 't1f8-liceo', 'school', now() + interval '1 day' $$), 'P0001 INVALID invalid_institution_shape',
  'a school with an expiry is INVALID invalid_institution_shape (the case of the review)');
select is(pg_temp.inst(format($$ 'Liceo', 't1f8-liceo', 'school', null, %L $$, pg_temp.id('owner'))), 'P0001 INVALID invalid_institution_shape', 'a school with an owner');
select is(pg_temp.inst($$ 'Demo', 't1f8-demo', 'sandbox' $$), 'P0001 INVALID invalid_institution_shape', 'a sandbox with neither');
select is(pg_temp.inst(format($$ 'Demo', 't1f8-demo', 'sandbox', null, %L $$, pg_temp.id('owner'))), 'P0001 INVALID invalid_institution_shape', 'a sandbox with no expiry');
select is(pg_temp.inst($$ 'Demo', 't1f8-demo', 'sandbox', now() + interval '1 day' $$), 'P0001 INVALID invalid_institution_shape', 'a sandbox with no owner');
select is(pg_temp.insts(), (select n from before_insts), 'none of them created an institution');
select is(pg_temp.inst($$ 'Liceo', 't1f8-liceo', 'school' $$), 'ok', 'while the valid school is created');
select is(pg_temp.inst(format($$ 'Demo', 't1f8-demo', 'sandbox', now() + interval '1 day', %L $$, pg_temp.id('owner'))), 'ok', 'and the valid sandbox');
select is(pg_temp.inst($$ 'Liceo', 't1f8-liceo', 'school' $$), 'ok', 'a repeat of the same request still answers the same institution');
select is(pg_temp.inst($$ 'Otro', 't1f8-liceo', 'school' $$), 'P0001 CONFLICT op_key_reused', 'and another name for that code is still CONFLICT');

-- ---------------------------------------------------------------------------------------------
-- internal_upsert_app_user: a name that is given has to be 1 to 120 characters once trimmed; a null one changes nothing
-- ---------------------------------------------------------------------------------------------
create function pg_temp.upsert(p_user text, p_name text) returns text language sql as $$
  select coalesce(pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(p_user), p_name)) ->> 'error', 'ok')
$$;
create function pg_temp.appu(p_user text) returns text language sql as $$
  select revision || ':' || coalesce(display_name, '-') from app.app_users where id = pg_temp.id(p_user)
$$;
select is(pg_temp.appu('co'), '1:Persona co', 'control: the user has its name');
select is(pg_temp.upsert('co', '   '), 'P0001 INVALID invalid_name', 'a blank name is INVALID invalid_name, not a table check');
select is(pg_temp.upsert('co', ''), 'P0001 INVALID invalid_name', 'an empty one');
select is(pg_temp.upsert('co', repeat('y', 121)), 'P0001 INVALID invalid_name', 'and one of 121 characters');
select is(pg_temp.appu('co'), '1:Persona co', 'none of them changed the user');
select is(pg_temp.upsert('co', repeat('y', 120)), 'ok', 'a name of 120 characters is fine');
select is(pg_temp.as_service(format('select api.internal_upsert_app_user(%L, null)', pg_temp.id('co'))) ->> 'id', pg_temp.id('co')::text, 'a null name changes nothing and still answers');
select is(pg_temp.appu('co'), '2:' || repeat('y', 120), 'and the name is the one saved');

-- ---------------------------------------------------------------------------------------------
-- internal_add_membership: the role is one of the four, checked before anything else
-- ---------------------------------------------------------------------------------------------
create function pg_temp.addm(p_inst text, p_user text, p_role text) returns text language sql as $$
  select coalesce(pg_temp.as_service(format('select api.internal_add_membership(%L, %L, %L)', pg_temp.id(p_inst), pg_temp.id(p_user), p_role)) ->> 'error', 'ok')
$$;
insert into ids (k, id) select 'i', (pg_temp.as_service($$ select api.internal_create_institution('Liceo F8', 't1f8-instituto', 'school') $$) ->> 'id')::uuid;
select is(pg_temp.addm('i', 'owner', 'janitor'), 'P0001 INVALID invalid_role', 'an unknown role is INVALID invalid_role');
select is(pg_temp.addm('i', 'owner', 'Admin'), 'P0001 INVALID invalid_role', 'the case matters');
select is(pg_temp.addm('i', 'owner', ''), 'P0001 INVALID invalid_role', 'an empty role');
select is(pg_temp.as_service(format('select api.internal_add_membership(%L, %L, null)', pg_temp.id('i'), pg_temp.id('owner'))) ->> 'error',
  'P0001 INVALID invalid_role', 'a null role');
select is(pg_temp.as_service(format('select api.internal_add_membership(null, %L, ''teacher'')', pg_temp.id('owner'))) ->> 'error',
  'P0001 NOT_FOUND not_found', 'a null institution is NOT_FOUND');
select is((select count(*) from app.memberships where institution_id = pg_temp.id('i')), 0::bigint, 'no membership was written');
select is(pg_temp.addm('i', 'owner', 'teacher') || pg_temp.addm('i', 'admin', 'admin') || pg_temp.addm('i', 'co', 'teacher'), 'okokok', 'while the valid roles are added');

-- ---------------------------------------------------------------------------------------------
-- add_group_staff: the role is owner or co_teacher, checked after who may and before anything is written or compared
-- ---------------------------------------------------------------------------------------------
insert into ids (k, id) select 'g', (pg_temp.as_user('owner', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i'))) ->> 'id')::uuid;
create function pg_temp.addgs(p_actor text, p_target text, p_role text) returns text language sql as $$
  select coalesce(pg_temp.as_user(p_actor, format('select api.add_group_staff(%L, %L, %L)', pg_temp.id('g'), pg_temp.id(p_target), p_role)) ->> 'error', 'ok')
$$;
create function pg_temp.staff() returns text language sql as $$
  select string_agg(u.k || ':' || gs.role || ':' || (gs.removed_at is null), ',' order by u.k)
    from app.group_staff gs join ids u on u.id = gs.user_id where gs.group_id = pg_temp.id('g')
$$;
select is(pg_temp.staff(), 'owner:owner:true', 'control: the group has its owner');
-- A teacher of the institution who is not on the group yet: with the role "admin" the table check used to answer 23514, with null 23502.
select is(pg_temp.addgs('owner', 'co', 'admin'), 'P0001 INVALID invalid_role', 'an unknown role for a valid teacher is INVALID invalid_role (the case of the review)');
select is(pg_temp.addgs('owner', 'co', ''), 'P0001 INVALID invalid_role', 'an empty role');
select is(pg_temp.addgs('owner', 'co', 'OWNER'), 'P0001 INVALID invalid_role', 'the case matters');
select is(pg_temp.as_user('owner', format('select api.add_group_staff(%L, %L, null)', pg_temp.id('g'), pg_temp.id('co'))) ->> 'error',
  'P0001 INVALID invalid_role', 'a null role for a teacher not on the group (it used to be 23502)');
select is(pg_temp.staff(), 'owner:owner:true', 'none of them wrote a row');
select is(pg_temp.addgs('owner', 'co', 'co_teacher'), 'ok', 'a valid role adds the teacher');
-- With the row already there a null role used to compare as null and answer success.
select is(pg_temp.as_user('owner', format('select api.add_group_staff(%L, %L, null)', pg_temp.id('g'), pg_temp.id('co'))) ->> 'error',
  'P0001 INVALID invalid_role', 'a null role for a teacher already on the group is INVALID, not a silent success');
select is(pg_temp.addgs('owner', 'co', 'co_teacher'), 'ok', 'while the same valid role is still idempotent');
select is(pg_temp.addgs('owner', 'co', 'owner'), 'P0001 CONFLICT revision_mismatch', 'and another valid role for that teacher is still CONFLICT');
-- Who may comes first: a person with no access to the group learns nothing about the roles.
select is(pg_temp.addgs('userb', 'co', 'admin'), 'P0001 NOT_FOUND not_found', 'another institution gets NOT_FOUND before the role is looked at');
select is(pg_temp.addgs('co', 'admin', 'admin'), 'P0001 FORBIDDEN forbidden', 'a co-teacher who may not manage the staff gets FORBIDDEN before the role is looked at');
select is(pg_temp.staff(), 'co:co_teacher:true,owner:owner:true', 'the staff is what the valid calls made it');

select * from finish();
rollback;
