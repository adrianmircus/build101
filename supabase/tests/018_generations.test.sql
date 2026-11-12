-- T1.4d: generations, internal (service_role only): internal_create_generation, internal_record_generation_output
-- and internal_finish_generation. Placeholder text only. The teacher is only used to edit by hand (T1.4c) and to
-- change a configuration (T1.4b/T1.F4) in the middle of a generation. Races with two connections are in
-- tests/integration/races/generations*.test.ts. The whole file is rolled back.
begin;
select plan(213);

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

insert into ids (k, id) select k, gen_random_uuid() from unnest(array['teach', 'other']) as k;
insert into auth.users (id, email) select id, k || '@t1-4d.invalid' from ids;
do $$
declare
  k text;
begin
  for k in select ids.k from ids loop
    perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;
insert into ids (k, id) select 'i_n', (pg_temp.as_service($$ select api.internal_create_institution('Liceo N', 't1-4d', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, %L)', pg_temp.id('i_n'), pg_temp.id('teach'), 'teacher'));
insert into ids (k, id) values
  ('g_n', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid);

create function pg_temp.mk_asm(p_key text, p_instr text default '') returns void language plpgsql as $$
begin
  perform pg_temp.keep(p_key, pg_temp.as_user('teach', format('select api.create_assessment(%L, ''worksheet'', ''Repaso'', %L, gen_random_uuid())', pg_temp.id('g_n'), p_instr)));
end $$;
create function pg_temp.mk_ex(p_asm text, p_key text, p_body text) returns void language plpgsql as $$
begin
  perform pg_temp.keep(p_key, pg_temp.as_user('teach', format('select api.add_exercise(%L, %L, %L, gen_random_uuid(), null)', pg_temp.id(p_asm), right(p_key, 1), p_body)));
end $$;
select pg_temp.mk_asm('a1', 'Elegí dos ejercicios.');
select pg_temp.mk_ex('a1', 'e1', 'Enunciado 1');
select pg_temp.mk_ex('a1', 'e2', 'Enunciado 2');
select pg_temp.mk_asm('a2');
select pg_temp.mk_ex('a2', 'f1', 'Enunciado 1');

-- A version with two adapted exercises (x<key>1, x<key>2) and a row for its answer key.
create function pg_temp.cv(p_key text, p_asm text default 'a1') returns void language plpgsql as $$
begin
  perform pg_temp.keep(p_key, pg_temp.as_user('teach', format($q$ select api.create_version(%L, '{"profiles":["motor"],"supports":[],"interests":[]}'::jsonb, 'gaze', gen_random_uuid(), null) $q$, pg_temp.id(p_asm))));
  insert into ids (k, id) select 'x' || substr(p_key, 2) || row_number() over (order by e.position), ve.id
    from app.version_exercises ve join app.assessment_exercises e on e.id = ve.exercise_id where ve.version_id = pg_temp.id(p_key);
  insert into app.answer_keys (institution_id, version_id) values (pg_temp.id('i_n'), pg_temp.id(p_key));
end $$;
select pg_temp.cv(k) from unnest(array['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'va', 'vb', 'vc', 'vd']) as k;
select pg_temp.cv('vx', 'a2');
-- Of the three other versions, one for archive tests.

create function pg_temp.opk() returns text language sql as $$ select quote_literal(gen_random_uuid()) $$;
-- The calls under test.
create function pg_temp.cg(p_ver text, p_kind text, p_op text default null, p_target text default null, p_inputs text default '{}', p_jobs text default '2',
                           p_hash text default 'repeat(''a'', 64)', p_by text default 'null') returns jsonb language sql as $$
  select pg_temp.as_service(format('select api.internal_create_generation(%L, %L, %s, %L::jsonb, %s, ''r1'', ''p1'', %s, %s, %s)',
    pg_temp.id(p_ver), p_kind, coalesce(p_op, pg_temp.opk()), p_inputs, p_hash, p_jobs,
    case when p_target is null then 'null' else quote_literal(pg_temp.id(p_target)) end, p_by))
$$;
-- Creates and remembers the id under p_key.
create function pg_temp.mk(p_key text, p_ver text, p_kind text, p_target text default null) returns jsonb language sql as $$
  select pg_temp.keep(p_key, pg_temp.cg(p_ver, p_kind, null, p_target))
$$;
create function pg_temp.ro(p_gen text, p_kind text, p_out text, p_x text default null) returns jsonb language sql as $$
  select pg_temp.as_service(format('select api.internal_record_generation_output(%L, %L, %L::jsonb, %s)', pg_temp.id(p_gen), p_kind, p_out,
    case when p_x is null then 'null' else quote_literal(pg_temp.id(p_x)) end))
$$;
create function pg_temp.fg(p_gen text, p_status text, p_code text default null) returns jsonb language sql as $$
  select pg_temp.as_service(format('select api.internal_finish_generation(%L, %L, %s)', pg_temp.id(p_gen), p_status,
    case when p_code is null then 'null' else quote_literal(p_code) end))
$$;
create function pg_temp.text_out(p_body text) returns text language sql as $$
  select jsonb_build_object('body', p_body, 'changes', jsonb_build_array(jsonb_build_object('what', 'Frases cortas', 'why', 'Apoyo de lectura')))::text
$$;
create function pg_temp.qs_out(p_n integer default 2) returns text language sql as $$
  select jsonb_build_object('questions', (select jsonb_agg(jsonb_build_object('stem', 'Pregunta ' || n,
           'options', jsonb_build_array(jsonb_build_object('id', 'A', 'text', 'Uno'), jsonb_build_object('id', 'B', 'text', 'Dos'))) order by n)
           from generate_series(1, p_n) n))::text
$$;
-- Hand edits as the teacher (T1.4c).
create function pg_temp.edit_ex(p_x text, p_body text) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format('select api.update_version_exercise(%L, %s, %L, gen_random_uuid())', pg_temp.id(p_x),
    (select revision from app.version_exercises where id = pg_temp.id(p_x)), p_body))
$$;
create function pg_temp.edit_instr(p_v text, p_text text) returns jsonb language sql as $$
  select pg_temp.as_user('teach', format('select api.update_version_instructions(%L, %s, %L, gen_random_uuid())', pg_temp.id(p_v),
    (select instructions_revision from app.versions where id = pg_temp.id(p_v)), p_text))
$$;

create function pg_temp.xs(p_x text) returns text language sql as $$
  select concat_ws('|', ve.revision, ve.status, ve.body, ve.written_by_generation_id is not distinct from null, ve.current_generation_id is not distinct from null,
                   (select count(*) from app.version_questions q where q.version_exercise_id = ve.id))
    from app.version_exercises ve where ve.id = pg_temp.id(p_x)
$$;
create function pg_temp.vs(p_v text) returns text language sql as $$
  select concat_ws('|', v.revision, v.status, v.instructions_revision, v.current_generation_id is not distinct from null, v.error_code)
    from app.versions v where v.id = pg_temp.id(p_v)
$$;
create function pg_temp.gstatus(p_g text) returns text language sql as $$ select status from app.generations where id = pg_temp.id(p_g) $$;
create function pg_temp.digest(p_v text) returns text language sql as $$
  select md5(coalesce((select string_agg(concat_ws('|', v.id, v.revision, v.instructions_revision, v.general_instructions, v.instructions_written_by, v.status, v.stale, v.current_generation_id, v.error_code), ';' order by v.id)
                         from app.versions v where v.id = pg_temp.id(p_v)), '')
          || coalesce((select string_agg(concat_ws('|', ve.id, ve.revision, ve.body, ve.status, ve.error_code, ve.written_by_generation_id, ve.current_generation_id), ';' order by ve.id)
                         from app.version_exercises ve where ve.version_id = pg_temp.id(p_v)), '')
          || coalesce((select string_agg(concat_ws('|', q.id, q.revision, q.stem), ';' order by q.id) from app.version_questions q where q.version_id = pg_temp.id(p_v)), '')
          || coalesce((select string_agg(concat_ws('|', g.id, g.status), ';' order by g.id) from app.generations g where g.version_id = pg_temp.id(p_v)), '')
          || (select count(*) from app.generation_outputs o where o.version_id = pg_temp.id(p_v))::text
          || (select count(*) from app.version_events e where e.version_id = pg_temp.id(p_v))::text)
$$;
create temp table before_val (n serial, d text);
create function pg_temp.mark(p_v text) returns void language sql as $$ insert into before_val (d) select pg_temp.digest(p_v) $$;
create function pg_temp.unchanged(p_v text) returns boolean language sql as $$
  select (select d from before_val order by n desc limit 1) = pg_temp.digest(p_v)
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: only service_role
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'api' and p.proname in ('internal_create_generation', 'internal_record_generation_output', 'internal_finish_generation')
              and has_function_privilege('service_role', p.oid, 'execute')), 3::bigint, 'service_role executes the three RPCs');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'api' and p.proname in ('internal_create_generation', 'internal_record_generation_output', 'internal_finish_generation')
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 0::bigint,
  'anon and authenticated execute none');
