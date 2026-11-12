-- The student role is the guarantee that what a student reads never comes from the answer key or
-- anyone's needs: every api.student_* runs as tiza_student, and Postgres denies what the role is
-- not granted, whatever path the SQL takes. Runs as postgres; everything is rolled back.
begin;
select plan(25);

-- The role itself.
select ok(
  (select not r.rolcanlogin and not r.rolinherit and not r.rolbypassrls and not r.rolsuper
          and not r.rolcreaterole and not r.rolcreatedb and not r.rolreplication
     from pg_roles r where r.rolname = 'tiza_student'),
  'tiza_student cannot log in, inherit, bypass RLS or create anything');
select is_empty($$
  select r.rolname::text from pg_auth_members a join pg_roles r on r.oid = a.roleid
   where a.member = 'tiza_student'::regrole
$$, 'tiza_student is a member of no role');
select is_empty($$
  select m.rolname || case when a.set_option or a.inherit_option then ' (set or inherit)' else '' end
    from pg_auth_members a join pg_roles m on m.oid = a.member
   where a.roleid = 'tiza_student'::regrole
     and (m.rolname <> 'postgres' or a.set_option or a.inherit_option)
$$, 'the only member of tiza_student is postgres, with ADMIN only (no SET, no INHERIT)');

-- Who owns what.
select ok(
  (select count(*) from pg_proc p where p.pronamespace = 'api'::regnamespace and starts_with(p.proname, 'student_')) >= 8,
  'the student RPCs exist');
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace = 'api'::regnamespace and starts_with(p.proname, 'student_')
     and not (p.prosecdef and p.proowner = 'tiza_student'::regrole)
$$, 'every api.student_* is SECURITY DEFINER and owned by tiza_student');
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.proowner = 'tiza_student'::regrole
     and not (p.pronamespace = 'api'::regnamespace and starts_with(p.proname, 'student_'))
$$, 'tiza_student owns nothing but the student RPCs');
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.prosecdef and has_function_privilege('tiza_student', p.oid, 'execute')
     and not (p.pronamespace = 'api'::regnamespace and starts_with(p.proname, 'student_'))
$$, 'every other function tiza_student can execute is SECURITY INVOKER: no helper lends it more rights');

-- What it can touch: exactly these tables, never the key, needs, notes or generations.
select is(
  (select array_agg(c.relname::text order by c.relname) from pg_class c
    where c.relnamespace = 'app'::regnamespace and c.relkind = 'r'
      and (has_table_privilege('tiza_student', c.oid, 'select') or has_table_privilege('tiza_student', c.oid, 'insert')
        or has_table_privilege('tiza_student', c.oid, 'update') or has_table_privilege('tiza_student', c.oid, 'delete'))),
  array['app_users', 'assessments', 'assignment_attempts', 'assignments', 'enrollments', 'grades', 'groups',
        'institutions', 'memberships', 'publications', 'students', 'subjects', 'submissions'],
  'tiza_student has table privileges only on the tables the student RPCs read and write');
select ok(
  not has_table_privilege('tiza_student', 'app.question_keys', 'select')
  and not has_table_privilege('tiza_student', 'app.answer_keys', 'select')
  and not has_table_privilege('tiza_student', 'app.answer_key_revisions', 'select')
  and not has_table_privilege('tiza_student', 'app.student_needs', 'select')
  and not has_table_privilege('tiza_student', 'app.student_notes', 'select')
  and not has_table_privilege('tiza_student', 'app.generations', 'select'),
  'no privilege on the key, needs, notes or generations');
select ok(
  has_column_privilege('tiza_student', 'app.consents', 'status', 'select')
  and not has_column_privilege('tiza_student', 'app.consents', 'text_version', 'select')
  and not has_column_privilege('tiza_student', 'app.consents', 'file_id', 'select'),
  'of consents, only whether one is in force: never its text or file');
select is_empty($$
  select c.relname::text from pg_class c
   where c.relnamespace = 'app'::regnamespace and c.relkind = 'r' and has_table_privilege('tiza_student', c.oid, 'delete')
$$, 'tiza_student deletes nothing');
select is_empty($$
  select pol.polname || ' on ' || pol.polrelid::regclass::text from pg_policy pol
   where pol.polrelid in (select c.oid from pg_class c where c.relnamespace = 'app'::regnamespace)
     and pol.polroles <> array['tiza_student'::regrole::oid]
$$, 'every policy in app admits tiza_student alone');

