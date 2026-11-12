-- Nothing in public, app or api is reachable by anon, authenticated or PUBLIC unless a migration
-- grants it by name. Tables live in app (not exposed by PostgREST) and nobody but the owner uses
-- that schema, not even service_role. RPCs live in api, the only exposed schema, created and owned
-- by postgres so no other creator's default privileges apply there. public is closed to the API
-- roles, so what Supabase's own creator role puts there stays out of reach. Tickets grant EXECUTE on
-- api RPCs to authenticated, so this file only forbids what must stay closed forever.
begin;
select plan(23);

-- Existing objects: no privilege at all for the API roles.
select is(
  (select count(*) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join (values ('anon'), ('authenticated')) as r(role_name)
    where n.nspname in ('public', 'api') and c.relkind in ('r', 'v', 'm', 'p', 'f')
      and (has_table_privilege(r.role_name, c.oid, 'select')
        or has_table_privilege(r.role_name, c.oid, 'insert')
        or has_table_privilege(r.role_name, c.oid, 'update')
        or has_table_privilege(r.role_name, c.oid, 'delete'))),
  0::bigint, 'anon and authenticated have no privilege on any table in public or api');

select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema in ('public', 'app', 'api') and grantee in ('anon', 'authenticated', 'PUBLIC')),
  0::bigint, 'information_schema lists no table grant to anon, authenticated or PUBLIC');

select is(
  (select count(*) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join (values ('anon'), ('authenticated')) as r(role_name)
    where n.nspname = 'public' and c.relkind = 'S'
      and (has_sequence_privilege(r.role_name, c.oid, 'usage')
        or has_sequence_privilege(r.role_name, c.oid, 'select')
        or has_sequence_privilege(r.role_name, c.oid, 'update'))),
  0::bigint, 'anon and authenticated have no privilege on any sequence in public');

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'api') and has_function_privilege('anon', p.oid, 'execute')),
  0::bigint, 'anon cannot execute any function in public or api');

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and starts_with(p.proname, 'internal_')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  0::bigint, 'authenticated cannot execute any internal_* function');

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as a
    where n.nspname in ('public', 'app', 'api') and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  0::bigint, 'PUBLIC has no EXECUTE on any function in public, app or api');

-- Future objects: default privileges of postgres (the role that runs migrations).
select is(
  (select count(*) from pg_default_acl d
     join pg_namespace n on n.oid = d.defaclnamespace
     cross join lateral aclexplode(d.defaclacl) as a
    where n.nspname = 'public' and pg_get_userbyid(d.defaclrole) = 'postgres'
      and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))),
  0::bigint, 'default privileges of postgres in public grant nothing to anon, authenticated or PUBLIC');

select is(
  (select count(*) from pg_default_acl d
     cross join lateral aclexplode(d.defaclacl) as a
    where d.defaclnamespace = 0 and d.defaclobjtype = 'f' and pg_get_userbyid(d.defaclrole) = 'postgres'
      and a.grantee = 0),
  0::bigint, 'new functions created by postgres do not get EXECUTE for PUBLIC');

-- public is closed to the API roles: whatever supabase_admin creates there with its open default
-- privileges cannot be used by anon or authenticated, even if public were exposed again by mistake.
select ok(
  not has_schema_privilege('anon', 'public', 'usage') and not has_schema_privilege('authenticated', 'public', 'usage'),
  'anon and authenticated cannot use schema public');

-- api: only postgres creates there, and no default privileges of any other role apply.
select ok(
  not has_schema_privilege('anon', 'api', 'usage')
  and not exists (
    select 1 from pg_namespace n cross join lateral aclexplode(n.nspacl) as a
     where n.nspname = 'api' and a.grantee = 0),
  'anon and PUBLIC cannot use schema api');

select is_empty($$
  select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('app', 'api') and pg_get_userbyid(c.relowner) <> 'postgres'
  union all
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace in ('app'::regnamespace, 'api'::regnamespace)
     and pg_get_userbyid(p.proowner) <> case
           when p.pronamespace = 'api'::regnamespace and starts_with(p.proname, 'student_') then 'tiza_student'
           else 'postgres' end
  union all
  select t.typname::text from pg_type t
   where t.typnamespace in ('app'::regnamespace, 'api'::regnamespace) and pg_get_userbyid(t.typowner) <> 'postgres'
$$, 'every object in app and api belongs to postgres, except the student RPCs, which belong to tiza_student');