select pg_temp.mk('gp', 'v9', 'version');
select pg_temp.mark('v9');
select is(pg_temp.rpc(null, 'anon', format('select api.internal_create_generation(%L, ''version'', gen_random_uuid(), ''{}''::jsonb, repeat(''a'', 64), ''r1'', ''p1'', 1)', pg_temp.id('v9'))) ->> 'error' like '42501%', true,
  'anon cannot create a generation');
select is(pg_temp.as_user('teach', format('select api.internal_create_generation(%L, ''version'', gen_random_uuid(), ''{}''::jsonb, repeat(''a'', 64), ''r1'', ''p1'', 1)', pg_temp.id('v9'))) ->> 'error' like '42501%', true,
  'a teacher of the institution cannot create one either');
select is(pg_temp.as_user('teach', format('select api.internal_record_generation_output(%L, ''instructions'', ''{"instructions": "x"}''::jsonb)', pg_temp.id('gp'))) ->> 'error' like '42501%', true,
  'nor record an output');
select is(pg_temp.as_user('other', format('select api.internal_finish_generation(%L, ''done'')', pg_temp.id('gp'))) ->> 'error' like '42501%', true,
  'nor finish it, and a person of no institution neither');
select is(pg_temp.rpc(null, 'anon', format('select api.internal_finish_generation(%L, ''done'')', pg_temp.id('gp'))) ->> 'error' like '42501%', true, 'anon cannot finish one');
select ok(pg_temp.unchanged('v9'), 'and nothing changed');

-- ---------------------------------------------------------------------------------------------
-- internal_create_generation: shape and references (v9)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.cg('v9', 'exercise') ->> 'error', 'P0001 INVALID invalid_target', 'an exercise generation without a target is INVALID invalid_target');
select is(pg_temp.cg('v9', 'version', null, 'x91') ->> 'error', 'P0001 INVALID invalid_target', 'and a version generation with one too');
select is(pg_temp.cg('v9', 'answer_key', null, 'x91') ->> 'error', 'P0001 INVALID invalid_target', 'and an answer key one');
select is(pg_temp.cg('v9', 'exercise', null, 'x81') ->> 'error', 'P0001 INVALID invalid_target', 'a target of another version is INVALID invalid_target');
select is(pg_temp.cg('v9', 'poem') ->> 'error', 'P0001 INVALID invalid_generation', 'an unknown kind is INVALID invalid_generation');
select is(pg_temp.cg('v9', 'version', null, null, '[]') ->> 'error', 'P0001 INVALID invalid_generation', 'inputs that are not an object too');
select is(pg_temp.cg('v9', 'version', null, null, '{}', '201') ->> 'error', 'P0001 INVALID invalid_generation', '201 jobs too');
select is(pg_temp.cg('v9', 'version', null, null, '{}', '-1') ->> 'error', 'P0001 INVALID invalid_generation', 'and -1');
select is(pg_temp.cg('v9', 'version', null, null, '{}', 'null') ->> 'error', 'P0001 INVALID invalid_generation', 'and a missing number');
select is(pg_temp.cg('v9', 'version', null, null, '{}', '2', '''xyz''') ->> 'error', 'P0001 INVALID invalid_generation', 'a profiles hash that is not a sha256 too');
select is(pg_temp.cg('v9', 'version', null, null, '{}', '2', 'null') ->> 'error', 'P0001 INVALID invalid_generation', 'or a null one');
select is(pg_temp.cg('v9', 'version', 'null') ->> 'error', 'P0001 INVALID invalid_op_key', 'a missing op_key is INVALID invalid_op_key');
select is(pg_temp.cg('v9', 'version', null, null, '{}', '2', 'repeat(''a'', 64)', quote_literal(gen_random_uuid())) ->> 'error', 'P0001 INVALID invalid_generation',
  'a requester that does not exist is INVALID invalid_generation');
select is(pg_temp.as_service(format('select api.internal_create_generation(%L, ''version'', gen_random_uuid(), ''{}''::jsonb, repeat(''a'', 64), ''r1'', ''p1'', 1)', gen_random_uuid())) ->> 'error',
  'P0001 NOT_FOUND not_found', 'a version that does not exist is NOT_FOUND');
select is(pg_temp.as_service(format('select api.internal_create_generation(null, ''version'', gen_random_uuid(), ''{}''::jsonb, repeat(''a'', 64), ''r1'', ''p1'', 1)')) ->> 'error',
  'P0001 INVALID invalid_op_key', 'and a missing one is refused before looking for it');
