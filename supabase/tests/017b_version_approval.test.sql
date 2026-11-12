-- T1.4c, part b: approving and rejecting one revision of a version, how an edit after the approval takes
-- it back, what an archived version, assessment or group refuses, and the permission matrix of the six
-- RPCs of T1.4c (the edits themselves are in 017a). Questions are seeded as the owner (T1.4d writes
-- them), and so are generations and the states a generation leaves (error, generating). The whole file is
-- rolled back.
begin;
-- Phase 1 links ordinary accounts (any email) to students; the shape guard of phase 2 (T2.5a) is off in this file. 040_f2_contract covers it.
alter table app.account_provisioning disable trigger student_auth_link_guard;
select plan(112);

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
  'admin', 'teach', 'other', 'incl', 'userb', 'nobody', 'ghost', 'adm2', 'stu_a', 'stu_b'
]) as k;
insert into auth.users (id, email) select id, k || '@t1-4c-b.invalid' from ids where k <> 'ghost';
do $$
declare
  k text;
begin
  for k in select ids.k from ids where ids.k <> 'ghost' loop
    perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;

-- Institution n: admin, teachers teach (g_n, g_z) and other (go_n), inclusion; adm2 is an admin who teaches
-- go_n. s1 (stu_a) is in g_n and sx (stu_b) in go_n. Institution b: userb.
insert into ids (k, id) select 'i_n', (pg_temp.as_service($$ select api.internal_create_institution('Liceo N', 't1-4c-b', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, %L)', pg_temp.id('i_n'), pg_temp.id(u.k), u.role))
  from (values ('admin', 'admin'), ('teach', 'teacher'), ('other', 'teacher'), ('adm2', 'admin'), ('incl', 'inclusion')) as u(k, role);
insert into ids (k, id) values
  ('g_n', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid),
  ('g_z', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º Z'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid),
  ('go_n', (pg_temp.as_user('other', format('select api.create_group(%L, ''3.º B'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid);
select pg_temp.as_user('other', format('select api.add_group_staff(%L, %L, ''co_teacher'')', pg_temp.id('go_n'), pg_temp.id('adm2')));
insert into ids (k, id) values
  ('s1', (pg_temp.as_user('teach', format('select api.create_student(%L, ''Estudiante 1'', ''est.1'', gen_random_uuid())', pg_temp.id('g_n'))) ->> 'id')::uuid),
  ('sx', (pg_temp.as_user('other', format('select api.create_student(%L, ''Estudiante X'', ''est.x'', gen_random_uuid())', pg_temp.id('go_n'))) ->> 'id')::uuid);
select pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('s1'), pg_temp.id('stu_a')));
select pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('sx'), pg_temp.id('stu_b')));
insert into ids (k, id) select 'i_b', (pg_temp.as_service($$ select api.internal_create_institution('Liceo B', 't1-4c-b-b', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_b'), pg_temp.id('userb')));

create function pg_temp.mk_asm(p_user text, p_group text, p_key text, p_instr text default '') returns void language plpgsql as $$
begin
  perform pg_temp.keep(p_key, pg_temp.as_user(p_user, format('select api.create_assessment(%L, ''worksheet'', ''Repaso'', %L, gen_random_uuid())', pg_temp.id(p_group), p_instr)));
end $$;
create function pg_temp.mk_ex(p_user text, p_asm text, p_key text, p_body text) returns void language plpgsql as $$
begin
  perform pg_temp.keep(p_key, pg_temp.as_user(p_user, format('select api.add_exercise(%L, %L, %L, gen_random_uuid(), null)', pg_temp.id(p_asm), right(p_key, 1), p_body)));
end $$;
-- A version of its own assessment with p_n exercises, an answer key row, and one question (options A, B, C)
-- in its first adapted exercise, written as the owner. Keys: the version p, its exercises x_p1.., its question q_p.
create function pg_temp.mkv(p_user text, p_group text, p text, p_n integer default 1, p_mode text default 'typed') returns void language plpgsql as $$
declare
  i integer;
begin
  perform pg_temp.mk_asm(p_user, p_group, 'a_' || p, 'Instrucciones');
  for i in 1..p_n loop
    perform pg_temp.mk_ex(p_user, 'a_' || p, 'e_' || p || i, 'Enunciado ' || i);
  end loop;
  perform pg_temp.keep(p, pg_temp.as_user(p_user, format($q$ select api.create_version(%L, '{"profiles":["motor"],"supports":[],"interests":[]}'::jsonb, %L, gen_random_uuid(), null) $q$,
    pg_temp.id('a_' || p), p_mode)));
  insert into ids (k, id) select 'x_' || p || row_number() over (order by e.position), ve.id
    from app.version_exercises ve join app.assessment_exercises e on e.id = ve.exercise_id where ve.version_id = pg_temp.id(p);
  insert into ids (k, id) values ('q_' || p, gen_random_uuid());
  insert into app.version_questions (id, institution_id, version_id, version_exercise_id, position, stem, options)
    select pg_temp.id('q_' || p), ve.institution_id, ve.version_id, ve.id, 0, '¿Cuánto es 2 + 2?', '[{"id":"A","text":"3"},{"id":"B","text":"4"},{"id":"C","text":"5"}]'::jsonb
      from app.version_exercises ve where ve.id = pg_temp.id('x_' || p || '1');
  insert into app.answer_keys (institution_id, version_id) select v.institution_id, v.id from app.versions v where v.id = pg_temp.id(p);
end $$;
select pg_temp.mkv('teach', 'g_n', 'va', 3);
select pg_temp.mkv('teach', 'g_n', 'vb', 2, 'gaze');
select pg_temp.mkv('teach', 'g_n', 'vg', 2, 'gaze');
select pg_temp.mkv('teach', 'g_n', 'vc', 1);
select pg_temp.mkv('other', 'go_n', 'vo', 1);
select pg_temp.mkv('teach', 'g_n', 'vs1', 1);
select pg_temp.mkv('teach', 'g_n', 'vs2', 1);
select pg_temp.mkv('teach', 'g_z', 'vs3', 1);
insert into ids (k, id) select 'op' || n, gen_random_uuid() from generate_series(1, 120) n;
create function pg_temp.op(p_n integer) returns text language sql as $$ select quote_literal(pg_temp.id('op' || p_n)) $$;

-- The calls under test. Revisions and op ids are SQL.
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
create function pg_temp.apv(p_user text, p_ver text, p_rev text, p_op text default 'gen_random_uuid()') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.approve_version(%L, %s, %s)', pg_temp.id(p_ver), p_rev, p_op))
$$;
create function pg_temp.rjv(p_user text, p_ver text, p_rev text, p_reasons text, p_op text default 'gen_random_uuid()') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.reject_version(%L, %s, %L::text[], %s)', pg_temp.id(p_ver), p_rev, p_reasons, p_op))
$$;
create function pg_temp.lv(p_asm text) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format('select api.list_versions(%L)', pg_temp.id(p_asm)))
$$;
create function pg_temp.gv(p_ver text) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format('select api.get_version(%L)', pg_temp.id(p_ver)))
$$;
-- The current revision of a version, to call as the teacher who just read it.
create function pg_temp.rev(p_ver text) returns text language sql as $$ select v.revision::text from app.versions v where v.id = pg_temp.id(p_ver) $$;
-- Writes the text of every adapted exercise of a version by hand: the way a version without any generation gets its content.
create function pg_temp.fill(p_user text, p_ver text) returns void language plpgsql as $$
declare
  r record;
begin
  for r in select ve.id, ve.revision from app.version_exercises ve where ve.version_id = pg_temp.id(p_ver) order by ve.id loop
    perform pg_temp.as_user(p_user, format('select api.update_version_exercise(%L, %s, ''Texto de la persona'', gen_random_uuid())', r.id, r.revision));
  end loop;
end $$;
-- Whether list_versions says a version is approved, and whether approved_revision is the current revision.
create function pg_temp.approved(p_asm text, p_ver text) returns boolean language sql as $$
  select (i ->> 'approved')::boolean from jsonb_array_elements(pg_temp.lv(p_asm) -> 'items') i where i ->> 'id' = pg_temp.id(p_ver)::text
$$;
create function pg_temp.approved_rev(p_ver text) returns text language sql as $$
  select coalesce(v.approved_revision::text, 'null') || '/' || v.revision from app.versions v where v.id = pg_temp.id(p_ver)
$$;

-- Everything these RPCs can change, as one string.
create function pg_temp.digest() returns text language sql as $$
  select md5(coalesce((select string_agg(concat_ws('|', v.id, v.revision, v.instructions_revision, v.general_instructions, v.approved_revision, v.status, v.stale, v.archived_at), ';' order by v.id)
                         from app.versions v where v.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', ve.id, ve.revision, ve.body, ve.status, ve.error_code), ';' order by ve.id)
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

-- ---------------------------------------------------------------------------------------------
-- approve_version: a version written by hand, with no generation, is approved when it is complete.
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from app.generations g where g.version_id = pg_temp.id('va')), 0::bigint, 'va has no generation at all, and its answer mode is typed');
select is((select concat_ws('|', v.status, v.answer_mode, v.current_generation_id is null, v.approved_revision is null) from app.versions v where v.id = pg_temp.id('va')), 'empty|typed|t|t', 'it starts empty');
select pg_temp.mark();
select is(pg_temp.apv('teach', 'va', '1') ->> 'error', 'P0001 CONFLICT content_incomplete', 'approving it with every exercise pending is CONFLICT content_incomplete');
select ok(pg_temp.unchanged(), 'and nothing changed: no approval, no event');
select is(pg_temp.uve('teach', 'x_va1', '1', 'Texto 1') ->> 'revision', '2', 'the teacher completes the first exercise by hand');
select is(pg_temp.uve('teach', 'x_va2', '1', 'Texto 2') ->> 'revision', '2', 'and the second');
select is((select v.status from app.versions v where v.id = pg_temp.id('va')), 'empty', 'with one exercise still pending the version is not ready');
select is(pg_temp.apv('teach', 'va', pg_temp.rev('va')) ->> 'error', 'P0001 CONFLICT content_incomplete', 'and it cannot be approved: content_incomplete, with the revision right');
select is(pg_temp.uve('teach', 'x_va3', '1', 'Texto 3') ->> 'revision', '2', 'the third one completes it');
select is((select v.status from app.versions v where v.id = pg_temp.id('va')), 'ready', 'the version, with no generation ever, is ready: every exercise has text');
select is((select v.revision from app.versions v where v.id = pg_temp.id('va')), 4, 'three edits, revision 4');
select is(pg_temp.keys(pg_temp.apv('teach', 'va', '4', pg_temp.op(1))), 'approvedRevision,id', 'and it is approved: the answer is the version and the revision approved');
select is(pg_temp.apv('teach', 'va', '4', pg_temp.op(1)), jsonb_build_object('id', pg_temp.id('va'), 'approvedRevision', 4), 'it is revision 4 (and the same op_id answers it again)');
select is(pg_temp.approved_rev('va'), '4/4', 'approved_revision is the revision, and approving did not move the revision');
select is((select concat_ws('|', e.kind, e.operation, e.target_id = pg_temp.id('va'), e.version_revision, e.version_exercise_id is null, e.actor_user_id = pg_temp.id('teach'),
                              e.data = jsonb_build_object('revision', 4), e.result = jsonb_build_object('id', pg_temp.id('va'), 'approvedRevision', 4))
             from app.version_events e where e.op_id = pg_temp.id('op1')), 'approved|approve_version|t|4|t|t|t|t', 'one approved event with the revision it covers, who approved and the answer given');
select is((select count(*) from app.version_events e where e.version_id = pg_temp.id('va') and e.kind = 'approved'), 1::bigint, 'and only one, however many times it was asked');
select is(pg_temp.approved('a_va', 'va'), true, 'list_versions shows it as approved');
select pg_temp.mark();
select is(pg_temp.apv('teach', 'va', '3', pg_temp.op(1)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'the same op_id with another revision is CONFLICT op_key_reused');
select is(pg_temp.apv('teach', 'vc', '1', pg_temp.op(1)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'on another version too');
select is(pg_temp.rjv('teach', 'va', '4', '{no_adapta}', pg_temp.op(1)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'and used by another RPC');
select is(pg_temp.uvi('teach', 'va', '1', 'Texto', pg_temp.op(1)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'also by an edit of the same version');
select is(pg_temp.apv('teach', 'va', '3') ->> 'error', 'P0001 CONFLICT revision_mismatch', 'an old revision is CONFLICT revision_mismatch');
select is(pg_temp.apv('teach', 'va', '5') ->> 'error', 'P0001 CONFLICT revision_mismatch', 'and so is one from the future');
select is(pg_temp.apv('teach', 'va', 'null') ->> 'error', 'P0001 INVALID revision_required', 'a missing one is INVALID revision_required');
select is(pg_temp.apv('teach', 'va', '4', 'null') ->> 'error', 'P0001 INVALID invalid_op_key', 'a missing op_id is INVALID invalid_op_key');
select is(pg_temp.as_user('teach', 'select api.approve_version(null, 1, gen_random_uuid())') ->> 'error', 'P0001 NOT_FOUND not_found', 'a null version is NOT_FOUND');
select is(pg_temp.as_user('teach', format('select api.approve_version(%L, 1, gen_random_uuid())', gen_random_uuid())) ->> 'error', 'P0001 NOT_FOUND not_found', 'one that does not exist too');
select ok(pg_temp.unchanged(), 'none of them changed anything');
select is(pg_temp.apv('teach', 'va', '4') ->> 'approvedRevision', '4', 'approving again the revision already approved, with a new op_id, is fine');
select is((select count(*) from app.version_events e where e.version_id = pg_temp.id('va') and e.kind = 'approved'), 2::bigint, 'and is recorded: it is a decision of the teacher');
-- A text that looks like it says the solution does not block the approval: the service only warns.
select is(pg_temp.uve('teach', 'x_va1', '2', 'La respuesta correcta es: B') ->> 'revision', '3', 'an exercise whose text announces its answer is saved');
select is(pg_temp.uvi('teach', 'va', '1', 'Solución: A') ->> 'instructionsRevision', '2', 'and so are the instructions');
select is(pg_temp.apv('teach', 'va', pg_temp.rev('va')) ->> 'approvedRevision', '6', 'the version is approved all the same, at revision 6: a warning is not a block (the service computes it over get_version)');

-- ---------------------------------------------------------------------------------------------
-- What is not complete is not approved.
-- ---------------------------------------------------------------------------------------------
select pg_temp.fill('teach', 'vg');
select is((select v.status from app.versions v where v.id = pg_temp.id('vg')), 'ready', 'vg is gaze with no questions and complete');
select is(pg_temp.apv('teach', 'vg', pg_temp.rev('vg')) ->> 'approvedRevision', '3', 'a gaze version without questions or a key is approved: publishing is what asks for them (T1.5a)');
select pg_temp.mkv('teach', 'g_n', 'vh', 2);
select pg_temp.fill('teach', 'vh');
update app.version_exercises set status = 'error', error_code = 'model_error' where id = pg_temp.id('x_vh1');
select is(pg_temp.apv('teach', 'vh', pg_temp.rev('vh')) ->> 'error', 'P0001 CONFLICT content_incomplete', 'an exercise in error is content_incomplete');
update app.version_exercises set status = 'generating' where id = pg_temp.id('x_vh1');
select is(pg_temp.apv('teach', 'vh', pg_temp.rev('vh')) ->> 'error', 'P0001 CONFLICT content_incomplete', 'a generating one too');
update app.version_exercises set status = 'ready' where id = pg_temp.id('x_vh1');
insert into ids (k, id) values ('gen_vh', gen_random_uuid());
insert into app.generations (id, institution_id, version_id, kind, target_revision, op_key, subject_id, inputs, profiles_hash, profiles_revision, prompt_version, required_jobs)
  values (pg_temp.id('gen_vh'), pg_temp.id('i_n'), pg_temp.id('vh'), 'version', 1, gen_random_uuid(), 'math', '{}', repeat('a', 64), 'r1', 'p1', 1);
select is(pg_temp.apv('teach', 'vh', pg_temp.rev('vh')) ->> 'error', 'P0001 CONFLICT content_incomplete', 'every exercise ready but a generation still running is content_incomplete too');
update app.generations set status = 'done', finished_at = clock_timestamp() where id = pg_temp.id('gen_vh');
select is(pg_temp.apv('teach', 'vh', pg_temp.rev('vh')) ->> 'approvedRevision', '3', 'with the generation finished, the same version is approved');
select pg_temp.mkv('teach', 'g_n', 'vi', 1);
select pg_temp.fill('teach', 'vi');
select is(pg_temp.uve('teach', 'x_vi1', pg_temp.rev('vi'), '   ') ->> 'versionRevision', '3', 'an exercise emptied by hand goes back to pending');
select is(pg_temp.apv('teach', 'vi', pg_temp.rev('vi')) ->> 'error', 'P0001 CONFLICT content_incomplete', 'and the version is not complete any more');

-- ---------------------------------------------------------------------------------------------
-- After the approval, any change of content leaves the version unapproved (vb: two exercises, a question).
-- ---------------------------------------------------------------------------------------------
select pg_temp.fill('teach', 'vb');
create function pg_temp.approve_now(p_ver text) returns text language sql as $$
  select pg_temp.apv('teach', p_ver, pg_temp.rev(p_ver)) ->> 'approvedRevision'
$$;
select is(pg_temp.approve_now('vb'), pg_temp.rev('vb'), 'vb is approved at its current revision');
select is(pg_temp.approved('a_vb', 'vb'), true, 'and listed as approved');
select is(pg_temp.uvi('teach', 'vb', '1', 'Instrucciones nuevas') ->> 'instructionsRevision', '2', 'the teacher edits the instructions after approving');
select is(pg_temp.approved('a_vb', 'vb'), false, 'the version is no longer approved');
select is((select v.approved_revision < v.revision from app.versions v where v.id = pg_temp.id('vb')), true, 'approved_revision stayed behind the revision');
select is(pg_temp.apv('teach', 'vb', (select v.approved_revision::text from app.versions v where v.id = pg_temp.id('vb'))) ->> 'error', 'P0001 CONFLICT revision_mismatch', 'and the old revision cannot be approved again');
select is(pg_temp.approve_now('vb'), pg_temp.rev('vb'), 'approved again at the new revision');
select is(pg_temp.uve('teach', 'x_vb2', (select ve.revision::text from app.version_exercises ve where ve.id = pg_temp.id('x_vb2')), 'Otro texto') ->> 'revision' is not null, true, 'the teacher edits an exercise');
select is(pg_temp.approved('a_vb', 'vb'), false, 'the version is not approved');
select is(pg_temp.approve_now('vb'), pg_temp.rev('vb'), 'approved again');
select is(pg_temp.uvq('teach', 'q_vb', '1', '¿Cuánto es 2 + 2?', '[{"id":"A","text":"3"},{"id":"B","text":"cuatro"},{"id":"C","text":"5"}]') ->> 'revision', '2', 'the teacher changes the text of one option (the stem is the same)');
select is(pg_temp.approved('a_vb', 'vb'), false, 'the version is not approved');
select is(pg_temp.approve_now('vb'), pg_temp.rev('vb'), 'approved again');
select is(pg_temp.sqk('teach', 'q_vb', 'B') ->> 'revision', '1', 'the teacher sets the correct option');
select is(pg_temp.approved('a_vb', 'vb'), false, 'the version is not approved');
select is(pg_temp.approve_now('vb'), pg_temp.rev('vb'), 'approved again');
select is(pg_temp.sqk('teach', 'q_vb', 'C', '1') ->> 'revision', '2', 'the teacher changes the correct option');
select is(pg_temp.approved('a_vb', 'vb'), false, 'the version is not approved');
select is(pg_temp.approved_rev('vb') ~ '^\d+/\d+$' and (select v.approved_revision < v.revision from app.versions v where v.id = pg_temp.id('vb')), true, 'approved_revision is behind the revision');
select is(pg_temp.approve_now('vb'), pg_temp.rev('vb'), 'approved once more, to see that a rejection takes it back');

-- ---------------------------------------------------------------------------------------------
-- reject_version
-- ---------------------------------------------------------------------------------------------
select pg_temp.mark();
select is(pg_temp.rjv('teach', 'vb', pg_temp.rev('vb'), '{}', pg_temp.op(30)) ->> 'error', 'P0001 INVALID invalid_reasons', 'a rejection with no reason is INVALID invalid_reasons');
select is(pg_temp.as_user('teach', format('select api.reject_version(%L, %s, null, gen_random_uuid())', pg_temp.id('vb'), pg_temp.rev('vb'))) ->> 'error', 'P0001 INVALID invalid_reasons', 'a null list too');
select is(pg_temp.rjv('teach', 'vb', pg_temp.rev('vb'), '{no_adapta,NULL}') ->> 'error', 'P0001 INVALID invalid_reasons', 'a null reason too');
select is(pg_temp.rjv('teach', 'vb', pg_temp.rev('vb'), '{a,b,c,d,e,f,g,h,i,j,k}') ->> 'error', 'P0001 INVALID invalid_reasons', 'and eleven reasons');
select is(pg_temp.rjv('teach', 'vb', pg_temp.rev('vb'), '{"Mal motivo"}') ->> 'error', 'P0001 INVALID invalid_reasons', 'a reason that is not snake_case too');
select is(pg_temp.rjv('teach', 'vb', pg_temp.rev('vb'), '{x}') ->> 'error', 'P0001 INVALID invalid_reasons', 'a single character too');
select is(pg_temp.rjv('teach', 'vb', pg_temp.rev('vb'), format('{%s}', 'a' || repeat('b', 41))) ->> 'error', 'P0001 INVALID invalid_reasons', 'and one of 42 characters');
select is(pg_temp.rjv('teach', 'vb', pg_temp.rev('vb'), '{no_adapta}', 'null') ->> 'error', 'P0001 INVALID invalid_op_key', 'a missing op_id is INVALID invalid_op_key');
select is(pg_temp.rjv('teach', 'vb', 'null', '{no_adapta}') ->> 'error', 'P0001 INVALID revision_required', 'a missing revision is INVALID revision_required');
select is(pg_temp.rjv('teach', 'vb', '1', '{no_adapta}') ->> 'error', 'P0001 CONFLICT revision_mismatch', 'an old revision is CONFLICT revision_mismatch');
select is(pg_temp.as_user('teach', 'select api.reject_version(null, 1, ''{no_adapta}'', gen_random_uuid())') ->> 'error', 'P0001 NOT_FOUND not_found', 'a null version is NOT_FOUND');
select is(pg_temp.as_user('teach', format('select api.reject_version(%L, 1, ''{no_adapta}'', gen_random_uuid())', gen_random_uuid())) ->> 'error', 'P0001 NOT_FOUND not_found', 'one that does not exist too');
select ok(pg_temp.unchanged(), 'and none changed anything');
create temp table rej as select pg_temp.rev('vb') as rev, pg_temp.rjv('teach', 'vb', pg_temp.rev('vb'), '{no_adapta,confuso}', pg_temp.op(30)) as res;
select is(pg_temp.keys((select res from rej)), 'eventId', 'a teacher rejects the approved revision with two reasons: the answer is the id of the event');
select is((select concat_ws('|', e.kind, e.operation, e.target_id = pg_temp.id('vb'), e.version_revision::text = (select rev from rej), e.version_exercise_id is null,
                              e.actor_user_id = pg_temp.id('teach'), e.data = jsonb_build_object('reasons', jsonb_build_array('no_adapta', 'confuso'), 'revision', (select rev::integer from rej)),
                              e.result = (select res from rej), e.id = ((select res from rej) ->> 'eventId')::uuid)
             from app.version_events e where e.op_id = pg_temp.id('op30')), 'rejected|reject_version|t|t|t|t|t|t|t', 'one rejected event with the revision, who rejected, the reasons in order and its own id as the answer');
select is(pg_temp.approved_rev('vb'), 'null/' || (select rev from rej), 'the approval of that same revision is taken back, and the revision did not move');
select is(pg_temp.approved('a_vb', 'vb'), false, 'the version is not approved');
select pg_temp.mark();
select is(pg_temp.rjv('teach', 'vb', '1', '{no_adapta,confuso}', pg_temp.op(30)), (select res from rej), 'the same op_id and reasons answer the same event, even with an old revision');
select is(pg_temp.rjv('teach', 'vb', (select rev from rej), '{confuso,no_adapta}', pg_temp.op(30)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'the same op_id with the reasons in another order is a reuse');
select is(pg_temp.rjv('teach', 'vb', (select rev from rej), '{no_adapta}', pg_temp.op(30)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'and with other reasons');
select is(pg_temp.rjv('teach', 'vc', '1', '{no_adapta,confuso}', pg_temp.op(30)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'on another version too');
select is(pg_temp.apv('teach', 'vb', (select rev from rej), pg_temp.op(30)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'and used by another RPC');
select ok(pg_temp.unchanged(), 'none of them changed anything');
select is(pg_temp.rjv('teach', 'vc', pg_temp.rev('vc'), '{no_adapta}') ->> 'eventId' is not null, true, 'a version that was never approved is rejected too');
select is(pg_temp.approved_rev('vc'), 'null/1', 'and stays unapproved');
select is(pg_temp.approve_now('vb'), (select rev from rej), 'the same revision can be approved again after a rejection: it is a decision of the teacher, not a lock');
select is((select count(*) from app.version_events e where e.version_id = pg_temp.id('vb') and e.kind in ('approved', 'rejected')), (select count(*) from app.version_events e where e.version_id = pg_temp.id('vb') and e.operation in ('approve_version', 'reject_version')),
  'every approval and rejection left its event');

-- ---------------------------------------------------------------------------------------------
-- State: an archived version, assessment or group refuses the six RPCs; the replay of an operation
-- recorded before still answers.
-- ---------------------------------------------------------------------------------------------
-- Operations recorded while everything was open: an instructions edit, an approval and a rejection.
select pg_temp.fill('teach', 'vs1');
select pg_temp.fill('teach', 'vs2');
select pg_temp.fill('teach', 'vs3');
select pg_temp.uvi('teach', 'vs1', '1', 'Antes de archivar', pg_temp.op(40));
select pg_temp.uvi('teach', 'vs2', '1', 'Antes de archivar', pg_temp.op(41));
select pg_temp.uvi('teach', 'vs3', '1', 'Antes de archivar', pg_temp.op(42));
select pg_temp.apv('teach', 'vs1', pg_temp.rev('vs1'), pg_temp.op(43));
select pg_temp.apv('teach', 'vs2', pg_temp.rev('vs2'), pg_temp.op(44));
select pg_temp.apv('teach', 'vs3', pg_temp.rev('vs3'), pg_temp.op(45));
create temp table vs1_rev as select pg_temp.rev('vs1') as r;
select pg_temp.as_user('teach', format('select api.archive_version(%L, %s)', pg_temp.id('vs1'), pg_temp.rev('vs1')));
select pg_temp.as_user('teach', format('select api.archive_assessment(%L, 1)', pg_temp.id('a_vs2')));
select pg_temp.as_user('teach', format('select api.archive_group(%L, 1)', pg_temp.id('g_z')));
-- The six calls on one version, as the teacher, with revisions that are not the point.
create function pg_temp.six(p_ver text) returns text language sql as $$
  select concat_ws(',',
    pg_temp.uvi('teach', p_ver, '1', 'Nuevo') ->> 'error',
    pg_temp.uve('teach', 'x_' || p_ver || '1', '1', 'Nuevo') ->> 'error',
    pg_temp.uvq('teach', 'q_' || p_ver, '1', 'Nuevo', '[{"id":"A","text":"x"},{"id":"B","text":"y"},{"id":"C","text":"z"}]') ->> 'error',
    pg_temp.sqk('teach', 'q_' || p_ver, 'A') ->> 'error',
    pg_temp.apv('teach', p_ver, pg_temp.rev(p_ver)) ->> 'error',
    pg_temp.rjv('teach', p_ver, pg_temp.rev(p_ver), '{no_adapta}') ->> 'error')
$$;
select pg_temp.mark();
select is(pg_temp.six('vs1'), repeat('P0001 INVALID version_archived,', 5) || 'P0001 INVALID version_archived', 'an archived version takes none of the six');
select is(pg_temp.six('vs2'), repeat('P0001 INVALID assessment_archived,', 5) || 'P0001 INVALID assessment_archived', 'a version of an archived assessment takes none: assessment_archived');
select is(pg_temp.six('vs3'), repeat('P0001 INVALID archived,', 5) || 'P0001 INVALID archived', 'a version of an archived group takes none: archived');
select ok(pg_temp.unchanged(), 'and none of the eighteen changed anything');
select is(pg_temp.uvi('teach', 'vs1', '1', 'Antes de archivar', pg_temp.op(40)) ->> 'instructionsRevision', '2', 'but the replay of an edit recorded before the version was archived still answers it');
select is(pg_temp.uvi('teach', 'vs2', '1', 'Antes de archivar', pg_temp.op(41)) ->> 'instructionsRevision', '2', 'also in an archived assessment');
select is(pg_temp.uvi('teach', 'vs3', '1', 'Antes de archivar', pg_temp.op(42)) ->> 'instructionsRevision', '2', 'and in an archived group');
select is(pg_temp.apv('teach', 'vs1', (select r from vs1_rev), pg_temp.op(43)) ->> 'approvedRevision', (select r from vs1_rev), 'the replay of an approval too (with the revision it approved: the archive moved the current one)');
select is(pg_temp.uvi('teach', 'vs1', '1', 'Otro texto', pg_temp.op(40)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'while the same op_id with another text is still a reuse, archived or not');
select ok(pg_temp.unchanged(), 'and the replays changed nothing');
select pg_temp.as_user('teach', format('select api.restore_group(%L, 2)', pg_temp.id('g_z')));
select is(pg_temp.uvi('teach', 'vs3', '2', 'Restaurado') ->> 'instructionsRevision', '3', 'control: the group is restored and the same version takes edits again');

-- ---------------------------------------------------------------------------------------------
-- The permission matrix by RPC: each role that must be denied, with code and reason, and the proof that
-- nothing changed (versions, exercises, questions, keys, events and audit rows).
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
-- g_n has vc; adm2 is an admin who teaches go_n, not g_n; stu_a is a student of g_n.
select is(pg_temp.denied(format('select api.update_version_instructions(%L, 1, ''Nuevo'', gen_random_uuid())', pg_temp.id('vc')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'),
  'update_version_instructions: an admin who does not teach the group, inclusion and a student are FORBIDDEN; other group, other institution and no membership NOT_FOUND; no session FORBIDDEN');
select is(pg_temp.denied(format('select api.update_version_exercise(%L, 1, ''Nuevo'', gen_random_uuid())', pg_temp.id('x_vc1')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'update_version_exercise: same');
select is(pg_temp.denied(format('select api.update_version_question(%L, 1, ''Nuevo'', %L::jsonb, gen_random_uuid())', pg_temp.id('q_vc'), '[{"id":"A","text":"x"},{"id":"B","text":"y"}]'), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'update_version_question: same');
select is(pg_temp.denied(format('select api.set_question_key(%L, ''A'', null)', pg_temp.id('q_vc')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'set_question_key: same');
select is(pg_temp.denied(format('select api.approve_version(%L, 1, gen_random_uuid())', pg_temp.id('vc')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'approve_version: same');
select is(pg_temp.denied(format('select api.reject_version(%L, 1, ''{no_adapta}'', gen_random_uuid())', pg_temp.id('vc')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'reject_version: same');
select is(pg_temp.as_anon(format('select api.update_version_instructions(%L, 1, ''x'', gen_random_uuid())', pg_temp.id('vc'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.update_version_exercise(%L, 1, ''x'', gen_random_uuid())', pg_temp.id('x_vc1'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.update_version_question(%L, 1, ''x'', ''[]''::jsonb, gen_random_uuid())', pg_temp.id('q_vc'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.set_question_key(%L, ''A'', null)', pg_temp.id('q_vc'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.approve_version(%L, 1, gen_random_uuid())', pg_temp.id('vc'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.reject_version(%L, 1, ''{no_adapta}'', gen_random_uuid())', pg_temp.id('vc'))) ->> 'error' like '42501%', true,
  'anon cannot execute any of the six');
select is(pg_temp.as_service(format('select api.approve_version(%L, 1, gen_random_uuid())', pg_temp.id('vc'))) ->> 'error' like '42501%', true, 'nor can service_role: they are the teacher''s RPCs, not internal ones');
select is(pg_temp.as_user('other', format('select api.set_question_key(%L, ''A'', null)', pg_temp.id('q_vc'))) ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher of another group does not even learn that the question exists');
-- Positive side of the matrix: an admin who also teaches go_n works in it like a teacher; the teacher of g_n cannot.
select pg_temp.fill('adm2', 'vo');
select is(pg_temp.apv('adm2', 'vo', pg_temp.rev('vo')) ->> 'approvedRevision', '2', 'an admin who also teaches go_n approves a version of it');
select is(pg_temp.apv('teach', 'vo', pg_temp.rev('vo')) ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher of another group of the same institution cannot');
select is((select count(*) from app.audit_log a where a.institution_id = pg_temp.id('i_n')), 0::bigint, 'and nothing above wrote an audit row: none of the six shows a student');
select is((pg_temp.gv('vb') -> 'version' ->> 'approvedRevision')::integer, (pg_temp.gv('vb') -> 'version' ->> 'revision')::integer, 'get_version shows the approved revision beside the revision (vb was approved again)');

select * from finish();
rollback;
