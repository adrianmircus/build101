-- The rules the schema enforces by itself, whatever an RPC does: isolation by composite FKs, the
-- uniqueness the spec states, frozen and append-only rows, the error convention and the lock order.
-- Runs as postgres (bypasses RLS) with fixed ids; everything is rolled back.
begin;
select plan(30);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000011', 'teacher-a@test.invalid'),
  ('00000000-0000-0000-0000-000000000012', 'teacher-b@test.invalid'),
  ('00000000-0000-0000-0000-000000000013', 'visitor@test.invalid');
insert into app.app_users (id, display_name) values
  ('00000000-0000-0000-0000-000000000011', 'Profe A'),
  ('00000000-0000-0000-0000-000000000012', 'Profe B'),
  ('00000000-0000-0000-0000-000000000013', null);
insert into app.institutions (id, name, code, kind, expires_at, owner_user_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'Liceo A', 'liceo-a', 'school', null, null),
  ('00000000-0000-0000-0000-0000000000b1', 'Liceo B', 'liceo-b', 'school', null, null),
  ('00000000-0000-0000-0000-0000000000c1', 'Demo', 'demo-x1', 'sandbox', now() - interval '1 minute', '00000000-0000-0000-0000-000000000013');
insert into app.memberships (institution_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000011', 'teacher'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000012', 'teacher'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000013', 'admin');
insert into app.groups (id, institution_id, subject_id, name, school_year) values
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-0000000000a1', 'math', '3.º A', 2026),
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-0000000000b1', 'math', '3.º B', 2026);
insert into app.group_staff (institution_id, group_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', 'owner');
insert into app.students (id, institution_id, display_name, username) values
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000000a1', 'Estudiante A', 'est.a'),
  ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-0000000000b1', 'Estudiante B', 'est.b');
insert into app.enrollments (institution_id, group_id, student_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000031');
insert into app.assessments (id, institution_id, group_id, subject_id, kind) values
  ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000021', 'math', 'worksheet'),
  ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000021', 'math', 'exam');
insert into app.assessment_exercises (id, institution_id, assessment_id, position, label, body) values
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000041', 0, '1', 'x + 1 = 2'),
  ('00000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000042', 0, '1', 'x + 2 = 3');
insert into app.versions (id, institution_id, assessment_id, position) values
  ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000041', 1),
  ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000041', 2);
insert into app.version_exercises (id, institution_id, assessment_id, version_id, exercise_id, source_revision) values
  ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000041',
   '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000051', 1);
insert into app.generations (id, institution_id, version_id, kind, target_revision, op_key, subject_id, inputs,
                             profiles_hash, profiles_revision, prompt_version, required_jobs) values
  ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000061',
   'version', 1, '00000000-0000-0000-0000-0000000000f1', 'math', '{}', repeat('a', 64), 'r1', 'p1', 1);

-- Isolation by composite FKs.
select throws_ok($$
  insert into app.enrollments (institution_id, group_id, student_id) values
    ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000032')
$$, '23503', null, 'a group cannot enroll a student of another institution');

select throws_ok($$
  insert into app.enrollments (institution_id, group_id, student_id) values
    ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000032')
$$, '23503', null, 'a row cannot claim another institution to reach its group');

select throws_ok($$
  insert into app.assessments (institution_id, group_id, subject_id, kind) values
    ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000021', 'physics', 'worksheet')
$$, '23503', null, 'an assessment always has its group''s subject');

select throws_ok($$
  insert into app.version_exercises (institution_id, assessment_id, version_id, exercise_id, source_revision) values
    ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000041',
     '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000052', 1)
$$, '23503', null, 'an adapted exercise points to an exercise of its own assessment');

select throws_ok($$
  update app.versions set current_generation_id = '00000000-0000-0000-0000-000000000081'
   where id = '00000000-0000-0000-0000-000000000062'
$$, '23503', null, 'a version can only be in force with one of its own generations');

-- Uniqueness the spec states.
select throws_ok($$
  insert into app.enrollments (institution_id, group_id, student_id) values
    ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000031')
$$, '23505', null, 'one active enrollment per group and student');

update app.enrollments set ended_at = now(), revision = revision + 1
 where student_id = '00000000-0000-0000-0000-000000000031';
select lives_ok($$
  insert into app.enrollments (institution_id, group_id, student_id) values
    ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000031')
$$, 'an ended enrollment does not block a new one');

select throws_ok($$
  insert into app.generations (institution_id, version_id, kind, target_revision, op_key, subject_id, inputs,
                               profiles_hash, profiles_revision, prompt_version, required_jobs) values
    ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000062', 'version', 1,
     '00000000-0000-0000-0000-0000000000f1', 'math', '{}', repeat('a', 64), 'r1', 'p1', 1)
$$, '23505', null, 'op_key is unique per institution');

select throws_ok($$
  insert into app.generations (institution_id, version_id, kind, target_revision, op_key, subject_id, inputs,
                               profiles_hash, profiles_revision, prompt_version, required_jobs) values
    ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000061', 'version', 1,
     '00000000-0000-0000-0000-0000000000f2', 'math', '{}', repeat('a', 64), 'r1', 'p1', 1)
$$, '23505', null, 'one running version generation per version');

insert into app.version_events (institution_id, version_id, op_id, kind, generation_id, version_revision) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000061', gen_random_uuid(), 'generated',
   '00000000-0000-0000-0000-000000000081', 1);