select ok(pg_temp.unchanged('v9'), 'no refusal created or changed anything');

-- ---------------------------------------------------------------------------------------------
-- internal_create_generation: the happy case and its idempotency (v9)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.keys(pg_temp.cg('v9', 'version', pg_temp.opk(), null, '{"exercises": ["a"]}', '2', 'repeat(''a'', 64)', quote_literal(pg_temp.id('teach')))), 'created,id',
  'a generation answers its id and created');
create temp table op9 as select gen_random_uuid() as op;
insert into ids (k, id) values ('g9', (pg_temp.cg('v9', 'version', (select quote_literal(op) from op9), null,
  '{"exercises": ["a"], "exerciseRevisions": {"x": 99}, "instructionsRevision": 99}', '2', 'repeat(''b'', 64)', quote_literal(pg_temp.id('teach'))) ->> 'id')::uuid);
select is((select concat_ws('|', g.status, g.kind, g.target_revision, g.subject_id, g.required_jobs, g.requested_by = pg_temp.id('teach'),
                            g.profiles_hash = repeat('b', 64), g.finished_at is null)
             from app.generations g where g.id = pg_temp.id('g9')), 'running|version|1|math|2|t|t|t',
  'it is running, at the revision of the version, in the subject of the assessment (not a parameter), and with its requester');
select is((select g.inputs -> 'exercises' from app.generations g where g.id = pg_temp.id('g9')), '["a"]'::jsonb, 'the inputs keep what the caller sent');
select is((select g.inputs -> 'exerciseRevisions' from app.generations g where g.id = pg_temp.id('g9')),
  jsonb_build_object(pg_temp.id('x91')::text, 1, pg_temp.id('x92')::text, 1), 'the starting revisions of the exercises are the real ones, not the ones the caller wrote');
select is((select concat_ws('|', g.inputs -> 'instructionsRevision', g.inputs -> 'questionRevisions') from app.generations g where g.id = pg_temp.id('g9')), '1|{}',
  'and the one of the instructions; the questions had none');
select is(pg_temp.vs('v9'), '1|generating|1|f', 'the version is generating and this is its generation in force');
select is(pg_temp.xs('x91'), '1|generating||t|f|0', 'its adapted exercises are generating under it');
select is((select count(*) from app.version_exercises where version_id = pg_temp.id('v9') and current_generation_id = pg_temp.id('g9')), 2::bigint, 'both of them');
select is(pg_temp.cg('v9', 'version', (select quote_literal(op) from op9), null, '{"exercises": ["b"]}', '2', 'repeat(''b'', 64)', quote_literal(pg_temp.id('teach'))) ->> 'error',
  'P0001 CONFLICT op_key_reused', 'the same op_key with other inputs is CONFLICT op_key_reused : the starting revisions that the RPC adds are not compared, what the caller sent is');
select is(pg_temp.cg('v9', 'version', (select quote_literal(op) from op9), null,
  '{"exercises": ["a"], "exerciseRevisions": {"x": 99}, "instructionsRevision": 99}', '2', 'repeat(''b'', 64)', quote_literal(pg_temp.id('teach'))),
  jsonb_build_object('id', pg_temp.id('g9'), 'created', false), 'the same request answers the same generation with created false');
select is((select count(*) from app.generations where op_key = (select op from op9)), 1::bigint, 'and there is one row');
select is(pg_temp.cg('v9', 'version', (select quote_literal(op) from op9), null,
  '{"exercises": ["a"], "exerciseRevisions": {"x": 99}, "instructionsRevision": 99}', '3', 'repeat(''b'', 64)', quote_literal(pg_temp.id('teach'))) ->> 'error',
  'P0001 CONFLICT op_key_reused', 'another number of jobs is another request');
select is(pg_temp.cg('v9', 'version', (select quote_literal(op) from op9), null,
  '{"exercises": ["a"], "exerciseRevisions": {"x": 99}, "instructionsRevision": 99}', '2', 'repeat(''c'', 64)', quote_literal(pg_temp.id('teach'))) ->> 'error',
  'P0001 CONFLICT op_key_reused', 'other profiles are another request');
select is(pg_temp.cg('v9', 'version', (select quote_literal(op) from op9), null,
  '{"exercises": ["a"], "exerciseRevisions": {"x": 99}, "instructionsRevision": 99}', '2', 'repeat(''b'', 64)', 'null'),
  jsonb_build_object('id', pg_temp.id('g9'), 'created', false), 'but another requester is not: who asked can be deleted later, so it is not part of the identity');
select is(pg_temp.cg('v8', 'version', (select quote_literal(op) from op9), null,
  '{"exercises": ["a"], "exerciseRevisions": {"x": 99}, "instructionsRevision": 99}', '2', 'repeat(''b'', 64)', quote_literal(pg_temp.id('teach'))) ->> 'error',
  'P0001 CONFLICT op_key_reused', 'the same op_key for another version is a CONFLICT, never a second generation');
select is(pg_temp.cg('v9', 'answer_key', (select quote_literal(op) from op9)) ->> 'error', 'P0001 CONFLICT op_key_reused', 'and for another kind');
select is((select count(*) from app.generations where op_key = (select op from op9)), 1::bigint, 'still one row');
-- The replay does not depend on what changed since: the generation is superseded by a newer one.
select pg_temp.mk('g9b', 'v9', 'version');
select is(pg_temp.gstatus('g9'), 'superseded', 'a newer version generation supersedes the running one');
select is(pg_temp.cg('v9', 'version', (select quote_literal(op) from op9), null,
  '{"exercises": ["a"], "exerciseRevisions": {"x": 99}, "instructionsRevision": 99}', '2', 'repeat(''b'', 64)', quote_literal(pg_temp.id('teach'))),
  jsonb_build_object('id', pg_temp.id('g9'), 'created', false), 'and the old request still answers its generation: it is not reopened and nothing new is created');
select is(pg_temp.gstatus('g9'), 'superseded', 'it stays superseded');
-- A row made by hand (seeds, older tests) is compared by what it stores, like any other.
insert into ids (k, id) values ('g_old', gen_random_uuid());
create temp table old_op as select gen_random_uuid() as op;
insert into app.generations (id, institution_id, version_id, kind, target_revision, op_key, subject_id, inputs, profiles_hash, profiles_revision, prompt_version, required_jobs, status, finished_at)
  values (pg_temp.id('g_old'), pg_temp.id('i_n'), pg_temp.id('v8'), 'version', 1, (select op from old_op), 'math', '{}', repeat('a', 64), 'r1', 'p1', 2, 'done', now());
