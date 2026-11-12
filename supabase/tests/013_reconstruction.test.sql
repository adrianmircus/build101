-- T1.3a, widened in T1.3b, T1.4b, T1.4c and T1.5a: reconstruction. A teacher of the group calls every staff RPC that is not
-- an audited read and none of the answers may carry a profile, a support, an interest, a review date,
-- the interface of a student, the configuration of a version, its recipients or the inputs of a
-- generation: those come out only through the audited reads.
--
-- There is something to leak in every source: the students are seeded with real needs through
-- set_student_needs, and (as the owner, rolled back with the test) with versions that have a
-- configuration and recipients and a generation with inputs. The operations that change a student
-- (update, archive, restore) run on students that have needs.
--
-- Two checks on every answer: it conforms, level by level, to the literal list of keys of its RPC
-- (a key that is not in the list is a leak whatever its name), and no object holds a seeded
-- (version, student) pair under any key. The detector has negative controls: a mutated copy of a real
-- answer for each kind of leak must fail it.
--
-- Every later ticket that adds a non-audited staff read adds its call and its keys here (the last
-- test fails until it does, comparing full signatures). The student_* reads are not here: a teacher
-- cannot call them, and 023_student_dto and the leak test cover them.
begin;
select plan(49);

create function pg_temp.rpc(p_user uuid, p_role text, p_sql text) returns jsonb
language plpgsql as $f$
declare
  v_res jsonb; v_state text; v_message text; v_detail text;
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else jsonb_build_object('sub', p_user, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  execute p_sql into v_res;
  reset role;
  return v_res;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  reset role;
  return jsonb_build_object('error', v_state || ' ' || v_message || ' ' || coalesce(v_detail, ''));
end
$f$;

create temp table ids (k text primary key, id uuid not null);
create function pg_temp.id(p_key text) returns uuid language sql as $$ select id from ids where k = p_key $$;
create function pg_temp.as_user(p_user text, p_sql text) returns jsonb language sql
  as $$ select pg_temp.rpc(pg_temp.id(p_user), 'authenticated', p_sql) $$;
create function pg_temp.as_service(p_sql text) returns jsonb language sql
  as $$ select pg_temp.rpc(null, 'service_role', p_sql) $$;

insert into ids (k, id) select k, gen_random_uuid() from unnest(array['admin', 'teach', 'other', 'incl']) as k;
insert into auth.users (id, email) select id, k || '@t1-3a-rec.invalid' from ids;
do $$
declare
  k text;
begin
  for k in select ids.k from ids loop
    perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;

-- Institution with admin, two teachers and inclusion; group g (teach) and go (other).
insert into ids (k, id) select 'inst', (pg_temp.as_service(
  $$ select api.internal_create_institution('Liceo R', 't1-3a-rec', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, %L)', pg_temp.id('inst'), pg_temp.id(u.k), u.role))
  from (values ('admin', 'admin'), ('teach', 'teacher'), ('other', 'teacher'), ('incl', 'inclusion')) as u(k, role);
insert into ids (k, id) values
  ('g', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('inst'))) ->> 'id')::uuid),
  ('go', (pg_temp.as_user('other', format('select api.create_group(%L, ''3.º B'', ''math'', 2026, gen_random_uuid())', pg_temp.id('inst'))) ->> 'id')::uuid);
-- Three students in g, one in go.
insert into ids (k, id)
  select 's' || n, (pg_temp.as_user('teach', format('select api.create_student(%L, %L, %L, gen_random_uuid())',
           pg_temp.id('g'), 'Estudiante ' || n, 'est.' || n)) ->> 'id')::uuid
    from generate_series(1, 3) n;
insert into ids (k, id) values
  ('s4', (pg_temp.as_user('other', format('select api.create_student(%L, ''Estudiante 4'', ''est.4'', gen_random_uuid())', pg_temp.id('go'))) ->> 'id')::uuid);

-- Seed real needs, with interests nobody would write by accident.
select is((pg_temp.as_user('teach', format($$ select api.set_student_needs(%L, '{motor,adhd}', '{preguntas_guia,recordatorio}', '{centinela-ajedrez}', gen_random_uuid(), null, '2027-05-01') $$, pg_temp.id('s1'))) ->> 'revision'), '1',
  'the first student gets a motor and adhd profile, supports, an interest and a review date');
select is((pg_temp.as_user('teach', format($$ select api.set_student_needs(%L, '{dysgraphia}', '{ejemplo_resuelto}', '{centinela-dibujo}', gen_random_uuid(), null, null) $$, pg_temp.id('s2'))) ->> 'revision'), '1',
  'the second one a dysgraphia profile');
select is((pg_temp.as_user('teach', format($$ select api.set_student_needs(%L, '{dyslexia,asd}', '{numeros_simples}', '{centinela-musica}', gen_random_uuid(), null, null) $$, pg_temp.id('s3'))) ->> 'revision'), '1',
  'the third one dyslexia and asd');
-- The interface is set by the staff, not derived from the profile (T1.F8): the owner sets one per student, so none is the default.
update app.students set interface = case username when 'est.1' then 'gaze' when 'est.2' then 'voice' else 'standard' end
 where institution_id = pg_temp.id('inst') and username in ('est.1', 'est.2', 'est.3');
select is((select string_agg(s.interface, ',' order by s.username) from app.students s where s.institution_id = pg_temp.id('inst') and s.username in ('est.1', 'est.2', 'est.3')),
  'gaze,voice,standard', 'so their interface is not the default one: it would show if a projection returned it');

-- The other sources, written as the owner: an assessment of g with two versions that carry a
-- configuration (sentinel inside) and recipients, and a generation with its inputs (sentinel inside).
-- Everything is rolled back with the test.
insert into ids (k, id) select k, gen_random_uuid() from unnest(array['asm', 'v1', 'v2']) as k;
insert into app.assessments (id, institution_id, group_id, subject_id, kind)
  values (pg_temp.id('asm'), pg_temp.id('inst'), pg_temp.id('g'), 'math', 'worksheet');
