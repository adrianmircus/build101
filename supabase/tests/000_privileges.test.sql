-- Nothing in schema public is reachable by anon, authenticated or PUBLIC unless a migration
-- grants it by name. This file only guards the starting point (the first migration); later
-- tests check each table and RPC they add.
begin;
select plan(12);

-- Existing objects: no privilege at all for the API roles.
select is(
  (select count(*) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join (values ('anon'), ('authenticated')) as r(role_name)
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
      and (has_table_privilege(r.role_name, c.oid, 'select')
        or has_table_privilege(r.role_name, c.oid, 'insert')
        or has_table_privilege(r.role_name, c.oid, 'update')
        or has_table_privilege(r.role_name, c.oid, 'delete'))),
  0::bigint, 'anon and authenticated have no privilege on any table in public');

select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')),
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
     cross join (values ('anon'), ('authenticated')) as r(role_name)
    where n.nspname = 'public' and has_function_privilege(r.role_name, p.oid, 'execute')),
  0::bigint, 'anon and authenticated cannot execute any function in public');

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as a
    where n.nspname = 'public' and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  0::bigint, 'PUBLIC has no EXECUTE on any function in public');

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

-- A table, a sequence and a function created now must stay closed.
create table public.pgtap_privilege_probe (id integer);
create sequence public.pgtap_privilege_probe_seq;
create function public.pgtap_privilege_probe_fn() returns integer language sql as 'select 1';

select ok(
  not has_table_privilege('anon', 'public.pgtap_privilege_probe', 'select')
  and not has_table_privilege('authenticated', 'public.pgtap_privilege_probe', 'select'),
  'a new table is not readable by anon or authenticated');

select ok(
  not has_table_privilege('anon', 'public.pgtap_privilege_probe', 'insert')
  and not has_table_privilege('authenticated', 'public.pgtap_privilege_probe', 'insert')
  and not has_table_privilege('authenticated', 'public.pgtap_privilege_probe', 'update')
  and not has_table_privilege('authenticated', 'public.pgtap_privilege_probe', 'delete'),
  'a new table is not writable by anon or authenticated');

select ok(
  not has_sequence_privilege('anon', 'public.pgtap_privilege_probe_seq', 'usage')
  and not has_sequence_privilege('authenticated', 'public.pgtap_privilege_probe_seq', 'usage'),
  'a new sequence is not usable by anon or authenticated');

select ok(
  not has_function_privilege('anon', 'public.pgtap_privilege_probe_fn()', 'execute')
  and not has_function_privilege('authenticated', 'public.pgtap_privilege_probe_fn()', 'execute'),
  'a new function is not executable by anon or authenticated');

select ok(
  has_table_privilege('service_role', 'public.pgtap_privilege_probe', 'select'),
  'service_role keeps access to new tables (the privileged server code relies on it)');

select * from finish();
rollback;