select is(pg_temp.cg('v8', 'version', (select quote_literal(op) from old_op)), jsonb_build_object('id', pg_temp.id('g_old'), 'created', false), 'a replay of a finished generation answers it, created false');
select is(pg_temp.cg('v8', 'version', (select quote_literal(op) from old_op), null, '{"otra": 1}') ->> 'error', 'P0001 CONFLICT op_key_reused', 'with other inputs it is a CONFLICT');
select throws_ok(format('update app.generations set required_jobs = 9 where id = %L', pg_temp.id('g9')), 'P0004', null, 'what a generation was asked never changes (as the owner: the guard, not the privilege)');
select throws_ok(format('update app.generations set profiles_hash = repeat(''c'', 64) where id = %L', pg_temp.id('g9')), 'P0004', null, 'the profiles it used either');
select throws_ok(format('update app.generations set inputs = ''{}'' where id = %L', pg_temp.id('g9')), 'P0004', null, 'nor its inputs outside an erasure');

-- Archived since: the replay still answers, a new one is refused.
select pg_temp.mk('gx', 'vx', 'version');
select pg_temp.as_user('teach', format('select api.archive_version(%L, %s)', pg_temp.id('vx'), (select revision from app.versions where id = pg_temp.id('vx'))));
select is(pg_temp.cg('vx', 'version') ->> 'error', 'P0001 INVALID version_archived', 'a new generation for an archived version is INVALID version_archived');
select is(pg_temp.as_user('teach', format('select api.archive_assessment(%L, %s)', pg_temp.id('a2'), (select revision from app.assessments where id = pg_temp.id('a2')))) ->> 'id', pg_temp.id('a2')::text, 'the assessment is archived');
select is(pg_temp.cg('vx', 'version') ->> 'error', 'P0001 INVALID assessment_archived', 'and for an archived assessment INVALID assessment_archived');
select is(pg_temp.as_service(format('select api.internal_create_generation(%L, ''version'', %L, ''{}''::jsonb, repeat(''a'', 64), ''r1'', ''p1'', 2)', pg_temp.id('vx'), (select op_key from app.generations where id = pg_temp.id('gx')))),
  jsonb_build_object('id', pg_temp.id('gx'), 'created', false), 'a replay of the archived one still answers its generation, created false');
select is((select count(*) from app.generations where version_id = pg_temp.id('vx')), 1::bigint, 'no refusal created a generation');

-- ---------------------------------------------------------------------------------------------
-- Vigencia (v4)
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('a', 'v4', 'version');
select pg_temp.mk('b', 'v4', 'exercise', 'x41');
select is(pg_temp.gstatus('a') || ',' || pg_temp.gstatus('b'), 'running,running', 'an exercise generation does not replace a version one: both run');
select is((select concat_ws(',', (select ve.current_generation_id = pg_temp.id('b') from app.version_exercises ve where ve.id = pg_temp.id('x41')),
                                 (select ve.current_generation_id = pg_temp.id('a') from app.version_exercises ve where ve.id = pg_temp.id('x42')))), 't,t',
  'the exercise is now generated by its own generation and the other one stays with the version''s');
select is((select v.current_generation_id = pg_temp.id('a') from app.versions v where v.id = pg_temp.id('v4')), true, 'and the version''s generation stays the one in force of the version');
select is((select g.target_revision from app.generations g where g.id = pg_temp.id('b')), 1, 'the exercise generation starts from the revision of its exercise');
select is((select g.inputs -> 'exerciseRevisions' from app.generations g where g.id = pg_temp.id('b')), jsonb_build_object(pg_temp.id('x41')::text, 1), 'and its inputs only have that exercise');
select pg_temp.mk('c', 'v4', 'exercise', 'x42');
select is(pg_temp.gstatus('b') || ',' || pg_temp.gstatus('c'), 'running,running', 'regenerating another exercise coexists');
select pg_temp.mk('d', 'v4', 'exercise', 'x41');
select is(pg_temp.gstatus('b') || ',' || pg_temp.gstatus('c') || ',' || pg_temp.gstatus('d'), 'superseded,running,running', 'regenerating the same exercise replaces the previous generation of that exercise only');
select is((select ve.current_generation_id = pg_temp.id('d') from app.version_exercises ve where ve.id = pg_temp.id('x41')), true, 'the new one is the exercise''s');
select is((select count(*) from app.generations where version_id = pg_temp.id('v4') and status = 'running' and kind = 'exercise'), 2::bigint, 'two exercise generations in force, one per exercise');
select pg_temp.mk('e', 'v4', 'version');
select is((select string_agg(pg_temp.gstatus(k), ',' order by k) from unnest(array['a', 'b', 'c', 'd', 'e']) k), 'superseded,superseded,superseded,superseded,running',
  'a new version generation supersedes the version one and the exercise ones');
select is((select count(*) from app.version_exercises where version_id = pg_temp.id('v4') and current_generation_id = pg_temp.id('e') and status = 'generating'), 2::bigint, 'and owns every exercise');
select is((select v.current_generation_id = pg_temp.id('e') from app.versions v where v.id = pg_temp.id('v4')), true, 'and the version');
select is((select count(*) from app.generations where version_id = pg_temp.id('v4') and finished_at is null), 1::bigint, 'the superseded ones are closed, with their finished_at');
select is(pg_temp.fg('a', 'cancelled'), jsonb_build_object('id', pg_temp.id('a'), 'status', 'superseded', 'changed', false), 'a terminal state never reopens or changes: closing it answers what it is');
select is(pg_temp.gstatus('a'), 'superseded', 'it stays superseded');
-- The answer key has its own vigencia.
select pg_temp.mk('k1', 'v4', 'answer_key');
select is(pg_temp.gstatus('e'), 'running', 'an answer key generation does not touch the adaptation''s');
select is((select concat_ws('|', k.status, k.current_generation_id = pg_temp.id('k1')) from app.answer_keys k where k.version_id = pg_temp.id('v4')), 'generating|t', 'it is the key''s generation in force');
select is((select v.current_generation_id = pg_temp.id('e') from app.versions v where v.id = pg_temp.id('v4')), true, 'and the version''s is still the adaptation one');
select pg_temp.mk('k2', 'v4', 'answer_key');
select is(pg_temp.gstatus('k1') || ',' || pg_temp.gstatus('k2') || ',' || pg_temp.gstatus('e'), 'superseded,running,running', 'a new key generation supersedes the previous key one only');
select pg_temp.mk('f', 'v4', 'version');
select is(pg_temp.gstatus('k2') || ',' || pg_temp.gstatus('e') || ',' || pg_temp.gstatus('f'), 'running,superseded,running', 'and a new version generation does not touch the key one');
select is((select count(*) from app.answer_keys where version_id = pg_temp.id('v4')), 1::bigint, 'there is one answer key row, created or reused');
select throws_ok(format('update app.generations set status = ''running'', finished_at = null where id = %L', pg_temp.id('a')), 'P0004', null, 'a superseded generation cannot be reopened');

