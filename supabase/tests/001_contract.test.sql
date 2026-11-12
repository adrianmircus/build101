-- The shape every contract table and RPC must keep, whatever later tickets add.
begin;
select plan(23);

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
     and c.relname not in ('app_users', 'institutions', 'subjects', 'rate_limits', 'student_rpc_windows')
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

-- The first statement after the body's begin is exactly perform app.rpc_begin(); (no comment or
-- statement in between), so nothing runs before the erasure-mode check.
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace = 'api'::regnamespace
     and coalesce(lower(regexp_replace(substring(p.prosrc from '(?i)\mbegin\M\s*([^;]*;)'), '\s+', ' ', 'g')), '')
         <> 'perform app.rpc_begin();'
$$, 'every RPC starts with perform app.rpc_begin(): none runs inside erasure mode');

-- What a student reads never comes from the answer key. The closure of every api.student_*
-- function is every app or api function its body names, and every function those name, to any
-- depth (a recursive CTE; UNION stops on cycles). Nothing in that closure may name question_keys,
-- answer_keys or answer_key_revisions, or use dynamic SQL (EXECUTE, format(...)), which no static
-- check can see through. Plpgsql bodies have no pg_depend rows, so names are matched in prosrc
-- with word boundaries, as the other checks do.
create function pg_temp.student_key_readers() returns setof text
language sql as $f$
  with recursive closure (root, fn) as (
    select p.oid, p.oid from pg_proc p
     where p.pronamespace = 'api'::regnamespace and starts_with(p.proname, 'student_')
    union
    select c.root, callee.oid
      from closure c
      join pg_proc caller on caller.oid = c.fn
      join pg_proc callee
        on callee.pronamespace in ('app'::regnamespace, 'api'::regnamespace)
       and caller.prosrc ~* ('\m' || callee.pronamespace::regnamespace::text || '\.' || callee.proname || '\M')
  )
  select root.proname || ' -> ' || fn.pronamespace::regnamespace::text || '.' || fn.proname || ': '
         || case when fn.prosrc ~* '\m(question_keys|answer_keys|answer_key_revisions)\M'
                 then 'reads the answer key' else 'uses dynamic SQL' end
    from closure c
    join pg_proc root on root.oid = c.root
    join pg_proc fn on fn.oid = c.fn
   where fn.prosrc ~* '\m(question_keys|answer_keys|answer_key_revisions)\M'
      or fn.prosrc ~* '\mexecute\M'
      or fn.prosrc ~* '\mformat\s*\('
$f$;

select is_empty($$ select * from pg_temp.student_key_readers() $$,
  'student RPCs never reach the answer key tables or dynamic SQL, at any depth');

-- Negative probes, rolled back with the test: the check must catch a two-hop chain and dynamic SQL.
-- They come last because they add functions the checks above would (rightly) reject.
create function app.zz_solution_text() returns text language sql
  as 'select content::text from app.answer_key_revisions limit 1';
create function app.zz_task_payload() returns text language sql
  as 'select app.zz_solution_text()';
create function api.student_zz_probe() returns jsonb language plpgsql security definer set search_path = ''
  as $p$ begin perform app.rpc_begin(); return to_jsonb(app.zz_task_payload()); end $p$;
create function api.student_zz_dynamic() returns jsonb language plpgsql security definer set search_path = ''
  as $p$ begin perform app.rpc_begin(); execute format('select %s', 1); return '{}'; end $p$;

select ok(
  exists (select 1 from pg_temp.student_key_readers() as r(line)
           where r.line = 'student_zz_probe -> app.zz_solution_text: reads the answer key'),
  'a two-hop chain to answer_key_revisions is caught');
select ok(
  exists (select 1 from pg_temp.student_key_readers() as r(line)
           where r.line = 'student_zz_dynamic -> api.student_zz_dynamic: uses dynamic SQL'),
  'dynamic SQL in a student RPC is caught');

select * from finish();
rollback;