insert into app.versions (id, institution_id, assessment_id, position, config, answer_mode) values
  (pg_temp.id('v1'), pg_temp.id('inst'), pg_temp.id('asm'), 1, '{"profiles":["motor"],"supports":["recordatorio"],"interests":["centinela-config"]}', 'gaze'),
  (pg_temp.id('v2'), pg_temp.id('inst'), pg_temp.id('asm'), 2, '{"profiles":["dysgraphia"],"supports":[],"interests":["centinela-config"]}', 'voice');
insert into app.version_recipients (institution_id, assessment_id, version_id, student_id) values
  (pg_temp.id('inst'), pg_temp.id('asm'), pg_temp.id('v1'), pg_temp.id('s1')),
  (pg_temp.id('inst'), pg_temp.id('asm'), pg_temp.id('v2'), pg_temp.id('s2'));
insert into app.generations (institution_id, version_id, kind, target_revision, op_key, subject_id, inputs, profiles_hash, profiles_revision, prompt_version, required_jobs)
  values (pg_temp.id('inst'), pg_temp.id('v1'), 'version', 1, gen_random_uuid(), 'math',
          '{"config":{"interests":["centinela-inputs"]},"exercises":[]}', repeat('a', 64), 'r1', 'p1', 0);
select is((select count(*) from app.version_recipients r where r.institution_id = pg_temp.id('inst')), 2::bigint, 'two versions have recipients');
select is((select count(*) from app.generations g where g.institution_id = pg_temp.id('inst') and g.inputs::text like '%centinela-inputs%'), 1::bigint, 'and a generation has inputs');
create temp table pairs (vid text not null, sid text not null);
insert into pairs select r.version_id::text, r.student_id::text from app.version_recipients r where r.institution_id = pg_temp.id('inst');

-- The detector. leaks: keys and values that must never appear. conforms: the answer uses only the keys
-- of its spec (a literal: an object lists its keys, an array holds one element spec, "s" is a scalar).
-- pair_leak: some object, at any depth, holds a seeded version id and a seeded student id together.
create function pg_temp.leaks(p_res jsonb) returns text language sql as $$
  select concat_ws(',',
    case when p_res::text ~ '"(profiles|supports|interests|reviewDueOn|interface|config|answerMode|recipients|recipientIds|studentIds|needs|inputs)"\s*:' then 'key' end,
    case when lower(p_res::text) ~ '\m(adhd|asd|dysgraphia|dyslexia|motor|preguntas_guia|recordatorio|ejemplo_resuelto|numeros_simples|gaze|voice|standard)\M' then 'catalogue' end,
    case when p_res::text ilike '%centinela%' then 'interest' end,
    case when p_res::text like '%2027-05-01%' then 'date' end)
$$;
create function pg_temp.conforms(p_val jsonb, p_spec jsonb) returns boolean language plpgsql as $$
declare
  k text; v jsonb;
begin
  if p_val is null or jsonb_typeof(p_val) = 'null' then return true; end if;
  -- "map": an object whose keys are ids (the content of an answer key); the leak detector still reads its values.
  if p_spec = '"map"'::jsonb then
    return jsonb_typeof(p_val) = 'object';
  end if;
  if jsonb_typeof(p_spec) = 'string' then
    return jsonb_typeof(p_val) in ('string', 'number', 'boolean');
  elsif jsonb_typeof(p_spec) = 'object' then
    if jsonb_typeof(p_val) <> 'object' then return false; end if;
    for k, v in select e.key, e.value from jsonb_each(p_val) e loop
      if not (p_spec ? k) or not pg_temp.conforms(v, p_spec -> k) then return false; end if;
    end loop;
    return true;
  elsif jsonb_typeof(p_spec) = 'array' then
    if jsonb_typeof(p_val) <> 'array' then return false; end if;
    for v in select e.value from jsonb_array_elements(p_val) e loop
      if not pg_temp.conforms(v, p_spec -> 0) then return false; end if;
    end loop;
    return true;
  end if;
  return false;
end
$$;
create function pg_temp.pair_leak(p_res jsonb) returns boolean language sql as $$
  with recursive t(v) as (
    select p_res
    union all
    select c.value
      from t, lateral (
        select e.value from jsonb_each(case when jsonb_typeof(t.v) = 'object' then t.v else '{}'::jsonb end) e
        union all
        select e.value from jsonb_array_elements(case when jsonb_typeof(t.v) = 'array' then t.v else '[]'::jsonb end) e
      ) c
  )
  select exists (select 1 from t, pairs p where jsonb_typeof(t.v) = 'object' and t.v::text like '%' || p.vid || '%' and t.v::text like '%' || p.sid || '%')
$$;
-- The verdict: empty when the answer is clean.
create function pg_temp.verdict(p_res jsonb, p_spec jsonb) returns text language sql as $$
  select concat_ws(',', nullif(pg_temp.leaks(p_res), ''),
    case when not pg_temp.conforms(p_res, p_spec) then 'shape' end,
    case when pg_temp.pair_leak(p_res) then 'pair' end)
$$;

