-- T1.3b: private notes and consents through the RPCs, as each role of the matrix would call them:
-- list_student_notes, create_student_note, update_student_note, archive_student_note,
-- list_student_consents, record_consent and revoke_consent. The whole file is rolled back.
begin;
select plan(196);

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

insert into ids (k, id) select k, gen_random_uuid() from unnest(array[
  'admin', 'teach', 'other', 'incl', 'userb', 'visitor', 'nobody', 'ghost', 'adm2', 'co', 'tmp', 'stu_a', 'stu_b'
]) as k;
insert into auth.users (id, email) select id, k || '@t1-3b.invalid' from ids where k <> 'ghost' and k not like 'stu\_%';
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

-- One institution per call: admin; teachers teach, other, co and tmp; inclusion. Groups g_<p> (teach) and go_<p> (other).
create function pg_temp.mk(p text) returns void language plpgsql as $$
declare
  v_inst uuid;
begin
  v_inst := (pg_temp.as_service(format('select api.internal_create_institution(%L, %L, ''school'')', 'Liceo ' || p, 't1-3b-' || p)) ->> 'id')::uuid;
  insert into ids (k, id) values ('i_' || p, v_inst);
  perform pg_temp.as_service(format('select api.internal_add_membership(%L, %L, %L)', v_inst, pg_temp.id(u.k), u.role))
     from (values ('admin', 'admin'), ('teach', 'teacher'), ('other', 'teacher'), ('co', 'teacher'), ('tmp', 'teacher'), ('incl', 'inclusion')) as u(k, role);
  insert into ids (k, id) values
    ('g_' || p, (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', v_inst)) ->> 'id')::uuid),
    ('go_' || p, (pg_temp.as_user('other', format('select api.create_group(%L, ''3.º B'', ''math'', 2026, gen_random_uuid())', v_inst)) ->> 'id')::uuid);
end
$$;
create function pg_temp.new_student(p_key text, p_user text, p_group text) returns void language plpgsql as $$
begin
  insert into ids (k, id) values (p_key,
    (pg_temp.as_user(p_user, format('select api.create_student(%L, %L, %L, gen_random_uuid())',
       pg_temp.id(p_group), 'Estudiante ' || p_key, 'est.' || p_key)) ->> 'id')::uuid);
end
$$;

-- The calls under test. Raw arguments (p_rev, p_until, p_file) are SQL: 'null' or a value.
create function pg_temp.keep(p_key text, p_res jsonb) returns jsonb language plpgsql as $$
begin
  insert into ids (k, id) values (p_key, (p_res ->> 'id')::uuid);
  return p_res;
end $$;
create function pg_temp.addn(p_user text, p_student text, p_body text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.create_student_note(%L, %L, gen_random_uuid())', pg_temp.id(p_student), p_body))
$$;
create function pg_temp.upn(p_user text, p_note text, p_rev text, p_body text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.update_student_note(%L, %s, %L)', pg_temp.id(p_note), p_rev, p_body))
$$;
create function pg_temp.arn(p_user text, p_note text, p_rev text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.archive_student_note(%L, %s)', pg_temp.id(p_note), p_rev))
$$;
create function pg_temp.lsn(p_user text, p_student text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.list_student_notes(%L)', pg_temp.id(p_student)))
$$;
create function pg_temp.lsc(p_user text, p_student text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.list_student_consents(%L)', pg_temp.id(p_student)))
$$;
create function pg_temp.rec(p_user text, p_student text, p_purpose text, p_text text, p_until text default 'null', p_file text default 'null')
returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.record_consent(%L, %L, %L, %s, %s)', pg_temp.id(p_student), p_purpose, p_text, p_until, p_file))
$$;
create function pg_temp.rvk(p_user text, p_consent text, p_rev text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.revoke_consent(%L, %s)', pg_temp.id(p_consent), p_rev))
$$;
create function pg_temp.audits(p_inst text, p_action text) returns bigint language sql as $$
  select count(*) from app.audit_log a where a.institution_id = pg_temp.id(p_inst) and a.action = p_action
$$;
create function pg_temp.idset(p_keys text[]) returns text language sql as $$
  select array_agg(i order by i)::text from (select pg_temp.id(k) as i from unnest(p_keys) k) t
$$;
-- Everything these RPCs can change or write, as one string.
create function pg_temp.digest(p_inst text) returns text language sql as $$
  select md5(coalesce((select string_agg(concat_ws('|', n.id, n.revision, n.archived_at, n.body), ';' order by n.id)
                         from app.student_notes n where n.institution_id = pg_temp.id(p_inst)), '')
          || coalesce((select string_agg(concat_ws('|', c.id, c.status, c.revision, c.revoked_at, c.text_version, c.file_id), ';' order by c.id)
                         from app.consents c where c.institution_id = pg_temp.id(p_inst)), '')
          || (select count(*) from app.audit_log a where a.institution_id = pg_temp.id(p_inst))::text)
$$;
create function pg_temp.holds(p_key text) returns boolean language sql as $$
  select exists (
    select 1 from pg_locks l
     where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
       and l.classid = ((k.k >> 32) & 4294967295)::oid and l.objid = (k.k & 4294967295)::oid
  ) from (select hashtextextended(p_key, 0) as k) k
$$;
-- A file of a student, created as the owner (T4.5 will do it through its own RPC).
create function pg_temp.mkfile(p_key text, p_inst text, p_student text, p_purpose text default 'consent_form', p_status text default 'ready')
returns void language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into ids (k, id) values (p_key, v_id);
  insert into app.files (id, institution_id, bucket, path, purpose, student_id, max_bytes, size_bytes, mime_type, status, confirmed_at)
  values (v_id, pg_temp.id(p_inst), 'consents', pg_temp.id(p_inst)::text || '/' || v_id::text, p_purpose, pg_temp.id(p_student), 1000,
          case when p_status = 'ready' then 500 end, 'application/pdf', p_status, case when p_status = 'ready' then now() end);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Setup: institution n. Students sn1 (stu_a), sn2, sn4, sn5, sn6 in g_n; sn3 (stu_b) in go_n.
-- co is a co-teacher of g_n; adm2 is an admin who teaches go_n.
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('n');
select pg_temp.new_student('sn1', 'teach', 'g_n');
select pg_temp.new_student('sn2', 'teach', 'g_n');
select pg_temp.new_student('sn4', 'teach', 'g_n');
select pg_temp.new_student('sn5', 'teach', 'g_n');
select pg_temp.new_student('sn6', 'teach', 'g_n');
select pg_temp.new_student('sn3', 'other', 'go_n');
select pg_temp.link_student(pg_temp.id('sn1'), pg_temp.id('stu_a'));
select pg_temp.link_student(pg_temp.id('sn3'), pg_temp.id('stu_b'));
select pg_temp.as_user('teach', format('select api.add_group_staff(%L, %L, ''co_teacher'')', pg_temp.id('g_n'), pg_temp.id('co')));
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''admin'')', pg_temp.id('i_n'), pg_temp.id('adm2')));
select pg_temp.as_user('other', format('select api.add_group_staff(%L, %L, ''co_teacher'')', pg_temp.id('go_n'), pg_temp.id('adm2')));
select pg_temp.as_service('select api.internal_create_institution(''Liceo B'', ''t1-3b-liceo-b'', ''school'')');
insert into ids (k, id) select 'i_b', i.id from app.institutions i where i.code = 't1-3b-liceo-b';
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_b'), pg_temp.id('userb')));

-- ---------------------------------------------------------------------------------------------
-- Notes: create
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.keys(pg_temp.keep('n1', pg_temp.addn('teach', 'sn1', E'  Primera nota \n'))), 'id,revision', 'a teacher of the group creates a note: the answer is its id and revision');
select is((select concat_ws('|', n.body, n.revision, n.author_user_id = pg_temp.id('teach'), n.student_id = pg_temp.id('sn1'), n.institution_id = pg_temp.id('i_n'), n.archived_at is null)
             from app.student_notes n where n.id = pg_temp.id('n1')),
  'Primera nota|1|t|t|t|t', 'stored trimmed, revision 1, with the author taken from the session');
select is(pg_temp.keep('n2', pg_temp.addn('co', 'sn1', 'Nota de la co-docente')) ->> 'revision', '1', 'a co-teacher of the group writes a note too');
select is(pg_temp.keep('n3', pg_temp.addn('teach', 'sn1', repeat('a', 5000))) ->> 'revision', '1', 'a note of exactly 5000 characters is fine');
create temp table before_val (d text);
insert into before_val select pg_temp.digest('i_n');
select is(pg_temp.addn('teach', 'sn1', repeat('a', 5001)) ->> 'error', 'P0001 INVALID invalid_note', 'one of 5001 is INVALID invalid_note');
select is(pg_temp.addn('teach', 'sn1', '') ->> 'error', 'P0001 INVALID invalid_note', 'an empty body too');
select is(pg_temp.addn('teach', 'sn1', E'  \n\t ') ->> 'error', 'P0001 INVALID invalid_note', 'a blank body too');
select is(pg_temp.as_user('teach', format('select api.create_student_note(%L, null, gen_random_uuid())', pg_temp.id('sn1'))) ->> 'error', 'P0001 INVALID invalid_note', 'a null body too (a null never passes a length check)');
select is(pg_temp.as_user('teach', 'select api.create_student_note(null, ''x'', gen_random_uuid())') ->> 'error', 'P0001 NOT_FOUND not_found', 'a null student is NOT_FOUND');
select is(pg_temp.as_user('teach', 'select api.create_student_note(gen_random_uuid(), ''x'', gen_random_uuid())') ->> 'error', 'P0001 NOT_FOUND not_found', 'a student that does not exist too');
select is((select b.d from before_val b) = pg_temp.digest('i_n'), true, 'and no refusal changed anything');

-- ---------------------------------------------------------------------------------------------
-- Notes: audited read
-- ---------------------------------------------------------------------------------------------
select is(jsonb_array_length(pg_temp.lsn('teach', 'sn1') -> 'items'), 3, 'list_student_notes shows the three notes of the student');
select is(pg_temp.keys(pg_temp.lsn('teach', 'sn1')), 'items', 'the answer has only items');
select is(pg_temp.keys(pg_temp.lsn('teach', 'sn1') -> 'items' -> 0), 'archivedAt,authorUserId,body,createdAt,id,revision,studentId', 'each note has exactly the keys of StudentNote');
select is(pg_temp.audits('i_n', 'list_student_notes'), 3::bigint, 'every request wrote exactly one audit row');
select is((select concat_ws('|', count(*) filter (where a.student_ids::text = pg_temp.idset(array['sn1'])), bool_and(a.entity = 'student'),
                              bool_and(a.entity_id = pg_temp.id('sn1')), bool_and(a.actor_user_id = pg_temp.id('teach')))
             from app.audit_log a where a.institution_id = pg_temp.id('i_n') and a.action = 'list_student_notes'),
  '3|t|t|t', 'with the student once, the entity, its id and the actor');
select is((select count(distinct i ->> 'authorUserId') from jsonb_array_elements(pg_temp.lsn('co', 'sn1') -> 'items') i), 2::bigint,
  'a co-teacher reads the notes of every author of the group');
select is((select a.actor_user_id = pg_temp.id('co') from app.audit_log a where a.action = 'list_student_notes' and a.institution_id = pg_temp.id('i_n')
            order by a.created_at desc, a.id limit 1) is not null, true, 'and their read is logged too');
select is(pg_temp.audits('i_n', 'list_student_notes'), 4::bigint, 'four rows now');
select is(pg_temp.lsn('teach', 'sn6'), jsonb_build_object('items', '[]'::jsonb), 'a student with no notes shows an empty list');
select is(pg_temp.audits('i_n', 'list_student_notes'), 4::bigint, 'and writes no audit row: nobody was disclosed');

-- ---------------------------------------------------------------------------------------------
-- Notes: update and archive (only the author, with the revision)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.upn('teach', 'n1', '1', E' Primera nota, corregida \n'), jsonb_build_object('id', pg_temp.id('n1'), 'revision', 2), 'the author edits with the current revision: revision 2');
select is((select n.body from app.student_notes n where n.id = pg_temp.id('n1')), 'Primera nota, corregida', 'the body is stored trimmed');
select is((select n.author_user_id = pg_temp.id('teach') and n.student_id = pg_temp.id('sn1') from app.student_notes n where n.id = pg_temp.id('n1')), true, 'and the author and the student did not move');
insert into before_val select pg_temp.digest('i_n');
select is(pg_temp.upn('teach', 'n1', '1', 'otra') ->> 'error', 'P0001 CONFLICT revision_mismatch', 'an old revision is CONFLICT revision_mismatch');
select is(pg_temp.upn('teach', 'n1', 'null', 'otra') ->> 'error', 'P0001 INVALID revision_required', 'no revision is INVALID revision_required');
select is(pg_temp.upn('teach', 'n1', '2', repeat('a', 5001)) ->> 'error', 'P0001 INVALID invalid_note', 'a body over 5000 is INVALID invalid_note');
select is(pg_temp.upn('teach', 'n1', '2', '   ') ->> 'error', 'P0001 INVALID invalid_note', 'a blank one too');
select is(pg_temp.upn('teach', 'n1', '2', null) ->> 'error', 'P0001 INVALID invalid_note', 'a null one too');
select is(pg_temp.upn('co', 'n1', '2', 'de otra persona') ->> 'error', 'P0001 FORBIDDEN not_author', 'a co-teacher who reads the note cannot edit it: FORBIDDEN not_author');
select is(pg_temp.arn('co', 'n1', '2') ->> 'error', 'P0001 FORBIDDEN not_author', 'nor archive it');
select is(pg_temp.upn('teach', 'n2', '1', 'de otra persona') ->> 'error', 'P0001 FORBIDDEN not_author', 'the teacher does not edit the note of the co-teacher either');
select is(pg_temp.as_user('teach', 'select api.update_student_note(null, 1, ''x'')') ->> 'error', 'P0001 NOT_FOUND not_found', 'a null note id is NOT_FOUND');
select is(pg_temp.as_user('teach', 'select api.archive_student_note(gen_random_uuid(), 1)') ->> 'error', 'P0001 NOT_FOUND not_found', 'a note that does not exist too');
select is((select b.d from (select d from before_val order by ctid desc limit 1) b) = pg_temp.digest('i_n'), true, 'none of the refusals changed anything');

select is(pg_temp.arn('teach', 'n1', '2'), jsonb_build_object('id', pg_temp.id('n1'), 'revision', 3), 'the author archives with the current revision: revision 3');
select is((select n.archived_at is not null from app.student_notes n where n.id = pg_temp.id('n1')), true, 'the note is archived');
select is((select count(*) from jsonb_array_elements(pg_temp.lsn('teach', 'sn1') -> 'items') i where i ->> 'archivedAt' is not null), 1::bigint, 'and the list still shows it, with archivedAt');
select is(pg_temp.arn('teach', 'n1', '3') ->> 'error', 'P0001 INVALID archived', 'archiving an archived note is INVALID archived');
select is(pg_temp.arn('teach', 'n1', '2') ->> 'error', 'P0001 CONFLICT revision_mismatch', 'and a retry with the old revision is CONFLICT revision_mismatch');
select is(pg_temp.upn('teach', 'n1', '3', 'tarde') ->> 'error', 'P0001 INVALID archived', 'an archived note takes no edit');
select is(pg_temp.arn('teach', 'n2', '1') ->> 'error', 'P0001 FORBIDDEN not_author', 'only its author archives a note');
select is(pg_temp.arn('co', 'n2', 'null') ->> 'error', 'P0001 INVALID revision_required', 'archiving with no revision is INVALID revision_required');

-- An archived student: no new note and no edit, but a note can still be taken out of sight.
select is(pg_temp.as_user('teach', format('select api.archive_student(%L, 1)', pg_temp.id('sn4'))) ->> 'revision', '2', 'sn4 is archived');
select is(pg_temp.addn('teach', 'sn4', 'tarde') ->> 'error', 'P0001 INVALID archived', 'an archived student takes no new note');
select is(pg_temp.as_user('teach', format('select api.restore_student(%L, 2)', pg_temp.id('sn4'))) ->> 'revision', '3', 'sn4 is restored');
select pg_temp.keep('n4', pg_temp.addn('teach', 'sn4', 'Antes de archivarlo'));
select pg_temp.as_user('teach', format('select api.archive_student(%L, 3)', pg_temp.id('sn4')));
select is(pg_temp.upn('teach', 'n4', '1', 'cambio') ->> 'error', 'P0001 INVALID archived', 'a note of an archived student takes no edit');
select is(pg_temp.lsn('teach', 'sn4') -> 'items' -> 0 ->> 'body', 'Antes de archivarlo', 'but it is still readable');
select is(pg_temp.arn('teach', 'n4', '1') ->> 'revision', '2', 'and can be archived');

-- Leaving the group: the teacher no longer sees the student.
select pg_temp.keep('n5', pg_temp.addn('teach', 'sn5', 'De un estudiante que se va'));
select pg_temp.as_user('teach', format('select api.unenroll_student(%L, %L)', pg_temp.id('g_n'), pg_temp.id('sn5')));
select is(pg_temp.lsn('teach', 'sn5') ->> 'error', 'P0001 NOT_FOUND not_found', 'once the student left the group their notes are NOT_FOUND for the teacher');
select is(pg_temp.upn('teach', 'n5', '1', 'x') ->> 'error', 'P0001 NOT_FOUND not_found', 'also for the author, who cannot edit them');
select is(pg_temp.addn('teach', 'sn5', 'x') ->> 'error', 'P0001 NOT_FOUND not_found', 'or add one');
select is(pg_temp.lsn('admin', 'sn5') ->> 'error', 'P0001 FORBIDDEN forbidden', 'the admin, who sees the student but does not teach them, is FORBIDDEN');
select is(pg_temp.as_user('teach', format('select api.enroll_student(%L, %L)', pg_temp.id('g_n'), pg_temp.id('sn5'))) is not null, true, 'enrolled again');
select is(pg_temp.lsn('teach', 'sn5') -> 'items' -> 0 ->> 'body', 'De un estudiante que se va', 'the note is there when they come back');

-- An admin who teaches the group is staff: reads and writes; one who does not, is FORBIDDEN.
select is(pg_temp.keep('n6', pg_temp.addn('adm2', 'sn3', 'Nota del admin que enseña')) ->> 'revision', '1', 'an admin who also teaches the group writes a note');
select is(pg_temp.lsn('adm2', 'sn3') -> 'items' -> 0 ->> 'body', 'Nota del admin que enseña', 'and reads it');
select is(pg_temp.addn('adm2', 'sn1', 'x') ->> 'error', 'P0001 FORBIDDEN forbidden', 'but not in a group they do not teach');
select is(pg_temp.addn('incl', 'sn1', 'x') ->> 'error', 'P0001 FORBIDDEN forbidden', 'inclusion never writes a note');
select is(pg_temp.lsn('incl', 'sn1') ->> 'error', 'P0001 FORBIDDEN forbidden', 'and never reads one');

-- ---------------------------------------------------------------------------------------------
-- Guards on notes
-- ---------------------------------------------------------------------------------------------
select throws_ok(format('update app.student_notes set student_id = %L where id = %L', pg_temp.id('sn2'), pg_temp.id('n2')), 'P0004', null, 'the student of a note never changes');
select throws_ok(format('update app.student_notes set author_user_id = %L where id = %L', pg_temp.id('teach'), pg_temp.id('n2')), 'P0004', null, 'nor its author');
select throws_ok(format('update app.student_notes set body = ''x'' where id = %L', pg_temp.id('n1')), 'P0004', null, 'an archived note does not change its body');
select throws_ok(format('update app.student_notes set archived_at = null where id = %L', pg_temp.id('n1')), 'P0004', null, 'nor come back');
select lives_ok(format('update app.student_notes set author_user_id = null where id = %L', pg_temp.id('n2')), 'the author can only go to null (the account was deleted)');
select is(pg_temp.upn('co', 'n2', '1', 'nadie') ->> 'error', 'P0001 FORBIDDEN not_author', 'and then nobody can edit that note');

-- ---------------------------------------------------------------------------------------------
-- Consents: record
-- ---------------------------------------------------------------------------------------------
select ok(not pg_temp.holds('tiza.consents:' || pg_temp.id('sn1')::text), 'nothing holds the consents lock of the student yet');
select is(pg_temp.keys(pg_temp.keep('c1', pg_temp.rec('teach', 'sn1', 'ai_adaptation', '2026-11'))), 'id,revision', 'a teacher of the group records a consent: id and revision');
select ok(pg_temp.holds('tiza.consents:' || pg_temp.id('sn1')::text), 'under the per-student consents lock, taken before any row');
select is((select concat_ws('|', c.status, c.revision, c.purpose, c.text_version, c.valid_until is null, c.file_id is null, c.revoked_at is null,
                              c.recorded_by = pg_temp.id('teach'), c.institution_id = pg_temp.id('i_n'))
             from app.consents c where c.id = pg_temp.id('c1')),
  'granted|1|ai_adaptation|2026-11|t|t|t|t|t', 'it is granted, revision 1, with the actor taken from the session');
select is(pg_temp.rec('teach', 'sn1', 'ai_adaptation', '2026-11'), jsonb_build_object('id', pg_temp.id('c1'), 'revision', 1), 'the same record again answers the same consent');
select is((select count(*) from app.consents c where c.student_id = pg_temp.id('sn1')), 1::bigint, 'and wrote nothing');
select is(pg_temp.rec('admin', 'sn1', 'ai_adaptation', '2026-11') ->> 'id', pg_temp.id('c1')::text, 'whoever retries it, an admin included');

select is(pg_temp.keep('c2', pg_temp.rec('teach', 'sn1', 'ai_adaptation', '2026-12')) ->> 'revision', '1', 'another text version is a new consent');
select is((select concat_ws('|', c.status, c.revision, c.revoked_at is not null, c.revoked_by = pg_temp.id('teach')) from app.consents c where c.id = pg_temp.id('c1')),
  'revoked|2|t|t', 'and it revokes the previous one in the same transaction (revision 2, who and when)');
select is((select count(*) from app.consents c where c.student_id = pg_temp.id('sn1') and c.purpose = 'ai_adaptation' and c.status = 'granted'), 1::bigint, 'one granted consent per purpose');
select is(pg_temp.keep('c3', pg_temp.rec('teach', 'sn1', 'ai_dictation', '2026-11')) ->> 'revision', '1', 'another purpose is independent');
select is((select count(*) from app.consents c where c.student_id = pg_temp.id('sn1') and c.status = 'granted'), 2::bigint, 'and the two stay granted');
select is(pg_temp.rec('teach', 'sn1', 'ai_adaptation', '2026-11') ->> 'id' <> pg_temp.id('c1')::text, true, 'registering the first text again, now that it is not the current one, is a new consent');
select is((select count(*) from app.consents c where c.student_id = pg_temp.id('sn1') and c.purpose = 'ai_adaptation' and c.status = 'granted'), 1::bigint, 'and there is still one granted');
select is(pg_temp.keep('c4', pg_temp.rec('admin', 'sn1', 'store_profile', 'v1', 'now() + interval ''30 days''')) ->> 'revision', '1', 'an admin records a consent with an expiry');
select is((select c.valid_until > now() from app.consents c where c.id = pg_temp.id('c4')), true, 'stored with it');
select is(pg_temp.rec('teach', 'sn1', 'store_profile', 'v1', 'now() + interval ''30 days''') ->> 'id', pg_temp.id('c4')::text, 'the same expiry again is the same consent');
select is(pg_temp.rec('teach', 'sn1', 'store_profile', 'v1', 'now() + interval ''31 days''') ->> 'id' <> pg_temp.id('c4')::text, true, 'another expiry is a new one');
select is(pg_temp.rec('teach', 'sn1', 'store_profile', 'v1') ->> 'id' <> pg_temp.id('c4')::text, true, 'and so is no expiry');

-- An expired consent still holds the slot: recording replaces it.
insert into app.consents (institution_id, student_id, purpose, text_version, valid_from, valid_until)
  values (pg_temp.id('i_n'), pg_temp.id('sn2'), 'ai_analysis', 'v0', now() - interval '2 days', now() - interval '1 day');
select is(pg_temp.rec('teach', 'sn2', 'ai_analysis', 'v1') ->> 'revision', '1', 'a new consent replaces one that expired');
select is((select string_agg(c.status, ',' order by c.status) from app.consents c where c.student_id = pg_temp.id('sn2')), 'granted,revoked', 'and the expired one is revoked');

-- Validation. Nothing changes on any refusal.
insert into before_val select pg_temp.digest('i_n');
select is(pg_temp.rec('teach', 'sn2', 'foo', 'v1') ->> 'error', 'P0001 INVALID invalid_purpose', 'a purpose outside the list is INVALID invalid_purpose');
select is(pg_temp.as_user('teach', format('select api.record_consent(%L, null, ''v1'', null, null)', pg_temp.id('sn2'))) ->> 'error', 'P0001 INVALID invalid_purpose', 'a null purpose too');
select is(pg_temp.rec('teach', 'sn2', 'ai_dictation', 'Bad Version') ->> 'error', 'P0001 INVALID invalid_text_version', 'a text version with spaces or capitals is INVALID invalid_text_version');
select is(pg_temp.rec('teach', 'sn2', 'ai_dictation', '') ->> 'error', 'P0001 INVALID invalid_text_version', 'an empty one too');
select is(pg_temp.rec('teach', 'sn2', 'ai_dictation', repeat('a', 33)) ->> 'error', 'P0001 INVALID invalid_text_version', 'one of 33 characters too');
select is(pg_temp.as_user('teach', format('select api.record_consent(%L, ''ai_dictation'', null, null, null)', pg_temp.id('sn2'))) ->> 'error', 'P0001 INVALID invalid_text_version', 'a null one too');
select is(pg_temp.rec('teach', 'sn2', 'ai_dictation', repeat('a', 32)) ->> 'revision', '1', 'one of exactly 32 is fine');
insert into before_val select pg_temp.digest('i_n');
select is(pg_temp.rec('teach', 'sn2', 'ai_adaptation', 'v1', 'now()') ->> 'error', 'P0001 INVALID invalid_valid_until', 'an expiry that is not in the future is INVALID invalid_valid_until');
select is(pg_temp.rec('teach', 'sn2', 'ai_adaptation', 'v1', 'now() - interval ''1 day''') ->> 'error', 'P0001 INVALID invalid_valid_until', 'a past one too');
select is((select b.d from (select d from before_val order by ctid desc limit 1) b) = pg_temp.digest('i_n'), true, 'nothing changed');

-- Files: a ready consent form of this student only.
select pg_temp.mkfile('f1', 'i_n', 'sn1');
select pg_temp.mkfile('f2', 'i_n', 'sn1');
select pg_temp.mkfile('fx', 'i_n', 'sn2');
select pg_temp.mkfile('fr', 'i_n', 'sn1', 'consent_form', 'reserved');
select pg_temp.mkfile('fs', 'i_n', 'sn1', 'specialist_report');
select is(pg_temp.keep('c5', pg_temp.rec('teach', 'sn1', 'ai_analysis', 'v1', 'null', format('%L', pg_temp.id('f1')))) ->> 'revision', '1', 'a consent with a ready consent form of the student');
select is((select c.file_id = pg_temp.id('f1') from app.consents c where c.id = pg_temp.id('c5')), true, 'keeps the file');
select is(pg_temp.rec('teach', 'sn1', 'ai_analysis', 'v1', 'null', format('%L', pg_temp.id('f1'))) ->> 'id', pg_temp.id('c5')::text, 'the same file again is the same consent');
select is(pg_temp.rec('teach', 'sn1', 'ai_analysis', 'v1', 'null', format('%L', pg_temp.id('f2'))) ->> 'id' <> pg_temp.id('c5')::text, true, 'another file is a new consent');
select is(pg_temp.rec('teach', 'sn1', 'ai_analysis', 'v1') ->> 'id' <> pg_temp.id('c5')::text, true, 'and so is no file');
insert into before_val select pg_temp.digest('i_n');
select is(pg_temp.rec('teach', 'sn1', 'ai_dictation', 'v9', 'null', format('%L', pg_temp.id('fx'))) ->> 'error', 'P0001 INVALID invalid_file', 'the form of another student is INVALID invalid_file');
select is(pg_temp.rec('teach', 'sn1', 'ai_dictation', 'v9', 'null', format('%L', pg_temp.id('fr'))) ->> 'error', 'P0001 INVALID invalid_file', 'one that is not ready too');
select is(pg_temp.rec('teach', 'sn1', 'ai_dictation', 'v9', 'null', format('%L', pg_temp.id('fs'))) ->> 'error', 'P0001 INVALID invalid_file', 'one that is not a consent form too');
select is(pg_temp.rec('teach', 'sn1', 'ai_dictation', 'v9', 'null', '''' || gen_random_uuid()::text || '''') ->> 'error', 'P0001 INVALID invalid_file', 'one that does not exist too');
select is((select b.d from (select d from before_val order by ctid desc limit 1) b) = pg_temp.digest('i_n'), true, 'and no refusal changed anything');

-- ---------------------------------------------------------------------------------------------
-- Consents: revoke
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.rvk('teach', 'c3', '1'), jsonb_build_object('id', pg_temp.id('c3'), 'revision', 2), 'a teacher revokes with the current revision: revision 2');
select is((select concat_ws('|', c.status, c.revoked_at is not null, c.revoked_by = pg_temp.id('teach')) from app.consents c where c.id = pg_temp.id('c3')), 'revoked|t|t', 'the consent is revoked, with who and when');
select ok(pg_temp.holds('tiza.consents:' || pg_temp.id('sn1')::text), 'under the same per-student lock as record_consent');
select is(pg_temp.rvk('teach', 'c3', '1'), jsonb_build_object('id', pg_temp.id('c3'), 'revision', 2), 'a retry with the revision it read answers the same');
select is((select c.revision from app.consents c where c.id = pg_temp.id('c3')), 2, 'and changed nothing');
select is(pg_temp.rvk('admin', 'c3', '1') ->> 'error', 'P0001 CONFLICT revision_mismatch', 'but another person with that old revision is CONFLICT revision_mismatch');
select is(pg_temp.rvk('teach', 'c3', '2') ->> 'error', 'P0001 INVALID already_revoked', 'revoking with the current revision of a revoked consent is INVALID already_revoked');
select is(pg_temp.rvk('teach', 'c3', '9') ->> 'error', 'P0001 CONFLICT revision_mismatch', 'a wrong revision is CONFLICT revision_mismatch');
select is(pg_temp.rvk('teach', 'c3', 'null') ->> 'error', 'P0001 INVALID revision_required', 'no revision is INVALID revision_required');
select is(pg_temp.as_user('teach', 'select api.revoke_consent(null, 1)') ->> 'error', 'P0001 NOT_FOUND not_found', 'a null consent id is NOT_FOUND');
select is(pg_temp.as_user('teach', 'select api.revoke_consent(gen_random_uuid(), 1)') ->> 'error', 'P0001 NOT_FOUND not_found', 'a consent that does not exist too');
select is(pg_temp.rvk('teach', 'c1', '1'), jsonb_build_object('id', pg_temp.id('c1'), 'revision', 2), 'a consent that a newer record replaced answers the same to its retry');
select pg_temp.keep('c7', pg_temp.rec('admin', 'sn1', 'ai_dictation', 'v7'));
select is(pg_temp.rvk('admin', 'c7', '1') ->> 'revision', '2', 'an admin who does not teach the student revokes');
select is(pg_temp.rec('admin', 'sn1', 'store_profile', 'v2') ->> 'revision', '1', 'and records');

-- An archived student: no new consent (the same one still answers), but the family can always revoke.
select pg_temp.keep('c6', pg_temp.rec('teach', 'sn6', 'ai_adaptation', 'v1'));
select is(pg_temp.as_user('teach', format('select api.archive_student(%L, 1)', pg_temp.id('sn6'))) ->> 'revision', '2', 'sn6 is archived');
select is(pg_temp.rec('teach', 'sn6', 'ai_adaptation', 'v2') ->> 'error', 'P0001 INVALID archived', 'an archived student takes no new consent');
select is(pg_temp.rec('teach', 'sn6', 'ai_adaptation', 'v1') ->> 'id', pg_temp.id('c6')::text, 'but repeating the one already recorded answers the same');
select is(pg_temp.rvk('teach', 'c6', '1') ->> 'revision', '2', 'and the consent of an archived student can be revoked');

-- ---------------------------------------------------------------------------------------------
-- Consents: audited read
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.audits('i_n', 'list_student_consents'), 0::bigint, 'no consent read so far, no audit row');
select is(jsonb_array_length(pg_temp.lsc('teach', 'sn1') -> 'items'), (select count(*)::integer from app.consents c where c.student_id = pg_temp.id('sn1')), 'list_student_consents shows every consent of the student, revoked ones too');
select is(pg_temp.keys(pg_temp.lsc('teach', 'sn1')), 'items', 'the answer has only items');
select is(pg_temp.keys(pg_temp.lsc('teach', 'sn1') -> 'items' -> 0), 'fileId,id,purpose,revision,revokedAt,status,studentId,textVersion,validFrom,validUntil', 'each one has exactly the keys of Consent');
select is((select string_agg(distinct i ->> 'status', ',') from jsonb_array_elements(pg_temp.lsc('teach', 'sn1') -> 'items') i), 'granted,revoked', 'with both statuses');
select is((select count(*) from jsonb_array_elements(pg_temp.lsc('teach', 'sn1') -> 'items') i where i ->> 'status' = 'granted' and i ->> 'revokedAt' is not null), 0::bigint, 'a granted one has no revokedAt');
select is(pg_temp.audits('i_n', 'list_student_consents'), 5::bigint, 'every request wrote exactly one audit row');
select is((select concat_ws('|', count(*) filter (where a.student_ids::text = pg_temp.idset(array['sn1'])), bool_and(a.entity = 'student'),
                              bool_and(a.entity_id = pg_temp.id('sn1')), bool_and(a.actor_user_id = pg_temp.id('teach')))
             from app.audit_log a where a.institution_id = pg_temp.id('i_n') and a.action = 'list_student_consents'),
  '5|t|t|t', 'with the student once, the entity, its id and the actor');
select is(jsonb_array_length(pg_temp.lsc('incl', 'sn1') -> 'items') > 0, true, 'inclusion reads consents');
select is(jsonb_array_length(pg_temp.lsc('admin', 'sn1') -> 'items') > 0, true, 'and so does the admin');
select is(pg_temp.audits('i_n', 'list_student_consents'), 7::bigint, 'each of those reads is logged');
select is(pg_temp.lsc('teach', 'sn4'), jsonb_build_object('items', '[]'::jsonb), 'a student with no consents shows an empty list');
select is(pg_temp.audits('i_n', 'list_student_consents'), 7::bigint, 'and writes no audit row');
select is(pg_temp.lsc('other', 'sn1') ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher of another group does not see them');
select is(pg_temp.audits('i_n', 'list_student_consents'), 7::bigint, 'and a refusal writes no audit row');

-- ---------------------------------------------------------------------------------------------
-- Guards and constraints on consents
-- ---------------------------------------------------------------------------------------------
select throws_ok(format('insert into app.consents (institution_id, student_id, purpose, text_version) values (%L, %L, ''ai_adaptation'', ''zz'')', pg_temp.id('i_n'), pg_temp.id('sn1')),
  '23505', null, 'the unique index still refuses a second granted consent for a purpose (the last resort behind the lock)');
select throws_ok(format('update app.consents set purpose = ''ai_dictation'' where id = %L', pg_temp.id('c4')), 'P0004', null, 'the purpose of a consent never changes');
select throws_ok(format('update app.consents set text_version = ''zz'' where id = %L', pg_temp.id('c4')), 'P0004', null, 'nor the text that was signed');
select throws_ok(format('update app.consents set valid_until = now() + interval ''9 days'' where id = %L', pg_temp.id('c5')), 'P0004', null, 'nor its dates');
select throws_ok(format('update app.consents set student_id = %L where id = %L', pg_temp.id('sn2'), pg_temp.id('c5')), 'P0004', null, 'nor its student');
select throws_ok(format('update app.consents set status = ''granted'', revoked_at = null where id = %L', pg_temp.id('c3')), 'P0004', null, 'a revoked consent is not reopened');
select throws_ok(format('update app.consents set revoked_by = %L where id = %L', pg_temp.id('co'), pg_temp.id('c3')), 'P0004', null, 'nor does the one who revoked it change');
select throws_ok(format('update app.consents set file_id = %L where id = %L', pg_temp.id('f2'), pg_temp.id('c5')), 'P0004', null, 'a file once attached never changes');
select throws_ok(format('update app.consents set revoked_by = null, recorded_by = null where id = %L', pg_temp.id('c3')) || '; update app.consents set status = ''granted'' where id = ' || quote_literal(pg_temp.id('c3')),
  'P0004', null, 'the account references can go to null, but not the status');
select lives_ok(format('update app.consents set file_id = %L where id = %L', pg_temp.id('f2'), pg_temp.id('c4')), 'a file can be attached once to a consent that had none');

-- A deleted account leaves its notes and consents in place, with nobody as author.
select pg_temp.as_user('teach', format('select api.add_group_staff(%L, %L, ''co_teacher'')', pg_temp.id('g_n'), pg_temp.id('tmp')));
select pg_temp.keep('nt', pg_temp.addn('tmp', 'sn2', 'Nota de quien se va'));
select pg_temp.keep('ct', pg_temp.rec('tmp', 'sn2', 'store_profile', 'v1'));
select pg_temp.keep('ct2', pg_temp.rec('tmp', 'sn2', 'store_profile', 'v2'));
select lives_ok(format('delete from auth.users where id = %L', pg_temp.id('tmp')), 'deleting the account of the author works');
select is((select concat_ws('|', n.author_user_id is null, n.body) from app.student_notes n where n.id = pg_temp.id('nt')), 't|Nota de quien se va', 'the note stays, with no author');
select is((select concat_ws('|', c.recorded_by is null, c.revoked_by is null, c.status) from app.consents c where c.id = pg_temp.id('ct')), 't|t|revoked', 'and the consents keep their history without the account');
select throws_ok(format('update app.consents set recorded_by = %L where id = %L', pg_temp.id('co'), pg_temp.id('ct')), 'P0004', null, 'once the account is gone nobody else is assigned as who recorded it');
select throws_ok(format('update app.consents set revoked_by = %L where id = %L', pg_temp.id('co'), pg_temp.id('ct')), 'P0004', null, 'nor as who revoked a consent that was already revoked');
select throws_ok(format('update app.consents set revoked_by = %L where id = %L', pg_temp.id('co'), pg_temp.id('ct2')), 'P0004', null, 'nor is revoked_by set on a consent that is still granted');
select throws_ok(format('update app.consents set status = ''revoked'', revoked_at = now(), recorded_by = %L where id = %L', pg_temp.id('co'), pg_temp.id('ct2')), 'P0004', null, 'and revoking cannot reassign who recorded it');

-- ---------------------------------------------------------------------------------------------
-- The sandbox: the same rules, and after it expires nothing is readable.
-- ---------------------------------------------------------------------------------------------
insert into ids (k, id) select 'i_s', (pg_temp.as_service(format(
  $$ select api.internal_create_institution('Demo', 't1-3b-demo', 'sandbox', now() + interval '1 day', %L) $$, pg_temp.id('visitor'))) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_s'), pg_temp.id('visitor')));
insert into ids (k, id) select 'g_s', (pg_temp.as_user('visitor', format('select api.create_group(%L, ''Demo'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_s'))) ->> 'id')::uuid;
select pg_temp.new_student('ss1', 'visitor', 'g_s');
select is(pg_temp.keep('ns', pg_temp.addn('visitor', 'ss1', 'En la demo')) ->> 'revision', '1', 'the visitor writes a note in their sandbox');
select is(pg_temp.rec('visitor', 'ss1', 'ai_adaptation', 'v1') ->> 'revision', '1', 'and records a consent');
select is(jsonb_array_length(pg_temp.lsn('visitor', 'ss1') -> 'items') + jsonb_array_length(pg_temp.lsc('visitor', 'ss1') -> 'items'), 2, 'and reads both');
update app.institutions set expires_at = now() - interval '1 minute' where id = pg_temp.id('i_s');
select is(pg_temp.lsn('visitor', 'ss1') ->> 'error', 'P0001 NOT_FOUND not_found', 'once the sandbox expires the notes are NOT_FOUND');
select is(pg_temp.upn('visitor', 'ns', '1', 'x') ->> 'error', 'P0001 NOT_FOUND not_found', 'also to edit them');
select is(pg_temp.rec('visitor', 'ss1', 'ai_adaptation', 'v2') ->> 'error', 'P0001 NOT_FOUND not_found', 'and to record a consent');
select is(pg_temp.lsc('visitor', 'ss1') ->> 'error', 'P0001 NOT_FOUND not_found', 'or read them');

-- ---------------------------------------------------------------------------------------------
-- The permission matrix by RPC: each role that must be denied, with code and reason, and the proof
-- that nothing changed (notes, consents and audit rows of the institution).
-- ---------------------------------------------------------------------------------------------
create function pg_temp.denied(p_sql text, p_users text[]) returns text language plpgsql as $$
declare
  v_before text := pg_temp.digest('i_n');
  v_out text;
begin
  select string_agg(u.k || '=' || coalesce(pg_temp.as_user(u.k, p_sql) ->> 'error', 'ALLOWED'), ';' order by u.n) into v_out
    from unnest(p_users) with ordinality as u(k, n);
  return v_out || ' changed=' || (v_before <> pg_temp.digest('i_n'))::text;
end
$$;
-- The expected answer for the users in order: F = FORBIDDEN forbidden, N = NOT_FOUND, S = no session, A = not the author.
create function pg_temp.expect(p_users text[], p_codes text) returns text language sql as $$
  select string_agg(u.k || '=P0001 ' || case substr(p_codes, u.n::integer, 1)
                      when 'F' then 'FORBIDDEN forbidden' when 'N' then 'NOT_FOUND not_found'
                      when 'S' then 'FORBIDDEN no_session' when 'A' then 'FORBIDDEN not_author' end, ';' order by u.n) || ' changed=false'
    from unnest(p_users) with ordinality as u(k, n)
$$;
-- sn1 is in g_n and is stu_a. stu_b is sn3 (go_n), a student of the institution who is not sn1.
-- n2 was written by co and has no author now; n3 by teach.
select is(pg_temp.denied(format('select api.list_student_notes(%L)', pg_temp.id('sn1')), array['admin', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFNNNNS'), 'list_student_notes: every denied role gets its code, with no audit row');
select is(pg_temp.denied(format('select api.create_student_note(%L, ''x'', gen_random_uuid())', pg_temp.id('sn1')), array['admin', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['admin', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFFNNNNS'), 'create_student_note: same, and nothing is created');
select is(pg_temp.denied(format('select api.update_student_note(%L, 1, ''x'')', pg_temp.id('n3')), array['admin', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost', 'co']),
  pg_temp.expect(array['admin', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost', 'co'], 'FFFNNNNSA'), 'update_student_note: same, and a co-teacher is not the author');
select is(pg_temp.denied(format('select api.archive_student_note(%L, 1)', pg_temp.id('n3')), array['admin', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost', 'co']),
  pg_temp.expect(array['admin', 'incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost', 'co'], 'FFFNNNNSA'), 'archive_student_note: same');
select is(pg_temp.denied(format('select api.list_student_consents(%L)', pg_temp.id('sn1')), array['stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FNNNNS'), 'list_student_consents: the student themselves, other groups, other institutions and no session are denied');
select is(pg_temp.denied(format('select api.record_consent(%L, ''ai_dictation'', ''v5'', null, null)', pg_temp.id('sn1')), array['incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFNNNNS'), 'record_consent: inclusion is FORBIDDEN too, and nothing is recorded');
select is(pg_temp.denied(format('select api.revoke_consent(%L, 1)', pg_temp.id('c5')), array['incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost']),
  pg_temp.expect(array['incl', 'stu_a', 'stu_b', 'other', 'userb', 'nobody', 'ghost'], 'FFNNNNS'), 'revoke_consent: same');
select is(pg_temp.as_anon(format('select api.list_student_notes(%L)', pg_temp.id('sn1'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.create_student_note(%L, ''x'', gen_random_uuid())', pg_temp.id('sn1'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.update_student_note(%L, 1, ''x'')', pg_temp.id('n3'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.archive_student_note(%L, 1)', pg_temp.id('n3'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.list_student_consents(%L)', pg_temp.id('sn1'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.record_consent(%L, ''ai_dictation'', ''v5'', null, null)', pg_temp.id('sn1'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.revoke_consent(%L, 1)', pg_temp.id('c5'))) ->> 'error' like '42501%', true,
  'anon cannot execute any of the seven');
select is(pg_temp.addn('teach', 'sn3', 'x') ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher of another group cannot write a note about a student of a group they do not teach');
select is(pg_temp.lsc('teach', 'sn3') ->> 'error', 'P0001 NOT_FOUND not_found', 'nor read their consents');
select is((select count(*) from app.student_notes n where n.student_id = pg_temp.id('sn3')), 1::bigint, 'and that student kept only the note of their own teacher');

-- ---------------------------------------------------------------------------------------------
-- Notes: op_key (T1.F2)
-- ---------------------------------------------------------------------------------------------
select pg_temp.new_student('sn7', 'teach', 'g_n');
create function pg_temp.addk(p_user text, p_student text, p_body text, p_key text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.create_student_note(%L, %L, %L)', pg_temp.id(p_student), p_body, p_key))
$$;
select is(pg_temp.keep('k1', pg_temp.addk('teach', 'sn7', 'Con clave', '00000000-0000-4000-8000-0000000000a1')) ->> 'revision', '1', 'a note with an op_key is created');
select is(pg_temp.addk('teach', 'sn7', 'Con clave', '00000000-0000-4000-8000-0000000000a1') ->> 'id', pg_temp.id('k1')::text, 'the same op_key, student and text answers the same note');
select is(pg_temp.addk('teach', 'sn7', E'  Con clave 
', '00000000-0000-4000-8000-0000000000a1') ->> 'id', pg_temp.id('k1')::text, 'also when the text only differs by the trim');
select is((select count(*) from app.student_notes n where n.student_id = pg_temp.id('sn7')), 1::bigint, 'and the double submit left one note');
select is(pg_temp.addk('teach', 'sn7', 'Otro texto', '00000000-0000-4000-8000-0000000000a1') ->> 'error', 'P0001 CONFLICT op_key_reused', 'the same op_key with another text is CONFLICT op_key_reused');
select is(pg_temp.addk('teach', 'sn1', 'Con clave', '00000000-0000-4000-8000-0000000000a1') ->> 'error', 'P0001 CONFLICT op_key_reused', 'with another student too');
select is((select count(*) from app.student_notes n where n.student_id = pg_temp.id('sn7')), 1::bigint, 'and neither created a note');
select is(pg_temp.upn('teach', 'k1', '1', 'Texto editado') ->> 'revision', '2', 'the author edits the note');
select is(pg_temp.addk('teach', 'sn7', 'Con clave', '00000000-0000-4000-8000-0000000000a1') ->> 'revision', '1', 'a retry after the edit answers the original (revision 1, identity kept as it was)');
select is(pg_temp.addk('teach', 'sn7', 'Texto editado', '00000000-0000-4000-8000-0000000000a1') ->> 'error', 'P0001 CONFLICT op_key_reused', 'and the edited text is not the identity of the operation');
select is(pg_temp.arn('teach', 'k1', '2') ->> 'revision', '3', 'the author archives it');
select is(pg_temp.addk('teach', 'sn7', 'Con clave', '00000000-0000-4000-8000-0000000000a1') ->> 'id', pg_temp.id('k1')::text, 'a retry after archiving still answers it');
select is(pg_temp.keep('k2', pg_temp.addk('co', 'sn7', 'Con clave', '00000000-0000-4000-8000-0000000000a1')) ->> 'revision', '1', 'the op_key is per author: a co-teacher with the same key writes their own note');
select isnt(pg_temp.id('k2'), pg_temp.id('k1'), 'a different note');
select is(pg_temp.keep('k3', pg_temp.addk('teach', 'sn7', 'Con clave', '00000000-0000-4000-8000-0000000000a2')) ->> 'revision', '1', 'another op_key with the same text is another note');
select is(pg_temp.as_user('teach', format('select api.create_student_note(%L, ''x'', null)', pg_temp.id('sn7'))) ->> 'error', 'P0001 INVALID invalid_op_key', 'a null op_key is INVALID invalid_op_key');
select is((select count(*) from app.student_notes n where n.student_id = pg_temp.id('sn7')), 3::bigint, 'and nothing was created by it');
select is(pg_temp.addk('other', 'sn7', 'x', '00000000-0000-4000-8000-0000000000a9') ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher of another group still gets NOT_FOUND with a key');
select is((select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'api' and p.proname = 'create_student_note'), 1::bigint, 'the old signature is gone: only one create_student_note');
-- As the table owner, so the update reaches the guard: as authenticated it would stop at the schema privilege
-- (42501) and pass even without the guard.
select throws_ok(format('update app.student_notes set op_key = gen_random_uuid() where id = %L', pg_temp.id('k1')), 'P0004', null, 'the op_key of a note is frozen');
select throws_ok(format('update app.student_notes set op_identity = repeat(''0'', 64) where id = %L', pg_temp.id('k1')), 'P0004', null, 'its op_identity too');

select * from finish();
rollback;
