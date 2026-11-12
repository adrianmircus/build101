-- T1.5a: publish_version, second half. The permission matrix by RPC (each role that is denied, with code and reason,
-- and the proof that nothing changed), the NULLs, an archived group, another institution (including the same op_key),
-- and the guards of what publishing writes, as the owner and demanding P0004: as `authenticated` the UPDATE would fail
-- first with 42501 and the test would pass with no guard at all. The checks and the idempotency are in 020a; the
-- races and the lock order in tests/integration/races/publish*.test.ts. Placeholder text only. Rolled back.
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
create function pg_temp.keep(p_key text, p_res jsonb) returns jsonb language plpgsql as $$
begin
  insert into ids (k, id) values (p_key, (p_res ->> 'id')::uuid);
  return p_res;
end $$;
create function pg_temp.err(p_res jsonb) returns text language sql as $$ select p_res ->> 'error' $$;
-- The state and message of a statement run as the owner (the migration role): to see a guard raise.
create function pg_temp.owner_err(p_sql text) returns text language plpgsql as $f$
declare
  v_state text; v_message text;
begin
  execute p_sql;
  return 'ok';
exception
  -- WHEN OTHERS does not catch P0004 (assert_failure), by design: a program error cannot be swallowed by accident.
  when assert_failure then
    return 'P0004';
  when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    return v_state;
end
$f$;

insert into ids (k, id) select k, gen_random_uuid() from unnest(array[
  'admin', 'teach', 'other', 'incl', 'userb', 'nobody', 'ghost', 'adm2', 'stu_a', 'stu_b'
]) as k;
insert into auth.users (id, email) select id, k || '@t1-5a-b.invalid' from ids where k <> 'ghost' and k not like 'stu\_%';
do $$
declare
  k text;
begin
  for k in select ids.k from ids where ids.k <> 'ghost' and ids.k not like 'stu\_%' loop
    perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;

-- The student accounts have the canonical shape of phase 2 (docs/contratos/fase-2.md, «Cómo entra un estudiante»), like the provisioning
-- of T2.5a leaves them: the id is remembered in account_provisioning first, then the row of Auth is born with the email
-- <id>@estudiantes.usetiza.app (the trigger leaves it without a password), then the student is linked. So student_auth_link_guard
-- stays on. The keys stu_* are not in the first insert: only the staff are ordinary accounts, and a student's is born here.
create function pg_temp.link_student(p_student uuid, p_user uuid) returns void language plpgsql as $$
begin
  perform pg_temp.as_service(format('select api.internal_remember_student_account(%L, %L)',
    (select ap.id from app.account_provisioning ap where ap.student_id = p_student), p_user));
  insert into auth.users (id, email) values (p_user, p_user::text || '@estudiantes.usetiza.app');
  perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', p_user, 'Persona ' || (select k from ids where id = p_user)));
  perform pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', p_student, p_user));