-- The literal keys of every non-audited answer, by RPC.
create temp table specs (name text primary key, spec jsonb not null);
insert into specs (name, spec) values
  ('list_my_institutions', '{"items":[{"id":"s","name":"s","kind":"s","roles":["s"]}]}'),
  ('create_group', '{"id":"s","revision":"s"}'),
  ('update_group', '{"id":"s","revision":"s"}'),
  ('archive_group', '{"id":"s","revision":"s"}'),
  ('restore_group', '{"id":"s","revision":"s"}'),
  ('add_group_staff', '{"id":"s"}'),
  ('remove_group_staff', '{"id":"s"}'),
  ('create_student', '{"id":"s","revision":"s","provisioningId":"s"}'),
  ('update_student', '{"id":"s","revision":"s"}'),
  ('archive_student', '{"id":"s","revision":"s"}'),
  ('restore_student', '{"id":"s","revision":"s"}'),
  ('set_student_interface', '{"id":"s","revision":"s"}'),
  ('enroll_student', '{"id":"s"}'),
  ('unenroll_student', '{"id":"s"}'),
  ('list_my_groups', '{"items":[{"archivedAt":"s","id":"s","myRole":"s","name":"s","revision":"s","schoolYear":"s","studentCount":"s","subjectId":"s"}],"total":"s"}'),
  ('get_group', '{"archivedAt":"s","id":"s","institutionId":"s","myRole":"s","name":"s","revision":"s","schoolYear":"s","subjectId":"s","staff":[{"userId":"s","displayName":"s","role":"s"}]}'),
  ('list_group_students', '{"items":[{"archivedAt":"s","displayName":"s","enrolledAt":"s","hasAccount":"s","id":"s","revision":"s","username":"s"}],"total":"s"}'),
  ('set_student_needs', '{"studentId":"s","revision":"s"}'),
  ('create_student_note', '{"id":"s","revision":"s"}'),
  ('update_student_note', '{"id":"s","revision":"s"}'),
  ('archive_student_note', '{"id":"s","revision":"s"}'),
  ('record_consent', '{"id":"s","revision":"s"}'),
  ('revoke_consent', '{"id":"s","revision":"s"}'),
  ('create_assessment', '{"id":"s","revision":"s"}'),
  ('update_assessment', '{"id":"s","revision":"s"}'),
  ('archive_assessment', '{"id":"s","revision":"s"}'),
  ('add_exercise', '{"id":"s","revision":"s"}'),
  ('update_exercise', '{"id":"s","revision":"s"}'),
  ('remove_exercise', '{"id":"s","revision":"s"}'),
  ('reorder_exercises', '{"id":"s","revision":"s"}'),
  ('list_assessments', '{"items":[{"createdAt":"s","dueAt":"s","exerciseCount":"s","id":"s","kind":"s","publishAt":"s","revision":"s","status":"s","subjectId":"s","topic":"s","versionCount":"s"}],"total":"s"}'),
  ('create_version', '{"id":"s","revision":"s","position":"s"}'),
  ('update_version_config', '{"id":"s","revision":"s"}'),
  ('set_version_recipients', '{"id":"s","revision":"s"}'),
  ('archive_version', '{"id":"s","revision":"s"}'),
  ('update_version_instructions', '{"id":"s","instructionsRevision":"s","versionRevision":"s"}'),
  ('update_version_exercise', '{"id":"s","revision":"s","versionRevision":"s"}'),
  ('update_version_question', '{"id":"s","revision":"s","versionRevision":"s"}'),
  ('set_question_key', '{"questionId":"s","revision":"s"}'),
  ('approve_version', '{"id":"s","approvedRevision":"s"}'),
  ('reject_version', '{"eventId":"s"}'),
  ('list_versions', '{"items":[{"approved":"s","exerciseCount":"s","id":"s","position":"s","readyCount":"s","revision":"s","stale":"s","status":"s"}]}'),
  ('edit_answer_key', '{"revisionId":"s","number":"s"}'),
  ('confirm_answer_key', '{"revisionId":"s","number":"s"}'),
  ('approve_answer_key', '{"answerKeyId":"s","approvedRevisionId":"s","revision":"s"}'),
  ('get_answer_key', '{"id":"s","versionId":"s","status":"s","stale":"s","approvedRevisionId":"s","revision":"s","current":{"id":"s","number":"s","source":"s","content":{"exercises":"map","questions":"map"},"versionRevision":"s","exerciseRevisions":"map","questionRevisions":"map","instructionsRevision":"s","createdAt":"s"}}'),
  ('publish_version', '{"publicationId":"s","attempts":"s"}'),
  ('list_assessment_attempts', '{"items":[{"studentId":"s","displayName":"s","assignmentId":"s","attemptId":"s","status":"s","submittedAt":"s","late":"s","score":"s","graded":"s"}]}'),
  ('grade_attempt', '{"attemptId":"s","revision":"s"}'),
  ('get_assessment', '{"assessment":{"createdAt":"s","dueAt":"s","generalInstructions":"s","groupId":"s","id":"s","kind":"s","publishAt":"s","revision":"s","sourceFileId":"s","status":"s","subjectId":"s","topic":"s"},"exercises":[{"body":"s","id":"s","label":"s","position":"s","revision":"s","topicId":"s"}]}');

-- A control: the detector does flag the audited read of the same data, so a green result below is not a blind detector.
select is(pg_temp.leaks(pg_temp.as_user('teach', format('select api.get_student_needs(array[%L, %L, %L]::uuid[])',
    pg_temp.id('s1'), pg_temp.id('s2'), pg_temp.id('s3')))), 'key,catalogue,interest,date', 'control: the detector flags the audited read of the seeded needs');
select is(pg_temp.leaks('{"id": "x", "name": "ok"}'::jsonb), '', 'and flags nothing in a harmless answer');

-- Every non-audited staff RPC the database has today, called as the teacher of the group. The
-- signature is the full one: a new overload is not covered by the call of the old one.
create temp table answers (name text primary key, sig text not null, res jsonb not null);
create function pg_temp.call(p_name text, p_sig text, p_sql text) returns void language plpgsql as $$
begin
  insert into answers (name, sig, res) values (p_name, p_sig::regprocedure::text, pg_temp.as_user('teach', p_sql));