-- ---------------------------------------------------------------------------------------------
-- Outputs: text, then questions, then instructions (v1)
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('g1', 'v1', 'version');
select pg_temp.mark('v1');
select is(pg_temp.ro('g1', 'answer_key', '{}', 'x11') ->> 'error', 'P0001 INVALID invalid_output', 'an answer key output does not go through here');
select is(pg_temp.ro('g1', 'exercise', pg_temp.text_out('x')) ->> 'error', 'P0001 INVALID invalid_target', 'an exercise output without an exercise is INVALID invalid_target');
select is(pg_temp.ro('g1', 'instructions', '{"instructions": "x"}', 'x11') ->> 'error', 'P0001 INVALID invalid_target', 'and an instructions output with one too');
select is(pg_temp.ro('g1', 'exercise', pg_temp.text_out('x'), 'x81') ->> 'error', 'P0001 INVALID invalid_target', 'an exercise of another version is INVALID invalid_target');
select is(pg_temp.as_service(format('select api.internal_record_generation_output(%L, ''exercise'', ''[]''::jsonb, %L)', pg_temp.id('g1'), pg_temp.id('x11'))) ->> 'error', 'P0001 INVALID invalid_output', 'an output that is not an object is INVALID invalid_output');
select is(pg_temp.as_service(format('select api.internal_record_generation_output(%L, ''exercise'', ''{}''::jsonb, %L)', gen_random_uuid(), pg_temp.id('x11'))) ->> 'error', 'P0001 NOT_FOUND not_found', 'a generation that does not exist is NOT_FOUND');
select ok(pg_temp.unchanged('v1'), 'no refusal changed anything');
select is(pg_temp.keys(pg_temp.ro('g1', 'exercise', pg_temp.text_out('Texto adaptado 1'), 'x11')), 'outcome,outputId', 'recording an output answers its id and what was decided');
select is(pg_temp.ro('g1', 'exercise', pg_temp.text_out('Texto adaptado 1'), 'x11') ->> 'outcome', 'applied', 'the text of an exercise of the generation in force at its starting revision is applied');
select is(pg_temp.xs('x11'), '2|ready|Texto adaptado 1|f|f|0', 'the exercise has its text, is ready, one revision up, written by the generation, and keeps being generated by it');
select is((select ve.changes from app.version_exercises ve where ve.id = pg_temp.id('x11')), '[{"what": "Frases cortas", "why": "Apoyo de lectura"}]'::jsonb, 'with what changed and why');
select is((select ve.written_by_generation_id = pg_temp.id('g1') from app.version_exercises ve where ve.id = pg_temp.id('x11')), true, 'the provenance is this generation');
select is(pg_temp.vs('v1'), '2|generating|1|f', 'the version moved one revision and is still generating (the generation runs)');
select is((select k.stale from app.answer_keys k where k.version_id = pg_temp.id('v1')), true, 'and its answer key is stale');
select is((select concat_ws('|', o.kind, o.outcome, o.expected_revision, o.version_exercise_id = pg_temp.id('x11'), o.output ->> 'body', o.version_id = pg_temp.id('v1'))
             from app.generation_outputs o where o.generation_id = pg_temp.id('g1')), 'exercise|applied|1|t|Texto adaptado 1|t', 'the output is stored as it arrived, with the revision it expected');
-- The questions come after the text: the revision is no longer the starting one, but this generation wrote it.
select is(pg_temp.ro('g1', 'gaze_questions', pg_temp.qs_out(2), 'x11') ->> 'outcome', 'applied', 'the questions that come after the text are applied too: the generation wrote that revision');
select is(pg_temp.xs('x11'), '3|ready|Texto adaptado 1|f|f|2', 'the exercise has two questions and moved another revision');
select is((select string_agg(q.position || ':' || q.stem, ',' order by q.position) from app.version_questions q where q.version_exercise_id = pg_temp.id('x11')), '0:Pregunta 1,1:Pregunta 2', 'in order');
select is((select o.expected_revision from app.generation_outputs o where o.generation_id = pg_temp.id('g1') and o.kind = 'gaze_questions'), 1, 'it expected the starting revision of the generation, not the current one');
select is(pg_temp.vs('v1'), '3|generating|1|f', 'the version moved again');
-- Retries: they find what was stored and do not apply anything again.
select pg_temp.mark('v1');
select is(pg_temp.ro('g1', 'exercise', pg_temp.text_out('Texto adaptado 1'), 'x11') ->> 'outcome', 'applied', 'a retry of the text answers what was decided');
select is(pg_temp.ro('g1', 'gaze_questions', pg_temp.qs_out(2), 'x11') ->> 'outcome', 'applied', 'and one of the questions');
select is(pg_temp.ro('g1', 'exercise', pg_temp.text_out('Otro texto'), 'x11') ->> 'outputId', (select o.id::text from app.generation_outputs o where o.generation_id = pg_temp.id('g1') and o.kind = 'exercise'),
  'even if the retry arrives with another text: the stored output is the one that counts');
select ok(pg_temp.unchanged('v1'), 'and nothing was applied twice: no revision, no new question, no new output');
select is((select count(*) from app.generation_outputs where generation_id = pg_temp.id('g1')), 2::bigint, 'two outputs');
-- The instructions.
select is(pg_temp.ro('g1', 'instructions', '{"instructions": "Leé con calma y resolvé."}') ->> 'outcome', 'applied', 'the instructions of the generation in force are applied');
select is((select concat_ws('|', v.general_instructions, v.instructions_revision, v.instructions_written_by = pg_temp.id('g1'), v.revision) from app.versions v where v.id = pg_temp.id('v1')),
  'Leé con calma y resolvé.|2|t|4', 'the text, its revision, its provenance and the revision of the version');
select is((select o.expected_revision from app.generation_outputs o where o.generation_id = pg_temp.id('g1') and o.kind = 'instructions'), 1, 'it expected the starting revision of the instructions');
select pg_temp.mark('v1');
select is(pg_temp.ro('g1', 'instructions', '{"instructions": "Leé con calma y resolvé."}') ->> 'outcome', 'applied', 'a retry answers the same');
select ok(pg_temp.unchanged('v1'), 'and applies nothing');
select is(pg_temp.ro('g1', 'exercise', pg_temp.text_out('Texto adaptado 2'), 'x12') ->> 'outcome', 'applied', 'the other exercise is applied as well, from its own starting revision');
select is(pg_temp.vs('v1'), '5|generating|2|f', 'the version only moves one revision per output');

