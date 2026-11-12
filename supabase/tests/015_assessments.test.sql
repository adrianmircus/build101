-- T1.4a: assessments and their original exercises through the RPCs, as each role of the matrix would
-- call them: create_assessment, update_assessment, archive_assessment, list_assessments,
-- get_assessment, add_exercise, update_exercise, remove_exercise and reorder_exercises. Versions are
-- seeded as the owner (T1.4b does not exist yet): changing the original marks them stale and never
-- touches their copy. Guards are tried as the owner of the table, expecting P0004: as authenticated
-- the UPDATE would fail first on privileges (42501) and the test would pass without the guard.
-- The whole file is rolled back.
begin;
select plan(229);

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
create function pg_temp.as_anon(p_sql text) returns jsonb language sql
  as $$ select pg_temp.rpc(null, 'anon', p_sql) $$;
create function pg_temp.keys(p_obj jsonb) returns text language sql
  as $$ select string_agg(k, ',' order by k) from jsonb_object_keys(p_obj) k $$;
create function pg_temp.keep(p_key text, p_res jsonb) returns jsonb language plpgsql as $$
begin
  insert into ids (k, id) values (p_key, (p_res ->> 'id')::uuid);
  return p_res;
end $$;

insert into ids (k, id) select k, gen_random_uuid() from unnest(array[
  'admin', 'teach', 'other', 'incl', 'userb', 'nobody', 'ghost', 'adm2', 'co', 'stu_a', 'stu_b'
]) as k;
insert into auth.users (id, email) select id, k || '@t1-4a.invalid' from ids where k <> 'ghost';
do $$
declare
  k text;
begin
  for k in select ids.k from ids where ids.k <> 'ghost' loop
    perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;

