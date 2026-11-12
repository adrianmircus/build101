-- The shape every contract table and RPC must keep, whatever later tickets add.
begin;
select plan(20);

-- Tables: born closed.
select is_empty($$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)
$$, 'every table in app has RLS enabled and forced');

select ok(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind = 'r') >= 44,
  'the contract tables exist in app');

select is_empty($$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'f')
$$, 'no table lives in public: data is reachable only through RPCs (a later view must be security_invoker)');

select is_empty($$
  select c.relname::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role_name)
   where n.nspname = 'app' and c.relkind = 'r'
     and (has_table_privilege(r.role_name, c.oid, 'select') or has_table_privilege(r.role_name, c.oid, 'insert')
       or has_table_privilege(r.role_name, c.oid, 'update') or has_table_privilege(r.role_name, c.oid, 'delete'))
$$, 'anon, authenticated and service_role have no privilege on any app table');

-- Identity columns.
select is_empty($$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind = 'r' and c.relname <> 'subjects'
     and not exists (
       select 1 from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
        where k.conrelid = c.oid and k.contype = 'p' and cardinality(k.conkey) = 1
          and a.attname = 'id' and a.atttypid = 'uuid'::regtype)
$$, 'every app table but subjects has a uuid primary key named id');

select is_empty($$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind = 'r'
     and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'created_at' and a.attnotnull)
$$, 'every app table has created_at');

select is_empty($$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind = 'r'
     and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'revision')
     and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'updated_at')
$$, 'every table with revision also has updated_at');

select is_empty($$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind = 'r'
     and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'updated_at')
     and not exists (
       select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgfoid = 'app.touch_row'::regproc)
$$, 'every table with updated_at runs app.touch_row');

-- Isolation: institutional tables carry institution_id and expose (institution_id, id).
select is_empty($$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind = 'r'
     and c.relname not in ('app_users', 'institutions', 'subjects', 'rate_limits')
     and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'institution_id' and a.attnotnull)
$$, 'every non-global table has a non-null institution_id');

select is_empty($$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind = 'r'
     and c.relname not in ('audit_log', 'erasures')
     and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'institution_id')
     and not exists (
       select 1 from pg_constraint k
        where k.conrelid = c.oid and k.contype = 'f' and k.confrelid = 'app.institutions'::regclass)
$$, 'every institutional table but audit_log and erasures references institutions');

select is_empty($$
  select c.conname::text
    from pg_constraint c
    join pg_attribute src on src.attrelid = c.conrelid and src.attname = 'institution_id'
    join pg_attribute dst on dst.attrelid = c.confrelid and dst.attname = 'institution_id'
   where c.contype = 'f' and c.connamespace = 'app'::regnamespace
     and not exists (
       select 1 from generate_subscripts(c.conkey, 1) as i
        where c.conkey[i] = src.attnum and c.confkey[i] = dst.attnum)
$$, 'every FK between two institutional tables matches institution_id to institution_id');

select is_empty($$
  select c.conname::text from pg_constraint c
   where c.contype = 'f' and c.connamespace = 'app'::regnamespace
     and exists (select 1 from pg_attribute a where a.attrelid = c.confrelid and a.attname = 'institution_id')
     and not exists (select 1 from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'institution_id')
$$, 'no global table references an institutional one');

-- History never rewrites itself: an append-only or immutable row cannot be the target of an FK
-- action that updates it (SET NULL, SET DEFAULT, ON UPDATE CASCADE). Deleting the parent may
-- delete it (CASCADE) or fail (NO ACTION); actors on those rows are kept as plain ids.
select is_empty($$
  select c.conname::text from pg_constraint c
   where c.contype = 'f' and c.connamespace = 'app'::regnamespace
     and (c.confdeltype in ('n', 'd') or c.confupdtype not in ('a', 'r'))
     and exists (
       select 1 from pg_trigger t
        where t.tgrelid = c.conrelid
          and t.tgfoid in ('app.append_only'::regproc, 'app.publications_guard'::regproc))
$$, 'no FK action rewrites an append-only or immutable row');

-- RPCs and helpers. RPCs live in api; nothing of ours is in public.
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace = 'public'::regnamespace and pg_get_userbyid(p.proowner) = 'postgres'
$$, 'postgres owns no function in public: RPCs live in api');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace in ('api'::regnamespace, 'app'::regnamespace)
     and not coalesce('search_path=""' = any (p.proconfig), false)
$$, 'every function in app and api pins search_path to empty');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace = 'api'::regnamespace and not p.prosecdef
$$, 'every function in api is a SECURITY DEFINER RPC');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace = 'api'::regnamespace
     and p.prorettype <> 'jsonb'::regtype
$$, 'every RPC returns jsonb');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace = 'api'::regnamespace
     and (has_function_privilege('anon', p.oid, 'execute')
       or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as a where a.grantee = 0))
$$, 'no RPC is executable by anon or PUBLIC');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace = 'api'::regnamespace and starts_with(p.proname, 'internal_')
     and has_function_privilege('authenticated', p.oid, 'execute')
$$, 'no internal_* RPC is executable by authenticated');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace = 'api'::regnamespace and position('app.rpc_begin()' in p.prosrc) = 0
$$, 'every RPC starts with app.rpc_begin(): none runs inside erasure mode');

select * from finish();
rollback;
