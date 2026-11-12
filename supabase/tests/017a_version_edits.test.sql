-- T1.4c, part a: editing the content of a version through the RPCs, as a teacher would call them:
-- update_version_instructions, update_version_exercise, update_version_question and set_question_key.
-- Approval, state (archived) and the permission matrix are in 017b. Questions, answer keys and
-- generations are seeded as the owner (T1.4d and T1.4e write them). Guards are tried as the owner of the
-- table, expecting P0004: as authenticated the UPDATE would fail first on privileges (42501) and the test
-- would pass without the guard. The whole file is rolled back.
begin;
select plan(139);

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
create function pg_temp.keys(p_obj jsonb) returns text language sql
  as $$ select string_agg(k, ',' order by k) from jsonb_object_keys(p_obj) k $$;
create function pg_temp.keep(p_key text, p_res jsonb) returns jsonb language plpgsql as $$
begin
  insert into ids (k, id) values (p_key, (p_res ->> 'id')::uuid);
  return p_res;
end $$;

insert into ids (k, id) select k, gen_random_uuid() from unnest(array['teach', 'co']) as k;
insert into auth.users (id, email) select id, k || '@t1-4c-a.invalid' from ids;
do $$
declare
  k text;
begin
  for k in select ids.k from ids loop
    perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;

