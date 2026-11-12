-- T1.4b: versions, their configuration and their recipients through the RPCs, as each role of the
-- matrix would call them: create_version, update_version_config, set_version_recipients, archive_version,
-- list_versions and get_version; plus update_group, which now validates like create_group. Rows the RPCs
-- cannot make yet (adapted content, questions and keys: T1.4c and T1.4d) are seeded as the owner. Guards
-- are tried as the owner of the table, expecting P0004: as authenticated the UPDATE would fail first on
-- privileges (42501) and the test would pass without the guard. The whole file is rolled back.
begin;
-- Phase 1 links ordinary accounts (any email) to students; the shape guard of phase 2 (T2.5a) is off in this file. 040_f2_contract covers it.
alter table app.account_provisioning disable trigger student_auth_link_guard;
select plan(223);

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
insert into auth.users (id, email) select id, k || '@t1-4b.invalid' from ids where k <> 'ghost';
do $$
declare
  k text;
begin
  for k in select ids.k from ids where ids.k <> 'ghost' loop
    perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;

-- Institution n: admin, teachers teach (g_n) and other (go_n), co (co-teacher of g_n), inclusion; adm2 is an
-- admin who teaches go_n. Students of g_n: s1 (stu_a), s2, s3, s4; s5 was unenrolled, s6 is archived.
-- sx is in go_n (stu_b). Institution b: userb, with a group and a student.
insert into ids (k, id) select 'i_n', (pg_temp.as_service($$ select api.internal_create_institution('Liceo N', 't1-4b-n', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, %L)', pg_temp.id('i_n'), pg_temp.id(u.k), u.role))
  from (values ('admin', 'admin'), ('teach', 'teacher'), ('other', 'teacher'), ('co', 'teacher'), ('adm2', 'admin'), ('incl', 'inclusion')) as u(k, role);
insert into ids (k, id) values
  ('g_n', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid),
  ('go_n', (pg_temp.as_user('other', format('select api.create_group(%L, ''3.º B'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid),
  ('g_arch', (pg_temp.as_user('teach', format('select api.create_group(%L, ''Archivado'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid);
select pg_temp.as_user('teach', format('select api.add_group_staff(%L, %L, ''co_teacher'')', pg_temp.id('g_n'), pg_temp.id('co')));
select pg_temp.as_user('other', format('select api.add_group_staff(%L, %L, ''co_teacher'')', pg_temp.id('go_n'), pg_temp.id('adm2')));
insert into ids (k, id)
  select 's' || n, (pg_temp.as_user('teach', format('select api.create_student(%L, %L, %L, gen_random_uuid())',
           pg_temp.id('g_n'), 'Estudiante ' || n, 'est.' || n)) ->> 'id')::uuid
    from generate_series(1, 6) n;
insert into ids (k, id) values
  ('sx', (pg_temp.as_user('other', format('select api.create_student(%L, ''Estudiante X'', ''est.x'', gen_random_uuid())', pg_temp.id('go_n'))) ->> 'id')::uuid);
select pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('s1'), pg_temp.id('stu_a')));
select pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('sx'), pg_temp.id('stu_b')));
select pg_temp.as_user('teach', format('select api.unenroll_student(%L, %L)', pg_temp.id('g_n'), pg_temp.id('s5')));
select pg_temp.as_user('teach', format('select api.archive_student(%L, 1)', pg_temp.id('s6')));
insert into ids (k, id) select 'i_b', (pg_temp.as_service($$ select api.internal_create_institution('Liceo B', 't1-4b-b', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_b'), pg_temp.id('userb')));
insert into ids (k, id) values
  ('g_b', (pg_temp.as_user('userb', format('select api.create_group(%L, ''Otro colegio'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_b'))) ->> 'id')::uuid);
insert into ids (k, id) values
  ('sb', (pg_temp.as_user('userb', format('select api.create_student(%L, ''Estudiante B'', ''est.b'', gen_random_uuid())', pg_temp.id('g_b'))) ->> 'id')::uuid);

-- The assessments: a1 with three exercises (the third is removed later), a2 with two (another assessment
-- of the same group), a_empty without any, a_b in the other institution.
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
select pg_temp.mk_asm('teach', 'g_n', 'a2');
select pg_temp.mk_ex('teach', 'a2', 'f1', 'Otro enunciado 1');
select pg_temp.mk_ex('teach', 'a2', 'f2', 'Otro enunciado 2');
select pg_temp.mk_asm('teach', 'g_n', 'a_empty');
select pg_temp.mk_asm('userb', 'g_b', 'a_b');
select pg_temp.mk_ex('userb', 'a_b', 'b1', 'Enunciado B');

-- The calls under test. Raw arguments (revisions, keys, bases) are SQL; the configuration is JSON text.
create function pg_temp.cfg(p_profiles text default '', p_supports text default '', p_interests text default '', p_keep text default null) returns text language sql as $$
  select format('{"profiles":[%s],"supports":[%s],"interests":[%s]%s}', p_profiles, p_supports, p_interests,
                case when p_keep is null then '' else ',"keep":[' || p_keep || ']' end)
$$;
create function pg_temp.cv(p_user text, p_asm text, p_cfg text, p_mode text default 'typed', p_key text default 'gen_random_uuid()', p_base text default 'null') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.create_version(%L, %L::jsonb, %L, %s, %s)', pg_temp.id(p_asm), p_cfg, p_mode, p_key, p_base))
$$;
create function pg_temp.ucv(p_user text, p_ver text, p_rev text, p_cfg text, p_mode text default 'typed') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.update_version_config(%L, %s, %L::jsonb, %L)', pg_temp.id(p_ver), p_rev, p_cfg, p_mode))
$$;
-- An exercise id as a JSON string, for config.keep.
create function pg_temp.jq(p_key text) returns text language sql as $$ select '"' || pg_temp.id(p_key)::text || '"' $$;
create function pg_temp.idarr(p_keys text[]) returns text language sql as $$
  select format('%L::uuid[]', '{' || coalesce(string_agg(pg_temp.id(k)::text, ',' order by n), '') || '}') from unnest(p_keys) with ordinality as t(k, n)
$$;
create function pg_temp.rec(p_user text, p_ver text, p_rev text, p_studs text[], p_op text default 'gen_random_uuid()') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.set_version_recipients(%L, %s, %s, %s)', pg_temp.id(p_ver), p_rev, pg_temp.idarr(p_studs), p_op))
$$;
create function pg_temp.arv(p_user text, p_ver text, p_rev text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.archive_version(%L, %s)', pg_temp.id(p_ver), p_rev))
$$;
create function pg_temp.lv(p_user text, p_asm text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.list_versions(%L)', pg_temp.id(p_asm)))
$$;
create function pg_temp.gv(p_user text, p_ver text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.get_version(%L)', pg_temp.id(p_ver)))
$$;
-- The current recipients of a version, as the keys of their students.
create function pg_temp.now_of(p_ver text) returns text language sql as $$
  select coalesce(string_agg(k, ',' order by k), '') from (select coalesce((select i.k from ids i where i.id = r.student_id), '?') as k
    from app.version_recipients r where r.version_id = pg_temp.id(p_ver) and r.valid_to is null) t
$$;
-- Everything these RPCs can change, as one string.
create function pg_temp.digest() returns text language sql as $$
  select md5(coalesce((select string_agg(concat_ws('|', v.id, v.revision, v.stale, v.config, v.answer_mode, v.archived_at, v.position, v.general_instructions, v.status), ';' order by v.id)
                         from app.versions v where v.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', r.id, r.version_id, r.student_id, r.valid_from, r.valid_to), ';' order by r.id)
                         from app.version_recipients r where r.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', ve.id, ve.version_id, ve.revision, ve.body), ';' order by ve.id)
                         from app.version_exercises ve where ve.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(concat_ws('|', g.id, g.revision, g.name, g.school_year), ';' order by g.id)
                         from app.groups g where g.institution_id = pg_temp.id('i_n')), '')
          || (select count(*) from app.version_events e where e.institution_id = pg_temp.id('i_n'))::text
          || (select count(*) from app.audit_log a where a.institution_id = pg_temp.id('i_n'))::text)
$$;
create temp table before_val (n serial, d text);
create function pg_temp.mark() returns void language sql as $$ insert into before_val (d) select pg_temp.digest() $$;
create function pg_temp.unchanged() returns boolean language sql as $$
  select (select d from before_val order by n desc limit 1) = pg_temp.digest()
$$;

-- ---------------------------------------------------------------------------------------------
-- create_version
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.keys(pg_temp.keep('v1', pg_temp.cv('teach', 'a1', pg_temp.cfg('"motor"', '"recordatorio"', '"  Ajedrez  "'), 'gaze'))), 'id,position,revision',
  'a teacher of the group creates a version: the answer is its id, its position and its revision');
select is((select concat_ws('|', v.position, v.revision, v.status, v.stale, v.answer_mode, v.general_instructions, v.base_version_id is null,
                              v.created_by = pg_temp.id('teach'), v.institution_id = pg_temp.id('i_n'), v.instructions_revision, v.approved_revision is null,
                              v.archived_at is null, v.op_key is not null, v.op_identity ~ '^[0-9a-f]{64}$')
             from app.versions v where v.id = pg_temp.id('v1')),
  '1|1|empty|f|gaze|Elegí dos ejercicios.|t|t|t|1|t|t|t|t',
  'it is position 1, empty, not stale, with the instructions copied from the assessment, its author from the session and its operation stored');
select is((select v.config from app.versions v where v.id = pg_temp.id('v1')),
  '{"profiles":["motor"],"supports":["recordatorio"],"interests":["Ajedrez"]}'::jsonb, 'the configuration is stored normalized: the interest is trimmed');
select is((select string_agg(coalesce((select i.k from ids i where i.id = ve.exercise_id), '?') || ':' || ve.status || ':' || ve.source_revision || ':' || (ve.body = '')::text,
                             ',' order by e.position)
             from app.version_exercises ve join app.assessment_exercises e on e.id = ve.exercise_id where ve.version_id = pg_temp.id('v1')),
  'e1:pending:1:true,e2:pending:1:true,e3:pending:1:true', 'with no config.keep it has a pending adapted exercise for each live exercise, from revision 1 and with no text');
select is((select count(*) from app.version_exercises ve where ve.version_id = pg_temp.id('v1') and ve.institution_id = pg_temp.id('i_n')
              and ve.assessment_id = pg_temp.id('a1')), 3::bigint, 'each one in the institution and the assessment of the version');
select is(pg_temp.cv('co', 'a1', pg_temp.cfg('"dyslexia"', '', ''), 'typed') ->> 'position', '2', 'a co-teacher creates another one: the next position');
select pg_temp.keep('v3', pg_temp.cv('teach', 'a1', pg_temp.cfg('', '"ejemplo_resuelto","numeros_simples"', '"música"', pg_temp.jq('e1') || ',' || pg_temp.jq('e3')), 'voice', 'gen_random_uuid()', quote_literal(pg_temp.id('v1'))));
select is((select concat_ws('|', v.position, v.base_version_id = pg_temp.id('v1'), v.config -> 'keep' = jsonb_build_array(pg_temp.id('e1'), pg_temp.id('e3')))
             from app.versions v where v.id = pg_temp.id('v3')), '3|t|t', 'a version with a base version and config.keep: position 3 and it keeps what it was given');
select is((select string_agg(coalesce((select i.k from ids i where i.id = ve.exercise_id), '?'), ',' order by e.position)
             from app.version_exercises ve join app.assessment_exercises e on e.id = ve.exercise_id where ve.version_id = pg_temp.id('v3')),
  'e1,e3', 'and has an adapted exercise only for the ones kept');
select is(pg_temp.cv('teach', 'a1', pg_temp.cfg(), 'typed') ->> 'revision', '1', 'an empty configuration is fine: no profile, support or interest');
select is(pg_temp.cv('teach', 'a1', '{"profiles":[],"supports":[],"interests":[],"keep":[]}'::text, 'typed') ->> 'error', 'P0001 INVALID no_exercises',
  'a keep that is empty leaves no exercise to adapt: INVALID no_exercises');
-- Positions are never reused: archiving the last version does not free its number.
select pg_temp.keep('v5', pg_temp.cv('teach', 'a1', pg_temp.cfg('"adhd"', '', ''), 'typed'));
select is((select position from app.versions where id = pg_temp.id('v5')), 5, 'the fifth version is position 5');
select is(pg_temp.arv('teach', 'v5', '1') ->> 'revision', '2', 'it is archived');
select is(pg_temp.cv('teach', 'a1', pg_temp.cfg('"asd"', '', ''), 'typed') ->> 'position', '6', 'and the next one is 6: the position of an archived version is not reused');
-- Refusals: nothing changes.
select pg_temp.mark();
select is(pg_temp.cv('teach', 'a1', null) ->> 'error', 'P0001 INVALID invalid_config', 'a null configuration is INVALID invalid_config');
select is(pg_temp.cv('teach', 'a1', '[]') ->> 'error', 'P0001 INVALID invalid_config', 'an array is not a configuration');
select is(pg_temp.cv('teach', 'a1', '{"profiles":[],"supports":[],"interests":[],"nombre":"x"}') ->> 'error', 'P0001 INVALID invalid_config', 'a key outside the shape is refused');
select is(pg_temp.cv('teach', 'a1', '{"profiles":[],"supports":[]}') ->> 'error', 'P0001 INVALID invalid_config', 'a missing key is refused');
select is(pg_temp.cv('teach', 'a1', '{"profiles":"motor","supports":[],"interests":[]}') ->> 'error', 'P0001 INVALID invalid_config', 'a profiles that is not a list is refused');
select is(pg_temp.cv('teach', 'a1', '{"profiles":[1],"supports":[],"interests":[]}') ->> 'error', 'P0001 INVALID invalid_config', 'a profile that is not text is refused');
select is(pg_temp.cv('teach', 'a1', pg_temp.cfg('"motor","motor"', '', '')) ->> 'error', 'P0001 INVALID invalid_config', 'a repeated profile is refused');
select is(pg_temp.cv('teach', 'a1', pg_temp.cfg('"motor","adhd","asd","dyslexia","dysgraphia","motor","adhd","asd","dyslexia","dysgraphia","motor"', '', '')) ->> 'error',
  'P0001 INVALID invalid_config', 'and more than ten');
select is(pg_temp.cv('teach', 'a1', pg_temp.cfg('"zurdo"', '', '')) ->> 'error', 'P0001 INVALID unknown_profile', 'a profile outside the validated catalogue is INVALID unknown_profile');
select is(pg_temp.cv('teach', 'a1', pg_temp.cfg('', '"truco"', '')) ->> 'error', 'P0001 INVALID unknown_support', 'a support outside it is INVALID unknown_support');
select is(pg_temp.cv('teach', 'a1', pg_temp.cfg('', '', '"a","b","c","d","e","f"')) ->> 'error', 'P0001 INVALID invalid_interests', 'six interests are INVALID invalid_interests');
select is(pg_temp.cv('teach', 'a1', pg_temp.cfg('', '', '"   "')) ->> 'error', 'P0001 INVALID invalid_interests', 'a blank interest too');
select is(pg_temp.cv('teach', 'a1', pg_temp.cfg('', '', format('"%s"', repeat('i', 61)))) ->> 'error', 'P0001 INVALID invalid_interests', 'one of 61 characters too');
select is(pg_temp.cv('teach', 'a1', pg_temp.cfg('', '', '"a"," a"')) ->> 'error', 'P0001 INVALID invalid_interests', 'and a repeated one (compared trimmed)');
select is(pg_temp.cv('teach', 'a1', '{"profiles":[],"supports":[],"interests":[1]}') ->> 'error', 'P0001 INVALID invalid_interests', 'an interest that is not text too');
select is(pg_temp.cv('teach', 'a1', pg_temp.cfg('', '', '', '"no-es-un-id"')) ->> 'error', 'P0001 INVALID invalid_keep', 'a keep that is not made of ids is INVALID invalid_keep');
select is(pg_temp.cv('teach', 'a1', '{"profiles":[],"supports":[],"interests":[],"keep":null}') ->> 'error', 'P0001 INVALID invalid_keep', 'a null keep too');
select is(pg_temp.cv('teach', 'a1', pg_temp.cfg('', '', '', pg_temp.jq('e1') || ',' || pg_temp.jq('e1'))) ->> 'error', 'P0001 INVALID invalid_keep', 'a repeated id in keep too');
select is(pg_temp.cv('teach', 'a1', pg_temp.cfg('', '', '', pg_temp.jq('f1'))) ->> 'error', 'P0001 INVALID invalid_keep', 'an exercise of another assessment in keep too');
select is(pg_temp.cv('teach', 'a1', pg_temp.cfg('', '', '', '"' || gen_random_uuid() || '"')) ->> 'error', 'P0001 INVALID invalid_keep', 'and one that does not exist');
select is(pg_temp.cv('teach', 'a1', pg_temp.cfg(), 'braille') ->> 'error', 'P0001 INVALID invalid_answer_mode', 'an answer mode outside the list is INVALID invalid_answer_mode');
select is(pg_temp.as_user('teach', format('select api.create_version(%L, %L::jsonb, null, gen_random_uuid(), null)', pg_temp.id('a1'), pg_temp.cfg())) ->> 'error', 'P0001 INVALID invalid_answer_mode', 'a null one too');
select is(pg_temp.as_user('teach', format('select api.create_version(%L, %L::jsonb, ''typed'', null, null)', pg_temp.id('a1'), pg_temp.cfg())) ->> 'error', 'P0001 INVALID invalid_op_key', 'a null op_key is INVALID invalid_op_key');
select is(pg_temp.cv('teach', 'a1', pg_temp.cfg(), 'typed', 'gen_random_uuid()', quote_literal(gen_random_uuid())) ->> 'error', 'P0001 INVALID invalid_base_version', 'a base version that does not exist is INVALID invalid_base_version');
select pg_temp.keep('w1', pg_temp.cv('teach', 'a2', pg_temp.cfg(), 'typed'));
select pg_temp.mark();
select is(pg_temp.cv('teach', 'a1', pg_temp.cfg(), 'typed', 'gen_random_uuid()', quote_literal(pg_temp.id('w1'))) ->> 'error', 'P0001 INVALID invalid_base_version', 'and one of another assessment');
select is(pg_temp.cv('teach', 'a_empty', pg_temp.cfg()) ->> 'error', 'P0001 INVALID no_exercises', 'an assessment without exercises has nothing to adapt: INVALID no_exercises');
select is(pg_temp.as_user('teach', 'select api.create_version(null, ''{}''::jsonb, ''typed'', gen_random_uuid(), null)') ->> 'error', 'P0001 NOT_FOUND not_found', 'a null assessment is NOT_FOUND');
select is(pg_temp.as_user('teach', format('select api.create_version(%L, %L::jsonb, ''typed'', gen_random_uuid(), null)', gen_random_uuid(), pg_temp.cfg())) ->> 'error', 'P0001 NOT_FOUND not_found', 'one that does not exist too');
select ok(pg_temp.unchanged(), 'and no refusal changed anything');

-- An exercise removed or edited before the version is made is not copied or copied as it is.
select pg_temp.keep('ed', pg_temp.as_user('teach', format('select api.add_exercise(%L, ''4'', ''Cuarto'', gen_random_uuid(), null)', pg_temp.id('a1'))));
select pg_temp.as_user('teach', format('select api.remove_exercise(%L, 1)', pg_temp.id('e3')));
select pg_temp.as_user('teach', format('select api.update_exercise(%L, 1, ''2'', ''Enunciado 2 editado'', null)', pg_temp.id('e2')));
select pg_temp.keep('v7', pg_temp.cv('teach', 'a1', pg_temp.cfg(), 'typed'));
select is((select string_agg(coalesce((select i.k from ids i where i.id = ve.exercise_id), '?') || ':' || ve.source_revision, ',' order by e.position)
             from app.version_exercises ve join app.assessment_exercises e on e.id = ve.exercise_id where ve.version_id = pg_temp.id('v7')),
  'e1:1,e2:2,ed:1', 'a version made now skips the removed exercise and records the revision of the edited one');
select is((select v.stale from app.versions v where v.id = pg_temp.id('v7')), false, 'and is not stale: it was made from what the assessment says now');
select is((select string_agg(k, ',' order by k) from (select i.k from app.versions v join ids i on i.id = v.id where v.stale and v.assessment_id = pg_temp.id('a1')) t), 'v1,v3',
  'while the earlier versions that adapted the removed or edited exercise were marked stale (and the empty-config ones with them)');

-- ---------------------------------------------------------------------------------------------
-- Idempotency by op_key (T1.F3), compared with the identity stored at the creation.
-- ---------------------------------------------------------------------------------------------
insert into ids (k, id) values ('ka', gen_random_uuid()), ('kb', gen_random_uuid());
create function pg_temp.cvk(p_user text, p_asm text, p_key text, p_cfg text, p_mode text default 'typed', p_base text default 'null') returns jsonb language sql as $$
  select pg_temp.cv(p_user, p_asm, p_cfg, p_mode, quote_literal(pg_temp.id(p_key)), p_base)
$$;
select pg_temp.keep('vk', pg_temp.cvk('teach', 'a2', 'ka', pg_temp.cfg('"motor"', '', '"Ajedrez"'), 'gaze'));
select is(pg_temp.cvk('teach', 'a2', 'ka', pg_temp.cfg('"motor"', '', '"Ajedrez"'), 'gaze'), jsonb_build_object('id', pg_temp.id('vk'), 'revision', 1, 'position', 2),
  'create_version: the same op_key and data answer the same version (id, revision 1 and its position)');
select is(pg_temp.cvk('co', 'a2', 'ka', '{"interests":[" Ajedrez "],"supports":[],"profiles":["motor"]}', 'gaze') ->> 'id', pg_temp.id('vk')::text,
  'also from another teacher, with the keys in another order and an interest with spaces: the same request');
select is((select count(*) from app.versions v where v.op_key = pg_temp.id('ka')), 1::bigint, 'one row');
select is(pg_temp.ucv('teach', 'vk', '1', pg_temp.cfg('"adhd"', '', ''), 'typed') ->> 'revision', '2', 'the version is edited after the creation');
select is(pg_temp.cvk('teach', 'a2', 'ka', pg_temp.cfg('"motor"', '', '"Ajedrez"'), 'gaze'), jsonb_build_object('id', pg_temp.id('vk'), 'revision', 1, 'position', 2),
  'and the replay still answers what the creation answered: revision 1, not the current one');
select is(pg_temp.arv('teach', 'vk', '2') ->> 'revision', '3', 'the version is archived');
select is(pg_temp.cvk('teach', 'a2', 'ka', pg_temp.cfg('"motor"', '', '"Ajedrez"'), 'gaze') ->> 'id', pg_temp.id('vk')::text, 'and the replay answers it anyway');
select pg_temp.mark();
select is(pg_temp.cvk('teach', 'a2', 'ka', pg_temp.cfg('"motor"', '', '"Ajedrez"'), 'typed') ->> 'error', 'P0001 CONFLICT op_key_reused', 'the same op_key with another answer mode is CONFLICT op_key_reused');
select is(pg_temp.cvk('teach', 'a2', 'ka', pg_temp.cfg('"adhd"', '', '"Ajedrez"'), 'gaze') ->> 'error', 'P0001 CONFLICT op_key_reused', 'with another configuration');
select is(pg_temp.cvk('teach', 'a1', 'ka', pg_temp.cfg('"motor"', '', '"Ajedrez"'), 'gaze') ->> 'error', 'P0001 CONFLICT op_key_reused', 'on another assessment, never a second version');
select is(pg_temp.cvk('teach', 'a2', 'ka', pg_temp.cfg('"motor"', '', '"Ajedrez"'), 'gaze', quote_literal(pg_temp.id('w1'))) ->> 'error', 'P0001 CONFLICT op_key_reused', 'and with a base version');
select ok(pg_temp.unchanged(), 'none of them changed anything');
-- The replay of a version made in an assessment archived since still answers it; a new key does not.
select pg_temp.mk_asm('teach', 'g_n', 'a_arch');
select pg_temp.mk_ex('teach', 'a_arch', 'h1', 'Texto');
select pg_temp.keep('vh', pg_temp.cvk('teach', 'a_arch', 'kb', pg_temp.cfg()));
select pg_temp.as_user('teach', format('select api.archive_assessment(%L, 1)', pg_temp.id('a_arch')));
select is(pg_temp.cvk('teach', 'a_arch', 'kb', pg_temp.cfg()) ->> 'id', pg_temp.id('vh')::text, 'the replay in an assessment archived since answers the same version');
select is(pg_temp.cv('teach', 'a_arch', pg_temp.cfg()) ->> 'error', 'P0001 INVALID assessment_archived', 'but an archived assessment takes no new version');
select is(pg_temp.as_user('teach', format('select api.create_version(%L, %L::jsonb, ''typed'', gen_random_uuid(), null)', pg_temp.id('a2'), pg_temp.cfg('', '', '', pg_temp.jq('f2')))) ->> 'position', '3',
  'a version that keeps one exercise of the assessment is made, in the next position');

-- ---------------------------------------------------------------------------------------------
-- set_version_recipients
-- ---------------------------------------------------------------------------------------------
insert into ids (k, id) select 'op' || n, gen_random_uuid() from generate_series(1, 20) n;
select is(pg_temp.keys(pg_temp.rec('teach', 'v1', '1', array['s1', 's2'], quote_literal(pg_temp.id('op1')))), 'id,revision', 'a teacher sets the recipients: the answer is the id and the revision of the version');
select is(pg_temp.rec('teach', 'v1', '1', array['s1', 's2'], quote_literal(pg_temp.id('op1'))) ->> 'revision', '2', 'the revision moved: an approval of the old one no longer covers it (and the same op_id replays that answer)');
select is(pg_temp.now_of('v1'), 's1,s2', 'the recipients are the two students');
select is((select count(*) from app.version_recipients r where r.version_id = pg_temp.id('v1') and r.valid_to is null and r.valid_from <= clock_timestamp()
              and r.institution_id = pg_temp.id('i_n') and r.assessment_id = pg_temp.id('a1')), 2::bigint, 'each row open, in the institution and the assessment of the version');
select is((select concat_ws('|', e.kind, e.operation, e.target_id = pg_temp.id('v1'), e.version_revision, e.actor_user_id = pg_temp.id('teach'), e.result = jsonb_build_object('id', pg_temp.id('v1'), 'revision', 2))
             from app.version_events e where e.op_id = pg_temp.id('op1')), 'recipients_changed|set_version_recipients|t|2|t|t',
  'one recipients_changed event, with its op_id, the revision it produced and the result { id, revision }');
select is((select count(*) from app.version_events e where e.op_id = pg_temp.id('op1')), 1::bigint, 'and only one, however many times it was asked');
select is((select e.result::text like '%' || pg_temp.id('s1')::text || '%' or e.result::text like '%' || pg_temp.id('s2')::text || '%' from app.version_events e where e.op_id = pg_temp.id('op1')), false,
  'the stored result carries no student id');
select is((select (e.data -> 'added') @> to_jsonb(array[pg_temp.id('s1')::text, pg_temp.id('s2')::text]) and jsonb_array_length(e.data -> 'added') = 2 and e.data -> 'removed' = '[]'::jsonb
                    and jsonb_array_length(e.data -> 'recipients') = 2
             from app.version_events e where e.op_id = pg_temp.id('op1')), true, 'who joined goes only in data (added, removed and the resulting set)');
-- A change of the set is a difference: the one who stays keeps their row and their date.
create temp table before_s1 as select r.id, r.valid_from from app.version_recipients r where r.version_id = pg_temp.id('v1') and r.student_id = pg_temp.id('s1');
select is(pg_temp.rec('teach', 'v1', '2', array['s1', 's3'], quote_literal(pg_temp.id('op2'))) ->> 'revision', '3', 'a new set: the revision moves again');
select is(pg_temp.now_of('v1'), 's1,s3', 'now s1 and s3 receive it');
select is((select count(*) from app.version_recipients r join before_s1 b on b.id = r.id and b.valid_from = r.valid_from where r.valid_to is null), 1::bigint,
  'the one who stayed (s1) keeps their row and their valid_from');
select is((select count(*) from app.version_recipients r where r.version_id = pg_temp.id('v1') and r.student_id = pg_temp.id('s2') and r.valid_to is not null and r.valid_to >= r.valid_from), 1::bigint,
  'the one who left (s2) has a closed row: history, not a delete');
select is((select concat_ws('|', jsonb_array_length(e.data -> 'added'), jsonb_array_length(e.data -> 'removed'), (e.data -> 'removed') ? pg_temp.id('s2')::text, (e.data -> 'added') ? pg_temp.id('s3')::text)
             from app.version_events e where e.op_id = pg_temp.id('op2')), '1|1|t|t', 'and the event says who left and who joined');
select is((select r.valid_from > (select max(r2.valid_from) from app.version_recipients r2 where r2.id = (select id from before_s1))
             from app.version_recipients r where r.version_id = pg_temp.id('v1') and r.student_id = pg_temp.id('s3') and r.valid_to is null), true, 'the one who joined starts later than the one already there');
-- The same set again: the revision does not move (an approval stays), but the operation is recorded.
select is(pg_temp.rec('teach', 'v1', '3', array['s3', 's1'], quote_literal(pg_temp.id('op3'))) ->> 'revision', '3', 'the same set in another order changes nothing: the revision stays');
select is((select count(*) from app.version_events e where e.op_id = pg_temp.id('op3')), 1::bigint, 'but the operation is recorded');
-- Replay and reuse of an op_id.
select is(pg_temp.rec('teach', 'v1', '2', array['s1', 's3'], quote_literal(pg_temp.id('op2'))) ->> 'revision', '3', 'the same op_id and set answer the stored result even with an old revision');
select pg_temp.mark();
select is(pg_temp.rec('teach', 'v1', '3', array['s1'], quote_literal(pg_temp.id('op2'))) ->> 'error', 'P0001 CONFLICT op_key_reused', 'the same op_id with another set is CONFLICT op_key_reused');
select is(pg_temp.rec('teach', 'v3', '1', array['s1', 's3'], quote_literal(pg_temp.id('op2'))) ->> 'error', 'P0001 CONFLICT op_key_reused', 'on another version too');
select is(pg_temp.as_user('teach', format('select api.update_version_config(%L, 3, %L::jsonb, ''typed'')', pg_temp.id('v1'), pg_temp.cfg())) ->> 'revision', '4', 'the version can still be reconfigured (revision 3 -> 4)');
select pg_temp.mark();
select is(pg_temp.as_user('teach', format('select api.set_version_recipients(%L, 4, %s, null)', pg_temp.id('v1'), pg_temp.idarr(array['s1']))) ->> 'error', 'P0001 INVALID invalid_op_key', 'a null op_id is INVALID invalid_op_key');
select is(pg_temp.rec('teach', 'v1', '3', array['s1']) ->> 'error', 'P0001 CONFLICT revision_mismatch', 'an old revision is CONFLICT revision_mismatch');
select is(pg_temp.as_user('teach', format('select api.set_version_recipients(%L, null, %s, gen_random_uuid())', pg_temp.id('v1'), pg_temp.idarr(array['s1']))) ->> 'error', 'P0001 INVALID revision_required', 'a missing revision too');
select is(pg_temp.as_user('teach', format('select api.set_version_recipients(%L, 4, null, gen_random_uuid())', pg_temp.id('v1'))) ->> 'error', 'P0001 INVALID invalid_students', 'a null list is INVALID invalid_students');
select is(pg_temp.as_user('teach', format('select api.set_version_recipients(%L, 4, array[%L, null]::uuid[], gen_random_uuid())', pg_temp.id('v1'), pg_temp.id('s1'))) ->> 'error', 'P0001 INVALID invalid_students', 'a list with a null too');
select is(pg_temp.rec('teach', 'v1', '4', array['s1', 's1']) ->> 'error', 'P0001 INVALID invalid_students', 'and one with a repeated student');
select is(pg_temp.as_user('teach', format('select api.set_version_recipients(%L, 4, (select array_agg(gen_random_uuid()) from generate_series(1, 201)), gen_random_uuid())', pg_temp.id('v1'))) ->> 'error', 'P0001 INVALID invalid_students', 'and one of 201');
select is(pg_temp.rec('teach', 'v1', '4', array['sb']) ->> 'error', 'P0001 INVALID invalid_students', 'a student of another institution is INVALID invalid_students (never a raw foreign key error)');
select is(pg_temp.as_user('teach', format('select api.set_version_recipients(%L, 4, array[gen_random_uuid()], gen_random_uuid())', pg_temp.id('v1'))) ->> 'error', 'P0001 INVALID invalid_students', 'and one that does not exist');
select is(pg_temp.rec('teach', 'v1', '4', array['sx']) ->> 'error', 'P0001 INVALID not_enrolled', 'a student of another group is INVALID not_enrolled');
select is(pg_temp.rec('teach', 'v1', '4', array['s5']) ->> 'error', 'P0001 INVALID not_enrolled', 'one who was unenrolled too');
select is(pg_temp.rec('teach', 'v1', '4', array['s6']) ->> 'error', 'P0001 INVALID not_enrolled', 'and an archived one');
select is(pg_temp.rec('teach', 'v1', '4', array['s1', 'sx']) ->> 'error', 'P0001 INVALID not_enrolled', 'one who is not enrolled refuses the whole set');
select ok(pg_temp.unchanged(), 'and no refusal changed anything');
-- Only one version of the assessment per student at a time.
select is(pg_temp.rec('teach', 'v3', '1', array['s1', 's4']) ->> 'error', 'P0001 CONFLICT recipient_in_other_version', 'a student who already receives another version of the assessment: CONFLICT recipient_in_other_version');
select is(pg_temp.now_of('v3'), '', 'nobody was added to the second version (the set is applied whole or not at all)');
select is(pg_temp.rec('teach', 'v3', '1', array['s2', 's4']) ->> 'revision', '2', 'the one who left the first version (s2) can receive another one');
select is(pg_temp.rec('teach', 'w1', '1', array['s1']) ->> 'revision', '2', 'and a version of another assessment has no conflict: the rule is per assessment');
-- The tables themselves, as the owner: the unique index and the enrollment trigger answer too.
select throws_ok(format('insert into app.version_recipients (institution_id, assessment_id, version_id, student_id) values (%L, %L, %L, %L)',
    pg_temp.id('i_n'), pg_temp.id('a1'), pg_temp.id('v3'), pg_temp.id('s1')), '23505', null, 'two open rows of one student in two versions of the same assessment: the index refuses (the RPC checks before)');
select throws_ok(format('insert into app.version_recipients (institution_id, assessment_id, version_id, student_id) values (%L, %L, %L, %L)',
    pg_temp.id('i_n'), pg_temp.id('a1'), pg_temp.id('v3'), pg_temp.id('sx')), 'P0001', 'INVALID', 'a recipient who is not enrolled in the group of the assessment is refused by the table, not only by the RPC (INVALID)');
select throws_ok(format('insert into app.version_recipients (institution_id, assessment_id, version_id, student_id) values (%L, %L, %L, %L)',
    pg_temp.id('i_n'), pg_temp.id('a1'), pg_temp.id('v3'), pg_temp.id('s6')), 'P0001', 'INVALID', 'nor an archived one');
select lives_ok(format('insert into app.version_recipients (institution_id, assessment_id, version_id, student_id) values (%L, %L, %L, %L)',
    pg_temp.id('i_n'), pg_temp.id('a2'), pg_temp.id('w1'), pg_temp.id('s3')), 'while an enrolled student is accepted by the trigger (s3, in another assessment where the index allows it)');
-- Closed rows and what says where a row belongs (as the owner of the table: P0004, not 42501).
select throws_ok(format('update app.version_recipients set valid_to = null where version_id = %L and student_id = %L and valid_to is not null', pg_temp.id('v1'), pg_temp.id('s2')), 'P0004', null, 'a closed row is not reopened');
select throws_ok(format('update app.version_recipients set valid_to = valid_to + interval ''1 day'' where version_id = %L and student_id = %L and valid_to is not null', pg_temp.id('v1'), pg_temp.id('s2')), 'P0004', null, 'nor moved');
select throws_ok(format('update app.version_recipients set student_id = %L where version_id = %L and student_id = %L', pg_temp.id('s4'), pg_temp.id('v1'), pg_temp.id('s1')), 'P0004', null, 'a recipient row never changes its student');
select throws_ok(format('update app.version_recipients set version_id = %L where version_id = %L and student_id = %L', pg_temp.id('v7'), pg_temp.id('v1'), pg_temp.id('s1')), 'P0004', null, 'nor its version');
select throws_ok(format('update app.version_recipients set valid_from = valid_from - interval ''1 day'' where version_id = %L and student_id = %L', pg_temp.id('v1'), pg_temp.id('s1')), 'P0004', null, 'nor the date it started');
select throws_ok(format('update app.version_recipients set institution_id = %L where version_id = %L and student_id = %L', pg_temp.id('i_b'), pg_temp.id('v1'), pg_temp.id('s1')), 'P0004', null, 'nor its institution');
select lives_ok(format('update app.version_recipients set valid_to = clock_timestamp() where version_id = %L and student_id = %L and valid_to is null', pg_temp.id('v1'), pg_temp.id('s1')), 'an open row is closed, once (the guard only protects the rest)');
select is(pg_temp.rec('teach', 'v1', '4', array['s1', 's3']) ->> 'revision', '5', 'and the RPC opens the row again for the same student (a new row, a new date)');
-- Guards of versions.
select throws_ok(format('update app.versions set position = 9 where id = %L', pg_temp.id('v1')), 'P0004', null, 'the position of a version never changes');
select throws_ok(format('update app.versions set assessment_id = %L where id = %L', pg_temp.id('a2'), pg_temp.id('v1')), 'P0004', null, 'nor its assessment');
select throws_ok(format('update app.versions set base_version_id = %L where id = %L', pg_temp.id('v1'), pg_temp.id('v7')), 'P0004', null, 'nor its base version');
select throws_ok(format('update app.versions set created_by = %L where id = %L', pg_temp.id('other'), pg_temp.id('v1')), 'P0004', null, 'nor its author, except to null');
select lives_ok(format('update app.versions set created_by = null where id = %L', pg_temp.id('v7')), 'the author can go to null (the account was deleted)');
select throws_ok(format('update app.versions set archived_at = null where id = %L', pg_temp.id('v5')), 'P0004', null, 'an archived version is not restored');
select throws_ok(format('update app.versions set institution_id = %L where id = %L', pg_temp.id('i_b'), pg_temp.id('v1')), 'P0004', null, 'nor does it move to another institution (touch_row)');

-- ---------------------------------------------------------------------------------------------
-- update_version_config
-- ---------------------------------------------------------------------------------------------
select pg_temp.keep('vc', pg_temp.cv('teach', 'a2', pg_temp.cfg('"motor"', '', ''), 'gaze'));
select is(pg_temp.ucv('teach', 'vc', '1', pg_temp.cfg('"motor","adhd"', '"recordatorio"', '"Dibujo"'), 'typed') ->> 'revision', '2', 'update_version_config: the configuration and the answer mode are changed with the revision');
select is((select concat_ws('|', v.config = '{"profiles":["motor","adhd"],"supports":["recordatorio"],"interests":["Dibujo"]}'::jsonb, v.answer_mode, v.revision, v.stale)
             from app.versions v where v.id = pg_temp.id('vc')), 't|typed|2|f', 'it is stored, and a version with no content made yet is not marked stale');
-- With content made for the old configuration, a change marks it stale (the content itself is not touched).
update app.version_exercises set status = 'ready', body = 'Adaptado' where version_id = pg_temp.id('vc');
select is(pg_temp.ucv('teach', 'vc', '2', pg_temp.cfg('"adhd"', '', ''), 'typed') ->> 'revision', '3', 'a change when the version has content: the revision moves');
select is((select concat_ws('|', v.stale, (select string_agg(ve.body, ',') from app.version_exercises ve where ve.version_id = v.id)) from app.versions v where v.id = pg_temp.id('vc')),
  't|Adaptado,Adaptado', 'and the version is marked stale, with its text exactly as it was');
select is(pg_temp.ucv('teach', 'vc', '3', pg_temp.cfg('"adhd"', '', ''), 'typed') ->> 'revision', '3', 'the same configuration changes nothing: the revision stays');
select pg_temp.mark();
select is(pg_temp.ucv('teach', 'vc', '2', pg_temp.cfg('"asd"', '', '')) ->> 'error', 'P0001 CONFLICT revision_mismatch', 'an old revision is CONFLICT revision_mismatch');
select is(pg_temp.ucv('teach', 'vc', 'null', pg_temp.cfg('"asd"', '', '')) ->> 'error', 'P0001 INVALID revision_required', 'a missing revision is INVALID revision_required');
select is(pg_temp.ucv('teach', 'vc', '3', null) ->> 'error', 'P0001 INVALID invalid_config', 'a null configuration is INVALID invalid_config');
select is(pg_temp.ucv('teach', 'vc', '3', pg_temp.cfg('"zurdo"', '', '')) ->> 'error', 'P0001 INVALID unknown_profile', 'an unknown profile is INVALID unknown_profile');
select is(pg_temp.ucv('teach', 'vc', '3', pg_temp.cfg(), 'braille') ->> 'error', 'P0001 INVALID invalid_answer_mode', 'an unknown answer mode is INVALID invalid_answer_mode');
select is(pg_temp.as_user('teach', format('select api.update_version_config(%L, 3, %L::jsonb, null)', pg_temp.id('vc'), pg_temp.cfg())) ->> 'error', 'P0001 INVALID invalid_answer_mode', 'a null one too');
select is(pg_temp.ucv('teach', 'vc', '3', pg_temp.cfg('"adhd"', '', '', pg_temp.jq('f1'))) ->> 'error', 'P0001 INVALID keep_changed', 'the exercises a version keeps are fixed at creation: INVALID keep_changed');
select is(pg_temp.ucv('teach', 'v3', '2', pg_temp.cfg('', '"ejemplo_resuelto","numeros_simples"', '"música"')) ->> 'error', 'P0001 INVALID keep_changed', 'also dropping the keep of a version that has one');
select is(pg_temp.ucv('teach', 'vk', '3', pg_temp.cfg()) ->> 'error', 'P0001 INVALID version_archived', 'an archived version takes no new configuration');
select is(pg_temp.ucv('teach', 'vh', '1', pg_temp.cfg('"adhd"', '', '')) ->> 'error', 'P0001 INVALID assessment_archived', 'nor one of an archived assessment');
select ok(pg_temp.unchanged(), 'and nothing changed');

-- ---------------------------------------------------------------------------------------------
-- archive_version
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.now_of('v3'), 's2,s4', 'v3 has two recipients before it is archived');
select is(pg_temp.arv('teach', 'v3', '2') ->> 'revision', '3', 'archive_version: the version is archived, with the revision moving');
select is((select concat_ws('|', v.archived_at is not null, (select count(*) from app.version_recipients r where r.version_id = v.id and r.valid_to is null))
             from app.versions v where v.id = pg_temp.id('v3')), 't|0', 'it is archived and its recipients are closed: they are not "taken" by a version nobody sees');
select is(pg_temp.rec('teach', 'v7', '1', array['s2', 's4']) ->> 'revision', '2', 'so they can receive another version of the assessment');
select is(pg_temp.arv('teach', 'v3', '3') ->> 'revision', '3', 'archiving an archived version with the current revision answers the same');
select pg_temp.mark();
select is(pg_temp.arv('teach', 'v3', '2') ->> 'error', 'P0001 CONFLICT revision_mismatch', 'with an old revision it is CONFLICT revision_mismatch');
select is(pg_temp.rec('teach', 'v3', '3', array['s1']) ->> 'error', 'P0001 INVALID version_archived', 'an archived version takes no recipients');
select ok(pg_temp.unchanged(), 'and nothing changed');
select is(pg_temp.arv('teach', 'vh', '1') ->> 'revision', '2', 'a version of an archived assessment is archived too: taking something out of sight is always possible');
select pg_temp.as_user('teach', format('select api.archive_group(%L, 1)', pg_temp.id('g_n')));
select pg_temp.mark();
select is(pg_temp.cv('teach', 'a2', pg_temp.cfg()) ->> 'error', 'P0001 INVALID archived', 'in an archived group no version is created');
select is(pg_temp.ucv('teach', 'vc', '3', pg_temp.cfg('"asd"', '', '')) ->> 'error', 'P0001 INVALID archived', 'nor reconfigured');
select is(pg_temp.rec('teach', 'vc', '3', array['s3']) ->> 'error', 'P0001 INVALID archived', 'nor given recipients');
select is(pg_temp.rec('teach', 'v1', '5', array['s1'], quote_literal(pg_temp.id('op2'))) ->> 'error', 'P0001 CONFLICT op_key_reused', 'an old op_id with a different set is still a reuse in an archived group');
select ok(pg_temp.unchanged(), 'and nothing changed');
select is(pg_temp.arv('teach', 'vc', '3') ->> 'revision', '4', 'but a version can still be archived');
select pg_temp.as_user('teach', format('select api.restore_group(%L, 2)', pg_temp.id('g_n')));

-- ---------------------------------------------------------------------------------------------
-- list_versions
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.keys(pg_temp.lv('teach', 'a1')), 'items', 'list_versions answers a list of items');
select is((select string_agg(k, ',' order by k) from (select jsonb_object_keys(pg_temp.lv('teach', 'a1') -> 'items' -> 0) k) t),
  'approved,exerciseCount,id,position,readyCount,revision,stale,status', 'each item has exactly the keys of VersionSummary: no configuration, answer mode or recipients');
select is((select string_agg((i ->> 'position'), ',' order by (i ->> 'position')::int) from jsonb_array_elements(pg_temp.lv('teach', 'a1') -> 'items') i), '1,2,4,6,7', 'in order, without the archived ones (3 and 5)');
select is((select concat_ws('|', i ->> 'status', i ->> 'stale', i ->> 'approved', i ->> 'exerciseCount', i ->> 'readyCount', i ->> 'revision')
             from jsonb_array_elements(pg_temp.lv('teach', 'a1') -> 'items') i where i ->> 'id' = pg_temp.id('v1')::text), 'empty|true|false|3|0|5',
  'a version with its status, stale mark, no approval and its counts');
update app.version_exercises set status = 'ready', body = 'Listo' where version_id = pg_temp.id('v7') and exercise_id = pg_temp.id('e1');
update app.versions set approved_revision = revision where id = pg_temp.id('v7');
select is((select concat_ws('|', i ->> 'approved', i ->> 'readyCount', i ->> 'exerciseCount')
             from jsonb_array_elements(pg_temp.lv('teach', 'a1') -> 'items') i where i ->> 'id' = pg_temp.id('v7')::text), 'true|1|3', 'an approved revision shows as approved, with the ready exercises counted');
update app.versions set revision = revision + 1 where id = pg_temp.id('v7');
select is((select i ->> 'approved' from jsonb_array_elements(pg_temp.lv('teach', 'a1') -> 'items') i where i ->> 'id' = pg_temp.id('v7')::text), 'false', 'and any later revision leaves it unapproved');
select is(jsonb_array_length(pg_temp.lv('teach', 'a_empty') -> 'items'), 0, 'an assessment without versions lists none');
select is((select count(*) from app.audit_log a where a.institution_id = pg_temp.id('i_n')), 0::bigint, 'and nothing above wrote an audit row: no listing shows a student');
select is((pg_temp.lv('teach', 'a1')::text ~* '(motor|adhd|dyslexia|recordatorio|gaze|voice|Ajedrez|profiles|config|answerMode|recipients)'), false, 'the answer carries no profile, config, answer mode or recipient');

-- ---------------------------------------------------------------------------------------------
-- get_version (audited)
-- ---------------------------------------------------------------------------------------------
-- Adapted content, a question and its key for v7, written as the owner (T1.4c and T1.4d make them).
insert into ids (k, id) values ('q1', gen_random_uuid());
insert into app.version_questions (id, institution_id, version_id, version_exercise_id, position, stem, options)
  select pg_temp.id('q1'), ve.institution_id, ve.version_id, ve.id, 0, '¿Cuánto es 2 + 2?', '[{"id":"A","text":"3"},{"id":"B","text":"4"}]'::jsonb
    from app.version_exercises ve where ve.version_id = pg_temp.id('v7') and ve.exercise_id = pg_temp.id('e1');
insert into app.question_keys (institution_id, version_id, question_id, correct_option_id) select v.institution_id, v.id, pg_temp.id('q1'), 'B' from app.versions v where v.id = pg_temp.id('v7');
create temp table g7 as select pg_temp.gv('teach', 'v7') as res;
select is(pg_temp.keys((select res from g7)), 'exercises,keys,questions,recipients,version', 'get_version answers the version, its recipients, exercises, questions and keys');
select is((select string_agg(k, ',' order by k) from (select jsonb_object_keys((select res from g7) -> 'version') k) t),
  'answerMode,approvedRevision,assessmentId,baseVersionId,config,currentGenerationId,errorCode,generalInstructions,id,instructionsRevision,position,revision,stale,status',
  'the version has exactly the keys of Version');
select is((select res from g7) -> 'version' ->> 'generalInstructions', 'Elegí dos ejercicios.', 'it includes the general instructions of the version');
select is(((select res from g7) -> 'version' -> 'config') = (select v.config from app.versions v where v.id = pg_temp.id('v7')), true, 'and its configuration');
select is((select string_agg(k, ',' order by k) from (select jsonb_object_keys((select res from g7) -> 'exercises' -> 0) k) t),
  'body,changes,currentGenerationId,errorCode,exerciseId,id,revision,sourceRevision,status', 'an exercise has exactly the keys of VersionExercise');
select is((select string_agg(k, ',' order by k) from (select jsonb_object_keys((select res from g7) -> 'questions' -> 0) k) t),
  'id,options,position,revision,stem,versionExerciseId', 'a question those of VersionQuestion');
select is((select res from g7) -> 'keys', jsonb_build_array(jsonb_build_object('questionId', pg_temp.id('q1'), 'correctOptionId', 'B', 'revision', 1)),
  'and the keys carry the correct option of each question with its revision (what set_question_key needs)');
select is((select string_agg(coalesce((select i.k from ids i where i.id = (x ->> 'exerciseId')::uuid), '?'), ',' order by ord) from jsonb_array_elements((select res from g7) -> 'exercises') with ordinality t(x, ord)),
  'e1,e2,ed', 'the exercises come in the order of the original');
select is((select res from g7) -> 'recipients' -> 0 ->> 'displayName', 'Estudiante 2', 'the recipients carry their name, which only staff may see');
select is((select string_agg(coalesce((select i.k from ids i where i.id = (x ->> 'studentId')::uuid), '?'), ',' order by x ->> 'displayName') from jsonb_array_elements((select res from g7) -> 'recipients') x), 's2,s4',
  'only the ones who receive it now: the closed rows are history');
select is((select string_agg(k, ',' order by k) from (select jsonb_object_keys((select res from g7) -> 'recipients' -> 0) k) t), 'displayName,studentId,validFrom', 'a recipient has exactly the keys of VersionRecipient');
select is((select count(*) from app.audit_log a where a.institution_id = pg_temp.id('i_n')), 1::bigint, 'the read of v7, which showed recipients, wrote one audit row');
select is((select concat_ws('|', a.action, a.entity, a.entity_id = pg_temp.id('v7'), a.actor_user_id = pg_temp.id('teach'), a.student_ids = array(select s from unnest(array[pg_temp.id('s2'), pg_temp.id('s4')]) s order by s))
             from app.audit_log a where a.institution_id = pg_temp.id('i_n') and a.entity_id = pg_temp.id('v7')), 'get_version|version|t|t|t',
  'the audit row names the action, the version, who read it and the students it showed, in order');
select is(pg_temp.gv('co', 'v1') -> 'recipients' -> 0 ->> 'studentId' is not null, true, 'a co-teacher reads another version too');
select is((select count(*) from app.audit_log a where a.institution_id = pg_temp.id('i_n')), 2::bigint, 'one more row');
select pg_temp.keep('v_none', pg_temp.cv('teach', 'a2', pg_temp.cfg('"motor"', '', '')));
select is(jsonb_array_length(pg_temp.gv('teach', 'v_none') -> 'recipients'), 0, 'a version with no recipients shows none');
select is((select count(*) from app.audit_log a where a.institution_id = pg_temp.id('i_n')), 2::bigint, 'and writes no row: nobody was disclosed');
select is(pg_temp.gv('teach', 'vk') -> 'version' ->> 'position', '2', 'an archived version is still read');

-- ---------------------------------------------------------------------------------------------
-- update_group validates like create_group
-- ---------------------------------------------------------------------------------------------
select pg_temp.mark();
select is(pg_temp.as_user('teach', format('select api.update_group(%L, 1, '''', 2026)', pg_temp.id('g_n'))) ->> 'error', 'P0001 INVALID invalid_name', 'update_group: an empty name is INVALID invalid_name, not a raw 23514');
select is(pg_temp.as_user('teach', format($$ select api.update_group(%L, 1, E' \t ', 2026) $$, pg_temp.id('g_n'))) ->> 'error', 'P0001 INVALID invalid_name', 'a blank one too');
select is(pg_temp.as_user('teach', format('select api.update_group(%L, 1, null, 2026)', pg_temp.id('g_n'))) ->> 'error', 'P0001 INVALID invalid_name', 'a null one too');
select is(pg_temp.as_user('teach', format('select api.update_group(%L, 1, %L, 2026)', pg_temp.id('g_n'), repeat('n', 121))) ->> 'error', 'P0001 INVALID invalid_name', 'one of 121 characters too');
select is(pg_temp.as_user('teach', format('select api.update_group(%L, 1, ''Ok'', 2019)', pg_temp.id('g_n'))) ->> 'error', 'P0001 INVALID invalid_school_year', 'a school year before 2020 is INVALID invalid_school_year');
select is(pg_temp.as_user('teach', format('select api.update_group(%L, 1, ''Ok'', 2101)', pg_temp.id('g_n'))) ->> 'error', 'P0001 INVALID invalid_school_year', 'after 2100 too');
select is(pg_temp.as_user('teach', format('select api.update_group(%L, 1, ''Ok'', null)', pg_temp.id('g_n'))) ->> 'error', 'P0001 INVALID invalid_school_year', 'a null year too');
select ok(pg_temp.unchanged(), 'and none of them changed the group');
select is(pg_temp.as_user('teach', format('select api.update_group(%L, 3, %L, 2100)', pg_temp.id('g_n'), repeat('n', 120))) ->> 'revision', '4', 'the limits are fine: 120 characters and 2100 (the group was archived and restored, so its revision is 3)');
select is((select g.name || '|' || g.school_year from app.groups g where g.id = pg_temp.id('g_n')), repeat('n', 120) || '|2100', 'and stored');
select is(pg_temp.as_user('teach', format($$ select api.update_group(%L, 4, E'  3.º A  ', 2026) $$, pg_temp.id('g_n'))) ->> 'revision', '5', 'a name with spaces is accepted');
select is((select g.name from app.groups g where g.id = pg_temp.id('g_n')), '3.º A', 'and stored trimmed');
select is(pg_temp.as_user('teach', format('select api.update_group(%L, 1, '''', 2026)', pg_temp.id('g_n'))) ->> 'error', 'P0001 INVALID invalid_name', 'the shape is checked before the revision, like in create_group');

-- ---------------------------------------------------------------------------------------------
-- The permission matrix by RPC: each role that must be denied, with code and reason, and the proof
-- that nothing changed (versions, recipients, adapted exercises, events and audit rows).
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
-- g_n is restored; a1, a2, v1 and v7 belong to it. adm2 is an admin who teaches go_n, not g_n.
select is(pg_temp.denied(format('select api.create_version(%L, %L::jsonb, ''typed'', gen_random_uuid(), null)', pg_temp.id('a2'), pg_temp.cfg()), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'),
  'create_version: an admin who does not teach the group, inclusion and a student are FORBIDDEN; other group, other institution and no membership NOT_FOUND; no session FORBIDDEN');
select is(pg_temp.denied(format('select api.update_version_config(%L, 1, %L::jsonb, ''typed'')', pg_temp.id('v1'), pg_temp.cfg()), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'update_version_config: same');
select is(pg_temp.denied(format('select api.set_version_recipients(%L, 1, %s, gen_random_uuid())', pg_temp.id('v1'), pg_temp.idarr(array['s1'])), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'set_version_recipients: same');
select is(pg_temp.denied(format('select api.archive_version(%L, 1)', pg_temp.id('v1')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'archive_version: same');
select is(pg_temp.denied(format('select api.list_versions(%L)', pg_temp.id('a1')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'list_versions: same');
select is(pg_temp.denied(format('select api.get_version(%L)', pg_temp.id('v7')), array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'), 'get_version: same, with no audit row for anyone who could not read it (the digest counts them)');
select is(pg_temp.denied(format('select api.update_group(%L, 1, ''x'', 2026)', pg_temp.id('g_n')), array['incl', 'stu_a', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['incl', 'stu_a', 'other', 'userb', 'nobody', 'ghost'], 'FFNNNS'), 'update_group keeps its matrix after the validations were added (inclusion and a student FORBIDDEN, others NOT_FOUND)');
-- An unknown version is NOT_FOUND for everyone, also a teacher; a version of another group of the same institution too.
select is(pg_temp.as_user('teach', format('select api.get_version(%L)', gen_random_uuid())) ->> 'error', 'P0001 NOT_FOUND not_found', 'a version that does not exist is NOT_FOUND');
select is(pg_temp.as_user('teach', 'select api.get_version(null)') ->> 'error', 'P0001 NOT_FOUND not_found', 'a null one too');
select is(pg_temp.as_user('teach', format('select api.archive_version(%L, 1)', gen_random_uuid())) ->> 'error', 'P0001 NOT_FOUND not_found', 'also for archive_version');
select is(pg_temp.as_user('other', format('select api.get_version(%L)', pg_temp.id('v7'))) ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher of another group does not even learn it exists');
select is(pg_temp.as_anon(format('select api.create_version(%L, %L::jsonb, ''typed'', gen_random_uuid(), null)', pg_temp.id('a1'), pg_temp.cfg())) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.update_version_config(%L, 1, %L::jsonb, ''typed'')', pg_temp.id('v1'), pg_temp.cfg())) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.set_version_recipients(%L, 1, %s, gen_random_uuid())', pg_temp.id('v1'), pg_temp.idarr(array['s1']))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.archive_version(%L, 1)', pg_temp.id('v1'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.list_versions(%L)', pg_temp.id('a1'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.get_version(%L)', pg_temp.id('v1'))) ->> 'error' like '42501%', true,
  'anon cannot execute any of the six');
-- Positive side of the matrix: an admin who also teaches a group works in it like a teacher.
select pg_temp.mk_asm('adm2', 'go_n', 'a_adm');
select pg_temp.mk_ex('adm2', 'a_adm', 'k1', 'Texto');
select is(pg_temp.cv('adm2', 'a_adm', pg_temp.cfg('"motor"', '', '')) ->> 'position', '1', 'an admin who also teaches go_n creates a version in it');
select is(pg_temp.cv('teach', 'a_adm', pg_temp.cfg()) ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher of another group of the same institution cannot');

-- ---------------------------------------------------------------------------------------------
-- T1.F4 (F3-1): create, edit to neutral text, erase. The identity is a hash of the configuration AS
-- CREATED (here an interest that names a student), so erasing a student nulls op_key and
-- op_identity of every version of the groups where they were ever enrolled, and of every version
-- they were a recipient of, whatever the configuration says now (erasure.ts, `nullifies`). The
-- statements below are that rule. s5 was unenrolled before: "ever" counts.
-- ---------------------------------------------------------------------------------------------
create function pg_temp.forget_version_operations(p_student uuid) returns void language sql as $$
  update app.versions v set op_key = null, op_identity = null
   where v.assessment_id in (select a.id from app.assessments a
                              where a.group_id in (select e.group_id from app.enrollments e where e.student_id = p_student))
      or v.id in (select r.version_id from app.version_recipients r where r.student_id = p_student);
$$;
insert into ids (k, id) values ('kfv', gen_random_uuid());
select pg_temp.keep('vp', pg_temp.cvk('teach', 'a2', 'kfv', pg_temp.cfg('"motor"', '', '"Paula"')));
create temp table op_before (identity text);
insert into op_before select v.op_identity from app.versions v where v.id = pg_temp.id('vp');
select is(pg_temp.ucv('teach', 'vp', '1', pg_temp.cfg('"motor"', '', '"Ajedrez"')) ->> 'revision', '2', 'the version is edited to a neutral configuration');
select is((select v.config -> 'interests' ->> 0 from app.versions v where v.id = pg_temp.id('vp')), 'Ajedrez', 'the configuration no longer names anyone ...');
select is((select v.op_identity ~ '^[0-9a-f]{64}$' and v.op_identity = (select identity from op_before) and v.op_key = pg_temp.id('kfv') from app.versions v where v.id = pg_temp.id('vp')),
  true, '... but the identity is still the hash of the one it was created with');
select is((select count(*) from app.enrollments e where e.student_id = pg_temp.id('s5') and e.group_id = pg_temp.id('g_n')) > 0, true, 's5 was enrolled in g_n (and was unenrolled since)');
select throws_ok(format('select pg_temp.forget_version_operations(%L)', pg_temp.id('s5')), 'P0004', null, 'outside an erasure the identity cannot be forgotten');
insert into ids (k, id) values ('era_s', gen_random_uuid());
insert into app.erasures (id, institution_id, kind, pseudonym_id)
  select pg_temp.id('era_s'), pg_temp.id('i_n'), 'student', p.id from app.student_pseudonyms p where p.student_id = pg_temp.id('s5');
select app.begin_erasure(pg_temp.id('era_s'));
select lives_ok(format('select pg_temp.forget_version_operations(%L)', pg_temp.id('s5')), 'inside the erasure of s5 the rule runs');
select is((select count(*) from app.versions v join app.assessments a on a.id = v.assessment_id
            where a.group_id = pg_temp.id('g_n') and (v.op_key is not null or v.op_identity is not null)), 0::bigint,
  'no version of g_n keeps its op_key or op_identity, edited or not (vp was edited to neutral text)');
select is((select count(*) from app.versions v join app.assessments a on a.id = v.assessment_id
            where a.group_id = pg_temp.id('go_n') and v.op_identity is not null), (select count(*) from app.versions v join app.assessments a on a.id = v.assessment_id where a.group_id = pg_temp.id('go_n')),
  'negative: the versions of a group where s5 was never enrolled keep every identity');
select is((select count(*) from app.versions v join app.assessments a on a.id = v.assessment_id where a.group_id = pg_temp.id('go_n')) > 0, true, 'and that group does have versions: the negative proves something');
update app.erasures set status = 'done', completed_at = now() where id = pg_temp.id('era_s');
select set_config('tiza.erasure', '', true);


-- ---------------------------------------------------------------------------------------------
-- T1.F4 (T14b-1, T14b-2): changing the configuration supersedes what is still running for the old
-- one and clears what points at it, and edited instructions count as content that goes stale.
-- The generations are seeded as the owner (T1.4d writes them).
-- ---------------------------------------------------------------------------------------------
create function pg_temp.seed_generation(p_version text, p_kind text, p_exercise text default null) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  insert into app.generations (institution_id, version_id, kind, target_exercise_id, target_revision, op_key, subject_id, inputs,
                               profiles_hash, profiles_revision, prompt_version, required_jobs)
  values (pg_temp.id('i_n'), pg_temp.id(p_version), p_kind, case when p_exercise is null then null else (select ve.id from app.version_exercises ve where ve.version_id = pg_temp.id(p_version) and ve.exercise_id = pg_temp.id(p_exercise)) end,
          1, gen_random_uuid(), 'math', '{}', repeat('a', 64), 'r1', 'p1', 1)
  returning id into v_id;
  return v_id;
end $$;
select pg_temp.keep('vq', pg_temp.cv('teach', 'a2', pg_temp.cfg('"motor"', '', '')));
create temp table gens (k text primary key, id uuid);
insert into gens select 'gv', pg_temp.seed_generation('vq', 'version');
insert into gens select 'ge', pg_temp.seed_generation('vq', 'exercise', 'f1');
update app.version_exercises ve set status = 'generating', current_generation_id = (select id from gens where k = 'ge'), written_by_generation_id = (select id from gens where k = 'gv')
 where ve.version_id = pg_temp.id('vq') and ve.exercise_id = pg_temp.id('f1');
update app.versions set current_generation_id = (select id from gens where k = 'gv'), status = 'generating' where id = pg_temp.id('vq');
select is(pg_temp.ucv('teach', 'vq', '1', pg_temp.cfg('"motor"', '', '')) ->> 'revision', '1', 'the same configuration and mode change nothing ...');
select is((select count(*) from app.generations g where g.version_id = pg_temp.id('vq') and g.status = 'running'), 2::bigint, '... and leave both generations running');
select is(pg_temp.ucv('teach', 'vq', '1', pg_temp.cfg('"adhd"', '', '')) ->> 'revision', '2', 'a different configuration is saved');
select is((select string_agg(g.status || ':' || (g.finished_at is not null)::text, ',' order by g.kind) from app.generations g where g.version_id = pg_temp.id('vq')), 'superseded:true,superseded:true',
  'both generations (version and exercise) are superseded, with their end date');
select is((select concat_ws('|', v.current_generation_id is null, v.status, v.stale) from app.versions v where v.id = pg_temp.id('vq')), 't|empty|t',
  'the version points at no generation, its status is recalculated and it is stale (it had a generation in force)');
select is((select concat_ws('|', ve.current_generation_id is null, ve.written_by_generation_id is null, ve.status) from app.version_exercises ve
            where ve.version_id = pg_temp.id('vq') and ve.exercise_id = pg_temp.id('f1')), 't|t|pending',
  'the exercise lost its generation and its provenance, and is no longer generating');
-- The conditions the protocol of outputs (C3) checks: no generation in force and none running, so an
-- output of the old configuration that arrives now is stored as obsolete and never applied.
select is((select count(*) from app.generations g
             where g.version_id = pg_temp.id('vq') and (g.status = 'running'
                or g.id in (select v.current_generation_id from app.versions v where v.id = g.version_id)
                or g.id in (select ve.current_generation_id from app.version_exercises ve where ve.version_id = g.version_id)
                or g.id in (select ve.written_by_generation_id from app.version_exercises ve where ve.version_id = g.version_id))),
  0::bigint, 'no generation of the old configuration is running or in force for any target: its output would not apply');
select throws_ok(format('update app.generations set status = ''running'', finished_at = null where id = %L', (select id from gens where k = 'gv')), 'P0004', null,
  'and a superseded generation never reopens');

-- T14b-2: instructions edited by a person are content too.
select pg_temp.keep('vi', pg_temp.cv('teach', 'a2', pg_temp.cfg('"motor"', '', '"Uno"')));
select pg_temp.keep('vcc', pg_temp.cv('teach', 'a2', pg_temp.cfg('"motor"', '', '"Dos"')));
update app.versions set instructions_revision = 2, general_instructions = 'Instrucciones editadas' where id = pg_temp.id('vi');
select is(pg_temp.ucv('teach', 'vi', '1', pg_temp.cfg('"adhd"', '', '"Uno"')) ->> 'revision', '2', 'a version with only pending exercises but edited instructions: the configuration changes');
select is((select v.stale from app.versions v where v.id = pg_temp.id('vi')), true, 'and it is stale: the edited instructions were written for the old one');
select is(pg_temp.ucv('teach', 'vcc', '1', pg_temp.cfg('"adhd"', '', '"Dos"')) ->> 'revision', '2', 'control: the same change on a version with nothing written');
select is((select v.stale from app.versions v where v.id = pg_temp.id('vcc')), false, 'leaves it not stale');

select * from finish();
rollback;