end
$$;
select pg_temp.call('list_my_institutions', 'api.list_my_institutions()', 'select api.list_my_institutions()');
select pg_temp.call('create_group', 'api.create_group(uuid,text,text,integer,uuid)', format('select api.create_group(%L, ''Taller'', ''math'', 2026, gen_random_uuid())', pg_temp.id('inst')));
insert into ids (k, id) select 'gx', (res ->> 'id')::uuid from answers where name = 'create_group';
select pg_temp.call('update_group', 'api.update_group(uuid,integer,text,integer)', format('select api.update_group(%L, 1, ''Taller 2'', 2026)', pg_temp.id('gx')));
select pg_temp.call('archive_group', 'api.archive_group(uuid,integer)', format('select api.archive_group(%L, 2)', pg_temp.id('gx')));
select pg_temp.call('restore_group', 'api.restore_group(uuid,integer)', format('select api.restore_group(%L, 3)', pg_temp.id('gx')));
select pg_temp.call('add_group_staff', 'api.add_group_staff(uuid,uuid,text)', format('select api.add_group_staff(%L, %L, ''co_teacher'')', pg_temp.id('g'), pg_temp.id('other')));
select pg_temp.call('remove_group_staff', 'api.remove_group_staff(uuid,uuid)', format('select api.remove_group_staff(%L, %L)', pg_temp.id('g'), pg_temp.id('other')));
select pg_temp.call('create_student', 'api.create_student(uuid,text,text,uuid)', format('select api.create_student(%L, ''Estudiante 5'', ''est.5'', gen_random_uuid())', pg_temp.id('g')));
insert into ids (k, id) select 's5', (res ->> 'id')::uuid from answers where name = 'create_student';
-- The operations that change a student run on one that has needs, a configuration and a version.
select pg_temp.call('update_student', 'api.update_student(uuid,integer,text,text)', format('select api.update_student(%L, 1, ''Estudiante Uno'', ''est.1'')', pg_temp.id('s1')));
select pg_temp.call('archive_student', 'api.archive_student(uuid,integer)', format('select api.archive_student(%L, 2)', pg_temp.id('s1')));
select pg_temp.call('restore_student', 'api.restore_student(uuid,integer)', format('select api.restore_student(%L, 3)', pg_temp.id('s1')));
select pg_temp.call('set_student_interface', 'api.set_student_interface(uuid,text,integer)', format('select api.set_student_interface(%L, ''gaze'', 1)', pg_temp.id('s5')));
select pg_temp.call('enroll_student', 'api.enroll_student(uuid,uuid)', format('select api.enroll_student(%L, %L)', pg_temp.id('gx'), pg_temp.id('s2')));
select pg_temp.call('unenroll_student', 'api.unenroll_student(uuid,uuid)', format('select api.unenroll_student(%L, %L)', pg_temp.id('gx'), pg_temp.id('s2')));
select pg_temp.call('list_my_groups', 'api.list_my_groups(uuid,boolean,integer,integer)', format('select api.list_my_groups(%L, true, 50, 0)', pg_temp.id('inst')));
select pg_temp.call('get_group', 'api.get_group(uuid)', format('select api.get_group(%L)', pg_temp.id('g')));
select pg_temp.call('list_group_students', 'api.list_group_students(uuid,boolean,integer,integer)', format('select api.list_group_students(%L, true, 50, 0)', pg_temp.id('g')));
-- set_student_needs is a write: what it answers is only the student and the revision.
select pg_temp.call('set_student_needs', 'api.set_student_needs(uuid,text[],text[],text[],uuid,integer,date)', format($$ select api.set_student_needs(%L, '{motor}', '{recordatorio}', '{centinela-otro}', gen_random_uuid(), 1, null) $$, pg_temp.id('s1')));
-- Notes and consents (T1.3b): their reads are audited and live below; their writes answer an id and a revision.
select pg_temp.call('create_student_note', 'api.create_student_note(uuid,text,uuid)', format('select api.create_student_note(%L, ''Observación de clase'', gen_random_uuid())', pg_temp.id('s1')));
insert into ids (k, id) select 'note', (res ->> 'id')::uuid from answers where name = 'create_student_note';
select pg_temp.call('update_student_note', 'api.update_student_note(uuid,integer,text)', format('select api.update_student_note(%L, 1, ''Observación corregida'')', pg_temp.id('note')));
select pg_temp.call('archive_student_note', 'api.archive_student_note(uuid,integer)', format('select api.archive_student_note(%L, 2)', pg_temp.id('note')));
select pg_temp.call('record_consent', 'api.record_consent(uuid,text,text,timestamptz,uuid)', format('select api.record_consent(%L, ''ai_adaptation'', ''2026-11'', null, null)', pg_temp.id('s1')));
insert into ids (k, id) select 'consent', (res ->> 'id')::uuid from answers where name = 'record_consent';
select pg_temp.call('revoke_consent', 'api.revoke_consent(uuid,integer)', format('select api.revoke_consent(%L, 1)', pg_temp.id('consent')));

