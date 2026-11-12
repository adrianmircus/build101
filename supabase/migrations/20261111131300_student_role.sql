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

-- Every policy limits the role to the caller's own rows. A student RPC can see no other student,
-- and none of what reveals another student's profile: their interface (gaze implies motor, voice
-- implies dysgraphia), their publication (answer_mode, aids) or their attempts. The chain starts at
-- the student row of the session user and each table narrows through the one before, so the
-- policies never recurse. subjects is the only table open to all: it holds no personal data.
create policy tiza_student_own on app.app_users for select to tiza_student
  using (id = app.session_user_id());
create policy tiza_student_own on app.memberships for select to tiza_student
  using (user_id = app.session_user_id());
create policy tiza_student_own on app.institutions for select to tiza_student
  using (id in (select m.institution_id from app.memberships m));
create policy tiza_student_all on app.subjects for select to tiza_student using (true);
create policy tiza_student_own on app.students for select to tiza_student
  using (user_id = app.session_user_id());
create policy tiza_student_own on app.enrollments for select to tiza_student
  using (student_id in (select s.id from app.students s));
create policy tiza_student_own on app.groups for select to tiza_student
  using (id in (select e.group_id from app.enrollments e));
create policy tiza_student_own on app.consents for select to tiza_student
  using (student_id in (select s.id from app.students s));
create policy tiza_student_own on app.assignments for all to tiza_student
  using (student_id in (select s.id from app.students s))
  with check (student_id in (select s.id from app.students s));
create policy tiza_student_own on app.assessments for select to tiza_student
  using (id in (select a.assessment_id from app.assignments a));
create policy tiza_student_own on app.assignment_attempts for all to tiza_student
  using (assignment_id in (select a.id from app.assignments a))
  with check (assignment_id in (select a.id from app.assignments a));
create policy tiza_student_own on app.publications for select to tiza_student
  using (id in (select t.publication_id from app.assignment_attempts t));
create policy tiza_student_own on app.submissions for all to tiza_student
  using (attempt_id in (select t.id from app.assignment_attempts t))
  with check (attempt_id in (select t.id from app.assignment_attempts t));
create policy tiza_student_own on app.grades for select to tiza_student
  using (attempt_id in (select t.id from app.assignment_attempts t));

-- Invoker helpers the student RPCs call. Triggers on the tables they write (touch_row, the
-- attempt and submission guards, attempts_key_matches) run as the invoker too and only read
-- publications, which is granted; raise_error is how they fail. Postgres does not check EXECUTE
-- when it fires a trigger, so a SECURITY DEFINER trigger function on one of those tables would
-- escape the role: 005_student_role fails if any such trigger exists.
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
--
-- It fails closed. begin records the window in student_rpc_windows; a deferred constraint
-- trigger checks at commit that end removed it, and raises otherwise. The transaction then aborts,
-- and because GRANT is transactional the rights it gave are rolled back with it: a window can
-- never be committed open. Plain tables and constraint triggers are all it uses, so it works for
-- postgres on hosted Supabase (no event triggers, no superuser).
create table app.student_rpc_windows (
  id uuid primary key default gen_random_uuid(),
  txid bigint not null unique,
  created_at timestamptz not null default now()
);
alter table app.student_rpc_windows enable row level security;
alter table app.student_rpc_windows force row level security;

create function app.student_rpc_window_closed() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from app.student_rpc_windows w where w.txid = new.txid) then
    raise exception 'app.begin_student_rpc_change was not closed: call app.end_student_rpc_change()' using errcode = 'P0004';
  end if;
  return null;
end
$$;

create constraint trigger student_rpc_window_must_close
  after insert on app.student_rpc_windows
  deferrable initially deferred
  for each row execute function app.student_rpc_window_closed();

create function app.begin_student_rpc_change() returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into app.student_rpc_windows (txid) values (txid_current()) on conflict (txid) do nothing;
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
  delete from app.student_rpc_windows w where w.txid = txid_current();
end
$$;

-- Hand the contract's student stubs over now.
select app.begin_student_rpc_change();
select app.end_student_rpc_change();