-- ---------------------------------------------------------------------------------------------
-- Outputs: questions, then text (v2)
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('g2', 'v2', 'version');
select is(pg_temp.ro('g2', 'gaze_questions', pg_temp.qs_out(1), 'x21') ->> 'outcome', 'applied', 'questions first: applied');
select is(pg_temp.xs('x21'), '2|generating||f|f|1', 'the exercise has no text yet, so it is not ready; the questions are in');
select is(pg_temp.ro('g2', 'exercise', pg_temp.text_out('Texto 2'), 'x21') ->> 'outcome', 'applied', 'and the text after them is applied too');
select is(pg_temp.xs('x21'), '3|ready|Texto 2|f|f|1', 'the exercise has both and is ready');
select pg_temp.mark('v2');
select is(pg_temp.ro('g2', 'gaze_questions', pg_temp.qs_out(1), 'x21') ->> 'outcome', 'applied', 'the questions repeated: same answer');
select is(pg_temp.ro('g2', 'exercise', pg_temp.text_out('Texto 2'), 'x21') ->> 'outcome', 'applied', 'the text repeated: same answer');
select ok(pg_temp.unchanged('v2'), 'and nothing was applied twice');
select is((select count(*) from app.generation_outputs where generation_id = pg_temp.id('g2') and outcome = 'applied'), 2::bigint, 'two outputs, both applied');

-- ---------------------------------------------------------------------------------------------
-- A manual edit between the two stages (v3): the person wins
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('g3', 'v3', 'version');
select is(pg_temp.ro('g3', 'exercise', pg_temp.text_out('Texto de la IA'), 'x31') ->> 'outcome', 'applied', 'the text arrives first and is applied');
select is(pg_temp.keys(pg_temp.edit_ex('x31', 'Texto de la profe')), 'id,revision,versionRevision', 'the teacher edits the exercise by hand');
select is(pg_temp.xs('x31'), '3|ready|Texto de la profe|t|f|0', 'the provenance is now null: a person wrote this revision');
select pg_temp.mark('v3');
select is(pg_temp.ro('g3', 'gaze_questions', pg_temp.qs_out(2), 'x31') ->> 'outcome', 'obsolete', 'the questions that come after are obsolete');
select is((select count(*) from app.version_questions where version_exercise_id = pg_temp.id('x31')), 0::bigint, 'they were not written');
select is(pg_temp.xs('x31'), '3|ready|Texto de la profe|t|f|0', 'and the exercise is exactly what the teacher left');
select is((select o.output -> 'questions' -> 1 ->> 'stem' from app.generation_outputs o where o.generation_id = pg_temp.id('g3') and o.kind = 'gaze_questions'), 'Pregunta 2', 'but the output is stored, visible to the teacher');
select is((select o.outcome from app.generation_outputs o where o.generation_id = pg_temp.id('g3') and o.kind = 'gaze_questions'), 'obsolete', 'as obsolete');
select is(pg_temp.ro('g3', 'gaze_questions', pg_temp.qs_out(2), 'x31') ->> 'outcome', 'obsolete', 'a retry answers obsolete again');
-- The other way: questions, an edit, then the text.
select is(pg_temp.ro('g3', 'gaze_questions', pg_temp.qs_out(1), 'x32') ->> 'outcome', 'applied', 'on the other exercise the questions come first and are applied');
select pg_temp.edit_ex('x32', 'Texto de la profe 2');
select is(pg_temp.ro('g3', 'exercise', pg_temp.text_out('Texto de la IA 2'), 'x32') ->> 'outcome', 'obsolete', 'the text after a manual edit is obsolete');
select is(pg_temp.xs('x32'), '3|ready|Texto de la profe 2|t|f|1', 'the teacher''s text stays and the questions that were applied before stay');
-- The instructions.
select pg_temp.edit_instr('v3', 'Instrucciones de la profe');
select is(pg_temp.ro('g3', 'instructions', '{"instructions": "De la IA"}') ->> 'outcome', 'obsolete', 'instructions after an edit by the teacher are obsolete');
select is((select v.general_instructions from app.versions v where v.id = pg_temp.id('v3')), 'Instrucciones de la profe', 'the teacher''s instructions stay');
-- A question edited by hand also takes the exercise away from the generation.
select pg_temp.mk('g3b', 'v3', 'exercise', 'x31');
select is(pg_temp.ro('g3b', 'exercise', pg_temp.text_out('Texto nuevo'), 'x31') ->> 'outcome', 'applied', 'a new generation starts from the current revision and applies');
select is(pg_temp.xs('x31'), '4|ready|Texto nuevo|f|f|0', 'over the teacher''s text, because the teacher asked to regenerate it');

-- ---------------------------------------------------------------------------------------------
-- Closed, superseded and taken over (v7)
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('g7', 'v7', 'version');
select pg_temp.ro('g7', 'exercise', pg_temp.text_out('Uno'), 'x71');
select pg_temp.ro('g7', 'exercise', pg_temp.text_out('Dos'), 'x72');
select is(pg_temp.vs('v7'), '3|generating|1|f', 'both exercises have text and the generation still runs');
select is(pg_temp.keys(pg_temp.fg('g7', 'done')), 'changed,id,status', 'finishing answers its id, its status and changed');
select is(pg_temp.gstatus('g7'), 'done', 'the generation is done');
select is(pg_temp.vs('v7'), '3|ready|1|f', 'the version is ready and the generation stays the one that made it');
select is((select count(*) from app.version_events where generation_id = pg_temp.id('g7') and kind = 'generated'), 1::bigint, 'one generated event');
select is((select concat_ws('|', e.op_id = pg_temp.id('g7'), e.operation, e.target_id = pg_temp.id('g7'), e.version_revision, e.version_exercise_id is null,
                            e.data = '{"kind": "version", "applied": 2, "obsolete": 0, "discarded": 0}'::jsonb, e.result ->> 'status')
             from app.version_events e where e.generation_id = pg_temp.id('g7')), 't|internal_finish_generation|t|3|t|t|done', 'with the generation as op_id and what it did, without any text');