-- Institution n: admin, teachers teach (g_n), other (go_n), co (co-teacher of g_n), inclusion. adm2 is an
-- admin who teaches go_n. sn1 (stu_a) is in g_n, sn3 (stu_b) in go_n. Institution b: userb.
insert into ids (k, id) select 'i_n', (pg_temp.as_service($$ select api.internal_create_institution('Liceo N', 't1-4a-n', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, %L)', pg_temp.id('i_n'), pg_temp.id(u.k), u.role))
  from (values ('admin', 'admin'), ('teach', 'teacher'), ('other', 'teacher'), ('co', 'teacher'), ('adm2', 'admin'), ('incl', 'inclusion')) as u(k, role);
insert into ids (k, id) values
  ('g_n', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid),
  ('go_n', (pg_temp.as_user('other', format('select api.create_group(%L, ''3.º B'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid),
  ('g_arch', (pg_temp.as_user('teach', format('select api.create_group(%L, ''Archivado'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid);
select pg_temp.as_user('teach', format('select api.add_group_staff(%L, %L, ''co_teacher'')', pg_temp.id('g_n'), pg_temp.id('co')));
select pg_temp.as_user('other', format('select api.add_group_staff(%L, %L, ''co_teacher'')', pg_temp.id('go_n'), pg_temp.id('adm2')));
insert into ids (k, id) values
  ('sn1', (pg_temp.as_user('teach', format('select api.create_student(%L, ''Estudiante 1'', ''est.1'', gen_random_uuid())', pg_temp.id('g_n'))) ->> 'id')::uuid),
  ('sn3', (pg_temp.as_user('other', format('select api.create_student(%L, ''Estudiante 3'', ''est.3'', gen_random_uuid())', pg_temp.id('go_n'))) ->> 'id')::uuid);
select pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('sn1'), pg_temp.id('stu_a')));
select pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('sn3'), pg_temp.id('stu_b')));
insert into ids (k, id) select 'i_b', (pg_temp.as_service($$ select api.internal_create_institution('Liceo B', 't1-4a-b', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_b'), pg_temp.id('userb')));
-- A syllabus with one unit, for the topic of an exercise (T4.5 will write it through its own RPC).
insert into ids (k, id) values ('unit', gen_random_uuid());
insert into app.syllabi (institution_id, group_id, units)
  values (pg_temp.id('i_n'), pg_temp.id('g_n'), jsonb_build_array(jsonb_build_object('id', pg_temp.id('unit'), 'title', 'Unidad 1', 'contents', '')));

-- The calls under test. Raw arguments (revisions, topics) are SQL: 'null' or a value.
create function pg_temp.ca(p_user text, p_group text, p_kind text, p_topic text, p_instr text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.create_assessment(%L, %L, %L, %L, gen_random_uuid())', pg_temp.id(p_group), p_kind, p_topic, p_instr))
$$;
create function pg_temp.upa(p_user text, p_asm text, p_rev text, p_kind text, p_topic text, p_instr text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.update_assessment(%L, %s, %L, %L, %L)', pg_temp.id(p_asm), p_rev, p_kind, p_topic, p_instr))
$$;
create function pg_temp.arc(p_user text, p_asm text, p_rev text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.archive_assessment(%L, %s)', pg_temp.id(p_asm), p_rev))
$$;
create function pg_temp.lst(p_user text, p_group text, p_rest text default 'false, 50, 0') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.list_assessments(%L, %s)', pg_temp.id(p_group), p_rest))
$$;
create function pg_temp.get(p_user text, p_asm text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.get_assessment(%L)', pg_temp.id(p_asm)))
$$;
create function pg_temp.adx(p_user text, p_asm text, p_label text, p_body text, p_topic text default 'null') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.add_exercise(%L, %L, %L, gen_random_uuid(), %s)', pg_temp.id(p_asm), p_label, p_body, p_topic))
$$;
create function pg_temp.upx(p_user text, p_ex text, p_rev text, p_label text, p_body text, p_topic text default 'null') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.update_exercise(%L, %s, %L, %L, %s)', pg_temp.id(p_ex), p_rev, p_label, p_body, p_topic))
$$;
create function pg_temp.rmx(p_user text, p_ex text, p_rev text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.remove_exercise(%L, %s)', pg_temp.id(p_ex), p_rev))
$$;
create function pg_temp.idarr(p_keys text[]) returns text language sql as $$
  select format('%L::uuid[]', '{' || coalesce(string_agg(pg_temp.id(k)::text, ',' order by n), '') || '}') from unnest(p_keys) with ordinality as t(k, n)
$$;
create function pg_temp.reo(p_user text, p_asm text, p_rev text, p_keys text[]) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.reorder_exercises(%L, %s, %s)', pg_temp.id(p_asm), p_rev, pg_temp.idarr(p_keys)))
$$;
-- The live exercises of an assessment, in order, as their keys in ids.
create function pg_temp.order_of(p_asm text) returns text language sql as $$
  select string_agg(coalesce((select i.k from ids i where i.id = e.id), '?'), ',' order by e.position, e.id)
    from app.assessment_exercises e where e.assessment_id = pg_temp.id(p_asm) and e.removed_at is null
$$;
-- Everything these RPCs can change, as one string.
create function pg_temp.digest() returns text language sql as $$
  select md5(coalesce((select string_agg(concat_ws('|', a.id, a.revision, a.kind, a.topic, a.general_instructions, a.status), ';' order by a.id)
                         from app.assessments a where a.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', e.id, e.revision, e.position, e.label, e.body, e.removed_at), ';' order by e.id)
                         from app.assessment_exercises e where e.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', v.id, v.stale, v.revision), ';' order by v.id)
                         from app.versions v where v.institution_id = pg_temp.id('i_n')), '')
          || (select count(*) from app.audit_log a where a.institution_id = pg_temp.id('i_n'))::text)
$$;
create temp table before_val (n serial, d text);
create function pg_temp.mark() returns void language sql as $$ insert into before_val (d) select pg_temp.digest() $$;
create function pg_temp.unchanged() returns boolean language sql as $$
  select (select d from before_val order by n desc limit 1) = pg_temp.digest()
$$;

-- ---------------------------------------------------------------------------------------------
-- create_assessment
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.keys(pg_temp.keep('a1', pg_temp.ca('teach', 'g_n', 'worksheet', '  Funciones  ', 'Elegí dos ejercicios.'))), 'id,revision', 'a teacher of the group creates an assessment: the answer is its id and revision');
select is((select concat_ws('|', a.subject_id, a.topic, a.general_instructions, a.kind, a.status, a.revision, a.institution_id = pg_temp.id('i_n'),
                              a.group_id = pg_temp.id('g_n'), a.created_by = pg_temp.id('teach'))
             from app.assessments a where a.id = pg_temp.id('a1')),
  'math|Funciones|Elegí dos ejercicios.|worksheet|draft|1|t|t|t', 'the subject is the group''s, the topic is trimmed, it starts as a draft and the author comes from the session');
select is(pg_temp.keep('a2', pg_temp.ca('co', 'g_n', 'exam', '', '')) ->> 'revision', '1', 'a co-teacher creates one too, with an empty topic and instructions');
select is(pg_temp.ca('teach', 'g_n', 'exam', repeat('t', 200), repeat('i', 5000)) ->> 'revision', '1', 'the limits are fine: a topic of 200 and instructions of 5000');
select pg_temp.mark();
select is(pg_temp.ca('teach', 'g_n', 'quiz', 'x', 'x') ->> 'error', 'P0001 INVALID invalid_kind', 'a kind outside the list is INVALID invalid_kind');
select is(pg_temp.as_user('teach', format('select api.create_assessment(%L, null, ''x'', ''x'', gen_random_uuid())', pg_temp.id('g_n'))) ->> 'error', 'P0001 INVALID invalid_kind', 'a null kind too');
select is(pg_temp.ca('teach', 'g_n', 'exam', repeat('t', 201), 'x') ->> 'error', 'P0001 INVALID invalid_topic', 'a topic of 201 is INVALID invalid_topic');
select is(pg_temp.as_user('teach', format('select api.create_assessment(%L, ''exam'', null, ''x'', gen_random_uuid())', pg_temp.id('g_n'))) ->> 'error', 'P0001 INVALID invalid_topic', 'a null topic too');
select is(pg_temp.ca('teach', 'g_n', 'exam', 'x', repeat('i', 5001)) ->> 'error', 'P0001 INVALID invalid_instructions', 'instructions of 5001 are INVALID invalid_instructions');
select is(pg_temp.as_user('teach', format('select api.create_assessment(%L, ''exam'', ''x'', null, gen_random_uuid())', pg_temp.id('g_n'))) ->> 'error', 'P0001 INVALID invalid_instructions', 'null instructions too');
select is(pg_temp.as_user('teach', 'select api.create_assessment(null, ''exam'', ''x'', ''x'', gen_random_uuid())') ->> 'error', 'P0001 NOT_FOUND not_found', 'a null group is NOT_FOUND');
select is(pg_temp.as_user('teach', 'select api.create_assessment(gen_random_uuid(), ''exam'', ''x'', ''x'', gen_random_uuid())') ->> 'error', 'P0001 NOT_FOUND not_found', 'a group that does not exist too');
select ok(pg_temp.unchanged(), 'and no refusal changed anything');
select pg_temp.as_user('teach', format('select api.archive_group(%L, 1)', pg_temp.id('g_arch')));
select is(pg_temp.ca('teach', 'g_arch', 'exam', 'x', 'x') ->> 'error', 'P0001 INVALID archived', 'an archived group takes no new assessment');

-- ---------------------------------------------------------------------------------------------
-- add_exercise
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.keys(pg_temp.keep('e1', pg_temp.adx('teach', 'a1', ' 1 ', 'Resolvé 2x + 1 = 5.'))), 'id,revision', 'a teacher adds an exercise: id and revision');
select is(pg_temp.adx('teach', 'a1', '1', 'x') ->> 'revision', '1', 'revision 1 (and a label may repeat: it is what the teacher sees)');
select pg_temp.as_user('teach', format('select api.remove_exercise(%L, 1)', (select e.id from app.assessment_exercises e where e.assessment_id = pg_temp.id('a1') and e.id <> pg_temp.id('e1'))));
select pg_temp.keep('e2', pg_temp.adx('co', 'a1', '2b', 'Graficá y = x^2.', quote_literal(pg_temp.id('unit'))));
select pg_temp.keep('e3', pg_temp.adx('teach', 'a1', '3', 'Factorizá x^2 - 9.'));
select is((select concat_ws('|', e.label, e.body, e.position, e.revision, e.topic_id is null, e.institution_id = pg_temp.id('i_n'))
             from app.assessment_exercises e where e.id = pg_temp.id('e1')), '1|Resolvé 2x + 1 = 5.|0|1|t|t', 'stored with the label trimmed, the first position and no topic');
select is(pg_temp.order_of('a1'), 'e1,e2,e3', 'each new exercise goes last, ignoring the removed one');
select is((select e.topic_id = pg_temp.id('unit') from app.assessment_exercises e where e.id = pg_temp.id('e2')), true, 'a topic of the group''s syllabus is accepted');
select is((select a.revision from app.assessments a where a.id = pg_temp.id('a1')), 1, 'adding does not move the revision of the assessment');
select pg_temp.mark();
select is(pg_temp.adx('teach', 'a1', '', 'x') ->> 'error', 'P0001 INVALID invalid_label', 'an empty label is INVALID invalid_label');
select is(pg_temp.adx('teach', 'a1', E' \t ', 'x') ->> 'error', 'P0001 INVALID invalid_label', 'a blank one too');
select is(pg_temp.adx('teach', 'a1', repeat('l', 21), 'x') ->> 'error', 'P0001 INVALID invalid_label', 'one of 21 characters too');
select is(pg_temp.as_user('teach', format('select api.add_exercise(%L, null, ''x'', gen_random_uuid(), null)', pg_temp.id('a1'))) ->> 'error', 'P0001 INVALID invalid_label', 'a null label too');
select is(pg_temp.adx('teach', 'a1', '4', '') ->> 'error', 'P0001 INVALID invalid_body', 'an empty body is INVALID invalid_body');
select is(pg_temp.adx('teach', 'a1', '4', E' \n ') ->> 'error', 'P0001 INVALID invalid_body', 'a blank one too');
select is(pg_temp.adx('teach', 'a1', '4', repeat('b', 20001)) ->> 'error', 'P0001 INVALID invalid_body', 'one of 20001 too');
select is(pg_temp.as_user('teach', format('select api.add_exercise(%L, ''4'', null, gen_random_uuid(), null)', pg_temp.id('a1'))) ->> 'error', 'P0001 INVALID invalid_body', 'a null body too');
select is(pg_temp.adx('teach', 'a1', '4', 'x', quote_literal(gen_random_uuid())) ->> 'error', 'P0001 INVALID unknown_topic', 'a topic that is not a unit of the syllabus is INVALID unknown_topic');
select is(pg_temp.adx('teach', 'a1', '4', repeat('b', 20000)) ->> 'revision', '1', 'a body of exactly 20000 is fine');
select is(pg_temp.adx('teach', 'a1', repeat('l', 20), 'x') ->> 'revision', '1', 'and a label of exactly 20');
select pg_temp.as_user('teach', format('select api.remove_exercise(%L, 1)', (select e.id from app.assessment_exercises e where e.assessment_id = pg_temp.id('a1') and e.removed_at is null and e.id not in (pg_temp.id('e1'), pg_temp.id('e2'), pg_temp.id('e3')) order by e.position limit 1)));
select pg_temp.as_user('teach', format('select api.remove_exercise(%L, 1)', (select e.id from app.assessment_exercises e where e.assessment_id = pg_temp.id('a1') and e.removed_at is null and e.id not in (pg_temp.id('e1'), pg_temp.id('e2'), pg_temp.id('e3')) order by e.position limit 1)));
select is(pg_temp.order_of('a1'), 'e1,e2,e3', 'the two extra exercises were removed again: the live ones are the three');
select is(pg_temp.adx('teach', 'a1', '9', 'x') ->> 'revision', '1', 'one more');
select pg_temp.as_user('teach', format('select api.remove_exercise(%L, 1)', (select e.id from app.assessment_exercises e where e.assessment_id = pg_temp.id('a1') and e.removed_at is null and e.id not in (pg_temp.id('e1'), pg_temp.id('e2'), pg_temp.id('e3')) limit 1)));

-- A full assessment takes no more: 200 live exercises (written as the owner), the 201st is INVALID.
select pg_temp.keep('afull', pg_temp.ca('teach', 'g_n', 'worksheet', 'Lleno', ''));
insert into app.assessment_exercises (institution_id, assessment_id, position, label, body)
  select pg_temp.id('i_n'), pg_temp.id('afull'), n, n::text, 'x' from generate_series(0, 199) n;
select is(pg_temp.adx('teach', 'afull', '201', 'x') ->> 'error', 'P0001 INVALID too_many_exercises', 'the 201st live exercise is INVALID too_many_exercises');
select is(pg_temp.reo('teach', 'afull', '1', array[]::text[]) ->> 'error', 'P0001 INVALID exercises_mismatch', 'and an empty order is INVALID exercises_mismatch');

-- ---------------------------------------------------------------------------------------------
-- Versions seeded as the owner: v1 adapted e1 and e2, v2 only e2, v3 (archived) e1. Their text and
-- their instructions are what must never change.
-- ---------------------------------------------------------------------------------------------
insert into ids (k, id) select k, gen_random_uuid() from unnest(array['v1', 'v2', 'v3']) k;
insert into app.versions (id, institution_id, assessment_id, position, general_instructions, archived_at, config) values
  (pg_temp.id('v1'), pg_temp.id('i_n'), pg_temp.id('a1'), 1, 'Copia uno', null, '{"keep":true}'),
  (pg_temp.id('v2'), pg_temp.id('i_n'), pg_temp.id('a1'), 2, 'Copia dos', null, '{}'),
  (pg_temp.id('v3'), pg_temp.id('i_n'), pg_temp.id('a1'), 3, 'Copia tres', now(), '{}');
insert into app.version_exercises (institution_id, assessment_id, version_id, exercise_id, source_revision, body, status) values
  (pg_temp.id('i_n'), pg_temp.id('a1'), pg_temp.id('v1'), pg_temp.id('e1'), 1, 'Texto adaptado 1', 'ready'),
  (pg_temp.id('i_n'), pg_temp.id('a1'), pg_temp.id('v1'), pg_temp.id('e2'), 1, 'Texto adaptado 2', 'ready'),
  (pg_temp.id('i_n'), pg_temp.id('a1'), pg_temp.id('v2'), pg_temp.id('e2'), 1, 'Texto adaptado 2b', 'ready'),
  (pg_temp.id('i_n'), pg_temp.id('a1'), pg_temp.id('v3'), pg_temp.id('e1'), 1, 'Texto adaptado 3', 'ready');
create function pg_temp.stale() returns text language sql as $$
  select string_agg(k || '=' || stale::text, ',' order by k) from (select i.k, v.stale from app.versions v join ids i on i.id = v.id) t
$$;
create function pg_temp.copies() returns text language sql as $$
  select md5((select string_agg(concat_ws('|', v.id, v.general_instructions, v.revision, v.instructions_revision, v.status, v.approved_revision), ';' order by v.id) from app.versions v where v.assessment_id = pg_temp.id('a1'))
          || (select string_agg(concat_ws('|', ve.id, ve.body, ve.revision, ve.source_revision, ve.status), ';' order by ve.id) from app.version_exercises ve where ve.assessment_id = pg_temp.id('a1')))
$$;
create function pg_temp.reset_stale() returns void language sql as $$ update app.versions set stale = false where assessment_id = pg_temp.id('a1') $$;
create temp table copy_before as select pg_temp.copies() as d;
select is(pg_temp.stale(), 'v1=false,v2=false,v3=false', 'the three versions start fresh');

-- ---------------------------------------------------------------------------------------------
-- update_exercise
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.upx('teach', 'e3', '1', '3', 'Factorizá x^2 - 9.', quote_literal(pg_temp.id('unit'))), jsonb_build_object('id', pg_temp.id('e3'), 'revision', 2), 'only the topic changes: revision 2 ...');
select is(pg_temp.stale(), 'v1=false,v2=false,v3=false', '... and no version is marked stale (that exercise is in none, and the text did not change)');
select is(pg_temp.upx('teach', 'e1', '1', ' 1a ', 'Resolvé 2x + 1 = 7.'), jsonb_build_object('id', pg_temp.id('e1'), 'revision', 2), 'the text changes: revision 2');
select is((select concat_ws('|', e.label, e.body, e.revision) from app.assessment_exercises e where e.id = pg_temp.id('e1')), '1a|Resolvé 2x + 1 = 7.|2', 'stored, with the label trimmed');
select is(pg_temp.stale(), 'v1=true,v2=false,v3=false', 'only the live version that adapted that exercise is stale: not v2 (it did not), not the archived v3');
select is(pg_temp.copies(), (select d from copy_before), 'and the copies of the versions (text, instructions, revisions, status) did not change');
select pg_temp.reset_stale();
select is(pg_temp.upx('teach', 'e1', '2', '1a', 'Resolvé 2x + 1 = 7.') ->> 'revision', '3', 'the same label and text again bumps the revision');
select is(pg_temp.stale(), 'v1=false,v2=false,v3=false', 'but marks nothing stale: nothing a version adapted changed');
select pg_temp.mark();
select is(pg_temp.upx('teach', 'e1', '2', '1a', 'otro') ->> 'error', 'P0001 CONFLICT revision_mismatch', 'an old revision is CONFLICT revision_mismatch');
select is(pg_temp.upx('teach', 'e1', 'null', '1a', 'otro') ->> 'error', 'P0001 INVALID revision_required', 'no revision is INVALID revision_required');
select is(pg_temp.upx('teach', 'e1', '3', '', 'otro') ->> 'error', 'P0001 INVALID invalid_label', 'an empty label is INVALID invalid_label');
select is(pg_temp.upx('teach', 'e1', '3', '1a', '  ') ->> 'error', 'P0001 INVALID invalid_body', 'a blank body is INVALID invalid_body');
select is(pg_temp.as_user('teach', format('select api.update_exercise(%L, 3, ''1a'', null, null)', pg_temp.id('e1'))) ->> 'error', 'P0001 INVALID invalid_body', 'a null body too');
select is(pg_temp.as_user('teach', format('select api.update_exercise(%L, 3, null, ''x'', null)', pg_temp.id('e1'))) ->> 'error', 'P0001 INVALID invalid_label', 'a null label too');
select is(pg_temp.upx('teach', 'e1', '3', '1a', 'x', quote_literal(gen_random_uuid())) ->> 'error', 'P0001 INVALID unknown_topic', 'an unknown topic is INVALID unknown_topic');
select is(pg_temp.as_user('teach', 'select api.update_exercise(null, 1, ''1'', ''x'', null)') ->> 'error', 'P0001 NOT_FOUND not_found', 'a null exercise is NOT_FOUND');
select is(pg_temp.as_user('teach', 'select api.update_exercise(gen_random_uuid(), 1, ''1'', ''x'', null)') ->> 'error', 'P0001 NOT_FOUND not_found', 'an exercise that does not exist too');
select ok(pg_temp.unchanged(), 'and no refusal changed anything');

-- ---------------------------------------------------------------------------------------------
-- remove_exercise
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.rmx('teach', 'e2', 'null') ->> 'error', 'P0001 INVALID revision_required', 'removing with no revision is INVALID revision_required');
select is(pg_temp.rmx('teach', 'e2', '5') ->> 'error', 'P0001 CONFLICT revision_mismatch', 'with a wrong revision CONFLICT revision_mismatch');
select is(pg_temp.rmx('teach', 'e2', '1'), jsonb_build_object('id', pg_temp.id('e2'), 'revision', 2), 'with the current revision the exercise is removed: revision 2');
select is(pg_temp.stale(), 'v1=true,v2=true,v3=false', 'both live versions that adapted it are stale');
select is(pg_temp.copies(), (select d from copy_before), 'and their copies are intact: the adapted text of the removed exercise is still there');
select is(pg_temp.order_of('a1'), 'e1,e3', 'it no longer shows in the live exercises');
select is((select e.removed_at is not null from app.assessment_exercises e where e.id = pg_temp.id('e2')), true, 'but the row stays, with removed_at (the versions point to its id)');
select is(pg_temp.rmx('teach', 'e2', '1'), jsonb_build_object('id', pg_temp.id('e2'), 'revision', 2), 'a retry with the revision it had read answers the same result');
select is(pg_temp.rmx('teach', 'e2', '2') ->> 'error', 'P0001 NOT_FOUND not_found', 'any other revision of a removed exercise is NOT_FOUND');
select is(pg_temp.upx('teach', 'e2', '2', '2b', 'x') ->> 'error', 'P0001 NOT_FOUND not_found', 'and a removed exercise takes no edit');
select is(pg_temp.as_user('teach', 'select api.remove_exercise(gen_random_uuid(), 1)') ->> 'error', 'P0001 NOT_FOUND not_found', 'an exercise that does not exist is NOT_FOUND');
select is(pg_temp.as_user('teach', 'select api.remove_exercise(null, 1)') ->> 'error', 'P0001 NOT_FOUND not_found', 'a null one too');

-- ---------------------------------------------------------------------------------------------
-- reorder_exercises
-- ---------------------------------------------------------------------------------------------
select pg_temp.keep('e4', pg_temp.adx('teach', 'a1', '4', 'Calculá la derivada de x^3.'));
select is(pg_temp.order_of('a1'), 'e1,e3,e4', 'live order before');
select pg_temp.reset_stale();
select pg_temp.mark();
select is(pg_temp.reo('teach', 'a1', '1', array['e4', 'e3']) ->> 'error', 'P0001 INVALID exercises_mismatch', 'an order that leaves one out is INVALID exercises_mismatch');
select is(pg_temp.reo('teach', 'a1', '1', array['e4', 'e3', 'e1', 'e2']) ->> 'error', 'P0001 INVALID exercises_mismatch', 'one that includes a removed exercise too');
select is(pg_temp.reo('teach', 'a1', '1', array['e4', 'e3', 'e1', 'e1']) ->> 'error', 'P0001 INVALID exercises_mismatch', 'one with a repeated id too');
select is(pg_temp.as_user('teach', format('select api.reorder_exercises(%L, 1, array[%L, %L, %L, gen_random_uuid()])', pg_temp.id('a1'), pg_temp.id('e1'), pg_temp.id('e3'), pg_temp.id('e4'))) ->> 'error', 'P0001 INVALID exercises_mismatch', 'one with an id that is not of the assessment too');
select is(pg_temp.as_user('teach', format('select api.reorder_exercises(%L, 1, array[%L, %L, null]::uuid[])', pg_temp.id('a1'), pg_temp.id('e1'), pg_temp.id('e3'))) ->> 'error', 'P0001 INVALID exercises_mismatch', 'one with a null id too');
select is(pg_temp.as_user('teach', format('select api.reorder_exercises(%L, 1, null)', pg_temp.id('a1'))) ->> 'error', 'P0001 INVALID exercises_mismatch', 'a null list too');
select is(pg_temp.reo('teach', 'a1', 'null', array['e4', 'e3', 'e1']) ->> 'error', 'P0001 INVALID revision_required', 'no revision is INVALID revision_required');
select is(pg_temp.reo('teach', 'a1', '9', array['e4', 'e3', 'e1']) ->> 'error', 'P0001 CONFLICT revision_mismatch', 'a wrong revision of the assessment is CONFLICT revision_mismatch');
select ok(pg_temp.unchanged(), 'and none of them changed anything');
select is(pg_temp.reo('teach', 'a1', '1', array['e4', 'e3', 'e1']), jsonb_build_object('id', pg_temp.id('a1'), 'revision', 2), 'the exact set in a new order: revision 2 of the assessment');
select is(pg_temp.order_of('a1'), 'e4,e3,e1', 'the new order is stored');
select is((select string_agg(e.position::text, ',' order by e.position) from app.assessment_exercises e where e.assessment_id = pg_temp.id('a1') and e.removed_at is null), '0,1,2', 'with positions 0, 1, 2');
select is((select string_agg(e.revision::text, ',' order by e.id) from app.assessment_exercises e where e.id in (pg_temp.id('e1'), pg_temp.id('e3'), pg_temp.id('e4'))),
  (select string_agg(r, ',' order by id) from (values (pg_temp.id('e1'), '3'), (pg_temp.id('e3'), '2'), (pg_temp.id('e4'), '1')) t(id, r)), 'the revision of the exercises did not move: the order is a property of the assessment');
select is(pg_temp.stale(), 'v1=false,v2=false,v3=false', 'and the versions are not stale');
select is(pg_temp.reo('teach', 'a1', '1', array['e1', 'e3', 'e4']) ->> 'error', 'P0001 CONFLICT revision_mismatch', 'a retry with the old revision is CONFLICT revision_mismatch');

-- ---------------------------------------------------------------------------------------------
-- update_assessment and the general instructions
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.upa('teach', 'a1', '2', 'exam', 'Funciones y derivadas', 'Elegí dos ejercicios.'), jsonb_build_object('id', pg_temp.id('a1'), 'revision', 3), 'the teacher changes the kind and the topic: revision 3');
select is((select concat_ws('|', a.kind, a.topic, a.general_instructions) from app.assessments a where a.id = pg_temp.id('a1')), 'exam|Funciones y derivadas|Elegí dos ejercicios.', 'stored');
select is(pg_temp.stale(), 'v1=false,v2=false,v3=false', 'the same instructions mark no version stale');
select is(pg_temp.upa('co', 'a1', '3', 'exam', 'Funciones y derivadas', E'Elegí dos ejercicios y justificá.\nUsá lápiz.') ->> 'revision', '4', 'a co-teacher changes the instructions: revision 4');
select is(pg_temp.stale(), 'v1=true,v2=true,v3=false', 'the live versions are stale; the archived one is not');
select is(pg_temp.copies(), (select d from copy_before), 'and each version keeps its own copy of the instructions, with every revision and status as it was');
select is((select string_agg(v.general_instructions, '/' order by v.position) from app.versions v where v.assessment_id = pg_temp.id('a1')), 'Copia uno/Copia dos/Copia tres', 'the copies read exactly as before');
select pg_temp.mark();
select is(pg_temp.upa('teach', 'a1', '3', 'exam', 'x', 'x') ->> 'error', 'P0001 CONFLICT revision_mismatch', 'an old revision is CONFLICT revision_mismatch');
select is(pg_temp.upa('teach', 'a1', 'null', 'exam', 'x', 'x') ->> 'error', 'P0001 INVALID revision_required', 'no revision is INVALID revision_required');
select is(pg_temp.upa('teach', 'a1', '4', 'quiz', 'x', 'x') ->> 'error', 'P0001 INVALID invalid_kind', 'a bad kind is INVALID invalid_kind');
select is(pg_temp.upa('teach', 'a1', '4', 'exam', repeat('t', 201), 'x') ->> 'error', 'P0001 INVALID invalid_topic', 'a topic of 201 is INVALID invalid_topic');
select is(pg_temp.upa('teach', 'a1', '4', 'exam', 'x', repeat('i', 5001)) ->> 'error', 'P0001 INVALID invalid_instructions', 'instructions of 5001 are INVALID invalid_instructions');
select is(pg_temp.as_user('teach', format('select api.update_assessment(%L, 4, null, ''x'', ''x'')', pg_temp.id('a1'))) ->> 'error', 'P0001 INVALID invalid_kind', 'a null kind too');
select is(pg_temp.as_user('teach', format('select api.update_assessment(%L, 4, ''exam'', null, ''x'')', pg_temp.id('a1'))) ->> 'error', 'P0001 INVALID invalid_topic', 'a null topic too');
select is(pg_temp.as_user('teach', format('select api.update_assessment(%L, 4, ''exam'', ''x'', null)', pg_temp.id('a1'))) ->> 'error', 'P0001 INVALID invalid_instructions', 'null instructions too');
select is(pg_temp.as_user('teach', 'select api.update_assessment(null, 1, ''exam'', ''x'', ''x'')') ->> 'error', 'P0001 NOT_FOUND not_found', 'a null assessment is NOT_FOUND');
select ok(pg_temp.unchanged(), 'and no refusal changed anything');

-- ---------------------------------------------------------------------------------------------
-- list_assessments and get_assessment (staff of the group only, no audit row: nothing sensitive)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.keys(pg_temp.lst('teach', 'g_n')), 'items,total', 'list_assessments answers items and total');
select is(pg_temp.keys(pg_temp.lst('teach', 'g_n') -> 'items' -> 0), 'createdAt,dueAt,exerciseCount,id,kind,publishAt,revision,status,subjectId,topic,versionCount', 'each item has exactly the keys of AssessmentSummary: no configuration, answer mode or recipient');
select is((select i ->> 'exerciseCount' || '/' || (i ->> 'versionCount') from jsonb_array_elements(pg_temp.lst('teach', 'g_n') -> 'items') i where i ->> 'id' = pg_temp.id('a1')::text), '3/2', 'the counts: live exercises (not the removed one) and live versions (not the archived one)');
select is((pg_temp.lst('teach', 'g_n') ->> 'total')::int, 4, 'the group has four assessments');
-- As the teacher of go_n, who can read it: an empty page is an answer, not a refusal (T14a-3).
select is(pg_temp.lst('other', 'go_n'), jsonb_build_object('items', '[]'::jsonb, 'total', 0), 'another group of the institution has none: its teacher reads an empty list with total 0, and no error');
select is(jsonb_array_length(pg_temp.lst('teach', 'g_n', 'false, 2, 0') -> 'items') || '/' || (pg_temp.lst('teach', 'g_n', 'false, 2, 0') ->> 'total'), '2/4', 'a page of two says the total');
select is(jsonb_array_length(pg_temp.lst('teach', 'g_n', 'false, 2, 3') -> 'items') || '/' || (pg_temp.lst('teach', 'g_n', 'false, 2, 3') ->> 'total'), '1/4', 'the last page has one');
select is(jsonb_array_length(pg_temp.lst('teach', 'g_n', 'false, 2, 50') -> 'items') || '/' || (pg_temp.lst('teach', 'g_n', 'false, 2, 50') ->> 'total'), '0/4', 'a page past the end is empty and keeps the total');
select is(pg_temp.lst('teach', 'g_n', 'false, 0, 0') ->> 'error', 'P0001 INVALID invalid_page', 'a limit of 0 is INVALID invalid_page');
select is(pg_temp.lst('teach', 'g_n', 'false, 201, 0') ->> 'error', 'P0001 INVALID invalid_page', 'one of 201 too');
select is(pg_temp.lst('teach', 'g_n', 'false, 50, -1') ->> 'error', 'P0001 INVALID invalid_page', 'a negative offset too');
select is(pg_temp.lst('teach', 'g_n', 'false, null, 0') ->> 'error', 'P0001 INVALID invalid_page', 'a null limit too');
select is(pg_temp.lst('teach', 'g_n', 'false, 50, null') ->> 'error', 'P0001 INVALID invalid_page', 'a null offset too');
select is(pg_temp.as_user('teach', 'select api.list_assessments(null)') ->> 'error', 'P0001 NOT_FOUND not_found', 'a null group is NOT_FOUND');
select is(pg_temp.keys(pg_temp.get('teach', 'a1')), 'assessment,exercises', 'get_assessment answers the assessment and its exercises');
select is(pg_temp.keys(pg_temp.get('teach', 'a1') -> 'assessment'), 'createdAt,dueAt,generalInstructions,groupId,id,kind,publishAt,revision,sourceFileId,status,subjectId,topic', 'with exactly the keys of Assessment');
select is(pg_temp.keys(pg_temp.get('teach', 'a1') -> 'exercises' -> 0), 'body,id,label,position,revision,topicId', 'and of AssessmentExercise');
select is((select string_agg(e ->> 'id', ',' order by (e ->> 'position')::int) from jsonb_array_elements(pg_temp.get('teach', 'a1') -> 'exercises') e),
  (select string_agg(pg_temp.id(k)::text, ',' order by n) from unnest(array['e4', 'e3', 'e1']) with ordinality as t(k, n)), 'the exercises come in order, the removed one out');
select is(pg_temp.get('teach', 'a1') -> 'assessment' ->> 'generalInstructions', E'Elegí dos ejercicios y justificá.\nUsá lápiz.', 'the instructions as the teacher wrote them');
select is(pg_temp.get('teach', 'a1') -> 'assessment' ->> 'subjectId', 'math', 'with the subject of the group');
select is(pg_temp.as_user('teach', 'select api.get_assessment(null)') ->> 'error', 'P0001 NOT_FOUND not_found', 'a null id is NOT_FOUND');
select is(pg_temp.as_user('teach', 'select api.get_assessment(gen_random_uuid())') ->> 'error', 'P0001 NOT_FOUND not_found', 'an id that does not exist too');
select is(pg_temp.get('co', 'a1') -> 'assessment' ->> 'id', pg_temp.id('a1')::text, 'a co-teacher reads the assessment of the group');
select is((select count(*) from app.audit_log a where a.institution_id = pg_temp.id('i_n') and a.action in ('list_assessments', 'get_assessment')), 0::bigint, 'neither read writes an audit row: nothing sensitive was disclosed');

-- ---------------------------------------------------------------------------------------------
-- The topic of an adapted exercise is part of what its versions were made from (T14a-1). e1 is in
-- v1 (live) and v3 (archived); v2 did not adapt it.
-- ---------------------------------------------------------------------------------------------
select pg_temp.reset_stale();
select is(pg_temp.upx('teach', 'e1', '3', '1a', 'Resolvé 2x + 1 = 7.', quote_literal(pg_temp.id('unit'))), jsonb_build_object('id', pg_temp.id('e1'), 'revision', 4),
  'only the topic of an adapted exercise changes: revision 4 ...');
select is(pg_temp.stale(), 'v1=true,v2=false,v3=false', '... and the live version that adapted it is stale (not v2, not the archived v3)');
select is(pg_temp.copies(), (select d from copy_before), 'its copy is untouched');
select pg_temp.reset_stale();
select is(pg_temp.upx('teach', 'e1', '4', '1a', 'Resolvé 2x + 1 = 7.', quote_literal(pg_temp.id('unit'))) ->> 'revision', '5', 'the same topic again bumps the revision');
select is(pg_temp.stale(), 'v1=false,v2=false,v3=false', 'but marks nothing stale');
select is(pg_temp.upx('teach', 'e1', '5', '1a', 'Resolvé 2x + 1 = 7.') ->> 'revision', '6', 'taking the topic away is a change too');
select is(pg_temp.stale(), 'v1=true,v2=false,v3=false', 'and marks v1 stale again');
select pg_temp.reset_stale();

-- ---------------------------------------------------------------------------------------------
-- Idempotency by op_key (T1.F3): one row per key and institution, compared with the identity stored
-- at creation; the replay answers the original result even after the row changed.
-- ---------------------------------------------------------------------------------------------
insert into ids (k, id) select k, gen_random_uuid() from unnest(array['ka', 'kx', 'kx2']) k;
create function pg_temp.ca_key(p_user text, p_key text, p_topic text, p_group text default 'g_n') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.create_assessment(%L, ''worksheet'', %L, ''Instrucciones'', %L)', pg_temp.id(p_group), p_topic, pg_temp.id(p_key)))
$$;
create function pg_temp.adx_key(p_user text, p_asm text, p_key text, p_body text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.add_exercise(%L, ''1'', %L, %L, null)', pg_temp.id(p_asm), p_body, pg_temp.id(p_key)))
$$;
select pg_temp.keep('ak', pg_temp.ca_key('teach', 'ka', ' Con clave '));
select is(pg_temp.ca_key('teach', 'ka', 'Con clave'), jsonb_build_object('id', pg_temp.id('ak'), 'revision', 1), 'create_assessment: the same op_key and data answer the same assessment (topic compared trimmed)');
select is(pg_temp.ca_key('co', 'ka', 'Con clave'), jsonb_build_object('id', pg_temp.id('ak'), 'revision', 1), 'also for a co-teacher of the group: the key is per institution');
select is((select count(*) from app.assessments a where a.op_key = pg_temp.id('ka')), 1::bigint, 'one row');
select is(pg_temp.upa('teach', 'ak', '1', 'exam', 'Cambiado', 'Otras') ->> 'revision', '2', 'the assessment is edited afterwards');
select is(pg_temp.ca_key('teach', 'ka', 'Con clave'), jsonb_build_object('id', pg_temp.id('ak'), 'revision', 1), 'a late retry still answers the original result: the stored identity, not the row');
select pg_temp.mark();
select is(pg_temp.ca_key('teach', 'ka', 'Otro tema') ->> 'error', 'P0001 CONFLICT op_key_reused', 'the same op_key with another topic is CONFLICT op_key_reused');
select is(pg_temp.ca_key('adm2', 'ka', 'Con clave', 'go_n') ->> 'error', 'P0001 CONFLICT op_key_reused', 'in another group of the institution it is CONFLICT op_key_reused, never a second assessment');
select is(pg_temp.as_user('teach', format('select api.create_assessment(%L, ''exam'', ''x'', ''x'', null)', pg_temp.id('g_n'))) ->> 'error', 'P0001 INVALID invalid_op_key', 'a null op_key is INVALID invalid_op_key');
select ok(pg_temp.unchanged(), 'no refusal changed anything');

select pg_temp.keep('xk', pg_temp.adx_key('teach', 'ak', 'kx', 'Enunciado con clave'));
select is(pg_temp.adx_key('teach', 'ak', 'kx', 'Enunciado con clave'), jsonb_build_object('id', pg_temp.id('xk'), 'revision', 1), 'add_exercise: the same op_key and data answer the same exercise');
select is((select count(*) from app.assessment_exercises e where e.assessment_id = pg_temp.id('ak') and e.removed_at is null), 1::bigint, 'one row');
select is(pg_temp.rmx('teach', 'xk', '1') ->> 'revision', '2', 'the exercise is removed afterwards');
select pg_temp.arc('teach', 'ak', '2');
select is(pg_temp.adx_key('teach', 'ak', 'kx', 'Enunciado con clave'), jsonb_build_object('id', pg_temp.id('xk'), 'revision', 1), 'a late retry answers the original result, even with the exercise removed and the assessment archived');
select pg_temp.mark();
select is(pg_temp.adx_key('teach', 'ak', 'kx', 'Otro enunciado') ->> 'error', 'P0001 CONFLICT op_key_reused', 'the same op_key with another text is CONFLICT op_key_reused');
select is(pg_temp.adx_key('teach', 'a1', 'kx', 'Enunciado con clave') ->> 'error', 'P0001 CONFLICT op_key_reused', 'and on another assessment too');
select is(pg_temp.adx_key('teach', 'ak', 'kx2', 'Nuevo') ->> 'error', 'P0001 INVALID assessment_archived', 'a new key on the archived assessment is refused as before');
select is(pg_temp.as_user('teach', format('select api.add_exercise(%L, ''1'', ''x'', null, null)', pg_temp.id('a1'))) ->> 'error', 'P0001 INVALID invalid_op_key', 'a null op_key is INVALID invalid_op_key');
select ok(pg_temp.unchanged(), 'no refusal changed anything');

-- ---------------------------------------------------------------------------------------------
-- archive_assessment, and what an archived assessment (or group) refuses in both directions
-- ---------------------------------------------------------------------------------------------
select pg_temp.keep('a3', pg_temp.ca('teach', 'g_n', 'worksheet', 'Para archivar', ''));
select pg_temp.keep('x1', pg_temp.adx('teach', 'a3', '1', 'Texto'));
select pg_temp.keep('x2', pg_temp.adx('teach', 'a3', '2', 'Texto'));
select is(pg_temp.arc('teach', 'a3', '1'), jsonb_build_object('id', pg_temp.id('a3'), 'revision', 2), 'archiving with the current revision: revision 2');
select is((select a.status from app.assessments a where a.id = pg_temp.id('a3')), 'archived', 'the status is archived');
select is(pg_temp.arc('teach', 'a3', '2'), jsonb_build_object('id', pg_temp.id('a3'), 'revision', 2), 'archiving it again changes nothing and answers the same');
select is(pg_temp.arc('teach', 'a3', '1') ->> 'error', 'P0001 CONFLICT revision_mismatch', 'with an old revision it is CONFLICT revision_mismatch');
select is(pg_temp.arc('teach', 'a3', 'null') ->> 'error', 'P0001 INVALID revision_required', 'with none INVALID revision_required');
select is((select count(*) from jsonb_array_elements(pg_temp.lst('teach', 'g_n') -> 'items') i where i ->> 'id' = pg_temp.id('a3')::text), 0::bigint, 'the list hides it ...');
select is((select count(*) from jsonb_array_elements(pg_temp.lst('teach', 'g_n', 'true, 50, 0') -> 'items') i where i ->> 'id' = pg_temp.id('a3')::text), 1::bigint, '... unless archived ones are asked for');
select is(pg_temp.get('teach', 'a3') -> 'assessment' ->> 'status', 'archived', 'and get_assessment still reads it');
select pg_temp.mark();
select is(pg_temp.upa('teach', 'a3', '2', 'exam', 'x', 'x') ->> 'error', 'P0001 INVALID assessment_archived', 'an archived assessment takes no update');
select is(pg_temp.adx('teach', 'a3', '3', 'x') ->> 'error', 'P0001 INVALID assessment_archived', 'no new exercise');
select is(pg_temp.upx('teach', 'x1', '1', '1', 'otro') ->> 'error', 'P0001 INVALID assessment_archived', 'no edit of an exercise');
select is(pg_temp.rmx('teach', 'x1', '1') ->> 'error', 'P0001 INVALID assessment_archived', 'no removal either: archived is frozen in both directions');
select is(pg_temp.reo('teach', 'a3', '2', array['x2', 'x1']) ->> 'error', 'P0001 INVALID assessment_archived', 'and no reorder');
select ok(pg_temp.unchanged(), 'none of them changed anything');
-- An archived group: the same, through its live assessment; archiving the assessment stays possible.
select pg_temp.keep('a4', pg_temp.ca('teach', 'g_n', 'exam', 'En grupo que se archiva', ''));
select pg_temp.keep('y1', pg_temp.adx('teach', 'a4', '1', 'Texto'));
select pg_temp.keep('y2', pg_temp.adx('teach', 'a4', '2', 'Texto'));
select pg_temp.as_user('teach', format('select api.archive_group(%L, 1)', pg_temp.id('g_n')));
select pg_temp.mark();
select is(pg_temp.adx('teach', 'a4', '3', 'x') ->> 'error', 'P0001 INVALID archived', 'in an archived group an exercise cannot be added');
select is(pg_temp.rmx('teach', 'y1', '1') ->> 'error', 'P0001 INVALID archived', 'nor removed');
select is(pg_temp.upx('teach', 'y1', '1', '1', 'otro') ->> 'error', 'P0001 INVALID archived', 'nor edited');
select is(pg_temp.reo('teach', 'a4', '1', array['y2', 'y1']) ->> 'error', 'P0001 INVALID archived', 'nor reordered');
select is(pg_temp.upa('teach', 'a4', '1', 'exam', 'x', 'x') ->> 'error', 'P0001 INVALID archived', 'nor the assessment updated');
select ok(pg_temp.unchanged(), 'and nothing changed');
select is(pg_temp.get('teach', 'a4') -> 'assessment' ->> 'id', pg_temp.id('a4')::text, 'reading still works');
select is(pg_temp.lst('teach', 'g_n') ->> 'total', '5', 'and listing');
select is(pg_temp.arc('teach', 'a4', '1') ->> 'revision', '2', 'and the assessment can still be archived');
select pg_temp.as_user('teach', format('select api.restore_group(%L, 2)', pg_temp.id('g_n')));

-- ---------------------------------------------------------------------------------------------
-- Guards on what says where a row belongs (as the owner of the table: P0004, not 42501)
-- ---------------------------------------------------------------------------------------------
select throws_ok(format('update app.assessments set group_id = %L where id = %L', pg_temp.id('go_n'), pg_temp.id('a1')), 'P0004', null, 'the group of an assessment never changes');
select throws_ok(format('update app.assessments set subject_id = ''physics'' where id = %L', pg_temp.id('a1')), 'P0004', null, 'nor its subject');
select throws_ok(format('update app.assessments set created_by = %L where id = %L', pg_temp.id('other'), pg_temp.id('a1')), 'P0004', null, 'nor its author, except to null');
select lives_ok(format('update app.assessments set created_by = null where id = %L', pg_temp.id('a2')), 'the author can go to null (the account was deleted)');
select throws_ok(format('update app.assessments set status = ''draft'' where id = %L', pg_temp.id('a3')), 'P0004', null, 'an archived assessment is not reopened');
select throws_ok(format('update app.assessments set institution_id = %L where id = %L', pg_temp.id('i_b'), pg_temp.id('a1')), 'P0004', null, 'nor does it move to another institution (touch_row)');
select throws_ok(format('update app.assessment_exercises set assessment_id = %L where id = %L', pg_temp.id('a2'), pg_temp.id('e1')), 'P0004', null, 'an exercise never moves to another assessment');
select throws_ok(format('update app.assessment_exercises set body = ''x'' where id = %L', pg_temp.id('e2')), 'P0004', null, 'a removed exercise does not change its text');
select throws_ok(format('update app.assessment_exercises set removed_at = null where id = %L', pg_temp.id('e2')), 'P0004', null, 'nor come back');
select throws_ok(format('update app.assessment_exercises set position = 9 where id = %L', pg_temp.id('e2')), 'P0004', null, 'nor move');
select lives_ok(format('update app.assessment_exercises set body = ''x'' where id = %L', pg_temp.id('e1')), 'a live one is edited by the RPCs (the owner here), the guard only protects the removed');

-- The operation stored with a row (T1.F3), as the owner: P0004 from app.op_key_frozen.
select throws_ok(format('update app.assessments set op_key = gen_random_uuid() where id = %L', pg_temp.id('ak')), 'P0004', null, 'the op_key of an assessment never changes');
select throws_ok(format('update app.assessments set op_identity = repeat(''0'', 64) where id = %L', pg_temp.id('ak')), 'P0004', null, 'nor its identity');
select throws_ok(format('update app.assessments set op_key = null, op_identity = null where id = %L', pg_temp.id('ak')), 'P0004', null, 'nor are both cleared outside an erasure');
select throws_ok(format('update app.assessment_exercises set op_key = gen_random_uuid() where id = %L', pg_temp.id('xk')), 'P0004', null, 'the op_key of an exercise never changes, removed or not');
select throws_ok(format('update app.assessment_exercises set op_identity = repeat(''0'', 64) where id = %L', pg_temp.id('e1')), 'P0004', null, 'nor its identity');
select throws_ok(format('update app.versions set op_key = gen_random_uuid(), op_identity = repeat(''0'', 64) where id = %L', pg_temp.id('v1')), 'P0004', null, 'a version gets no operation after its creation (T1.4b writes it in the insert)');
select throws_ok(format('insert into app.versions (institution_id, assessment_id, position, op_key) values (%L, %L, 9, gen_random_uuid())', pg_temp.id('i_n'), pg_temp.id('a1')), '23514', null, 'and a version with an op_key needs its identity (both or neither)');
insert into ids (k, id) values ('pub', gen_random_uuid());
insert into app.publications (id, institution_id, assessment_id, version_id, version_revision, content, answer_mode, op_key, op_identity, op_attempts)
  values (pg_temp.id('pub'), pg_temp.id('i_n'), pg_temp.id('a1'), pg_temp.id('v2'), 1, '{}', 'typed', gen_random_uuid(), repeat('a', 64), 2);
select throws_ok(format('update app.publications set op_attempts = 3 where id = %L', pg_temp.id('pub')), 'P0004', null, 'the operation of a publication never changes (publications_guard), not even its attempts count');
select throws_ok(format('update app.publications set op_key = null, op_identity = null, op_attempts = null where id = %L', pg_temp.id('pub')), 'P0004', null, 'nor is it cleared');
select throws_ok(format('insert into app.publications (institution_id, assessment_id, version_id, version_revision, content, answer_mode, op_key, op_identity) values (%L, %L, %L, 1, ''{}'', ''typed'', gen_random_uuid(), repeat(''a'', 64))', pg_temp.id('i_n'), pg_temp.id('a1'), pg_temp.id('v2')),
  '23514', null, 'a publication with an op_key stores the attempts count it answered');
select has_index('app', 'answer_key_revisions', 'answer_key_revisions_generation_key', 'one key revision per generation: a retried job writes it once (T1.4e)');
-- Inside an erasure of the institution the identity of a redacted text can be forgotten, both
-- columns together; never in a group, and never once the erasure is done.
insert into ids (k, id) values ('era', gen_random_uuid());
insert into app.erasures (id, institution_id, kind) values (pg_temp.id('era'), pg_temp.id('i_n'), 'institution');
select app.begin_erasure(pg_temp.id('era'));
select throws_ok(format('update app.assessments set op_key = null where id = %L', pg_temp.id('ak')), 'P0004', null, 'inside an erasure the key alone is not cleared');
select lives_ok(format('update app.assessments set op_key = null, op_identity = null where id = %L', pg_temp.id('ak')), 'inside an erasure both are cleared on an assessment');
select lives_ok(format('update app.assessment_exercises set op_key = null, op_identity = null where id = %L', pg_temp.id('e1')), 'and on an exercise');
select throws_ok(format('update app.assessment_exercises set op_key = gen_random_uuid(), op_identity = repeat(''0'', 64) where id = %L', pg_temp.id('e3')), 'P0004', null, 'but never rewritten');
select throws_ok(format('update app.groups set op_key = null, op_identity = null where id = %L', pg_temp.id('g_n')), 'P0004', null, 'a group never forgets its operation, not even in an erasure');
update app.erasures set status = 'done', completed_at = now() where id = pg_temp.id('era');
select throws_ok(format('update app.assessments set op_key = null, op_identity = null where id = %L', pg_temp.id('a2')), 'P0004', null, 'once the erasure is done, nothing is cleared');
-- The RPCs below refuse to run while the marker is set at all; the test removes it.
select set_config('tiza.erasure', '', true);

-- ---------------------------------------------------------------------------------------------
-- T1.F4 (F3-2): the replay of an add_exercise does not depend on the unit of the syllabus still
-- existing. Shape and authorization first, then the op_key lock and lookup, and only for a new
-- exercise the reference (the topic).
-- ---------------------------------------------------------------------------------------------
insert into ids (k, id) select k, gen_random_uuid() from unnest(array['pfk', 'tk', 'tk2']) k;
create function pg_temp.adt_key(p_user text, p_asm text, p_key text, p_body text, p_topic text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.add_exercise(%L, ''1'', %L, %L, %s)', pg_temp.id(p_asm), p_body, pg_temp.id(p_key), p_topic))
$$;
-- A new assessment (pf) in g_n: its topic and its exercise are what F3-1 below edits and erases.
select pg_temp.keep('pf', pg_temp.ca_key('teach', 'pfk', 'Práctico para Paula'));
select pg_temp.keep('xt', pg_temp.adt_key('teach', 'pf', 'tk', 'Enunciado para Paula', quote_literal(pg_temp.id('unit'))));
update app.syllabi set units = '[]' where group_id = pg_temp.id('g_n');
select is(pg_temp.adt_key('teach', 'pf', 'tk', 'Enunciado para Paula', quote_literal(pg_temp.id('unit'))), jsonb_build_object('id', pg_temp.id('xt'), 'revision', 1),
  'the replay of an exercise whose unit was deleted since answers the original result');
select is(pg_temp.adt_key('teach', 'pf', 'tk', 'Otro enunciado', quote_literal(pg_temp.id('unit'))) ->> 'error', 'P0001 CONFLICT op_key_reused',
  'the identity is compared first: another text with the same key is CONFLICT, not unknown_topic');
select is(pg_temp.adt_key('teach', 'pf', 'tk2', 'Nuevo', quote_literal(pg_temp.id('unit'))) ->> 'error', 'P0001 INVALID unknown_topic',
  'a new exercise on the deleted unit is INVALID unknown_topic');
select is(pg_temp.upx('teach', 'xt', '1', '1', 'Editado', quote_literal(pg_temp.id('unit'))) ->> 'error', 'P0001 INVALID unknown_topic',
  'update_exercise still validates the topic');
select is(pg_temp.adt_key('other', 'pf', 'tk', 'Enunciado para Paula', quote_literal(pg_temp.id('unit'))) ->> 'error', 'P0001 NOT_FOUND not_found',
  'authorization comes first: a teacher of another group never gets the replay');
select is((select count(*) from app.assessment_exercises e where e.assessment_id = pg_temp.id('pf')), 1::bigint, 'one exercise: no refusal created another');
update app.syllabi set units = jsonb_build_array(jsonb_build_object('id', pg_temp.id('unit'), 'title', 'Unidad 1', 'contents', ''))
 where group_id = pg_temp.id('g_n');

-- ---------------------------------------------------------------------------------------------
-- T1.F4 (F3-1): create, edit to neutral text, erase. The identity is a hash of the text AS CREATED
-- ("Para Paula"), so an erasure forgets it whatever the text says now: erasing a student nulls
-- op_key and op_identity of every assessment and exercise of the groups where they were ever
-- enrolled (erasure.ts, `nullifies`). The statements below are that rule.
-- ---------------------------------------------------------------------------------------------
create function pg_temp.forget_operations(p_student uuid) returns void language sql as $$
  update app.assessments a set op_key = null, op_identity = null
   where a.group_id in (select e.group_id from app.enrollments e where e.student_id = p_student);
  update app.assessment_exercises x set op_key = null, op_identity = null
   where x.assessment_id in (select a.id from app.assessments a
                              where a.group_id in (select e.group_id from app.enrollments e where e.student_id = p_student));
$$;
select is(pg_temp.upa('teach', 'pf', '1', 'worksheet', 'Repaso', 'Instrucciones') ->> 'revision', '2', 'the assessment is edited to neutral text');
select is(pg_temp.upx('teach', 'xt', '1', '1', 'Enunciado neutro') ->> 'revision', '2', 'and so is its exercise');
select is((select a.topic from app.assessments a where a.id = pg_temp.id('pf')), 'Repaso', 'the text no longer names anyone ...');
select is((select a.op_identity = encode(sha256(convert_to(jsonb_build_array('create_assessment', pg_temp.id('g_n'), 'worksheet', 'Práctico para Paula', 'Instrucciones')::text, 'utf8')), 'hex')
             from app.assessments a where a.id = pg_temp.id('pf')),
  true, '... but the identity is still the hash of the text as it was created: a candidate name can be checked against it');
select throws_ok(format('select pg_temp.forget_operations(%L)', pg_temp.id('sn1')), 'P0004', null, 'outside an erasure the identity cannot be forgotten');
insert into ids (k, id) values ('era_s', gen_random_uuid());
insert into app.erasures (id, institution_id, kind, pseudonym_id)
  select pg_temp.id('era_s'), pg_temp.id('i_n'), 'student', p.id from app.student_pseudonyms p where p.student_id = pg_temp.id('sn1');
select app.begin_erasure(pg_temp.id('era_s'));
select lives_ok(format('select pg_temp.forget_operations(%L)', pg_temp.id('sn1')), 'inside the erasure of sn1 the rule runs: the groups where sn1 was enrolled lose their operations');
select is((select count(*) from app.assessments a where a.group_id = pg_temp.id('g_n') and (a.op_key is not null or a.op_identity is not null)), 0::bigint,
  'no assessment of g_n keeps its op_key or op_identity, edited or not (pf was edited to neutral text)');
select is((select count(*) from app.assessment_exercises x join app.assessments a on a.id = x.assessment_id
            where a.group_id = pg_temp.id('g_n') and (x.op_key is not null or x.op_identity is not null)), 0::bigint,
  'nor any exercise of those assessments, removed or not');
select is((select count(*) from app.assessments a where a.group_id = pg_temp.id('go_n') and a.op_identity is not null), (select count(*) from app.assessments a where a.group_id = pg_temp.id('go_n')),
  'negative: a group where sn1 was never enrolled keeps every identity (the rule is not wider than it says)');
update app.erasures set status = 'done', completed_at = now() where id = pg_temp.id('era_s');
select set_config('tiza.erasure', '', true);

-- ---------------------------------------------------------------------------------------------
-- The permission matrix by RPC: each role that must be denied, with code and reason, and the proof
-- that nothing changed (assessments, exercises, versions and audit rows of the institution).
-- ---------------------------------------------------------------------------------------------
create function pg_temp.denied(p_sql text, p_users text[]) returns text language plpgsql as $$
declare
  v_before text := pg_temp.digest();
  v_out text;
begin
  select string_agg(u.k || '=' || coalesce(pg_temp.as_user(u.k, p_sql) ->> 'error', 'ALLOWED'), ';' order by u.n) into v_out
    from unnest(p_users) with ordinality as u(k, n);
  return v_out || ' changed=' || (v_before <> pg_temp.digest())::text;
end
$$;
create function pg_temp.expect(p_users text[], p_codes text) returns text language sql as $$
  select string_agg(u.k || '=P0001 ' || case substr(p_codes, u.n::integer, 1)
                      when 'F' then 'FORBIDDEN forbidden' when 'N' then 'NOT_FOUND not_found'
                      when 'S' then 'FORBIDDEN no_session' end, ';' order by u.n) || ' changed=false'
    from unnest(p_users) with ordinality as u(k, n)
$$;
-- g_n is restored; a1 and e1 belong to it. adm2 is an admin who teaches go_n, not g_n.
select is(pg_temp.denied(format('select api.create_assessment(%L, ''exam'', ''x'', ''x'', gen_random_uuid())', pg_temp.id('g_n')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'create_assessment: an admin who does not teach the group, inclusion and a student are FORBIDDEN; other group, other institution and no membership NOT_FOUND; no session FORBIDDEN');
select is(pg_temp.denied(format('select api.update_assessment(%L, 4, ''exam'', ''x'', ''x'')', pg_temp.id('a1')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'update_assessment: same');
select is(pg_temp.denied(format('select api.archive_assessment(%L, 4)', pg_temp.id('a1')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'archive_assessment: same');
select is(pg_temp.denied(format('select api.list_assessments(%L)', pg_temp.id('g_n')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'list_assessments: same');
select is(pg_temp.denied(format('select api.get_assessment(%L)', pg_temp.id('a1')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'get_assessment: same, and nothing leaks to who cannot read');
select is(pg_temp.denied(format('select api.add_exercise(%L, ''9'', ''x'', gen_random_uuid(), null)', pg_temp.id('a1')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'add_exercise: same');
select is(pg_temp.denied(format('select api.update_exercise(%L, 4, ''1'', ''x'', null)', pg_temp.id('e1')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'update_exercise: same');
select is(pg_temp.denied(format('select api.remove_exercise(%L, 4)', pg_temp.id('e1')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'remove_exercise: same');
select is(pg_temp.denied(format('select api.reorder_exercises(%L, 3, %s)', pg_temp.id('a1'), pg_temp.idarr(array['e1', 'e3', 'e4'])), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'reorder_exercises: same');
select is(pg_temp.as_anon(format('select api.create_assessment(%L, ''exam'', ''x'', ''x'', gen_random_uuid())', pg_temp.id('g_n'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.update_assessment(%L, 1, ''exam'', ''x'', ''x'')', pg_temp.id('a1'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.archive_assessment(%L, 1)', pg_temp.id('a1'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.list_assessments(%L)', pg_temp.id('g_n'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.get_assessment(%L)', pg_temp.id('a1'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.add_exercise(%L, ''1'', ''x'', gen_random_uuid(), null)', pg_temp.id('a1'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.update_exercise(%L, 1, ''1'', ''x'', null)', pg_temp.id('e1'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.remove_exercise(%L, 1)', pg_temp.id('e1'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.reorder_exercises(%L, 1, %s)', pg_temp.id('a1'), pg_temp.idarr(array['e1']))) ->> 'error' like '42501%', true,
  'anon cannot execute any of the nine');
-- Positive side of the matrix: an admin who also teaches a group works in it like a teacher.
select is(pg_temp.keep('a5', pg_temp.ca('adm2', 'go_n', 'exam', 'Del admin que enseña', '')) ->> 'revision', '1', 'an admin who also teaches go_n creates an assessment in it');
select is(pg_temp.adx('adm2', 'a5', '1', 'Texto') ->> 'revision', '1', 'and adds an exercise');
select is(pg_temp.get('other', 'a5') -> 'assessment' ->> 'id', pg_temp.id('a5')::text, 'the owner of go_n reads it');
select is(pg_temp.get('teach', 'a5') ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher of another group of the same institution cannot');
-- No refusal above created a stray row.
select is((select count(*) from app.assessments a where a.institution_id = pg_temp.id('i_n')), 9::bigint, 'nine assessments exist (pf is the one of T1.F4): none came from a refusal or a replay');

select * from finish();
rollback;