-- Assessments and original exercises (T1.4a): not sensitive and not audited. The group already has an
-- assessment with two versions that carry a configuration and recipients: its summary says how many
-- versions there are and nothing else.
select pg_temp.call('create_assessment', 'api.create_assessment(uuid,text,text,text,uuid)', format('select api.create_assessment(%L, ''worksheet'', ''Repaso'', ''Resolvé todo.'', gen_random_uuid())', pg_temp.id('g')));
insert into ids (k, id) select 'aa', (res ->> 'id')::uuid from answers where name = 'create_assessment';
select pg_temp.call('add_exercise', 'api.add_exercise(uuid,text,text,uuid,uuid)', format('select api.add_exercise(%L, ''1'', ''Texto del primer ejercicio'', gen_random_uuid(), null)', pg_temp.id('aa')));
insert into ids (k, id) select 'ea', (res ->> 'id')::uuid from answers where name = 'add_exercise';
insert into ids (k, id) select 'eb', (pg_temp.as_user('teach', format('select api.add_exercise(%L, ''2'', ''Texto del segundo ejercicio'', gen_random_uuid(), null)', pg_temp.id('aa'))) ->> 'id')::uuid;
select pg_temp.call('update_exercise', 'api.update_exercise(uuid,integer,text,text,uuid)', format('select api.update_exercise(%L, 1, ''1'', ''Texto corregido'', null)', pg_temp.id('ea')));
select pg_temp.call('reorder_exercises', 'api.reorder_exercises(uuid,integer,uuid[])', format('select api.reorder_exercises(%L, 1, array[%L, %L]::uuid[])', pg_temp.id('aa'), pg_temp.id('eb'), pg_temp.id('ea')));
select pg_temp.call('update_assessment', 'api.update_assessment(uuid,integer,text,text,text)', format('select api.update_assessment(%L, 2, ''exam'', ''Repaso final'', ''Resolvé todo y justificá.'')', pg_temp.id('aa')));
select pg_temp.call('remove_exercise', 'api.remove_exercise(uuid,integer)', format('select api.remove_exercise(%L, 1)', pg_temp.id('eb')));
select pg_temp.call('list_assessments', 'api.list_assessments(uuid,boolean,integer,integer)', format('select api.list_assessments(%L, true, 50, 0)', pg_temp.id('g')));
select pg_temp.call('get_assessment', 'api.get_assessment(uuid)', format('select api.get_assessment(%L)', pg_temp.id('aa')));
-- Versions (T1.4b): the configuration and the recipients go in, and what comes out is only an id, a
-- revision and a position. The recipient of the new version joins the seeded pairs, so the detector also
-- looks for it. list_versions shows how many versions and exercises there are, never for whom. get_version
-- is an audited read (below).
select pg_temp.call('create_version', 'api.create_version(uuid,jsonb,text,uuid,uuid)', format($$ select api.create_version(%L, '{"profiles":["motor"],"supports":["recordatorio"],"interests":["centinela-nuevo"]}', 'gaze', gen_random_uuid(), null) $$, pg_temp.id('aa')));
insert into ids (k, id) select 'va', (res ->> 'id')::uuid from answers where name = 'create_version';
select pg_temp.call('set_version_recipients', 'api.set_version_recipients(uuid,integer,uuid[],uuid)', format('select api.set_version_recipients(%L, 1, array[%L]::uuid[], gen_random_uuid())', pg_temp.id('va'), pg_temp.id('s3')));
insert into pairs values (pg_temp.id('va')::text, pg_temp.id('s3')::text);
select pg_temp.call('update_version_config', 'api.update_version_config(uuid,integer,jsonb,text)', format($$ select api.update_version_config(%L, 2, '{"profiles":["dyslexia"],"supports":[],"interests":["centinela-otro"]}', 'typed') $$, pg_temp.id('va')));
select pg_temp.call('list_versions', 'api.list_versions(uuid)', format('select api.list_versions(%L)', pg_temp.id('aa')));
select pg_temp.call('archive_version', 'api.archive_version(uuid,integer)', format('select api.archive_version(%L, 3)', pg_temp.id('va')));
-- Content of a version and its approval (T1.4c): a version of its own with no recipients. Its question is written as
-- the owner (T1.4d makes them). What comes out of each is only ids and revisions, never the text, the options
-- or the correct option that went in.
insert into ids (k, id) select 'vb', (pg_temp.as_user('teach', format($$ select api.create_version(%L, '{"profiles":[],"supports":[],"interests":[]}', 'gaze', gen_random_uuid(), null) $$, pg_temp.id('aa'))) ->> 'id')::uuid;
insert into ids (k, id) select 'xb', ve.id from app.version_exercises ve where ve.version_id = pg_temp.id('vb');
insert into ids (k, id) values ('qb', gen_random_uuid());
insert into app.version_questions (id, institution_id, version_id, version_exercise_id, position, stem, options)
  select pg_temp.id('qb'), ve.institution_id, ve.version_id, ve.id, 0, 'Enunciado de la pregunta', '[{"id":"A","text":"Uno"},{"id":"B","text":"Dos"}]'::jsonb
    from app.version_exercises ve where ve.id = pg_temp.id('xb');