-- teach teaches g_n and co is its co-teacher.
insert into ids (k, id) select 'i_n', (pg_temp.as_service($$ select api.internal_create_institution('Liceo N', 't1-4c-a', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, %L)', pg_temp.id('i_n'), pg_temp.id(u.k), 'teacher')) from (values ('teach'), ('co')) as u(k);
insert into ids (k, id) values
  ('g_n', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid);
select pg_temp.as_user('teach', format('select api.add_group_staff(%L, %L, ''co_teacher'')', pg_temp.id('g_n'), pg_temp.id('co')));

create function pg_temp.mk_asm(p_user text, p_group text, p_key text, p_instr text default '') returns void language plpgsql as $$
begin
  perform pg_temp.keep(p_key, pg_temp.as_user(p_user, format('select api.create_assessment(%L, ''worksheet'', ''Repaso'', %L, gen_random_uuid())', pg_temp.id(p_group), p_instr)));
end $$;
create function pg_temp.mk_ex(p_user text, p_asm text, p_key text, p_body text) returns void language plpgsql as $$
begin
  perform pg_temp.keep(p_key, pg_temp.as_user(p_user, format('select api.add_exercise(%L, %L, %L, gen_random_uuid(), null)', pg_temp.id(p_asm), right(p_key, 1), p_body)));
end $$;
select pg_temp.mk_asm('teach', 'g_n', 'a1', 'Elegí dos ejercicios.');
select pg_temp.mk_ex('teach', 'a1', 'e1', 'Enunciado 1');
select pg_temp.mk_ex('teach', 'a1', 'e2', 'Enunciado 2');
select pg_temp.mk_ex('teach', 'a1', 'e3', 'Enunciado 3');

-- Three versions, one per area of the file, so that every count of revisions starts from 1: vi (the
-- instructions), vx (the exercises) and vq (the questions and keys). The adapted exercises are xi1.., xx1.. and xq1..
create function pg_temp.cv(p_key text) returns void language plpgsql as $$
begin
  perform pg_temp.keep(p_key, pg_temp.as_user('teach', format($q$ select api.create_version(%L, '{"profiles":["motor"],"supports":[],"interests":[]}'::jsonb, 'gaze', gen_random_uuid(), null) $q$, pg_temp.id('a1'))));
  insert into ids (k, id) select 'x' || substr(p_key, 2, 1) || row_number() over (order by e.position), ve.id
    from app.version_exercises ve join app.assessment_exercises e on e.id = ve.exercise_id where ve.version_id = pg_temp.id(p_key);
end $$;
select pg_temp.cv('vi');
select pg_temp.cv('vx');
select pg_temp.cv('vq');
insert into ids (k, id) select k, gen_random_uuid() from unnest(array['q1', 'q2', 'q3']) as k;
insert into ids (k, id) select 'op' || n, gen_random_uuid() from generate_series(1, 80) n;
create function pg_temp.op(p_n integer) returns text language sql as $$ select quote_literal(pg_temp.id('op' || p_n)) $$;
-- Questions written as the owner: q1 and q2 in xq1, q3 in xq2.
insert into app.version_questions (id, institution_id, version_id, version_exercise_id, position, stem, options)
  select pg_temp.id(q.k), ve.institution_id, ve.version_id, ve.id, q.pos, q.stem, q.options::jsonb
    from (values ('q1', 'xq1', 0, '¿Cuánto es 2 + 2?', '[{"id":"A","text":"3"},{"id":"B","text":"4"},{"id":"C","text":"5"}]'),
                 ('q2', 'xq1', 1, '¿Cuánto es 3 + 3?', '[{"id":"A","text":"6"},{"id":"B","text":"7"}]'),
                 ('q3', 'xq2', 0, '¿Cuánto es 1 + 1?', '[{"id":"A","text":"1"},{"id":"B","text":"2"},{"id":"C","text":"3"},{"id":"D","text":"4"}]')) as q(k, x, pos, stem, options)
    join app.version_exercises ve on ve.id = pg_temp.id(q.x);
-- An answer key row for each version: an edit marks it stale.
insert into app.answer_keys (institution_id, version_id) select v.institution_id, v.id from app.versions v where v.institution_id = pg_temp.id('i_n');
-- One generation per version, running and in force, that wrote the instructions and the first exercise.
insert into ids (k, id) select 'gen_' || k, gen_random_uuid() from unnest(array['vi', 'vx', 'vq']) as k;
insert into app.generations (id, institution_id, version_id, kind, target_revision, op_key, subject_id, inputs, profiles_hash, profiles_revision, prompt_version, required_jobs)
  select pg_temp.id('gen_' || k), pg_temp.id('i_n'), pg_temp.id(k), 'version', 1, gen_random_uuid(), 'math', '{}', repeat('a', 64), 'r1', 'p1', 1 from unnest(array['vi', 'vx', 'vq']) as k;
update app.versions v set current_generation_id = pg_temp.id('gen_' || k), instructions_written_by = pg_temp.id('gen_' || k)
  from unnest(array['vi', 'vx', 'vq']) as k where v.id = pg_temp.id(k);
update app.version_exercises set current_generation_id = pg_temp.id('gen_vx'), written_by_generation_id = pg_temp.id('gen_vx'), status = 'generating' where id = pg_temp.id('xx2');
update app.version_exercises set written_by_generation_id = pg_temp.id('gen_vq') where id = pg_temp.id('xq1');

-- The calls under test. Revisions and op ids are SQL; options are JSON text.
create function pg_temp.uvi(p_user text, p_ver text, p_rev text, p_text text, p_op text default 'gen_random_uuid()') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.update_version_instructions(%L, %s, %L, %s)', pg_temp.id(p_ver), p_rev, p_text, p_op))
$$;
create function pg_temp.uve(p_user text, p_x text, p_rev text, p_body text, p_op text default 'gen_random_uuid()') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.update_version_exercise(%L, %s, %L, %s)', pg_temp.id(p_x), p_rev, p_body, p_op))
$$;
create function pg_temp.uvq(p_user text, p_q text, p_rev text, p_stem text, p_options text, p_op text default 'gen_random_uuid()') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.update_version_question(%L, %s, %L, %L::jsonb, %s)', pg_temp.id(p_q), p_rev, p_stem, p_options, p_op))
$$;
create function pg_temp.sqk(p_user text, p_q text, p_opt text, p_rev text default 'null') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.set_question_key(%L, %L, %s)', pg_temp.id(p_q), p_opt, p_rev))
$$;
create function pg_temp.opts(variadic p_ids text[]) returns text language sql as $$
  select '[' || string_agg(format('{"id":"%s","text":"Opción %s"}', i, i), ',' order by n) || ']' from unnest(p_ids) with ordinality as t(i, n)
$$;
create function pg_temp.gv(p_ver text) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format('select api.get_version(%L)', pg_temp.id(p_ver)))
$$;

-- Everything these RPCs can change, as one string.
create function pg_temp.digest() returns text language sql as $$
  select md5(coalesce((select string_agg(concat_ws('|', v.id, v.revision, v.instructions_revision, v.general_instructions, v.instructions_written_by, v.approved_revision, v.status, v.stale, v.current_generation_id), ';' order by v.id)
                         from app.versions v where v.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', ve.id, ve.revision, ve.body, ve.status, ve.error_code, ve.written_by_generation_id, ve.current_generation_id), ';' order by ve.id)
                         from app.version_exercises ve where ve.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', q.id, q.revision, q.stem, q.options::text), ';' order by q.id)
                         from app.version_questions q where q.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', k.question_id, k.correct_option_id, k.revision), ';' order by k.question_id)
                         from app.question_keys k where k.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', a.id, a.stale), ';' order by a.id) from app.answer_keys a where a.institution_id = pg_temp.id('i_n')), '')
          || (select count(*) from app.version_events e where e.institution_id = pg_temp.id('i_n'))::text
          || (select count(*) from app.audit_log a where a.institution_id = pg_temp.id('i_n'))::text)
$$;
create temp table before_val (n serial, d text);
create function pg_temp.mark() returns void language sql as $$ insert into before_val (d) select pg_temp.digest() $$;
create function pg_temp.unchanged() returns boolean language sql as $$
  select (select d from before_val order by n desc limit 1) = pg_temp.digest()
$$;
-- The revisions of a question, its adapted exercise and its version, as a snapshot and as a difference.
create temp table snap (n serial, q integer, x integer, v integer);
create function pg_temp.take(p_q text) returns void language sql as $$
  insert into snap (q, x, v) select q.revision, ve.revision, v.revision
    from app.version_questions q join app.version_exercises ve on ve.id = q.version_exercise_id join app.versions v on v.id = q.version_id where q.id = pg_temp.id(p_q)
$$;
create function pg_temp.delta(p_q text) returns text language sql as $$
  select concat_ws(',', q.revision - s.q, ve.revision - s.x, v.revision - s.v)
    from app.version_questions q join app.version_exercises ve on ve.id = q.version_exercise_id join app.versions v on v.id = q.version_id,
         (select * from snap order by n desc limit 1) s where q.id = pg_temp.id(p_q)
$$;

-- ---------------------------------------------------------------------------------------------
-- update_version_instructions (on vi)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.keys(pg_temp.uvi('teach', 'vi', '1', 'Resolvé dos y justificá.', pg_temp.op(1))), 'id,instructionsRevision,versionRevision',
  'a teacher edits the instructions of a version: the answer is its id and the two revisions that moved');
select is(pg_temp.uvi('teach', 'vi', '1', 'Resolvé dos y justificá.', pg_temp.op(1)), jsonb_build_object('id', pg_temp.id('vi'), 'instructionsRevision', 2, 'versionRevision', 2),
  'instructions_revision went 1 -> 2 and the revision of the version 1 -> 2 (the same op_id answers it again, even with the old revision)');
select is((select concat_ws('|', v.general_instructions, v.instructions_revision, v.revision, v.instructions_written_by is null) from app.versions v where v.id = pg_temp.id('vi')),
  'Resolvé dos y justificá.|2|2|t', 'the text is stored and the provenance is null: a person wrote this revision, so the generation in force no longer owns it');
select is((select a.general_instructions from app.assessments a where a.id = pg_temp.id('a1')), 'Elegí dos ejercicios.', 'the instructions of the assessment are not touched');
select is((select a.stale from app.answer_keys a where a.version_id = pg_temp.id('vi')), true, 'the answer key of the version is stale');
select is((select a.stale from app.answer_keys a where a.version_id = pg_temp.id('vx')), false, 'and the key of another version is not');
select is((select concat_ws('|', e.kind, e.operation, e.target_id = pg_temp.id('vi'), e.version_revision, e.version_exercise_id is null, e.exercise_revision is null,
                              e.actor_user_id = pg_temp.id('teach'), e.data = jsonb_build_object('instructions', 'Resolvé dos y justificá.'),
                              e.result = jsonb_build_object('id', pg_temp.id('vi'), 'instructionsRevision', 2, 'versionRevision', 2))
             from app.version_events e where e.op_id = pg_temp.id('op1')),
  'edited|update_version_instructions|t|2|t|t|t|t|t', 'one edited event: the RPC, its target, the revision it produced, who edited, what was written and the answer given');
select is((select count(*) from app.version_events e where e.version_id = pg_temp.id('vi')), 1::bigint, 'and only one, however many times it was asked');
select pg_temp.mark();
select is(pg_temp.uvi('teach', 'vi', '2', 'Otro texto', pg_temp.op(1)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'the same op_id with another text is CONFLICT op_key_reused');
select is(pg_temp.uvi('teach', 'vx', '1', 'Resolvé dos y justificá.', pg_temp.op(1)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'on another version too (another target)');
select is(pg_temp.uve('teach', 'xi1', '1', 'Texto', pg_temp.op(1)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'and used by another RPC (another operation)');
select is(pg_temp.uvi('teach', 'vi', '1', 'Nuevo', pg_temp.op(2)) ->> 'error', 'P0001 CONFLICT revision_mismatch', 'an old instructions revision is CONFLICT revision_mismatch');
select is(pg_temp.uvi('teach', 'vi', '1', 'Nuevo', pg_temp.op(1)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'and the replay is decided before the revision: an old revision with another text is a reuse');
select is(pg_temp.uvi('teach', 'vi', 'null', 'Nuevo', pg_temp.op(2)) ->> 'error', 'P0001 INVALID revision_required', 'a missing revision is INVALID revision_required');
select is(pg_temp.uvi('teach', 'vi', '2', 'Nuevo', 'null') ->> 'error', 'P0001 INVALID invalid_op_key', 'a missing op_id is INVALID invalid_op_key');
select is(pg_temp.as_user('teach', format('select api.update_version_instructions(%L, 2, null, gen_random_uuid())', pg_temp.id('vi'))) ->> 'error', 'P0001 INVALID invalid_instructions', 'null instructions are INVALID invalid_instructions');
select is(pg_temp.uvi('teach', 'vi', '2', repeat('i', 5001)) ->> 'error', 'P0001 INVALID invalid_instructions', 'and 5001 characters too');
select is(pg_temp.as_user('teach', format('select api.update_version_instructions(null, 2, ''x'', gen_random_uuid())')) ->> 'error', 'P0001 NOT_FOUND not_found', 'a null version is NOT_FOUND');
select is(pg_temp.as_user('teach', format('select api.update_version_instructions(%L, 2, ''x'', gen_random_uuid())', gen_random_uuid())) ->> 'error', 'P0001 NOT_FOUND not_found', 'one that does not exist too');
select ok(pg_temp.unchanged(), 'and no refusal changed anything: no revision, no text, no event');
select is(pg_temp.uvi('teach', 'vi', '2', repeat('i', 5000)) ->> 'instructionsRevision', '3', '5000 characters are fine');
select is(pg_temp.uvi('teach', 'vi', '3', '') ->> 'instructionsRevision', '4', 'and so is an empty text: the version simply has no instructions');
select is(pg_temp.uvi('co', 'vi', '4', E'Con salto\nde línea') ->> 'versionRevision', '5', 'a co-teacher edits too: the revision of the version is the number of edits plus one');
select is((select count(*) from app.version_events e where e.version_id = pg_temp.id('vi') and e.actor_user_id = pg_temp.id('co')), 1::bigint, 'and the event names them');
select is((select v.general_instructions from app.versions v where v.id = pg_temp.id('vi')), E'Con salto\nde línea', 'the text is stored as it came: not trimmed or normalized');

-- ---------------------------------------------------------------------------------------------
-- update_version_exercise (on vx)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.keys(pg_temp.uve('teach', 'xx1', '1', 'Enunciado adaptado 1', pg_temp.op(10))), 'id,revision,versionRevision',
  'a teacher edits an adapted exercise: the answer is its id, its revision and the version''s');
select is(pg_temp.uve('teach', 'xx1', '1', 'Enunciado adaptado 1', pg_temp.op(10)), jsonb_build_object('id', pg_temp.id('xx1'), 'revision', 2, 'versionRevision', 2), 'both went 1 -> 2');
select is((select concat_ws('|', ve.body, ve.status, ve.revision, ve.written_by_generation_id is null, ve.error_code is null) from app.version_exercises ve where ve.id = pg_temp.id('xx1')),
  'Enunciado adaptado 1|ready|2|t|t', 'with text it is ready, from a person (no generation) and without error');
select is((select v.status from app.versions v where v.id = pg_temp.id('vx')), 'generating', 'the status of the version is recalculated: a generation is still running');
select is((select a.stale from app.answer_keys a where a.version_id = pg_temp.id('vx')), true, 'the answer key of the version is stale');
select is((select concat_ws('|', e.kind, e.operation, e.target_id = pg_temp.id('xx1'), e.version_exercise_id = pg_temp.id('xx1'), e.version_revision, e.exercise_revision,
                              e.actor_user_id = pg_temp.id('teach'), e.data = jsonb_build_object('body', 'Enunciado adaptado 1'),
                              e.result = jsonb_build_object('id', pg_temp.id('xx1'), 'revision', 2, 'versionRevision', 2))
             from app.version_events e where e.op_id = pg_temp.id('op10')), 'edited|update_version_exercise|t|t|2|2|t|t|t',
  'one edited event with the exercise, both revisions, the text and the answer');
select is((select count(*) from app.version_events e where e.version_exercise_id = pg_temp.id('xx1')), 1::bigint, 'and only one, however many times it was asked');
select pg_temp.mark();
select is(pg_temp.uve('teach', 'xx1', '1', 'Enunciado adaptado 1', pg_temp.op(10)) ->> 'revision', '2', 'the same op_id answers the stored result even with the old revision');
select is(pg_temp.uve('teach', 'xx1', '2', 'Otro texto', pg_temp.op(10)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'the same op_id with another text is CONFLICT op_key_reused');
select is(pg_temp.uve('teach', 'xx3', '1', 'Enunciado adaptado 1', pg_temp.op(10)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'on another exercise of the same version too: the target is the exercise');
select is(pg_temp.uvi('teach', 'vx', '1', 'Enunciado adaptado 1', pg_temp.op(10)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'and used by another RPC on the same version');
select is(pg_temp.uve('teach', 'xx1', '1', 'Nuevo', pg_temp.op(11)) ->> 'error', 'P0001 CONFLICT revision_mismatch', 'an old revision is CONFLICT revision_mismatch');
select is(pg_temp.uve('teach', 'xx1', 'null', 'Nuevo', pg_temp.op(11)) ->> 'error', 'P0001 INVALID revision_required', 'a missing one is INVALID revision_required');
select is(pg_temp.uve('teach', 'xx1', '2', 'Nuevo', 'null') ->> 'error', 'P0001 INVALID invalid_op_key', 'a missing op_id is INVALID invalid_op_key');
select is(pg_temp.as_user('teach', format('select api.update_version_exercise(%L, 2, null, gen_random_uuid())', pg_temp.id('xx1'))) ->> 'error', 'P0001 INVALID invalid_body', 'a null text is INVALID invalid_body');
select is(pg_temp.uve('teach', 'xx1', '2', repeat('b', 20001)) ->> 'error', 'P0001 INVALID invalid_body', 'and 20001 characters too');
select is(pg_temp.as_user('teach', 'select api.update_version_exercise(null, 2, ''x'', gen_random_uuid())') ->> 'error', 'P0001 NOT_FOUND not_found', 'a null exercise is NOT_FOUND');
select is(pg_temp.as_user('teach', format('select api.update_version_exercise(%L, 2, ''x'', gen_random_uuid())', pg_temp.id('e1'))) ->> 'error', 'P0001 NOT_FOUND not_found', 'and so is the id of the original exercise (it is not an adapted one)');
select ok(pg_temp.unchanged(), 'and no refusal changed anything');
select is(pg_temp.uve('teach', 'xx1', '2', '') ->> 'revision', '3', 'an empty text is fine');
select is((select concat_ws('|', ve.status, ve.body) from app.version_exercises ve where ve.id = pg_temp.id('xx1')), 'pending|', 'and the exercise goes back to pending');
select is(pg_temp.uve('teach', 'xx1', '3', E' \t\n ') ->> 'revision', '4', 'a text of only whitespace too');
select is((select ve.status from app.version_exercises ve where ve.id = pg_temp.id('xx1')), 'pending', 'pending: there is nothing to show');
select is((select concat_ws('|', ve.status, ve.written_by_generation_id is null, ve.current_generation_id = pg_temp.id('gen_vx'))
             from app.version_exercises ve where ve.id = pg_temp.id('xx2')), 'generating|f|t', 'control: xx2 was generating and written by the running generation');
select is(pg_temp.uve('teach', 'xx2', '1', 'Texto de la persona') ->> 'revision', '2', 'a person edits it');
select is((select concat_ws('|', ve.status, ve.written_by_generation_id is null, ve.current_generation_id = pg_temp.id('gen_vx'))
             from app.version_exercises ve where ve.id = pg_temp.id('xx2')), 'ready|t|t',
  'it is ready and written by nobody: no output of that generation applies over it (the provenance is null; the person always wins)');
update app.version_exercises set status = 'error', error_code = 'model_error' where id = pg_temp.id('xx3');
select is(pg_temp.uve('teach', 'xx3', '1', 'Texto para el que falló') ->> 'revision', '2', 'an exercise in error is edited');
select is((select concat_ws('|', ve.status, ve.error_code is null) from app.version_exercises ve where ve.id = pg_temp.id('xx3')), 'ready|t', 'it is ready and the error is gone');
select is((select v.status from app.versions v where v.id = pg_temp.id('vx')), 'generating', 'the version is still generating while its generation runs, even with two exercises ready');
update app.generations set status = 'cancelled', finished_at = clock_timestamp() where id = pg_temp.id('gen_vx');
select is(pg_temp.uve('teach', 'xx1', '4', 'Texto 1') ->> 'revision', '5', 'the generation is over and the last exercise is written by hand');
select is((select v.status from app.versions v where v.id = pg_temp.id('vx')), 'ready', 'every exercise is ready with text: the version is ready');
select is(pg_temp.uve('teach', 'xx1', '5', repeat('b', 20000)) ->> 'revision', '6', '20000 characters are fine');

-- ---------------------------------------------------------------------------------------------
-- update_version_question (on vq): q1 and q2 are in xq1, q3 in xq2
-- ---------------------------------------------------------------------------------------------
select pg_temp.take('q1');
select is(pg_temp.keys(pg_temp.uvq('teach', 'q1', '1', '¿Cuánto es 2 + 2? (editada)', pg_temp.opts('A', 'B', 'C'), pg_temp.op(20))), 'id,revision,versionRevision',
  'a teacher edits a question: the answer is its id, its revision and the version''s');
select is(pg_temp.uvq('teach', 'q1', '1', '¿Cuánto es 2 + 2? (editada)', pg_temp.opts('A', 'B', 'C'), pg_temp.op(20)),
  jsonb_build_object('id', pg_temp.id('q1'), 'revision', 2, 'versionRevision', 2), 'the question and the version went 1 -> 2 (the same op_id answers it again)');
select is(pg_temp.delta('q1'), '1,1,1', 'the question, its adapted exercise and the version each moved by one');
select is((select concat_ws('|', q.stem, q.options = pg_temp.opts('A', 'B', 'C')::jsonb) from app.version_questions q where q.id = pg_temp.id('q1')), '¿Cuánto es 2 + 2? (editada)|t', 'the stem and the options are stored');
select is((select ve.written_by_generation_id is null from app.version_exercises ve where ve.id = pg_temp.id('xq1')), true, 'the adapted exercise is now written by a person, not by the generation (null provenance)');
select is((select string_agg(q.id::text || ':' || q.revision, ',' order by q.id) from app.version_questions q where q.id in (pg_temp.id('q2'), pg_temp.id('q3')))
          = (select string_agg(i.id::text || ':1', ',' order by i.id) from ids i where i.k in ('q2', 'q3')), true, 'the other questions did not move');
select is((select ve.revision from app.version_exercises ve where ve.id = pg_temp.id('xq2')), 1, 'nor did the other adapted exercise');
select is((select a.stale from app.answer_keys a where a.version_id = pg_temp.id('vq')), true, 'the answer key is stale');
select is((select concat_ws('|', e.kind, e.operation, e.target_id = pg_temp.id('q1'), e.version_exercise_id = pg_temp.id('xq1'), e.version_revision, e.exercise_revision,
                              e.data = jsonb_build_object('stem', '¿Cuánto es 2 + 2? (editada)', 'options', pg_temp.opts('A', 'B', 'C')::jsonb))
             from app.version_events e where e.op_id = pg_temp.id('op20')), 'edited|update_version_question|t|t|2|2|t', 'one edited event with the question, its exercise, the revisions and what was written');
-- Swapping the options keeps the ids and changes the revision all the same.
select pg_temp.take('q1');
select is(pg_temp.uvq('teach', 'q1', '2', '¿Cuánto es 2 + 2? (editada)', '[{"id":"A","text":"Opción B"},{"id":"B","text":"Opción A"},{"id":"C","text":"Opción C"}]') ->> 'revision', '3',
  'swapping the texts of A and B, with the same ids, is an edit: the revision moves');
select is(pg_temp.delta('q1'), '1,1,1', 'and moves the exercise and the version too');
select pg_temp.mark();
select is(pg_temp.uvq('teach', 'q1', '2', '¿Cuánto es 2 + 2? (editada)', pg_temp.opts('A', 'B', 'C'), pg_temp.op(20)) ->> 'revision', '2', 'the same op_id answers the stored result even with an old revision');
select is(pg_temp.uvq('teach', 'q1', '3', 'Otro enunciado', pg_temp.opts('A', 'B', 'C'), pg_temp.op(20)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'the same op_id with another stem is CONFLICT op_key_reused');
select is(pg_temp.uvq('teach', 'q1', '3', '¿Cuánto es 2 + 2? (editada)', pg_temp.opts('A', 'B'), pg_temp.op(20)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'with other options too');
select is(pg_temp.uvq('teach', 'q2', '1', '¿Cuánto es 2 + 2? (editada)', pg_temp.opts('A', 'B', 'C'), pg_temp.op(20)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'on another question of the same exercise too');
select is(pg_temp.uve('teach', 'xq1', '3', 'Texto', pg_temp.op(20)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'and on the exercise of the question');
select is(pg_temp.uvq('teach', 'q1', '2', 'Nuevo', pg_temp.opts('A', 'B', 'C'), pg_temp.op(21)) ->> 'error', 'P0001 CONFLICT revision_mismatch', 'an old revision is CONFLICT revision_mismatch');
select is(pg_temp.uvq('teach', 'q1', 'null', 'Nuevo', pg_temp.opts('A', 'B', 'C'), pg_temp.op(21)) ->> 'error', 'P0001 INVALID revision_required', 'a missing one is INVALID revision_required');
select is(pg_temp.uvq('teach', 'q1', '3', 'Nuevo', pg_temp.opts('A', 'B', 'C'), 'null') ->> 'error', 'P0001 INVALID invalid_op_key', 'a missing op_id is INVALID invalid_op_key');
select is(pg_temp.uvq('teach', 'q1', '3', '', pg_temp.opts('A', 'B', 'C')) ->> 'error', 'P0001 INVALID invalid_stem', 'an empty stem is INVALID invalid_stem');
select is(pg_temp.uvq('teach', 'q1', '3', '   ', pg_temp.opts('A', 'B', 'C')) ->> 'error', 'P0001 INVALID invalid_stem', 'a blank one too');
select is(pg_temp.as_user('teach', format('select api.update_version_question(%L, 3, null, %L::jsonb, gen_random_uuid())', pg_temp.id('q1'), pg_temp.opts('A', 'B'))) ->> 'error', 'P0001 INVALID invalid_stem', 'a null one too');
select is(pg_temp.uvq('teach', 'q1', '3', repeat('s', 5001), pg_temp.opts('A', 'B', 'C')) ->> 'error', 'P0001 INVALID invalid_stem', 'and one of 5001 characters');
select is(pg_temp.uvq('teach', 'q1', '3', 'Ok', '[{"id":"A","text":"x"},{"id":"A","text":"y"}]') ->> 'error', 'P0001 INVALID options_repeated', 'repeated options ([A, A]) are INVALID options_repeated: they could never be graded');
select is(pg_temp.uvq('teach', 'q1', '3', 'Ok', '[{"id":"A","text":"x"},{"id":"B","text":"y"},{"id":"A","text":"z"}]') ->> 'error', 'P0001 INVALID options_repeated', 'also when they are not next to each other');
select is(pg_temp.uvq('teach', 'q1', '3', 'Ok', '[{"id":"A","text":"x"}]') ->> 'error', 'P0001 INVALID invalid_options', 'one option is INVALID invalid_options');
select is(pg_temp.uvq('teach', 'q1', '3', 'Ok', '[{"id":"A","text":"x"},{"id":"B","text":"x"},{"id":"C","text":"x"},{"id":"D","text":"x"},{"id":"E","text":"x"}]') ->> 'error', 'P0001 INVALID invalid_options', 'five too');
select is(pg_temp.uvq('teach', 'q1', '3', 'Ok', '[{"id":"a","text":"x"},{"id":"B","text":"y"}]') ->> 'error', 'P0001 INVALID invalid_options', 'an id that is not one capital letter too');
select is(pg_temp.uvq('teach', 'q1', '3', 'Ok', '[{"id":"AB","text":"x"},{"id":"B","text":"y"}]') ->> 'error', 'P0001 INVALID invalid_options', 'and an id of two letters');
select is(pg_temp.uvq('teach', 'q1', '3', 'Ok', '[{"id":"A"},{"id":"B","text":"y"}]') ->> 'error', 'P0001 INVALID invalid_options', 'an option without text too');
select is(pg_temp.uvq('teach', 'q1', '3', 'Ok', '[{"id":"A","text":1},{"id":"B","text":"y"}]') ->> 'error', 'P0001 INVALID invalid_options', 'with a text that is not text too');
select is(pg_temp.uvq('teach', 'q1', '3', 'Ok', format('[{"id":"A","text":"%s"},{"id":"B","text":"y"}]', repeat('t', 2001))) ->> 'error', 'P0001 INVALID invalid_options', 'and one of 2001 characters');
select is(pg_temp.uvq('teach', 'q1', '3', 'Ok', '[{"id":"A","text":"x","correct":true},{"id":"B","text":"y"}]') ->> 'error', 'P0001 INVALID invalid_options', 'an option with a key outside the shape too (no "correct" flag can slip in)');
select is(pg_temp.uvq('teach', 'q1', '3', 'Ok', '[{"id":"A","text":"x","graph":1},{"id":"B","text":"y"}]') ->> 'error', 'P0001 INVALID invalid_options', 'a graph that is not an object too');
select is(pg_temp.uvq('teach', 'q1', '3', 'Ok', '["A","B"]') ->> 'error', 'P0001 INVALID invalid_options', 'options that are not objects too');
select is(pg_temp.uvq('teach', 'q1', '3', 'Ok', '{"id":"A"}') ->> 'error', 'P0001 INVALID invalid_options', 'an object instead of a list too');
select is(pg_temp.uvq('teach', 'q1', '3', 'Ok', 'null') ->> 'error', 'P0001 INVALID invalid_options', 'a JSON null too');
select is(pg_temp.as_user('teach', format('select api.update_version_question(%L, 3, ''Ok'', null, gen_random_uuid())', pg_temp.id('q1'))) ->> 'error', 'P0001 INVALID invalid_options', 'and a missing one');
select is(pg_temp.as_user('teach', 'select api.update_version_question(null, 1, ''Ok'', ''[]''::jsonb, gen_random_uuid())') ->> 'error', 'P0001 NOT_FOUND not_found', 'a null question is NOT_FOUND');
select is(pg_temp.as_user('teach', format('select api.update_version_question(%L, 1, ''Ok'', %L::jsonb, gen_random_uuid())', gen_random_uuid(), pg_temp.opts('A', 'B'))) ->> 'error', 'P0001 NOT_FOUND not_found', 'one that does not exist too');
select ok(pg_temp.unchanged(), 'and no refusal changed anything');
select is(pg_temp.uvq('teach', 'q1', '3', 'Con gráfico', '[{"id":"A","text":"x","graph":{"functions":[],"points":[]}},{"id":"B","text":"y"}]') ->> 'revision', '4', 'an option with a graph is accepted (zod validates it deeper)');
select is(pg_temp.uvq('teach', 'q3', '1', 'Con tres', pg_temp.opts('A', 'B', 'C')) ->> 'revision', '2', 'a question with no key can drop an option: q3 goes from four options to three');

-- ---------------------------------------------------------------------------------------------
-- set_question_key (on vq)
-- ---------------------------------------------------------------------------------------------
select pg_temp.take('q2');
select is(pg_temp.keys(pg_temp.sqk('teach', 'q2', 'B')), 'questionId,revision', 'a teacher sets the correct option of a question that has none: the answer is the question and the key revision');
select is(pg_temp.sqk('teach', 'q2', 'B'), jsonb_build_object('questionId', pg_temp.id('q2'), 'revision', 1), 'the key is revision 1 (and the same request again answers the same)');
select is((select concat_ws('|', k.correct_option_id, k.revision, k.version_id = pg_temp.id('vq'), k.institution_id = pg_temp.id('i_n')) from app.question_keys k where k.question_id = pg_temp.id('q2')),
  'B|1|t|t', 'the key is stored in the version and the institution of its question');
select is(pg_temp.delta('q2'), '1,1,1', 'the question, its adapted exercise and the version each moved by one');
select is((select ve.written_by_generation_id is null from app.version_exercises ve where ve.id = pg_temp.id('xq1')), true, 'the exercise is written by a person');
select is((select count(*) from app.version_events e where e.operation = 'set_question_key' and e.target_id = pg_temp.id('q2')), 1::bigint, 'the change left an event: the feedback of a key is not lost');
select is((select concat_ws('|', e.kind, e.version_exercise_id = pg_temp.id('xq1'), e.exercise_revision, e.data = jsonb_build_object('correctOptionId', 'B'),
                              e.result = jsonb_build_object('questionId', pg_temp.id('q2'), 'revision', 1), e.actor_user_id = pg_temp.id('teach'))
             from app.version_events e where e.operation = 'set_question_key' and e.target_id = pg_temp.id('q2')), 'edited|t|5|t|t|t', 'an edited event with the option chosen and the answer given');
select pg_temp.mark();
select is(pg_temp.sqk('teach', 'q2', 'B') ->> 'revision', '1', 'the same option again, with no revision, answers the same key');
select is(pg_temp.sqk('co', 'q2', 'B', '7') ->> 'revision', '1', 'also with any revision: the option is already the key, there is nothing to write');
select ok(pg_temp.unchanged(), 'and neither wrote anything: no revision, no event');
select is(pg_temp.sqk('teach', 'q2', 'A') ->> 'error', 'P0001 CONFLICT revision_mismatch', 'another option without the revision of the key is CONFLICT revision_mismatch');
select is(pg_temp.sqk('teach', 'q2', 'A', '2') ->> 'error', 'P0001 CONFLICT revision_mismatch', 'and with a wrong one');
select is(pg_temp.sqk('teach', 'q2', 'Z', '1') ->> 'error', 'P0001 INVALID unknown_option', 'an option the question does not have is INVALID unknown_option');
select is(pg_temp.sqk('teach', 'q2', 'C', '1') ->> 'error', 'P0001 INVALID unknown_option', 'also when another question has it (q2 has A and B)');
select is(pg_temp.sqk('teach', 'q2', 'a', '1') ->> 'error', 'P0001 INVALID unknown_option', 'a lowercase letter too');
select is(pg_temp.as_user('teach', format('select api.set_question_key(%L, null, 1)', pg_temp.id('q2'))) ->> 'error', 'P0001 INVALID unknown_option', 'a null option too');
select is(pg_temp.sqk('teach', 'q3', 'A', '1') ->> 'error', 'P0001 CONFLICT revision_mismatch', 'a revision for a question that has no key is CONFLICT revision_mismatch');
select is(pg_temp.sqk('teach', 'q3', 'D') ->> 'error', 'P0001 INVALID unknown_option', 'q3 lost its option D in the edit above: it cannot be the key');
select is(pg_temp.as_user('teach', 'select api.set_question_key(null, ''A'', null)') ->> 'error', 'P0001 NOT_FOUND not_found', 'a null question is NOT_FOUND');
select is(pg_temp.as_user('teach', format('select api.set_question_key(%L, ''A'', null)', gen_random_uuid())) ->> 'error', 'P0001 NOT_FOUND not_found', 'one that does not exist too');
select ok(pg_temp.unchanged(), 'none of them changed anything');
select pg_temp.take('q2');
select is(pg_temp.sqk('teach', 'q2', 'A', '1'), jsonb_build_object('questionId', pg_temp.id('q2'), 'revision', 2), 'another option with the revision of the key changes it: key revision 2');
select is(pg_temp.delta('q2'), '1,1,1', 'and moves the question, the exercise and the version again');
select is(pg_temp.sqk('teach', 'q2', 'B', '1') ->> 'error', 'P0001 CONFLICT revision_mismatch', 'a second teacher who still has revision 1 is CONFLICT revision_mismatch');
select is((pg_temp.gv('vq') -> 'keys') @> jsonb_build_array(jsonb_build_object('questionId', pg_temp.id('q2'), 'correctOptionId', 'A', 'revision', 2)), true,
  'get_version carries the key with its revision: what set_question_key needs after a reload');
-- The correct option cannot be taken out by an edit of the question.
select pg_temp.mark();
select pg_temp.sqk('teach', 'q1', 'B');
select is(pg_temp.uvq('teach', 'q1', (select q.revision::text from app.version_questions q where q.id = pg_temp.id('q1')), 'Ok', pg_temp.opts('A', 'C')) ->> 'error', 'P0001 INVALID correct_option_removed',
  'an edit that takes the correct option out is INVALID correct_option_removed: the key is changed first');
select is(pg_temp.uvq('teach', 'q1', (select q.revision::text from app.version_questions q where q.id = pg_temp.id('q1')), 'Ok', pg_temp.opts('B', 'C'))->> 'error' is null, true, 'while one that keeps it is fine, whatever else it drops');
select is(pg_temp.sqk('teach', 'q1', 'C', '1') ->> 'revision', '2', 'the key moves to C first');
select is(pg_temp.uvq('teach', 'q1', (select q.revision::text from app.version_questions q where q.id = pg_temp.id('q1')), 'Ok', pg_temp.opts('A', 'C')) ->> 'error' is null, true, 'and now B can go');
select is(pg_temp.gv('vq') -> 'questions' @> jsonb_build_array(jsonb_build_object('id', pg_temp.id('q1'), 'versionExerciseId', pg_temp.id('xq1'), 'position', 0, 'stem', 'Ok', 'options', pg_temp.opts('A', 'C')::jsonb,
  'revision', (select q.revision from app.version_questions q where q.id = pg_temp.id('q1')))), true, 'the read shows the question as it was written');

-- ---------------------------------------------------------------------------------------------
-- Guards: the columns that say where a row belongs never change, tried as the owner of the table.
-- ---------------------------------------------------------------------------------------------
select throws_ok(format('update app.version_exercises set exercise_id = %L where id = %L', pg_temp.id('e3'), pg_temp.id('xq1')), 'P0004', null, 'the original exercise of an adapted one never changes');
select throws_ok(format('update app.version_exercises set version_id = %L where id = %L', pg_temp.id('vi'), pg_temp.id('xq1')), 'P0004', null, 'nor the version of an adapted exercise');
select throws_ok(format('update app.version_exercises set assessment_id = %L where id = %L', gen_random_uuid(), pg_temp.id('xq1')), 'P0004', null, 'nor its assessment');
select throws_ok(format('update app.version_questions set version_exercise_id = %L where id = %L', pg_temp.id('xq2'), pg_temp.id('q2')), 'P0004', null, 'a question never moves to another adapted exercise, even of the same version');
select throws_ok(format('update app.version_questions set version_id = %L where id = %L', pg_temp.id('vi'), pg_temp.id('q2')), 'P0004', null, 'nor to another version');
select throws_ok(format('update app.question_keys set question_id = %L where question_id = %L', pg_temp.id('q3'), pg_temp.id('q2')), 'P0004', null, 'a key never moves to another question');
select throws_ok(format('update app.question_keys set version_id = %L where question_id = %L', pg_temp.id('vi'), pg_temp.id('q2')), 'P0004', null, 'nor to another version');
select lives_ok(format('update app.version_exercises set body = body where id = %L', pg_temp.id('xq1')), 'control: the guards let the content columns through');
select lives_ok(format('update app.question_keys set revision = revision where question_id = %L', pg_temp.id('q2')), 'also for a key');

select * from finish();
rollback;