select pg_temp.mark('v7');
select is(pg_temp.fg('g7', 'done'), jsonb_build_object('id', pg_temp.id('g7'), 'status', 'done', 'changed', false), 'finishing again answers the same, changed false');
select is(pg_temp.fg('g7', 'failed', 'ai_error'), jsonb_build_object('id', pg_temp.id('g7'), 'status', 'done', 'changed', false), 'a late failure does not reopen it');
select ok(pg_temp.unchanged('v7'), 'and nothing else is written: still one event');
-- An output that arrives after the generation closed.
select is(pg_temp.ro('g7', 'gaze_questions', pg_temp.qs_out(1), 'x71') ->> 'outcome', 'obsolete', 'an output after the generation closed is obsolete');
select is(pg_temp.ro('g7', 'instructions', '{"instructions": "Tarde"}') ->> 'outcome', 'obsolete', 'the instructions too');
select is(pg_temp.xs('x71'), '2|ready|Uno|f|f|0', 'and nothing was touched');
select is(pg_temp.vs('v7'), '3|ready|1|f', 'not even the version');
select is((select o.output -> 'questions' -> 0 ->> 'stem' from app.generation_outputs o where o.generation_id = pg_temp.id('g7') and o.outcome = 'obsolete' and o.kind = 'gaze_questions'), 'Pregunta 1', 'the late output is stored');
-- A superseded generation: the old output is obsolete, the new generation applies.
select pg_temp.mk('g7b', 'v7', 'version');
select pg_temp.mk('g7c', 'v7', 'version');
select is(pg_temp.gstatus('g7b'), 'superseded', 'a version generation superseded by another');
select is(pg_temp.ro('g7b', 'exercise', pg_temp.text_out('Viejo'), 'x71') ->> 'outcome', 'obsolete', 'its output is obsolete');
select is(pg_temp.ro('g7c', 'exercise', pg_temp.text_out('Nuevo'), 'x71') ->> 'outcome', 'applied', 'the newer generation applies');
select is(pg_temp.xs('x71'), '3|ready|Nuevo|f|f|0', 'and the exercise has the new text');
-- An exercise taken over by its own generation: the version generation no longer applies to it.
select pg_temp.mk('g7d', 'v7', 'exercise', 'x72');
select is(pg_temp.ro('g7c', 'exercise', pg_temp.text_out('Del lote'), 'x72') ->> 'outcome', 'obsolete', 'an exercise regenerated on its own: the output of the version generation for it is obsolete');
select is(pg_temp.ro('g7d', 'exercise', pg_temp.text_out('Propio'), 'x72') ->> 'outcome', 'applied', 'and the output of its own generation applies');
select is(pg_temp.ro('g7d', 'exercise', pg_temp.text_out('Otro propio'), 'x71') ->> 'error', 'P0001 INVALID invalid_target', 'an exercise generation does not take another exercise');
select is(pg_temp.ro('g7d', 'instructions', '{"instructions": "x"}') ->> 'error', 'P0001 INVALID invalid_output', 'nor instructions');
select is(pg_temp.ro('g7c', 'gaze_questions', pg_temp.qs_out(1), 'x71') ->> 'outcome', 'applied', 'the version generation still applies to its other exercise');

-- A manual edit before the output of an exercise generation, and a retry after finishing.
select pg_temp.mk('g7e', 'v7', 'exercise', 'x71');
select pg_temp.edit_ex('x71', 'Texto de la profe');
select is(pg_temp.ro('g7e', 'exercise', pg_temp.text_out('De la IA'), 'x71') ->> 'outcome', 'obsolete', 'an exercise generation whose target was edited by hand meanwhile: obsolete');
select is(pg_temp.fg('g7e', 'done') ->> 'changed', 'true', 'it can be closed');
select is((select e.version_exercise_id = pg_temp.id('x71') and e.data ->> 'kind' = 'exercise' and (e.data ->> 'obsolete')::int = 1 from app.version_events e where e.generation_id = pg_temp.id('g7e')), true,
  'the event names the exercise and counts what was obsolete');
select is(pg_temp.xs('x71'), '5|ready|Texto de la profe|t|f|1', 'the teacher''s text stays');

-- ---------------------------------------------------------------------------------------------
-- A change of configuration supersedes what is running (T1.F4) (v6)
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('g6', 'v6', 'version');
select pg_temp.ro('g6', 'exercise', pg_temp.text_out('Antes del cambio'), 'x61');
select pg_temp.as_user('teach', format($q$select api.update_version_config(%L, %s, '{"profiles":["motor"],"supports":[],"interests":["fútbol"]}'::jsonb, 'gaze')$q$,
  pg_temp.id('v6'), (select revision from app.versions where id = pg_temp.id('v6'))));
select is(pg_temp.gstatus('g6'), 'superseded', 'changing the configuration supersedes the running generation');
select pg_temp.mark('v6');
select is(pg_temp.ro('g6', 'exercise', pg_temp.text_out('De la config vieja'), 'x62') ->> 'outcome', 'obsolete', 'its output arrives after: obsolete');
select is(pg_temp.ro('g6', 'instructions', '{"instructions": "De la config vieja"}') ->> 'outcome', 'obsolete', 'and its instructions');
select is(pg_temp.ro('g6', 'gaze_questions', pg_temp.qs_out(1), 'x61') ->> 'outcome', 'obsolete', 'and its questions');
select is(pg_temp.xs('x62'), '1|pending||t|t|0', 'nothing was applied');
select is((select count(*) from app.generation_outputs where generation_id = pg_temp.id('g6') and outcome = 'obsolete'), 3::bigint, 'the three outputs are stored');
select is(pg_temp.fg('g6', 'done'), jsonb_build_object('id', pg_temp.id('g6'), 'status', 'superseded', 'changed', false), 'closing it answers superseded without a change');
select is((select count(*) from app.version_events where generation_id = pg_temp.id('g6')), 0::bigint, 'and writes no generated event');
select is(pg_temp.mk('g6b', 'v6', 'version') ->> 'created', 'true', 'a new generation for the new configuration starts');
select is(pg_temp.ro('g6b', 'exercise', pg_temp.text_out('De la config nueva'), 'x62') ->> 'outcome', 'applied', 'and applies');