select is_empty($$
  select pg_get_userbyid(d.defaclrole) || ' in ' || n.nspname from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname in ('app', 'api') and pg_get_userbyid(d.defaclrole) <> 'postgres'
$$, 'no other role has default privileges in app or api');

-- Schema app: no API role (service_role included) uses it, and nothing in it is granted.
select ok(
  not has_schema_privilege('anon', 'app', 'usage')
  and not has_schema_privilege('authenticated', 'app', 'usage')
  and not has_schema_privilege('service_role', 'app', 'usage'),
  'no API role has USAGE on schema app');

select is(
  (select count(*) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as a
    where n.nspname = 'app' and c.relkind in ('r', 'v', 'm', 'p', 'f', 'S')
      and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role')))),
  0::bigint, 'no table, view or sequence in app grants anything to PUBLIC, anon, authenticated or service_role');

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as a
    where n.nspname = 'app'
      and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role')))),
  0::bigint, 'no function in app is executable by PUBLIC, anon, authenticated or service_role');

select is(
  (select count(*) from pg_default_acl d
     join pg_namespace n on n.oid = d.defaclnamespace
     cross join lateral aclexplode(d.defaclacl) as a
    where n.nspname in ('app', 'api')
      and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role')))),
  0::bigint, 'default privileges in app and api grant nothing to PUBLIC, anon, authenticated or service_role');

-- A table, a sequence and a function created now must stay closed.
create table public.pgtap_privilege_probe (id integer);
create sequence public.pgtap_privilege_probe_seq;
create function public.pgtap_privilege_probe_fn() returns integer language sql as 'select 1';
create table app.pgtap_privilege_probe (id integer);
create function api.pgtap_privilege_probe_fn() returns integer language sql as 'select 1';

select ok(
  not has_table_privilege('anon', 'public.pgtap_privilege_probe', 'select')
  and not has_table_privilege('authenticated', 'public.pgtap_privilege_probe', 'select'),
  'a new table in public is not readable by anon or authenticated');

select ok(
  not has_table_privilege('anon', 'public.pgtap_privilege_probe', 'insert')
  and not has_table_privilege('authenticated', 'public.pgtap_privilege_probe', 'insert')
  and not has_table_privilege('authenticated', 'public.pgtap_privilege_probe', 'update')
  and not has_table_privilege('authenticated', 'public.pgtap_privilege_probe', 'delete'),
  'a new table in public is not writable by anon or authenticated');

select ok(
  not has_sequence_privilege('anon', 'public.pgtap_privilege_probe_seq', 'usage')
  and not has_sequence_privilege('authenticated', 'public.pgtap_privilege_probe_seq', 'usage'),
  'a new sequence is not usable by anon or authenticated');

select ok(
  not has_function_privilege('anon', 'public.pgtap_privilege_probe_fn()', 'execute')
  and not has_function_privilege('authenticated', 'public.pgtap_privilege_probe_fn()', 'execute'),
  'a new function in public is not executable by anon or authenticated');

select ok(
  has_table_privilege('service_role', 'public.pgtap_privilege_probe', 'select'),
  'service_role keeps access to new tables in public (Supabase default; no table of ours lives there)');

select ok(
  not has_table_privilege('anon', 'app.pgtap_privilege_probe', 'select')
  and not has_table_privilege('authenticated', 'app.pgtap_privilege_probe', 'select')
  and not has_table_privilege('service_role', 'app.pgtap_privilege_probe', 'select'),
  'a new table in app is not readable by anon, authenticated or service_role');

select ok(
  not has_function_privilege('anon', 'api.pgtap_privilege_probe_fn()', 'execute')
  and not has_function_privilege('authenticated', 'api.pgtap_privilege_probe_fn()', 'execute')
  and not has_function_privilege('service_role', 'api.pgtap_privilege_probe_fn()', 'execute'),
  'a new function in api is executable by nobody until a migration grants it');

select * from finish();
rollback;
