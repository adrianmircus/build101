-- History and provenance rules of the contract: an operation id cannot be reused on another
-- resource, provenance always points to the version's own generation, deleting an account keeps
-- every historical row, and an attempt keeps its publication's key revision. Runs as postgres.
begin;
select plan(14);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000111', 'actor@test.invalid');
insert into app.app_users (id, display_name) values ('00000000-0000-0000-0000-000000000111', 'Profe');
insert into app.institutions (id, name, code, kind) values ('00000000-0000-0000-0000-0000000001a1', 'Liceo', 'liceo-h', 'school');
insert into app.memberships (institution_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000111', 'teacher');
insert into app.groups (id, institution_id, subject_id, name, school_year, created_by) values
  ('00000000-0000-0000-0000-000000000121', '00000000-0000-0000-0000-0000000001a1', 'math', '4.º', 2026, '00000000-0000-0000-0000-000000000111');
insert into app.students (id, institution_id, display_name, username) values
  ('00000000-0000-0000-0000-000000000131', '00000000-0000-0000-0000-0000000001a1', 'Estudiante', 'est.h');
insert into app.student_need_events (institution_id, student_id, op_id, kind, need_revision, after, actor_user_id) values
  ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000131', gen_random_uuid(), 'set', 1, '{}',
   '00000000-0000-0000-0000-000000000111');
insert into app.assessments (id, institution_id, group_id, subject_id, kind) values
  ('00000000-0000-0000-0000-000000000141', '00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000121', 'math', 'worksheet');
insert into app.assessment_exercises (id, institution_id, assessment_id, position, label, body) values
  ('00000000-0000-0000-0000-000000000151', '00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000141', 0, '1', 'x = 1');
insert into app.versions (id, institution_id, assessment_id, position) values
  ('00000000-0000-0000-0000-000000000161', '00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000141', 1),
  ('00000000-0000-0000-0000-000000000162', '00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000141', 2);
insert into app.version_exercises (id, institution_id, assessment_id, version_id, exercise_id, source_revision) values
  ('00000000-0000-0000-0000-000000000171', '00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000141',
   '00000000-0000-0000-0000-000000000161', '00000000-0000-0000-0000-000000000151', 1);
insert into app.generations (id, institution_id, version_id, kind, target_revision, op_key, subject_id, inputs,
                             profiles_hash, profiles_revision, prompt_version, required_jobs) values
  ('00000000-0000-0000-0000-000000000181', '00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000162',
   'version', 1, gen_random_uuid(), 'math', '{}', repeat('b', 64), 'r1', 'p1', 1);
insert into app.version_events (institution_id, version_id, op_id, kind, version_exercise_id, version_revision, actor_user_id) values
  ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000161', '00000000-0000-0000-0000-0000000001f1',
   'edited', '00000000-0000-0000-0000-000000000171', 2, '00000000-0000-0000-0000-000000000111');
insert into app.answer_keys (id, institution_id, version_id) values
  ('00000000-0000-0000-0000-000000000191', '00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000161');
insert into app.answer_key_revisions (id, institution_id, version_id, answer_key_id, number, source, content,
                                      version_revision, exercise_revisions, author_user_id) values
  ('00000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000161',
   '00000000-0000-0000-0000-000000000191', 1, 'edited', '{}', 1, '{}', '00000000-0000-0000-0000-000000000111'),
  ('00000000-0000-0000-0000-0000000001b2', '00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000161',
   '00000000-0000-0000-0000-000000000191', 2, 'edited', '{}', 1, '{}', '00000000-0000-0000-0000-000000000111');
insert into app.publications (id, institution_id, assessment_id, version_id, version_revision, answer_key_revision_id,
                              content, answer_mode, published_by) values
  ('00000000-0000-0000-0000-0000000001c1', '00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000141',
   '00000000-0000-0000-0000-000000000161', 1, '00000000-0000-0000-0000-0000000001b1', '{}', 'typed',
   '00000000-0000-0000-0000-000000000111');
insert into app.assignments (id, institution_id, assessment_id, student_id) values
  ('00000000-0000-0000-0000-0000000001d1', '00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000141',
   '00000000-0000-0000-0000-000000000131');

-- Operation identity, checked under the lock by app.claim_version_op.
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

select ok(
  (app.claim_version_op('00000000-0000-0000-0000-0000000001a1', gen_random_uuid(), 'edited',
     '00000000-0000-0000-0000-000000000161', '00000000-0000-0000-0000-000000000171')).id is null,
  'a new op_id finds nothing');
