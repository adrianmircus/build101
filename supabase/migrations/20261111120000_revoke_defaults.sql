-- First migration: revoke everything Postgres and Supabase grant by default in schema public.
--
-- Why: in this project nothing is read or written directly through the API. Every access goes
-- through an RPC that authorizes the actor, and every privilege is granted explicitly, by name,
-- in the migration that needs it. Supabase's defaults (full table, sequence and function
-- privileges for anon and authenticated, EXECUTE for PUBLIC on every new function) work the
-- other way round, and one forgotten REVOKE would leak data about minors.
--
-- Two parts: (1) what already exists, (2) what future objects will receive.

-- (1) Existing objects.
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- (2) Future objects, for every role that creates objects in this project.
-- postgres runs the migrations. supabase_admin creates objects in a few Supabase-managed flows
-- (extensions, dashboard), so it is covered too whenever the migration role is allowed to.
do $$
declare
  creator text;
begin
  foreach creator in array array['postgres', 'supabase_admin'] loop
    if not exists (select 1 from pg_roles where rolname = creator) then
      continue;
    end if;
    -- A role can only change another role's default privileges if it is a member of it.
    if creator <> current_user and not pg_has_role(current_user, creator, 'member') then
      raise notice 'skipping default privileges for %: % is not a member', creator, current_user;
      continue;
    end if;

    execute format('alter default privileges for role %I in schema public revoke all on tables from public, anon, authenticated', creator);
    execute format('alter default privileges for role %I in schema public revoke all on sequences from public, anon, authenticated', creator);
    execute format('alter default privileges for role %I in schema public revoke all on functions from public, anon, authenticated', creator);
    -- Functions get EXECUTE for PUBLIC by default, and that default has no schema: it is global
    -- for the creator, so it is revoked without "in schema".
    execute format('alter default privileges for role %I revoke execute on functions from public', creator);
  end loop;
end
$$;