-- Postgres does not check EXECUTE when it fires a trigger: a SECURITY DEFINER trigger function on a
-- table tiza_student writes would run with its owner's rights and escape the role. Every trigger
-- on those tables must call an invoker function (internal FK triggers excluded).
create function pg_temp.definer_triggers_on_student_tables() returns setof text
language sql as $f$
  select t.tgrelid::regclass::text || ': ' || t.tgname || ' -> ' || t.tgfoid::regprocedure::text
    from pg_trigger t
    join pg_proc f on f.oid = t.tgfoid
   where not t.tgisinternal
     and f.prosecdef
     and (has_table_privilege('tiza_student', t.tgrelid, 'insert')
       or has_table_privilege('tiza_student', t.tgrelid, 'update')
       or has_table_privilege('tiza_student', t.tgrelid, 'delete'))
$f$;
select is_empty($$ select * from pg_temp.definer_triggers_on_student_tables() $$,
  'no trigger on a table tiza_student writes runs a SECURITY DEFINER function');
savepoint definer_trigger_probe;
create function app.zz_copy_key() returns trigger language plpgsql security definer set search_path = ''
  as $p$ begin return new; end $p$;
create trigger zz_copy_key before update on app.submissions for each row execute function app.zz_copy_key();
select ok(
  exists (select 1 from pg_temp.definer_triggers_on_student_tables() as r(line) where r.line like 'app.submissions: zz_copy_key%'),
  'a SECURITY DEFINER trigger on submissions is caught');
rollback to savepoint definer_trigger_probe;

-- Probes: student RPCs created now, handed over through the window like a ticket would.
insert into app.institutions (id, name, code, kind) values ('00000000-0000-0000-0000-0000000005a1', 'Liceo', 'liceo-s', 'school');
insert into app.groups (id, institution_id, subject_id, name, school_year) values
  ('00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-0000000005a1', 'math', '6.º', 2026);
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000511', 'student-a@test.invalid'),
  ('00000000-0000-0000-0000-000000000512', 'student-b@test.invalid');
insert into app.app_users (id) values ('00000000-0000-0000-0000-000000000511'), ('00000000-0000-0000-0000-000000000512');
insert into app.students (id, institution_id, display_name, username, user_id, interface) values
  ('00000000-0000-0000-0000-000000000531', '00000000-0000-0000-0000-0000000005a1', 'Estudiante A', 'est.a',
   '00000000-0000-0000-0000-000000000511', 'standard'),
  ('00000000-0000-0000-0000-000000000532', '00000000-0000-0000-0000-0000000005a1', 'Estudiante B', 'est.b',
   '00000000-0000-0000-0000-000000000512', 'gaze');