select pg_temp.call('update_version_exercise', 'api.update_version_exercise(uuid,integer,text,uuid)', format('select api.update_version_exercise(%L, 1, ''Texto adaptado'', gen_random_uuid())', pg_temp.id('xb')));
select pg_temp.call('update_version_instructions', 'api.update_version_instructions(uuid,integer,text,uuid)', format('select api.update_version_instructions(%L, 1, ''Instrucciones de la versión'', gen_random_uuid())', pg_temp.id('vb')));
select pg_temp.call('update_version_question', 'api.update_version_question(uuid,integer,text,jsonb,uuid)', format($$ select api.update_version_question(%L, 1, 'Otro enunciado', '[{"id":"A","text":"Uno"},{"id":"B","text":"Dos"}]', gen_random_uuid()) $$, pg_temp.id('qb')));
select pg_temp.call('set_question_key', 'api.set_question_key(uuid,text,integer)', format('select api.set_question_key(%L, ''B'', null)', pg_temp.id('qb')));
select pg_temp.call('approve_version', 'api.approve_version(uuid,integer,uuid)', format('select api.approve_version(%L, 5, gen_random_uuid())', pg_temp.id('vb')));
select pg_temp.call('reject_version', 'api.reject_version(uuid,integer,text[],uuid)', format('select api.reject_version(%L, 5, ''{no_adapta}'', gen_random_uuid())', pg_temp.id('vb')));
-- The answer key (T1.4e): the content of the key and the revisions of the snapshot are maps keyed by id; the keys
-- of everything else are literal. get_answer_key is not audited and carries no student, profile or recipient.
select pg_temp.call('edit_answer_key', 'api.edit_answer_key(uuid,jsonb,uuid)', format($$ select api.edit_answer_key(%L, jsonb_build_object('exercises', jsonb_build_object(%L, jsonb_build_object('answer', 'Respuesta 3', 'rubric', 'Criterio')), 'questions', jsonb_build_object(%L, 'B')), null) $$, pg_temp.id('vb'), pg_temp.id('xb'), pg_temp.id('qb')));
select pg_temp.call('confirm_answer_key', 'api.confirm_answer_key(uuid,uuid)', format('select api.confirm_answer_key(%L, %L)', pg_temp.id('vb'), (select res ->> 'revisionId' from answers where name = 'edit_answer_key')));
select pg_temp.call('approve_answer_key', 'api.approve_answer_key(uuid,uuid)', format('select api.approve_answer_key(%L, %L)', pg_temp.id('vb'), (select res ->> 'revisionId' from answers where name = 'confirm_answer_key')));
select pg_temp.call('get_answer_key', 'api.get_answer_key(uuid)', format('select api.get_answer_key(%L)', pg_temp.id('vb')));
-- Publishing (T1.5a): a version of its own with a recipient that has needs, approved and published. What comes out is the
-- id of the publication and the number of attempts; the copy is read below, and carries nothing of the configuration.
insert into ids (k, id) select 'vp', (pg_temp.as_user('teach', format($$ select api.create_version(%L, '{"profiles":["motor"],"supports":["recordatorio"],"interests":["centinela-publicado"]}', 'typed', gen_random_uuid(), null) $$, pg_temp.id('aa'))) ->> 'id')::uuid;
insert into ids (k, id) select 'xp', ve.id from app.version_exercises ve where ve.version_id = pg_temp.id('vp');
select pg_temp.as_user('teach', format('select api.update_version_exercise(%L, 1, ''Texto de la publicación'', gen_random_uuid())', pg_temp.id('xp')));
select pg_temp.as_user('teach', format('select api.set_version_recipients(%L, %s, array[%L]::uuid[], gen_random_uuid())', pg_temp.id('vp'), (select revision from app.versions where id = pg_temp.id('vp')), pg_temp.id('s2')));
insert into pairs values (pg_temp.id('vp')::text, pg_temp.id('s2')::text);
select pg_temp.as_user('teach', format('select api.approve_version(%L, %s, gen_random_uuid())', pg_temp.id('vp'), (select revision from app.versions where id = pg_temp.id('vp'))));
select pg_temp.call('publish_version', 'api.publish_version(uuid,integer,uuid,uuid)', format('select api.publish_version(%L, %s, gen_random_uuid(), null)', pg_temp.id('vp'), (select revision from app.versions where id = pg_temp.id('vp'))));
-- Grading (T1.5c): the recipient of that publication submitted (written as the owner: no student here has an account), and the
-- teacher lists the state of the group and grades. The list shows a name and a state and never which version each one got, and
-- the answer of grade_attempt is only the attempt and a revision. get_attempt_for_grading is an audited read (below).
insert into ids (k, id) select 'ts2', t.id from app.assignment_attempts t join app.assignments a on a.id = t.assignment_id
  where a.assessment_id = pg_temp.id('aa') and a.student_id = pg_temp.id('s2') and t.superseded_at is null;
update app.assignment_attempts set status = 'submitted', started_at = clock_timestamp(), submitted_at = clock_timestamp() where id = pg_temp.id('ts2');
insert into app.submissions (institution_id, attempt_id, answers, choices, submitted_at)
  values (pg_temp.id('inst'), pg_temp.id('ts2'), jsonb_build_object(pg_temp.id('xp')::text, jsonb_build_object('text', 'Respuesta de prueba', 'mode', 'typed')), '{}', clock_timestamp());
update app.assignments set status = 'submitted', revision = revision + 1 where id = (select assignment_id from app.assignment_attempts where id = pg_temp.id('ts2'));
select pg_temp.call('list_assessment_attempts', 'api.list_assessment_attempts(uuid)', format('select api.list_assessment_attempts(%L)', pg_temp.id('aa')));
select pg_temp.call('grade_attempt', 'api.grade_attempt(uuid,text,jsonb,integer,integer)',
  format('select api.grade_attempt(%L, ''Comentario de prueba'', %L::jsonb, 6, null)', pg_temp.id('ts2'),
         jsonb_build_object(pg_temp.id('xp')::text, jsonb_build_object('status', 'partial', 'errors', '["signo"]'::jsonb))::text));
select pg_temp.call('archive_assessment','api.archive_assessment(uuid,integer)', format('select api.archive_assessment(%L, 3)', pg_temp.id('aa')));

select is((select count(*) from answers where res ? 'error'), 0::bigint, 'every call worked: none answered an error (so each answer is a real one)');
select is((select string_agg(a.name, ',' order by a.name) from answers a where pg_temp.verdict(a.res, (select sp.spec from specs sp where sp.name = a.name)) <> ''), null::text,
  'no answer carries a profile, a support, an interest, a review date, an interface, a configuration, inputs or a recipient, and each one conforms to its keys');
select is((select count(*) from answers a join specs sp on sp.name = a.name), (select count(*) from answers), 'every answer has its spec of keys');
select is((select count(*) from answers), 50::bigint, 'fifty RPCs were called');
select is((select res -> 'current' -> 'content' -> 'questions' ->> pg_temp.id('qb')::text from answers where name = 'get_answer_key'), 'B',
  'the answer key read did carry the correct option and the exercise answer (so there was something to leak)');
select is(pg_temp.verdict((select res || '{"config": {}}'::jsonb from answers where name = 'get_answer_key'), (select spec from specs where name = 'get_answer_key')), 'key,shape',
  'control: a configuration smuggled into the answer key read is flagged');
