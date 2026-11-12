-- Contract, phase 1: the student role. What a student reads must never come from the answer key
-- or from anyone's needs, whatever path the SQL takes (helpers, views, triggers, any schema).
-- A static check of function bodies cannot prove that, so Postgres enforces it: every
-- api.student_* function is SECURITY DEFINER and owned by tiza_student, and runs with only this
-- role's privileges. The key tables, needs, notes, the content of consents and the generation
-- tables are simply not granted, so any path to them fails with insufficient_privilege.
--
-- The role:
--   - NOLOGIN and NOINHERIT; a member of no role; no API role (anon, authenticated, service_role)
--     is a member of it. The only member is postgres, with ADMIN OPTION and no SET or INHERIT: Postgres
--     grants that to the role's creator, and it is what lets the migrations hand functions over.
--   - No BYPASSRLS. Tables force RLS with no policies; the policies below admit this role, and
--     only on the tables it is granted, so the grants are the whole boundary.
--   - It may EXECUTE only SECURITY INVOKER helpers (a postgres-owned definer helper would run with
--     postgres's rights and escalate). 001_contract checks it.
-- Hosted Supabase: postgres has CREATEROLE there too, which is all this needs (no BYPASSRLS).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tiza_student') then
    create role tiza_student nologin noinherit;
  end if;
end
$$;

grant usage on schema app to tiza_student;

-- Who is calling and where they belong (the actor helpers read these).
grant select on app.app_users, app.institutions, app.memberships, app.subjects to tiza_student;
-- The student's own rows and what was published to them.
grant select on app.students, app.groups, app.enrollments, app.assessments, app.publications,
  app.assignments, app.assignment_attempts, app.submissions, app.grades to tiza_student;
-- Only whether a consent is in force (dictation becomes typed without it), never its text or file.
grant select (id, institution_id, student_id, purpose, status, valid_from, valid_until, revoked_at)
  on app.consents to tiza_student;
-- The attempt protocol: start, save and submit (and the row locks they take, which need UPDATE).
grant update on app.assignments, app.assignment_attempts to tiza_student;
grant insert, update on app.submissions to tiza_student;

create policy tiza_student_rpcs on app.app_users for select to tiza_student using (true);
create policy tiza_student_rpcs on app.institutions for select to tiza_student using (true);
create policy tiza_student_rpcs on app.memberships for select to tiza_student using (true);
create policy tiza_student_rpcs on app.subjects for select to tiza_student using (true);
create policy tiza_student_rpcs on app.students for select to tiza_student using (true);
create policy tiza_student_rpcs on app.groups for select to tiza_student using (true);
create policy tiza_student_rpcs on app.enrollments for select to tiza_student using (true);
create policy tiza_student_rpcs on app.assessments for select to tiza_student using (true);
create policy tiza_student_rpcs on app.publications for select to tiza_student using (true);
create policy tiza_student_rpcs on app.grades for select to tiza_student using (true);
create policy tiza_student_rpcs on app.consents for select to tiza_student using (true);
create policy tiza_student_rpcs on app.assignments for all to tiza_student using (true) with check (true);
create policy tiza_student_rpcs on app.assignment_attempts for all to tiza_student using (true) with check (true);
create policy tiza_student_rpcs on app.submissions for all to tiza_student using (true) with check (true);

-- Invoker helpers the student RPCs call. Triggers on the tables they write (touch_row, the
-- attempt and submission guards, attempts_key_matches) run as the invoker too and only read
-- publications, which is granted; raise_error is how they fail.
grant execute on function
  app.rpc_begin(), app.lock_begin(), app.lock_depth(), app.lock_violation(text), app.lock_assignments(uuid[]),
  app.lock_attempt_tree(uuid), app.raise_error(text, text), app.assert_revision(integer, integer),
  app.session_user_id(), app.actor_id(), app.require_actor(), app.actor_institutions(text[]), app.is_member(uuid, text[]),
  app.actor_student_id(), app.is_student_self(uuid), app.institution_is_open(uuid)
  to tiza_student;

-- The window a migration opens to create, replace or grant a student RPC. postgres cannot do it
-- alone: owning or replacing a function of tiza_student needs SET and INHERIT on the role, and
-- handing a function over needs the new owner to have CREATE on api. Both are given for the
-- window and taken back at its end, which also hands every api.student_* function to the role.
--   select app.begin_student_rpc_change();
--   create or replace function api.student_task(...) ...;   grant execute ... to authenticated;
--   select app.end_student_rpc_change();
create function app.begin_student_rpc_change() returns void
language plpgsql
set search_path = ''
as $$
begin
  grant tiza_student to current_user with set true, inherit true;
  grant create on schema api to tiza_student;
end
$$;

create function app.end_student_rpc_change() returns void
language plpgsql
set search_path = ''
as $$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'api'::regnamespace and starts_with(p.proname, 'student_')
       and p.proowner <> 'tiza_student'::regrole
  loop
    execute format('alter function %s owner to tiza_student', v_function);
  end loop;
  revoke create on schema api from tiza_student;
  revoke tiza_student from current_user;
end
$$;

-- Hand the contract's student stubs over now.
select app.begin_student_rpc_change();
select app.end_student_rpc_change();