insert into app.assessments (id, institution_id, group_id, subject_id, kind) values
  ('00000000-0000-0000-0000-000000000541', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000521', 'math', 'worksheet');
insert into app.versions (id, institution_id, assessment_id, position) values
  ('00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000541', 1),
  ('00000000-0000-0000-0000-000000000562', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000541', 2);
insert into app.publications (id, institution_id, assessment_id, version_id, version_revision, content, answer_mode) values
  ('00000000-0000-0000-0000-000000000591', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000541',
   '00000000-0000-0000-0000-000000000561', 1, '{}', 'typed'),
  ('00000000-0000-0000-0000-000000000592', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000541',
   '00000000-0000-0000-0000-000000000562', 1, '{}', 'gaze');
insert into app.assignments (id, institution_id, assessment_id, student_id) values
  ('00000000-0000-0000-0000-0000000005d1', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000541',
   '00000000-0000-0000-0000-000000000531'),
  ('00000000-0000-0000-0000-0000000005d2', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000541',
   '00000000-0000-0000-0000-000000000532');
insert into app.assignment_attempts (id, institution_id, assessment_id, assignment_id, version_id, publication_id, number) values
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000541',
   '00000000-0000-0000-0000-0000000005d1', '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000591', 1),
  ('00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000541',
   '00000000-0000-0000-0000-0000000005d2', '00000000-0000-0000-0000-000000000562', '00000000-0000-0000-0000-000000000592', 1);
-- The probes below run as student A.
do $$ begin
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000511", "role": "authenticated"}', true);
end $$;

select app.begin_student_rpc_change();
create function api.student_zz_key() returns jsonb language plpgsql security definer set search_path = ''
  as $p$ begin perform app.rpc_begin(); return to_jsonb((select count(*) from app.answer_key_revisions)); end $p$;
create function api.student_zz_needs() returns jsonb language plpgsql security definer set search_path = ''
  as $p$ begin perform app.rpc_begin(); return to_jsonb((select count(*) from app.student_needs)); end $p$;
create function api.student_zz_start() returns jsonb language plpgsql security definer set search_path = ''
  as $p$
  begin
    perform app.rpc_begin();
    perform app.lock_attempt_tree('00000000-0000-0000-0000-0000000005e1');
    update app.assignment_attempts set status = 'started', started_at = now(), revision = revision + 1
     where id = '00000000-0000-0000-0000-0000000005e1';
    insert into app.submissions (institution_id, attempt_id) values
      ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005e1');
    return to_jsonb((select count(*) from app.publications));
  end
  $p$;
create function api.student_zz_peek() returns jsonb language plpgsql security definer set search_path = ''
  as $p$
  begin
    perform app.rpc_begin();
    return jsonb_build_object(
      'students', (select count(*) from app.students),
      'otherInterface', (select s.interface from app.students s where s.id = '00000000-0000-0000-0000-000000000532'),
      'ownPublications', (select count(*) from app.publications p where p.id = '00000000-0000-0000-0000-000000000591'),
      'otherPublications', (select count(*) from app.publications p where p.id = '00000000-0000-0000-0000-000000000592'),
      'otherAttempts', (select count(*) from app.assignment_attempts t where t.id = '00000000-0000-0000-0000-0000000005e2'));
  end
  $p$;
select app.end_student_rpc_change();

-- The window is open again only to let postgres call what tiza_student now owns.
select app.begin_student_rpc_change();
select throws_ok($$ select api.student_zz_key() $$, '42501', null,
  'a student RPC that reaches answer_key_revisions is denied by Postgres');
select throws_ok($$ select api.student_zz_needs() $$, '42501', null,
  'a student RPC that reaches student_needs is denied by Postgres');
select lives_ok($$ select api.student_zz_start() $$,
  'the attempt protocol works as tiza_student, triggers included (touch_row, guards, key match)');
select is(api.student_zz_peek() -> 'students', '1'::jsonb, 'a student RPC sees only the caller''s own student row');
select is(api.student_zz_peek() -> 'otherInterface', 'null'::jsonb, 'nor another student''s interface (gaze would reveal a profile)');
select is(api.student_zz_peek() - 'students' - 'otherInterface',
  '{"ownPublications": 1, "otherPublications": 0, "otherAttempts": 0}'::jsonb,
  'its own publication is visible; another student''s publication and attempt are not');
select app.end_student_rpc_change();
select is(
  (select status from app.assignment_attempts where id = '00000000-0000-0000-0000-0000000005e1'),
  'started', 'the write made as tiza_student landed');
select is_empty($$
  select m.rolname::text from pg_auth_members a join pg_roles m on m.oid = a.member
   where a.roleid = 'tiza_student'::regrole and (a.set_option or a.inherit_option)
$$, 'closing the window takes SET and INHERIT back');

-- A window that is not closed fails at commit and leaves no rights. The deferred check is forced
-- with SET CONSTRAINTS ... IMMEDIATE, as COMMIT would; the subtransaction it aborts takes the
-- grants back with it.
create function pg_temp.open_window_and_commit() returns text
language plpgsql as $f$
declare
  v_state text;
begin
  perform app.begin_student_rpc_change();
  set constraints app.student_rpc_window_must_close immediate;
  return 'committed open';
exception when assert_failure or others then
  get stacked diagnostics v_state = returned_sqlstate;
  return v_state;
end
$f$;
select is(pg_temp.open_window_and_commit(), 'P0004', 'a window left open fails when the transaction commits');
select is_empty($$
  select m.rolname::text from pg_auth_members a join pg_roles m on m.oid = a.member
   where a.roleid = 'tiza_student'::regrole and (a.set_option or a.inherit_option)
  union all
  select 'create on api' where has_schema_privilege('tiza_student', 'api', 'create')
$$, 'and the failed transaction leaves no SET, INHERIT or CREATE behind');
select is_empty($$ select w.txid::text from app.student_rpc_windows w $$, 'and no open window is recorded');

select * from finish();
rollback;
