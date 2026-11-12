-- Redaction during an erasure, gaze options and keys, and the key snapshot. Runs as postgres.
-- Erasure mode is the only way to rewrite a historical row, and only while a marked erasure runs.
begin;
select plan(14);

insert into app.institutions (id, name, code, kind) values ('00000000-0000-0000-0000-0000000002a1', 'Liceo', 'liceo-r', 'school');
insert into app.groups (id, institution_id, subject_id, name, school_year) values
  ('00000000-0000-0000-0000-000000000221', '00000000-0000-0000-0000-0000000002a1', 'math', '5.º', 2026);
insert into app.assessments (id, institution_id, group_id, subject_id, kind) values
  ('00000000-0000-0000-0000-000000000241', '00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-000000000221', 'math', 'worksheet');
insert into app.assessment_exercises (id, institution_id, assessment_id, position, label, body) values
  ('00000000-0000-0000-0000-000000000251', '00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-000000000241', 0, '1', 'x = 1');
insert into app.versions (id, institution_id, assessment_id, position) values
  ('00000000-0000-0000-0000-000000000261', '00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-000000000241', 1);
insert into app.version_exercises (id, institution_id, assessment_id, version_id, exercise_id, source_revision) values
  ('00000000-0000-0000-0000-000000000271', '00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-000000000241',
   '00000000-0000-0000-0000-000000000261', '00000000-0000-0000-0000-000000000251', 1);
insert into app.version_questions (id, institution_id, version_id, version_exercise_id, position, stem, options) values
  ('00000000-0000-0000-0000-000000000272', '00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-000000000261',
   '00000000-0000-0000-0000-000000000271', 0, '¿x?', '[{"id": "A", "text": "1"}, {"id": "B", "text": "2"}]');
insert into app.question_keys (institution_id, version_id, question_id, correct_option_id) values
  ('00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-000000000261', '00000000-0000-0000-0000-000000000272', 'A');
insert into app.version_events (id, institution_id, version_id, op_id, kind, version_revision, operation, target_id, data) values
  ('00000000-0000-0000-0000-000000000281', '00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-000000000261',
   gen_random_uuid(), 'recipients_changed', 2, 'set_version_recipients', '00000000-0000-0000-0000-000000000261',
   '{"added": ["00000000-0000-0000-0000-000000000231", "00000000-0000-0000-0000-000000000232"]}');
insert into app.publications (id, institution_id, assessment_id, version_id, version_revision, content, answer_mode) values
  ('00000000-0000-0000-0000-000000000291', '00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-000000000241',
   '00000000-0000-0000-0000-000000000261', 1, '{"generalInstructions": "Para Juan"}', 'typed');
insert into app.erasures (id, institution_id, kind, pseudonym_id) values
  ('00000000-0000-0000-0000-0000000002e1', '00000000-0000-0000-0000-0000000002a1', 'student', gen_random_uuid());

-- Outside an erasure, history does not change.
select throws_ok($$
  update app.version_events set data = '{"added": ["00000000-0000-0000-0000-000000000232"]}'
   where id = '00000000-0000-0000-0000-000000000281'
$$, 'P0004', null, 'outside an erasure an event cannot be rewritten');
select throws_ok($$ select app.begin_erasure(gen_random_uuid()) $$, 'P0004', null,
  'only a marked erasure opens erasure mode');

-- Inside a marked erasure, the student can be taken out of shared rows.
do $$ begin perform app.begin_erasure('00000000-0000-0000-0000-0000000002e1'); end $$;
select lives_ok($$
  update app.version_events set data = '{"added": ["00000000-0000-0000-0000-000000000232"]}'
   where id = '00000000-0000-0000-0000-000000000281'
$$, 'inside the erasure the event of a shared version drops the erased student');
select lives_ok($$
  update app.publications set content = '{"generalInstructions": "[redactado]"}'
   where id = '00000000-0000-0000-0000-000000000291'
$$, 'inside the erasure a shared publication''s content can be redacted');
select throws_ok($$
  update app.publications set answer_mode = 'gaze' where id = '00000000-0000-0000-0000-000000000291'
$$, 'P0004', null, 'even inside the erasure, nothing but the content of a publication changes');

-- Once the erasure is done, the window closes even within the same transaction.
update app.erasures set status = 'done', completed_at = now() where id = '00000000-0000-0000-0000-0000000002e1';
select throws_ok($$
  update app.version_events set data = '{}' where id = '00000000-0000-0000-0000-000000000281'
$$, 'P0004', null, 'a finished erasure no longer opens history');
select is(
  (select data from app.version_events where id = '00000000-0000-0000-0000-000000000281'),
  '{"added": ["00000000-0000-0000-0000-000000000232"]}'::jsonb, 'the other student stays in the shared history');

-- Gaze options: unique one-letter ids; the key is always one of them.
select throws_ok($$
  insert into app.version_questions (institution_id, version_id, version_exercise_id, position, stem, options) values
    ('00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-000000000261', '00000000-0000-0000-0000-000000000271',
     1, '¿y?', '[{"id": "A", "text": "1"}, {"id": "A", "text": "2"}]')
$$, '23514', null, 'repeated option ids are refused');
select throws_ok($$
  insert into app.version_questions (institution_id, version_id, version_exercise_id, position, stem, options) values
    ('00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-000000000261', '00000000-0000-0000-0000-000000000271',
     1, '¿y?', '[{"id": "A", "text": "1"}]')
$$, '23514', null, 'a question needs at least two options');
select throws_ok($$
  update app.question_keys set correct_option_id = 'Z', revision = revision + 1
   where question_id = '00000000-0000-0000-0000-000000000272'
$$, 'P0004', null, 'the correct option must be one of the question''s options');
select throws_ok($$
  update app.version_questions set options = '[{"id": "B", "text": "2"}, {"id": "C", "text": "3"}]', revision = revision + 1
   where id = '00000000-0000-0000-0000-000000000272'
$$, 'P0004', null, 'an edit cannot remove the correct option');
select lives_ok($$
  update app.version_questions set options = '[{"id": "A", "text": "uno"}, {"id": "B", "text": "dos"}]', revision = revision + 1
   where id = '00000000-0000-0000-0000-000000000272'
$$, 'an edit that keeps the correct option is accepted');

-- The key snapshot includes the instructions.
insert into app.answer_keys (id, institution_id, version_id) values
  ('00000000-0000-0000-0000-0000000002b1', '00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-000000000261');
select throws_ok($$
  insert into app.answer_key_revisions (institution_id, version_id, answer_key_id, number, source, content,
                                        version_revision, exercise_revisions)
  values ('00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-000000000261', '00000000-0000-0000-0000-0000000002b1',
          1, 'edited', '{}', 1, '{}')
$$, '23502', null, 'a key revision always records the instructions revision it was made for');
select ok(
  exists (select 1 from information_schema.columns
           where table_schema = 'app' and table_name = 'answer_key_revisions' and column_name = 'instructions_revision'),
  'instructions_revision is part of the key snapshot');

select * from finish();
rollback;