select is(pg_temp.verdict(jsonb_set((select res from answers where name = 'list_assessment_attempts'), '{items,0}',
            ((select res from answers where name = 'list_assessment_attempts') -> 'items' -> 0) || jsonb_build_object('versionId', (select p.vid from pairs p where p.sid = pg_temp.id('s2')::text limit 1))),
          (select spec from specs where name = 'list_assessment_attempts')), 'shape,pair',
  'control: the version a student got, added to a row of the attempts list, is flagged (the row already holds the student that has it)');
select is(pg_temp.verdict((select jsonb_build_object('content', p.content, 'aids', p.aids, 'attempts', (select count(*) from app.assignment_attempts t where t.publication_id = p.id))
                             from app.publications p where p.id = (select (res ->> 'publicationId')::uuid from answers where name = 'publish_version')),
                           '{"content":{"generalInstructions":"s","exercises":[{"id":"s","label":"s","body":"s"}],"questions":[{"id":"s","exerciseId":"s","stem":"s","options":[{"id":"s","text":"s"}]}]},"aids":{"readAloud":"s"},"attempts":"s"}'::jsonb), '',
  'the copy a student receives carries no profile, support, interest, configuration, recipient or pair, and only the keys of its schema; a recipient with needs got its attempt');
select is(jsonb_array_length((select res -> 'items' from answers where name = 'list_group_students')), 4,
  'and the roster answer did list the students that have needs (so there was something to leak)');
select is((select string_agg(k, ',' order by k) from (select jsonb_object_keys(res -> 'items' -> 0) k from answers where name = 'list_group_students') t),
  'archivedAt,displayName,enrolledAt,hasAccount,id,revision,username', 'a roster entry has exactly the keys of its schema');
select is((select string_agg(k, ',' order by k) from (select jsonb_object_keys(res) k from answers where name = 'get_group') t),
  'archivedAt,id,institutionId,myRole,name,revision,schoolYear,staff,subjectId', 'and so does the group');
select is((select string_agg(k, ',' order by k) from (select jsonb_object_keys(res -> 'items' -> 0) k from answers where name = 'list_my_groups') t),
  'archivedAt,id,myRole,name,revision,schoolYear,studentCount,subjectId', 'and the list of groups');
select is((select string_agg(k, ',' order by k) from (select jsonb_object_keys(res) k from answers where name = 'set_student_needs') t),
  'revision,studentId', 'set_student_needs answers only the student and the revision');
select is((select s.revision || ':' || (select count(*) from app.student_needs n where n.student_id = s.id and n.profiles = '{motor}')
             from app.students s where s.id = pg_temp.id('s1')), '4:1', 'the student that was updated, archived and restored still has its needs and version (state of the run)');

-- The projections that other staff roles read, with the same seeded data.
create temp table answers_other (name text, who text, res jsonb not null);
insert into answers_other (name, who, res)
  select r.name, r.who, pg_temp.as_user(r.who, format(r.sql, pg_temp.id('inst'), pg_temp.id('g')))
    from (values
      ('list_my_groups', 'admin', 'select api.list_my_groups(%1$L, true, 50, 0)'),
      ('list_my_groups', 'incl', 'select api.list_my_groups(%1$L, true, 50, 0)'),
      ('get_group', 'admin', 'select api.get_group(%2$L)'),
      ('get_group', 'incl', 'select api.get_group(%2$L)'),
      ('list_group_students', 'admin', 'select api.list_group_students(%2$L, true, 50, 0)'),
      ('list_group_students', 'incl', 'select api.list_group_students(%2$L, true, 50, 0)'),
      ('list_my_institutions', 'incl', 'select api.list_my_institutions()')
    ) as r(name, who, sql);
select is((select count(*) from answers_other where res ? 'error'), 0::bigint, 'the admin and inclusion read the same projections without an error');
select is((select string_agg(a.who || ':' || a.name, ',' order by a.who, a.name) from answers_other a
            where pg_temp.verdict(a.res, (select sp.spec from specs sp where sp.name = a.name)) <> ''), null::text,
  'and none of their answers carries needs or conforms badly: not even inclusion, who may read them through the audited RPCs');

-- Negative controls: a mutated copy of a real answer for each kind of leak must fail the detector,
-- each under the flag that names it. Without these, a green result would prove nothing.
create temp table base_answers as
  select a.name, a.res, (select sp.spec from specs sp where sp.name = a.name) as spec
    from answers a where a.name in ('list_group_students', 'get_group', 'set_student_needs');
create function pg_temp.base(p_name text) returns jsonb language sql as $$ select res from base_answers where name = p_name $$;
create function pg_temp.spec(p_name text) returns jsonb language sql as $$ select spec from base_answers where name = p_name $$;
create function pg_temp.item(p_extra jsonb) returns jsonb language sql as $$
  select jsonb_set(pg_temp.base('list_group_students'), '{items,0}', (pg_temp.base('list_group_students') -> 'items' -> 0) || p_extra)