end
$$;
insert into ids (k, id) select 'i_n', (pg_temp.as_service($$ select api.internal_create_institution('Liceo N', 't1-5a-r', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, %L)', pg_temp.id('i_n'), pg_temp.id(u.k), u.role))
  from (values ('admin', 'admin'), ('teach', 'teacher'), ('other', 'teacher'), ('adm2', 'admin'), ('incl', 'inclusion')) as u(k, role);
insert into ids (k, id) values
  ('g_n', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid),
  ('g_x', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º C'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid),
  ('go_n', (pg_temp.as_user('other', format('select api.create_group(%L, ''3.º B'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid);
select pg_temp.as_user('other', format('select api.add_group_staff(%L, %L, ''co_teacher'')', pg_temp.id('go_n'), pg_temp.id('adm2')));
insert into ids (k, id) values
  ('s1', (pg_temp.as_user('teach', format('select api.create_student(%L, ''Estudiante 1'', ''est.1'', gen_random_uuid())', pg_temp.id('g_n'))) ->> 'id')::uuid),
  ('s2', (pg_temp.as_user('teach', format('select api.create_student(%L, ''Estudiante 2'', ''est.2'', gen_random_uuid())', pg_temp.id('g_n'))) ->> 'id')::uuid),
  ('s3', (pg_temp.as_user('teach', format('select api.create_student(%L, ''Estudiante 3'', ''est.3'', gen_random_uuid())', pg_temp.id('g_x'))) ->> 'id')::uuid),
  ('sx', (pg_temp.as_user('other', format('select api.create_student(%L, ''Estudiante X'', ''est.x'', gen_random_uuid())', pg_temp.id('go_n'))) ->> 'id')::uuid);
select pg_temp.link_student(pg_temp.id('s1'), pg_temp.id('stu_a'));
select pg_temp.link_student(pg_temp.id('sx'), pg_temp.id('stu_b'));
insert into ids (k, id) select 'i_b', (pg_temp.as_service($$ select api.internal_create_institution('Liceo B', 't1-5a-rb', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_b'), pg_temp.id('userb')));
insert into ids (k, id) values
  ('g_b', (pg_temp.as_user('userb', format('select api.create_group(%L, ''1.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_b'))) ->> 'id')::uuid);
insert into ids (k, id) values
  ('sb', (pg_temp.as_user('userb', format('select api.create_student(%L, ''Estudiante B'', ''est.b'', gen_random_uuid())', pg_temp.id('g_b'))) ->> 'id')::uuid);

-- A typed version p of the teacher u in group g, with one exercise ready, recipients and approved.
create function pg_temp.ready(p_user text, p_group text, p text, p_students text[]) returns void language plpgsql as $$
begin
  perform pg_temp.keep('a_' || p, pg_temp.as_user(p_user, format('select api.create_assessment(%L, ''worksheet'', ''Repaso'', ''Instrucciones'', gen_random_uuid())', pg_temp.id(p_group))));
  perform pg_temp.keep('e_' || p, pg_temp.as_user(p_user, format('select api.add_exercise(%L, ''1'', ''Enunciado'', gen_random_uuid(), null)', pg_temp.id('a_' || p))));
  perform pg_temp.keep(p, pg_temp.as_user(p_user, format($q$ select api.create_version(%L, '{"profiles":["motor"],"supports":[],"interests":[]}'::jsonb, 'typed', gen_random_uuid(), null) $q$, pg_temp.id('a_' || p))));
  insert into ids (k, id) select 'x_' || p, ve.id from app.version_exercises ve where ve.version_id = pg_temp.id(p);
  perform pg_temp.as_user(p_user, format('select api.update_version_exercise(%L, 1, ''Adaptado'', gen_random_uuid())', pg_temp.id('x_' || p)));
  perform pg_temp.as_user(p_user, format('select api.set_version_recipients(%L, %s, array[%s]::uuid[], gen_random_uuid())', pg_temp.id(p),
    (select revision from app.versions where id = pg_temp.id(p)),
    coalesce((select string_agg(quote_literal(pg_temp.id(s)), ',') from unnest(p_students) s), '')));
  perform pg_temp.as_user(p_user, format('select api.approve_version(%L, %s, gen_random_uuid())', pg_temp.id(p), (select revision from app.versions where id = pg_temp.id(p))));
end $$;
create function pg_temp.pub(p_user text, p_ver text, p_op text default 'gen_random_uuid()') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.publish_version(%L, %s, %s, null)', pg_temp.id(p_ver), (select revision from app.versions where id = pg_temp.id(p_ver)), p_op))
$$;
create function pg_temp.digest() returns text language sql as $$
  select md5(coalesce((select string_agg(concat_ws('|', p.id, p.withdrawn_at), ';' order by p.id) from app.publications p where p.institution_id in (pg_temp.id('i_n'), pg_temp.id('i_b'))), '')
          || coalesce((select string_agg(concat_ws('|', a.id, a.status, a.revision), ';' order by a.id) from app.assignments a where a.institution_id in (pg_temp.id('i_n'), pg_temp.id('i_b'))), '')
          || coalesce((select string_agg(concat_ws('|', t.id, t.publication_id, t.status, t.revision), ';' order by t.id) from app.assignment_attempts t where t.institution_id in (pg_temp.id('i_n'), pg_temp.id('i_b'))), '')
          || coalesce((select string_agg(concat_ws('|', v.id, v.revision, v.approved_revision, v.status), ';' order by v.id) from app.versions v where v.institution_id in (pg_temp.id('i_n'), pg_temp.id('i_b'))), '')
          || (select count(*) from app.audit_log l where l.institution_id in (pg_temp.id('i_n'), pg_temp.id('i_b')))::text)
$$;
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

-- ---------------------------------------------------------------------------------------------
-- The permission matrix. vm is a ready, approved version of g_n (teach): everything else is refused before it writes.
-- ---------------------------------------------------------------------------------------------
select pg_temp.ready('teach', 'g_n', 'vm', array['s1']);
select is(pg_temp.denied(format('select api.publish_version(%L, %s, gen_random_uuid(), null)', pg_temp.id('vm'), (select revision from app.versions where id = pg_temp.id('vm'))),
    array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'adm2', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFFNNNNS'),
  'publish_version: an admin who does not teach the group, inclusion and a student (of the group or not) are denied; another group, another institution and no membership NOT_FOUND; no session FORBIDDEN');
select is(pg_temp.err(pg_temp.rpc(null, 'anon', format('select api.publish_version(%L, 1, gen_random_uuid(), null)', pg_temp.id('vm')))) like '42501%', true, 'anon cannot execute it');
select is(pg_temp.err(pg_temp.as_service(format('select api.publish_version(%L, 1, gen_random_uuid(), null)', pg_temp.id('vm')))) like '42501%', true, 'nor service_role: it is the teacher''s RPC');
select is(pg_temp.err(pg_temp.as_user('userb', format('select api.publish_version(%L, 1, gen_random_uuid(), null)', pg_temp.id('vm')))), 'P0001 NOT_FOUND not_found',
  'a teacher of another institution does not even learn that the version exists');
select is((select count(*) from app.publications where institution_id = pg_temp.id('i_n')), 0::bigint, 'and nothing was published by any of them');
-- Who can: the teacher and an admin who also teaches the group (adm2 is co-teacher of go_n).
select pg_temp.ready('other', 'go_n', 'vo', array['sx']);
select is(pg_temp.err(pg_temp.pub('adm2', 'vo')), null, 'an admin who also teaches the group publishes like a teacher');
select is((select p.published_by = pg_temp.id('adm2') from app.publications p where p.version_id = pg_temp.id('vo')), true, 'and is recorded as who published');
select is(pg_temp.err(pg_temp.pub('teach', 'vo')), 'P0001 NOT_FOUND not_found', 'while the teacher of g_n cannot publish a version of go_n');
select is(pg_temp.err(pg_temp.pub('teach', 'vm')), null, 'the teacher of the group publishes');

-- ---------------------------------------------------------------------------------------------
-- NULLs: never a silent pass, never a row
-- ---------------------------------------------------------------------------------------------
select pg_temp.ready('teach', 'g_n', 'vn', array['s2']);
select is(pg_temp.denied('select api.publish_version(null, 1, gen_random_uuid(), null)', array['teach']), 'teach=P0001 NOT_FOUND not_found changed=false', 'a null version is NOT_FOUND');
select is(pg_temp.denied(format('select api.publish_version(%L, 1, null, null)', pg_temp.id('vn')), array['teach']), 'teach=P0001 INVALID invalid_op_key changed=false', 'a null op_key is INVALID invalid_op_key');
select is(pg_temp.denied(format('select api.publish_version(%L, null, gen_random_uuid(), null)', pg_temp.id('vn')), array['teach']), 'teach=P0001 INVALID revision_required changed=false', 'a null revision is INVALID revision_required');
select is(pg_temp.denied(format('select api.publish_version(%L, %s, gen_random_uuid(), %L)', pg_temp.id('vn'), (select revision from app.versions where id = pg_temp.id('vn')), gen_random_uuid()), array['teach']),
  'teach=P0001 NOT_FOUND not_found changed=false', 'a key revision that is not of the version is NOT_FOUND');
select is(pg_temp.denied(format('select api.publish_version(%L, 1, gen_random_uuid(), null)', gen_random_uuid()), array['teach']), 'teach=P0001 NOT_FOUND not_found changed=false', 'an unknown version is NOT_FOUND');

-- ---------------------------------------------------------------------------------------------
-- A group that was archived after the version was made: INVALID archived
-- ---------------------------------------------------------------------------------------------
select pg_temp.ready('teach', 'g_x', 'vz', array['s3']);
select pg_temp.as_user('teach', format('select api.archive_group(%L, %s)', pg_temp.id('g_x'), (select revision from app.groups where id = pg_temp.id('g_x'))));
select is(pg_temp.denied(format('select api.publish_version(%L, %s, gen_random_uuid(), null)', pg_temp.id('vz'), (select revision from app.versions where id = pg_temp.id('vz'))), array['teach']),
  'teach=P0001 INVALID archived changed=false', 'an archived group is INVALID archived');

-- ---------------------------------------------------------------------------------------------
-- Another institution: the same op_key belongs to each one (it is unique per institution)
-- ---------------------------------------------------------------------------------------------
select pg_temp.ready('userb', 'g_b', 'vb', array['sb']);
insert into ids (k, id) values ('opshared', gen_random_uuid());
select pg_temp.ready('teach', 'g_n', 'vi', array['s2']);
select is(pg_temp.err(pg_temp.pub('teach', 'vi', quote_literal(pg_temp.id('opshared')))), null, 'a teacher publishes with an op_key');
select is(pg_temp.err(pg_temp.pub('userb', 'vb', quote_literal(pg_temp.id('opshared')))), null, 'a teacher of another institution publishes with the same op_key: it is their own');
select is((select count(*) from app.publications where op_key = pg_temp.id('opshared')), 2::bigint, 'two publications, one per institution');
select is((select count(distinct institution_id) from app.publications where op_key = pg_temp.id('opshared')), 2::bigint, 'each in its own institution');

-- ---------------------------------------------------------------------------------------------
-- Guards, as the owner (P0004). vm is published (one assignment, one attempt, opened).
-- ---------------------------------------------------------------------------------------------
create function pg_temp.pubid(p_ver text) returns uuid language sql as $$ select p.id from app.publications p where p.version_id = pg_temp.id(p_ver) order by p.published_at desc limit 1 $$;
select is(pg_temp.owner_err(format('update app.publications set content = ''{}'' where id = %L', pg_temp.pubid('vm'))), 'P0004', 'a publication''s content cannot be changed');
select is(pg_temp.owner_err(format('update app.publications set answer_mode = ''gaze'' where id = %L', pg_temp.pubid('vm'))), 'P0004', 'nor its mode');
select is(pg_temp.owner_err(format('update app.publications set aids = ''{"readAloud": false}'' where id = %L', pg_temp.pubid('vm'))), 'P0004', 'nor its aids');
select is(pg_temp.owner_err(format('update app.publications set op_attempts = 9 where id = %L', pg_temp.pubid('vm'))), 'P0004', 'nor the attempts it answers on a replay');
select is(pg_temp.owner_err(format('update app.publications set op_key = gen_random_uuid() where id = %L', pg_temp.pubid('vm'))), 'P0004', 'nor its op_key');
select is(pg_temp.owner_err(format('update app.publications set op_identity = repeat(''a'', 64) where id = %L', pg_temp.pubid('vm'))), 'P0004', 'nor its op_identity');
select is(pg_temp.owner_err(format('update app.publications set version_revision = 99 where id = %L', pg_temp.pubid('vm'))), 'P0004', 'nor the revision it copied');
select is(pg_temp.owner_err(format('update app.publications set published_by = null where id = %L', pg_temp.pubid('vm'))), 'P0004', 'nor who published it');
select is(pg_temp.owner_err(format('update app.publications set withdrawn_at = clock_timestamp() where id = %L', pg_temp.pubid('vm'))), 'ok', 'it can be withdrawn');
select is(pg_temp.owner_err(format('update app.publications set withdrawn_at = clock_timestamp() where id = %L', pg_temp.pubid('vm'))), 'P0004', 'once');
select is(pg_temp.owner_err(format('update app.publications set content = ''{}'' where id = %L', pg_temp.pubid('vm'))), 'P0004', 'and a withdrawn one does not change either');
-- Assignments: whom and what they belong to never changes.
select is(pg_temp.owner_err(format('update app.assignments set student_id = %L where assessment_id = %L', pg_temp.id('s2'), pg_temp.id('a_vm'))), 'P0004', 'an assignment does not change student');
select is(pg_temp.owner_err(format('update app.assignments set assessment_id = %L where assessment_id = %L', pg_temp.id('a_vn'), pg_temp.id('a_vm'))), 'P0004', 'nor assessment');
select is(pg_temp.owner_err(format('update app.assignments set status = ''in_progress'' where assessment_id = %L', pg_temp.id('a_vm'))), 'ok', 'while its status can move');
-- Attempts.
select pg_temp.ready('teach', 'g_n', 'vt', array['s2']);
insert into ids (k, id) select 'pt1', (pg_temp.pub('teach', 'vt') ->> 'publicationId')::uuid;
insert into ids (k, id) select 'pt2', (pg_temp.pub('teach', 'vt') ->> 'publicationId')::uuid;
create function pg_temp.attid(p_ver text) returns uuid language sql as $$
  select t.id from app.assignment_attempts t where t.assessment_id = pg_temp.id('a_' || p_ver) and t.superseded_at is null
$$;
select is(pg_temp.owner_err(format('update app.assignment_attempts set number = 7 where id = %L', pg_temp.attid('vt'))), 'P0004', 'an attempt does not change number');
select is(pg_temp.owner_err(format('update app.assignment_attempts set assignment_id = (select a.id from app.assignments a where a.assessment_id = %L) where id = %L', pg_temp.id('a_vm'), pg_temp.attid('vt'))), 'P0004', 'nor assignment');
select is(pg_temp.owner_err(format('update app.assignment_attempts set assessment_id = %L where id = %L', pg_temp.id('a_vm'), pg_temp.attid('vt'))), 'P0004', 'nor assessment');
select is(pg_temp.owner_err(format('update app.assignment_attempts set answer_key_revision_id = gen_random_uuid() where id = %L', pg_temp.attid('vt'))), 'P0004', 'an attempt cannot carry a key revision that is not its publication''s');
select is(pg_temp.owner_err(format($q$ insert into app.assignment_attempts (institution_id, assessment_id, assignment_id, version_id, publication_id, answer_key_revision_id, number, superseded_at)
    select t.institution_id, t.assessment_id, t.assignment_id, t.version_id, t.publication_id, gen_random_uuid(), 2, now() from app.assignment_attempts t where t.id = %L $q$, pg_temp.attid('vt'))),
  'P0004', 'nor can one be created with another key');
select is((select t.publication_id = pg_temp.id('pt2') from app.assignment_attempts t where t.id = pg_temp.attid('vt')), true, 'the second publication moved the attempt nobody started');
select is(pg_temp.owner_err(format('update app.assignment_attempts set status = ''started'', started_at = now() where id = %L', pg_temp.attid('vt'))), 'ok', 'an attempt starts');
select is(pg_temp.owner_err(format('update app.assignment_attempts set publication_id = %L where id = %L', pg_temp.id('pt1'), pg_temp.attid('vt'))), 'P0004', 'and once started it keeps its publication');
select is(pg_temp.pub('teach', 'vt') ->> 'attempts', '0', 'publishing again moves nothing: the attempt started');
select is((select t.publication_id = pg_temp.id('pt2') from app.assignment_attempts t where t.id = pg_temp.attid('vt')), true, 'it stays on the publication it started with');
select is(pg_temp.owner_err(format('update app.assignment_attempts set status = ''opened'' where id = %L', pg_temp.attid('vt'))), 'P0004', 'and never goes back to opened');
select is(pg_temp.owner_err(format('update app.assignment_attempts set superseded_at = now() where id = %L', pg_temp.attid('vt'))), 'ok', 'a started attempt can be superseded');
select is(pg_temp.owner_err(format('update app.assignment_attempts set superseded_at = null where id = %L', (select t.id from app.assignment_attempts t where t.assessment_id = pg_temp.id('a_vt')))), 'P0004', 'and superseded is final');
-- Publications are not readable by a student through the tables: no privilege on the key of a publication.
select is((select count(*) from app.publications p where p.institution_id = pg_temp.id('i_n') and p.answer_key_revision_id is not null), 0::bigint, 'typed publications of this file carry no key');
select is(pg_temp.owner_err('set local role tiza_student; select count(*) from app.answer_key_revisions'), '42501', 'and the student role cannot read key revisions, whatever was published');
reset role;
select is((select count(*) from app.audit_log where institution_id = pg_temp.id('i_n') and action like '%publish%'), 0::bigint, 'publishing wrote no audit row: it is not a disclosure');

select * from finish();
rollback;
