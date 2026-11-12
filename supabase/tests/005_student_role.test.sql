-- The student role is the guarantee that what a student reads never comes from the answer key or
-- anyone's needs: every api.student_* runs as tiza_student, and Postgres denies what the role is
-- not granted, whatever path the SQL takes. Runs as postgres; everything is rolled back.
begin;
select plan(17);

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

-- Probes: student RPCs created now, handed over through the window like a ticket would.
insert into app.institutions (id, name, code, kind) values ('00000000-0000-0000-0000-0000000005a1', 'Liceo', 'liceo-s', 'school');
insert into app.groups (id, institution_id, subject_id, name, school_year) values
  ('00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-0000000005a1', 'math', '6.º', 2026);
insert into app.students (id, institution_id, display_name, username) values
  ('00000000-0000-0000-0000-000000000531', '00000000-0000-0000-0000-0000000005a1', 'Estudiante', 'est.s');
insert into app.assessments (id, institution_id, group_id, subject_id, kind) values
  ('00000000-0000-0000-0000-000000000541', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000521', 'math', 'worksheet');
insert into app.versions (id, institution_id, assessment_id, position) values
  ('00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000541', 1);
insert into app.publications (id, institution_id, assessment_id, version_id, version_revision, content, answer_mode) values
  ('00000000-0000-0000-0000-000000000591', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000541',
   '00000000-0000-0000-0000-000000000561', 1, '{}', 'typed');
insert into app.assignments (id, institution_id, assessment_id, student_id) values
  ('00000000-0000-0000-0000-0000000005d1', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000541',
   '00000000-0000-0000-0000-000000000531');
insert into app.assignment_attempts (id, institution_id, assessment_id, assignment_id, version_id, publication_id, number) values
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000541',
   '00000000-0000-0000-0000-0000000005d1', '00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000591', 1);

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
select app.end_student_rpc_change();

-- The window is open again only to let postgres call what tiza_student now owns.
select app.begin_student_rpc_change();
select throws_ok($$ select api.student_zz_key() $$, '42501', null,
  'a student RPC that reaches answer_key_revisions is denied by Postgres');
select throws_ok($$ select api.student_zz_needs() $$, '42501', null,
  'a student RPC that reaches student_needs is denied by Postgres');
select lives_ok($$ select api.student_zz_start() $$,
  'the attempt protocol works as tiza_student, triggers included (touch_row, guards, key match)');
select app.end_student_rpc_change();
select is(
  (select status from app.assignment_attempts where id = '00000000-0000-0000-0000-0000000005e1'),
  'started', 'the write made as tiza_student landed');
select is_empty($$
  select m.rolname::text from pg_auth_members a join pg_roles m on m.oid = a.member
   where a.roleid = 'tiza_student'::regrole and (a.set_option or a.inherit_option)
$$, 'closing the window takes SET and INHERIT back');

select * from finish();
rollback;