$$;
select is(pg_temp.verdict(pg_temp.base('list_group_students'), pg_temp.spec('list_group_students')), '', 'control: the real roster is clean for the verdict');
select ok(pg_temp.verdict(pg_temp.item('{"profiles": ["adhd"]}'), pg_temp.spec('list_group_students')) like 'key,catalogue%shape%', 'a leaked profile list in an item fails (key, catalogue, shape)');
select ok(pg_temp.verdict(pg_temp.item('{"x": "preguntas_guia"}'), pg_temp.spec('list_group_students')) like '%catalogue%shape%', 'a catalogue value under an unknown key fails');
select ok(pg_temp.verdict(pg_temp.item('{"note": "centinela-ajedrez"}'), pg_temp.spec('list_group_students')) like '%interest%shape%', 'an interest under an unknown key fails');
select ok(pg_temp.verdict(pg_temp.item('{"due": "2027-05-01"}'), pg_temp.spec('list_group_students')) like '%date%shape%', 'a review date under an unknown key fails');
select ok(pg_temp.verdict(pg_temp.item('{"ui": "gaze"}'), pg_temp.spec('list_group_students')) like '%catalogue%shape%', 'an interface value under an unknown key fails');
select ok(pg_temp.verdict(pg_temp.item('{"settings": {"note": "centinela-config"}}'), pg_temp.spec('list_group_students')) like '%interest%shape%', 'the configuration of a version under an unknown key fails');
select ok(pg_temp.verdict(pg_temp.item('{"gen": {"note": "centinela-inputs"}}'), pg_temp.spec('list_group_students')) like '%interest%shape%', 'the inputs of a generation under an unknown key fails');
select ok(pg_temp.verdict(pg_temp.item('{"inputs": {}}'), pg_temp.spec('list_group_students')) like 'key%shape%', 'an inputs key fails even when empty');
select ok(pg_temp.verdict(pg_temp.base('set_student_needs') || '{"profiles": []}', pg_temp.spec('set_student_needs')) like 'key%shape%', 'a write that adds a profiles key fails');
select ok(pg_temp.verdict(pg_temp.base('get_group') || '{"version_recipients": []}', pg_temp.spec('get_group')) = 'shape', 'an unknown key with a harmless value fails the shape alone: that is what the literal keys catch');
select ok(pg_temp.verdict(jsonb_set(pg_temp.base('get_group'), '{staff,0,extra}', '"x"'), pg_temp.spec('get_group')) = 'shape', 'and an unknown key two levels down');
-- The (version, student) pair, under different keys and shapes: the keys are unknown, so the shape fails too, but the pair flag must be there.
create function pg_temp.vs() returns jsonb language sql as $$
  select jsonb_build_object('v', p.vid, 's', p.sid) from pairs p order by p.vid limit 1
$$;
select ok(pg_temp.pair_leak(jsonb_build_object('version_recipients', jsonb_build_array(jsonb_build_object('version_id', (select vid from pairs order by vid limit 1), 'student_id', (select sid from pairs order by vid limit 1))))),
  'a pair as version_id and student_id in an object is found');
select ok(pg_temp.pair_leak(jsonb_build_object('a', jsonb_build_object('b', jsonb_build_array(pg_temp.vs())))), 'a pair under other keys and nesting is found');
select ok(pg_temp.pair_leak(jsonb_build_object('pairs', jsonb_build_array(jsonb_build_array((select vid from pairs order by vid limit 1), (select sid from pairs order by vid limit 1))))), 'a pair as an array of two ids is found');
select ok(pg_temp.pair_leak(jsonb_build_object('x', (select sid from pairs order by vid limit 1), 'y', (select vid from pairs order by vid limit 1))), 'and as two plain keys');
select ok(pg_temp.verdict(pg_temp.item(jsonb_build_object('k', pg_temp.vs())), pg_temp.spec('list_group_students')) like '%shape%pair', 'on a real answer the pair fails the verdict with the pair flag');
select is(pg_temp.pair_leak(pg_temp.base('list_group_students')), false, 'while a real roster, full of student ids, has no pair: one id alone is not a pair');
select is(pg_temp.pair_leak(jsonb_build_object('s', (select sid from pairs order by vid limit 1))), false, 'nor a student id alone');
-- The shape check itself: a scalar where an object is expected, an object where a scalar is.
select is(pg_temp.conforms('{"items": 3}'::jsonb, '{"items": [{"id": "s"}]}'::jsonb), false, 'conforms: a scalar where a list goes fails');
select is(pg_temp.conforms('{"id": {"a": 1}}'::jsonb, '{"id": "s"}'::jsonb), false, 'conforms: an object where a scalar goes fails');
select is(pg_temp.conforms('{"id": null, "items": []}'::jsonb, '{"id": "s", "items": [{"id": "s"}]}'::jsonb), true, 'conforms: nulls and empty lists are fine');

-- Nothing the calls above did wrote an audit row: only the audited reads do.
select is((select count(*) from app.audit_log a where a.institution_id = pg_temp.id('inst')), 1::bigint,
  'the only audit row is the control read of get_student_needs: the non-audited RPCs disclose nothing, so they log nothing');

-- Coverage, by full signature: an RPC an authenticated user can run must have been called above or be
-- an audited read. A new overload of an RPC that is already here is not covered by the old call.
create temp table audited (sig text primary key);
insert into audited (sig) values
  ('api.get_student_needs(uuid[])'::regprocedure::text), ('api.get_group_needs(uuid)'::regprocedure::text),
  ('api.list_student_need_events(uuid,integer,integer)'::regprocedure::text),
  ('api.list_student_notes(uuid)'::regprocedure::text), ('api.list_student_consents(uuid)'::regprocedure::text),
  ('api.get_version(uuid)'::regprocedure::text), ('api.get_attempt_for_grading(uuid)'::regprocedure::text);
select is((select string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text)
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'api' and has_function_privilege('authenticated', p.oid, 'execute')
              and p.proname not like 'student\_%'
              and p.oid::regprocedure::text not in (select a.sig from answers a)
              and p.oid::regprocedure::text not in (select au.sig from audited au)), null::text,
  'every RPC an authenticated user can run, by full signature, is either called here or one of the audited reads: add the call of the ticket that adds a new one');
-- And the guard itself: it flags an overload that nobody called (the control creates one, as the owner, and grants it).
create function api.list_my_institutions(p_extra integer) returns jsonb language sql security definer set search_path = '' as $$ select '{}'::jsonb $$;
grant execute on function api.list_my_institutions(integer) to authenticated;
select is((select string_agg(p.oid::regprocedure::text, ',')
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'api' and has_function_privilege('authenticated', p.oid, 'execute')
              and p.proname not like 'student\_%'
              and p.oid::regprocedure::text not in (select a.sig from answers a)
              and p.oid::regprocedure::text not in (select au.sig from audited au)), 'api.list_my_institutions(integer)',
  'control: a new overload of a covered RPC is flagged, even though its name was called');

select * from finish();
rollback;