select throws_ok($$
  insert into app.version_events (institution_id, version_id, op_id, kind, generation_id, version_revision) values
    ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000061', gen_random_uuid(), 'generated',
     '00000000-0000-0000-0000-000000000081', 1)
$$, '23505', null, 'a single generated event per generation');

select throws_ok($$
  insert into app.version_recipients (institution_id, assessment_id, version_id, student_id) values
    ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000031'),
    ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000031')
$$, '23505', null, 'a student receives one version of an assessment at a time');

-- Frozen and append-only rows.
select throws_ok($$
  update app.version_events set data = '{"x": 1}' where generation_id = '00000000-0000-0000-0000-000000000081'
$$, 'P0004', null, 'version events are append-only');

select lives_ok($$
  update app.generations set status = 'done', finished_at = now() where id = '00000000-0000-0000-0000-000000000081'
$$, 'a running generation can finish');

select throws_ok($$
  update app.generations set status = 'running', finished_at = null where id = '00000000-0000-0000-0000-000000000081'
$$, 'P0004', null, 'a finished generation never reopens');

select throws_ok($$
  update app.groups set revision = revision + 2 where id = '00000000-0000-0000-0000-000000000021'
$$, 'P0004', null, 'revision moves forward by one at most');

select throws_ok($$
  update app.groups set institution_id = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-000000000021'
$$, 'P0004', null, 'a row never changes institution');

select ok(
  (select updated_at from app.groups where id = '00000000-0000-0000-0000-000000000021') is not null,
  'groups keep updated_at');

-- Erasure order: the pseudonym is unlinked and the account marked before the student goes.
insert into app.student_pseudonyms (institution_id, student_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000032');
select throws_ok($$
  delete from app.students where id = '00000000-0000-0000-0000-000000000032'
$$, '23503', null, 'a student with a linked pseudonym cannot be deleted');

update app.student_pseudonyms set student_id = null, unlinked_at = now() where student_id = '00000000-0000-0000-0000-000000000032';
insert into app.account_provisioning (institution_id, student_id, op_key) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000032', gen_random_uuid());
select throws_ok($$
  delete from app.students where id = '00000000-0000-0000-0000-000000000032'
$$, '23514', null, 'a student whose account is not marked deleted cannot be deleted');

update app.account_provisioning set status = 'deleted', revision = revision + 1 where student_id = '00000000-0000-0000-0000-000000000032';
select lives_ok($$
  delete from app.students where id = '00000000-0000-0000-0000-000000000032'
$$, 'after unlinking and marking, the student can be deleted');

select is(
  (select count(*) from app.account_provisioning where status = 'deleted' and student_id is null),
  1::bigint, 'the deleted mark outlives the student');

-- Error convention.
create function pg_temp.error_of(p_sql text) returns text
language plpgsql as $f$
declare
  v_state text; v_message text; v_detail text;
begin
  execute p_sql;
  return null;
exception when assert_failure or others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return v_state || ' ' || v_message || ' ' || coalesce(v_detail, '');
end
$f$;

select is(pg_temp.error_of($$ select app.raise_error('CONFLICT', 'revision_mismatch') $$),
  'P0001 CONFLICT revision_mismatch', 'errors carry P0001, the code as message and the reason as detail');
select is(pg_temp.error_of($$ select app.assert_revision(3, 4) $$),
  'P0001 CONFLICT revision_mismatch', 'a stale revision is a CONFLICT');
select is(left(pg_temp.error_of($$ select app.raise_error('CONFLICT', 'El estudiante Juan') $$), 5),
  'P0004', 'a reason that is not a key is refused: no data reaches a message');
-- Stub today, implemented by T1.5a: either way it answers through the convention.
select ok(
  pg_temp.error_of($$ select api.publish_version(gen_random_uuid(), 1, gen_random_uuid()) $$)
    in ('P0001 UNAVAILABLE not_implemented', 'P0001 FORBIDDEN no_session', 'P0001 NOT_FOUND not_found'),
  'RPCs answer through the same convention');

-- Lock order.
do $$ begin
  perform app.lock_begin();
  perform app.lock_versions(array['00000000-0000-0000-0000-000000000061'::uuid]);
end $$;
select is(left(pg_temp.error_of($$ select app.lock_version_tree('00000000-0000-0000-0000-000000000061', null, null) $$), 5),
  'P0004', 'nothing of a version tree is locked after several versions');
do $$ begin
  perform app.lock_begin();
  perform app.lock_version_tree('00000000-0000-0000-0000-000000000061', null, array['00000000-0000-0000-0000-000000000071'::uuid]);
end $$;
select is(left(pg_temp.error_of($$ select app.lock_version_tree('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000081', null) $$), 5),
  'P0004', 'the generation is never locked after the exercises');

-- Actor helpers, with the claims PostgREST would set.
do $$ begin perform set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000011", "role": "authenticated"}', true); end $$;
select ok(app.is_group_staff('00000000-0000-0000-0000-000000000021'), 'the owner is staff of their group');
select ok(not app.is_member('00000000-0000-0000-0000-0000000000b1', array['teacher', 'admin']), 'no membership in another institution');
do $$ begin perform set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000013", "role": "authenticated"}', true); end $$;
select ok(not app.is_member('00000000-0000-0000-0000-0000000000c1', array['admin']), 'an expired sandbox counts as no membership');

select * from finish();
rollback;