select is(
  (app.claim_version_op('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-0000000001f1', 'edited',
     '00000000-0000-0000-0000-000000000161', '00000000-0000-0000-0000-000000000171')).version_revision,
  2, 'the same op_id on the same resource returns what it wrote');
select is(
  pg_temp.error_of($$ select app.claim_version_op('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-0000000001f1',
     'edited', '00000000-0000-0000-0000-000000000162', null) $$),
  'P0001 CONFLICT op_key_reused', 'the same op_id on another version is a CONFLICT');
select is(
  pg_temp.error_of($$ select app.claim_version_op('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-0000000001f1',
     'approved', '00000000-0000-0000-0000-000000000161', '00000000-0000-0000-0000-000000000171') $$),
  'P0001 CONFLICT op_key_reused', 'the same op_id for another kind of operation is a CONFLICT');

-- Provenance points only to the version's own generations.
select throws_ok($$
  update app.version_exercises set written_by_generation_id = '00000000-0000-0000-0000-000000000181'
   where id = '00000000-0000-0000-0000-000000000171'
$$, '23503', null, 'an exercise cannot claim it was written by another version''s generation');
select throws_ok($$
  update app.versions set instructions_written_by = '00000000-0000-0000-0000-000000000181'
   where id = '00000000-0000-0000-0000-000000000161'
$$, '23503', null, 'instructions cannot claim another version''s generation');
select throws_ok($$
  insert into app.generation_outputs (institution_id, version_id, generation_id, version_exercise_id, kind, output, outcome) values
    ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000162', '00000000-0000-0000-0000-000000000181',
     null, 'gaze_questions', '{}', 'obsolete')
$$, '23514', null, 'an exercise or questions output names its exercise');

-- Deleting an account keeps the history it wrote.
select lives_ok($$ delete from auth.users where id = '00000000-0000-0000-0000-000000000111' $$,
  'an Auth account that wrote history can be deleted');
select is(
  (select count(*) from app.student_need_events where actor_user_id = '00000000-0000-0000-0000-000000000111')
  + (select count(*) from app.version_events where actor_user_id = '00000000-0000-0000-0000-000000000111')
  + (select count(*) from app.answer_key_revisions where author_user_id = '00000000-0000-0000-0000-000000000111')
  + (select count(*) from app.publications where published_by = '00000000-0000-0000-0000-000000000111'),
  5::bigint, 'need events, version events, key revisions and publications keep the actor id');

-- An attempt is graded with its publication's key, and keeps it once started.
select throws_ok($$
  insert into app.assignment_attempts (institution_id, assessment_id, assignment_id, version_id, publication_id, answer_key_revision_id, number)
  values ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000141', '00000000-0000-0000-0000-0000000001d1',
          '00000000-0000-0000-0000-000000000161', '00000000-0000-0000-0000-0000000001c1', '00000000-0000-0000-0000-0000000001b2', 1)
$$, 'P0004', null, 'an attempt cannot use a key revision other than its publication''s');
select lives_ok($$
  insert into app.assignment_attempts (id, institution_id, assessment_id, assignment_id, version_id, publication_id, answer_key_revision_id, number)
  values ('00000000-0000-0000-0000-0000000001e1', '00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000141',
          '00000000-0000-0000-0000-0000000001d1', '00000000-0000-0000-0000-000000000161', '00000000-0000-0000-0000-0000000001c1',
          '00000000-0000-0000-0000-0000000001b1', 1)
$$, 'an attempt with its publication''s key is accepted');

update app.assignment_attempts set status = 'started', started_at = now(), revision = revision + 1
 where id = '00000000-0000-0000-0000-0000000001e1';
select throws_ok($$
  update app.assignment_attempts set answer_key_revision_id = '00000000-0000-0000-0000-0000000001b2'
   where id = '00000000-0000-0000-0000-0000000001e1'
$$, 'P0004', null, 'a started attempt keeps its key');

update app.assignment_attempts set status = 'submitted', submitted_at = now(), revision = revision + 1
 where id = '00000000-0000-0000-0000-0000000001e1';
select throws_ok($$
  update app.assignment_attempts set answer_key_revision_id = null
   where id = '00000000-0000-0000-0000-0000000001e1'
$$, 'P0004', null, 'a submitted attempt keeps its key');

select throws_ok($$
  insert into app.answer_key_revisions (institution_id, version_id, answer_key_id, number, source, content,
                                        version_revision, exercise_revisions, question_revisions)
  values ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000161', '00000000-0000-0000-0000-000000000191',
          3, 'edited', '{}', 1, '{}', '[]')
$$, '23514', null, 'question revisions are a map from question id to revision');

select * from finish();
rollback;