-- ---------------------------------------------------------------------------------------------
-- Finishing (v5 failed, vb cancelled, vc exercise done, vd answer key)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.fg('g7', 'superseded') ->> 'error', 'P0001 INVALID invalid_status', 'superseded is not a status a caller can ask for');
select is(pg_temp.fg('g7', 'running') ->> 'error', 'P0001 INVALID invalid_status', 'nor running');
select is(pg_temp.as_service(format('select api.internal_finish_generation(%L, null)', pg_temp.id('g7'))) ->> 'error', 'P0001 INVALID invalid_status', 'nor a missing one');
select is(pg_temp.fg('g7', 'done', 'oops') ->> 'error', 'P0001 INVALID invalid_error_code', 'done with an error code is INVALID invalid_error_code');
select is(pg_temp.fg('g7', 'failed', 'Mal Codigo') ->> 'error', 'P0001 INVALID invalid_error_code', 'and so is a code that is not a key');
select is(pg_temp.as_service(format('select api.internal_finish_generation(%L, ''done'')', gen_random_uuid())) ->> 'error', 'P0001 NOT_FOUND not_found', 'a generation that does not exist is NOT_FOUND');
select pg_temp.mk('g5', 'v5', 'version');
select pg_temp.ro('g5', 'exercise', pg_temp.text_out('Hecho'), 'x51');
select is(pg_temp.fg('g5', 'failed', 'ai_timeout'), jsonb_build_object('id', pg_temp.id('g5'), 'status', 'failed', 'changed', true), 'a generation fails');
select is(pg_temp.xs('x51'), '2|ready|Hecho|f|t|0', 'what it had written stays and stops being generated by it');
select is(pg_temp.xs('x52'), '1|error||t|t|0', 'what was still generating is in error');
select is((select ve.error_code from app.version_exercises ve where ve.id = pg_temp.id('x52')), 'ai_timeout', 'with its code');
select is(pg_temp.vs('v5'), '2|error|1|t|ai_timeout', 'the version is in error, with the code, and nothing is the generation in force');
select is((select count(*) from app.version_events where generation_id = pg_temp.id('g5')), 0::bigint, 'a failure writes no generated event');
select is((select g.error_code from app.generations g where g.id = pg_temp.id('g5')), 'ai_timeout', 'the generation keeps the code');
select is(pg_temp.ro('g5', 'exercise', pg_temp.text_out('Tarde'), 'x52') ->> 'outcome', 'obsolete', 'an output after a failure is obsolete');
select is(pg_temp.mk('g5b', 'v5', 'exercise', 'x52') ->> 'created', 'true', 'the exercise in error can be regenerated');
select is(pg_temp.ro('g5b', 'exercise', pg_temp.text_out('Bien'), 'x52') ->> 'outcome', 'applied', 'and applies');
select is(pg_temp.xs('x52'), '2|ready|Bien|f|f|0', 'it is ready with no error');
select is((select ve.error_code is null from app.version_exercises ve where ve.id = pg_temp.id('x52')), true, 'and the code is gone');

select pg_temp.mk('gb', 'vb', 'version');
select pg_temp.ro('gb', 'exercise', pg_temp.text_out('Hecho'), 'xb1');
select is(pg_temp.fg('gb', 'cancelled') ->> 'status', 'cancelled', 'a generation is cancelled');
select is(pg_temp.xs('xb1') || ',' || pg_temp.xs('xb2'), '2|ready|Hecho|f|t|0,1|pending||t|t|0', 'the exercises go back to what their text says');
select is(pg_temp.vs('vb'), '2|empty|1|t', 'the version is empty again, not in error, and no generation is in force');
select is((select count(*) from app.version_events where generation_id = pg_temp.id('gb')), 0::bigint, 'no event');

select pg_temp.mk('gc', 'vc', 'exercise', 'xc1');
select pg_temp.edit_ex('xc2', 'Hecho a mano');
select is(pg_temp.ro('gc', 'exercise', pg_temp.text_out('Texto del ejercicio'), 'xc1') ->> 'outcome', 'applied', 'an exercise generation applies');
select is(pg_temp.vs('vc'), '3|generating|1|t', 'the version is generating while it runs');
select is(pg_temp.fg('gc', 'done') ->> 'changed', 'true', 'and finishes');
select is(pg_temp.vs('vc'), '3|ready|1|t', 'the version is ready, completed by one generation and one person');

select pg_temp.mk('gk', 'vd', 'answer_key');
select is(pg_temp.fg('gk', 'failed', 'ai_error') ->> 'status', 'failed', 'an answer key generation fails');
select is((select concat_ws('|', k.status, k.error_code, k.current_generation_id is null) from app.answer_keys k where k.version_id = pg_temp.id('vd')), 'error|ai_error|t', 'the key is in error and the generation is not the one in force');
select is((select v.status from app.versions v where v.id = pg_temp.id('vd')), 'empty', 'the adaptation is not affected');
select pg_temp.mk('gk2', 'vd', 'answer_key');
select is(pg_temp.fg('gk2', 'done') ->> 'changed', 'true', 'another one finishes without recording a revision');
select is((select concat_ws('|', k.status, k.error_code is null, k.current_generation_id = pg_temp.id('gk2')) from app.answer_keys k where k.version_id = pg_temp.id('vd')), 'empty|t|t', 'the key goes back to empty');
select is((select count(*) from app.version_events where generation_id = pg_temp.id('gk2') and kind = 'generated'), 1::bigint, 'with its generated event');
select is(pg_temp.ro('gk2', 'exercise', pg_temp.text_out('x'), 'xd1') ->> 'error', 'P0001 INVALID invalid_output', 'the adaptation outputs do not go to an answer key generation');

-- ---------------------------------------------------------------------------------------------
-- Outputs that are not what was asked: stored as discarded, nothing applied (va)
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('ga', 'va', 'version');
select pg_temp.mark('va');
select is(pg_temp.ro('ga', 'exercise', '{"body": ""}', 'xa1') ->> 'outcome', 'discarded', 'an exercise without text is discarded');
select is(pg_temp.ro('ga', 'exercise', '{"body": "x", "changes": [{"what": 1, "why": "y"}]}', 'xa2') ->> 'outcome', 'discarded', 'and one with a change that is not text');
select is(pg_temp.ro('ga', 'gaze_questions', '{"questions": [{"stem": "¿?", "options": [{"id": "A", "text": "Uno"}]}]}', 'xa1') ->> 'outcome', 'discarded', 'questions with one option');
select is(pg_temp.ro('ga', 'gaze_questions', '{"questions": [{"stem": "¿?", "options": [{"id": "A", "text": "Uno"}, {"id": "A", "text": "Dos"}]}]}', 'xa2') ->> 'outcome', 'discarded', 'with a repeated option');
select is(pg_temp.ro('ga', 'instructions', '{"instructions": 5}') ->> 'outcome', 'discarded', 'instructions that are not text');
select is((select count(*) from app.generation_outputs where generation_id = pg_temp.id('ga') and outcome = 'discarded'), 5::bigint, 'the five are stored, not lost');
select is(pg_temp.vs('va'), '1|generating|1|f', 'and the version did not move');
select is(pg_temp.xs('xa1') || ',' || pg_temp.xs('xa2'), '1|generating||t|f|0,1|generating||t|f|0', 'nor did the exercises');
select is(pg_temp.ro('ga', 'exercise', '{"body": ""}', 'xa1') ->> 'outcome', 'discarded', 'a retry of a discarded output answers discarded');
select is(pg_temp.ro('ga', 'exercise', pg_temp.text_out('Ahora sí'), 'xa1') ->> 'outcome', 'discarded', 'and cannot fix it: the stored output is the one that counts, the job must be a new generation');
select is((select count(*) from app.generation_outputs where generation_id = pg_temp.id('ga')), 5::bigint, 'still five');

select * from finish();
rollback;
