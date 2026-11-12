-- T1.3a: student needs (health data) through the RPCs, as each role of the matrix would call them:
-- set_student_needs, get_student_needs, get_group_needs and list_student_need_events. Every section
-- builds its own institution through the internal RPCs and the whole file is rolled back.
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

create function pg_temp.err(p_sql text) returns text
language plpgsql as $f$
declare
  v_state text; v_message text; v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return v_state || ' ' || v_message || ' ' || coalesce(v_detail, '');
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
  'admin', 'teach', 'other', 'incl', 'userb', 'visitor', 'nobody', 'ghost', 'adm2', 'stu_a', 'stu_b'
]) as k;
insert into auth.users (id, email) select id, k || '@t1-3a.invalid' from ids where k <> 'ghost';
do $$
declare
  k text;
begin
  for k in select ids.k from ids where ids.k <> 'ghost' loop
    perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;

-- One institution per call: admin, two teachers, inclusion; group g_<p> (teach) and go_<p> (other).
create function pg_temp.mk(p text) returns void language plpgsql as $$
declare
  v_inst uuid;
begin
  v_inst := (pg_temp.as_service(format('select api.internal_create_institution(%L, %L, ''school'')', 'Liceo ' || p, 't1-3a-' || p)) ->> 'id')::uuid;
  insert into ids (k, id) values ('i_' || p, v_inst);
  perform pg_temp.as_service(format('select api.internal_add_membership(%L, %L, %L)', v_inst, pg_temp.id(u.k), u.role))
     from (values ('admin', 'admin'), ('teach', 'teacher'), ('other', 'teacher'), ('incl', 'inclusion')) as u(k, role);
  insert into ids (k, id) values
    ('g_' || p, (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', v_inst)) ->> 'id')::uuid),
    ('go_' || p, (pg_temp.as_user('other', format('select api.create_group(%L, ''3.º B'', ''math'', 2026, gen_random_uuid())', v_inst)) ->> 'id')::uuid);
end
$$;
-- Creates a student through the RPC and registers it under the key p_key.
create function pg_temp.new_student(p_key text, p_user text, p_group text) returns void language plpgsql as $$
begin
  insert into ids (k, id) values (p_key,
    (pg_temp.as_user(p_user, format('select api.create_student(%L, %L, %L, gen_random_uuid())',
       pg_temp.id(p_group), 'Estudiante ' || p_key, 'est.' || p_key)) ->> 'id')::uuid);
end
$$;

-- The calls under test. Arrays are literals of text[]; p_rev and p_due are raw SQL ('null' or a value).
create function pg_temp.op(p_key text) returns uuid language plpgsql as $$
begin
  insert into ids (k, id) values (p_key, gen_random_uuid()) on conflict do nothing;
  return pg_temp.id(p_key);
end $$;
create function pg_temp.setn(p_user text, p_student text, p_profiles text, p_supports text, p_interests text, p_op text,
                             p_rev text default 'null', p_due text default 'null') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.set_student_needs(%L, %L::text[], %L::text[], %L::text[], %L, %s, %s)',
    pg_temp.id(p_student), p_profiles, p_supports, p_interests, pg_temp.op(p_op), p_rev, p_due))
$$;
-- Raw arguments, for the nulls and shapes a text literal cannot say.
create function pg_temp.rawset(p_user text, p_student text, p_profiles text, p_supports text, p_interests text, p_op text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.set_student_needs(%L, %s, %s, %s, %s, null, null)',
    pg_temp.id(p_student), p_profiles, p_supports, p_interests, p_op))
$$;
create function pg_temp.getn(p_user text, p_students text[]) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.get_student_needs(%L::uuid[])',
    (select array_agg(pg_temp.id(s))::text from unnest(p_students) s)))
$$;
create function pg_temp.getg(p_user text, p_group text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.get_group_needs(%L)', pg_temp.id(p_group)))
$$;
create function pg_temp.evs(p_user text, p_student text, p_limit text default '50', p_offset text default '0') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.list_student_need_events(%L, %s, %s)', pg_temp.id(p_student), p_limit, p_offset))
$$;
create function pg_temp.audits(p_inst text, p_action text) returns bigint language sql as $$
  select count(*) from app.audit_log a where a.institution_id = pg_temp.id(p_inst) and a.action = p_action
$$;
create function pg_temp.events(p_student text) returns bigint language sql as $$
  select count(*) from app.student_need_events e where e.student_id = pg_temp.id(p_student)
$$;
-- The sorted set of ids behind some keys, as text, to compare with audit_log.student_ids.
create function pg_temp.idset(p_keys text[]) returns text language sql as $$
  select array_agg(i order by i)::text from (select pg_temp.id(k) as i from unnest(p_keys) k) t
$$;
-- Everything the needs RPCs can change or write, as one string.
create function pg_temp.digest(p_inst text) returns text language sql as $$
  select md5(coalesce((select string_agg(concat_ws('|', n.id, n.revision, n.profiles, n.supports, n.interests, n.review_due_on), ';' order by n.id)
                         from app.student_needs n where n.institution_id = pg_temp.id(p_inst)), '')
          || coalesce((select string_agg(concat_ws('|', e.id, e.op_id, e.need_revision), ';' order by e.id)
                         from app.student_need_events e where e.institution_id = pg_temp.id(p_inst)), '')
          || coalesce((select string_agg(concat_ws('|', s.id, s.revision, s.interface), ';' order by s.id)
                         from app.students s where s.institution_id = pg_temp.id(p_inst)), '')
          || (select count(*) from app.audit_log a where a.institution_id = pg_temp.id(p_inst))::text)
$$;
create function pg_temp.holds(p_key text) returns boolean language sql as $$
  select exists (
    select 1 from pg_locks l
     where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
       and l.classid = ((k.k >> 32) & 4294967295)::oid and l.objid = (k.k & 4294967295)::oid
  ) from (select hashtextextended(p_key, 0) as k) k
$$;

-- ---------------------------------------------------------------------------------------------
-- Setup: institution n. Students sn1, sn2, sn4, sn5, sn6 in g_n; sn3 in go_n. stu_a is sn1 and
-- stu_b is sn3.
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('n');
select pg_temp.new_student('sn1', 'teach', 'g_n');
select pg_temp.new_student('sn2', 'teach', 'g_n');
select pg_temp.new_student('sn4', 'teach', 'g_n');
select pg_temp.new_student('sn5', 'teach', 'g_n');
select pg_temp.new_student('sn6', 'teach', 'g_n');
select pg_temp.new_student('sn3', 'other', 'go_n');
select pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('sn1'), pg_temp.id('stu_a')));
select pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('sn3'), pg_temp.id('stu_b')));
select pg_temp.as_service(format('select api.internal_create_institution(''Liceo B'', ''t1-3a-liceo-b'', ''school'')'));
insert into ids (k, id) select 'i_b', i.id from app.institutions i where i.code = 't1-3a-liceo-b';
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_b'), pg_temp.id('userb')));

-- ---------------------------------------------------------------------------------------------
-- set_student_needs: create, edit, history, interface
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.setn('teach', 'sn1', '{adhd}', '{recordatorio}', '{robótica}', 'o1', 'null', '''2027-03-01'''),
  jsonb_build_object('studentId', pg_temp.id('sn1'), 'revision', 1), 'a teacher of the group creates the needs of a student: revision 1');
select is((select concat_ws('|', n.profiles, n.supports, n.interests, n.review_due_on, n.revision) from app.student_needs n where n.student_id = pg_temp.id('sn1')),
  '{adhd}|{recordatorio}|{robótica}|2027-03-01|1', 'the row is stored as sent');
select is((select concat_ws('|', e.kind, e.need_revision, e.before is null, e.after::text, e.actor_user_id = pg_temp.id('teach'), e.op_id = pg_temp.id('o1'))
             from app.student_need_events e where e.student_id = pg_temp.id('sn1')),
  'set|1|t|{"profiles": ["adhd"], "supports": ["recordatorio"], "interests": ["robótica"], "reviewDueOn": "2027-03-01"}|t|t',
  'and one event with no before, the after, the actor and the op_id');
select is((select s.interface || ':' || s.revision from app.students s where s.id = pg_temp.id('sn1')), 'standard:1',
  'an adhd profile does not touch the interface or the student revision');

-- Idempotency: the identity is the student and the content, kept in the event, answered under the lock.
select is(pg_temp.setn('teach', 'sn1', '{adhd}', '{recordatorio}', '{robótica}', 'o1', 'null', '''2027-03-01'''),
  jsonb_build_object('studentId', pg_temp.id('sn1'), 'revision', 1), 'the same op_id with the same content answers the stored result');
select is(pg_temp.setn('teach', 'sn1', '{adhd}', '{recordatorio}', '{robótica}', 'o1', '7', '''2027-03-01'''),
  jsonb_build_object('studentId', pg_temp.id('sn1'), 'revision', 1), 'even if the retry carries a revision that is no longer valid');
select is(pg_temp.events('sn1'), 1::bigint, 'and nothing was written twice');
select is(pg_temp.setn('teach', 'sn1', '{adhd}', '{}', '{robótica}', 'o1', 'null', '''2027-03-01'''),
  jsonb_build_object('error', 'P0001 CONFLICT op_key_reused'), 'the same op_id with other content is CONFLICT op_key_reused');
select is(pg_temp.setn('teach', 'sn1', '{adhd}', '{recordatorio}', '{robótica}', 'o1', 'null', 'null') ->> 'error', 'P0001 CONFLICT op_key_reused',
  'also when only the review date differs');
select is(pg_temp.setn('teach', 'sn2', '{adhd}', '{recordatorio}', '{robótica}', 'o1', 'null', '''2027-03-01''') ->> 'error', 'P0001 CONFLICT op_key_reused',
  'the same op_id on another student is CONFLICT op_key_reused, even with the same content');
select is((select count(*) from app.student_needs where student_id = pg_temp.id('sn2')), 0::bigint, 'and that student got nothing');

select is(pg_temp.setn('teach', 'sn1', '{motor,adhd}', '{recordatorio}', '{robótica}', 'o2', '1', '''2027-03-01'''),
  jsonb_build_object('studentId', pg_temp.id('sn1'), 'revision', 2), 'editing with the current revision moves it to 2');
select is((select s.interface from app.students s where s.id = pg_temp.id('sn1')), 'standard', 'a motor profile does not change the interface: it is not derived from the profile (T1.F8)');
select is((select e.before = (select e1.after from app.student_need_events e1 where e1.op_id = pg_temp.id('o1')) and e.after ->> 'profiles' = '["adhd", "motor"]'
             from app.student_need_events e where e.op_id = pg_temp.id('o2')), true,
  'the event keeps the previous content as before, and the profiles sorted');
select is(pg_temp.setn('teach', 'sn1', '{adhd,motor}', '{recordatorio}', '{robótica}', 'o2', '1', '''2027-03-01'''),
  jsonb_build_object('studentId', pg_temp.id('sn1'), 'revision', 2), 'the same set in another order is the same request');
select is(pg_temp.setn('teach', 'sn1', '{adhd}', '{recordatorio}', '{robótica}', 'o1', 'null', '''2027-03-01'''),
  jsonb_build_object('studentId', pg_temp.id('sn1'), 'revision', 1), 'the first op_id still answers its own result after later edits');

select is(pg_temp.setn('teach', 'sn1', '{adhd}', '{}', '{}', 'o3', '1') ->> 'error', 'P0001 CONFLICT revision_mismatch', 'an old revision is CONFLICT revision_mismatch');
select is((select needs.revision from app.student_needs needs where needs.student_id = pg_temp.id('sn1')), 2, 'and changed nothing');
select is(pg_temp.setn('teach', 'sn1', '{adhd}', '{}', '{}', 'o3', 'null') ->> 'error', 'P0001 INVALID revision_required',
  'editing an existing row with no revision is INVALID revision_required');
select is(pg_temp.setn('teach', 'sn2', '{adhd}', '{}', '{}', 'o3', '1') ->> 'error', 'P0001 CONFLICT revision_mismatch',
  'a revision for a row that does not exist is CONFLICT revision_mismatch');
select is(pg_temp.events('sn1') + pg_temp.events('sn2'), 2::bigint, 'the refused calls wrote no event');

select is(pg_temp.setn('teach', 'sn1', '{dysgraphia}', '{}', '{}', 'o4', '2') ->> 'revision', '3', 'dysgraphia: revision 3');
select is((select s.interface from app.students s where s.id = pg_temp.id('sn1')), 'standard', 'a dysgraphia profile does not change the interface either');
select is(pg_temp.setn('teach', 'sn1', '{dysgraphia,motor}', '{}', '{}', 'o5', '3') ->> 'revision', '4', 'dysgraphia and motor: revision 4');
select is((select s.interface from app.students s where s.id = pg_temp.id('sn1')), 'standard', 'nor do two profiles together');
select is(pg_temp.setn('teach', 'sn1', '{dyslexia,asd}', '{ejemplo_resuelto,numeros_simples}', '{}', 'o6', '4') ->> 'revision', '5', 'dyslexia and asd: revision 5');
select is((select s.interface from app.students s where s.id = pg_temp.id('sn1')), 'standard', 'the interface stays what the staff chose, whatever the profiles say');
select is(pg_temp.setn('teach', 'sn1', '{}', '{}', '{}', 'o7', '5') ->> 'revision', '6', 'clearing everything is an edit too: revision 6');
select is((select e.kind from app.student_need_events e where e.op_id = pg_temp.id('o7')), 'cleared', 'and its event is cleared');
select is(pg_temp.setn('teach', 'sn1', '{}', '{preguntas_guia}', '{"  robótica  "}', 'o8', '6') ->> 'revision', '7', 'interests are trimmed like the schema does');
select is((select n.interests::text from app.student_needs n where n.student_id = pg_temp.id('sn1')), '{robótica}', 'and stored trimmed');
select is((select s.revision from app.students s where s.id = pg_temp.id('sn1')), 1, 'the student revision never moved: needs do not edit the student');

-- ---------------------------------------------------------------------------------------------
-- Validation: the catalogue and the shape. Nothing changes on any refusal.
-- ---------------------------------------------------------------------------------------------
create temp table before_val (d text);
insert into before_val select pg_temp.digest('i_n');
select is(pg_temp.setn('teach', 'sn2', '{foo}', '{}', '{}', 'v1') ->> 'error', 'P0001 INVALID unknown_profile', 'a profile outside the catalogue is INVALID unknown_profile');
select is(pg_temp.setn('teach', 'sn2', '{ADHD}', '{}', '{}', 'v1') ->> 'error', 'P0001 INVALID unknown_profile', 'the catalogue ids are exact: ADHD is not adhd');
select is(pg_temp.setn('teach', 'sn2', '{adhd}', '{foo}', '{}', 'v1') ->> 'error', 'P0001 INVALID unknown_support', 'a support outside the catalogue is INVALID unknown_support');
select is(pg_temp.setn('teach', 'sn2', '{adhd,foo}', '{foo}', '{}', 'v1') ->> 'error', 'P0001 INVALID unknown_profile', 'with both wrong, the profile is reported');
select is(pg_temp.setn('teach', 'sn2', '{adhd,adhd}', '{}', '{}', 'v1') ->> 'error', 'P0001 INVALID invalid_needs', 'a repeated profile is INVALID invalid_needs');
select is(pg_temp.setn('teach', 'sn2', '{}', '{recordatorio,recordatorio}', '{}', 'v1') ->> 'error', 'P0001 INVALID invalid_needs', 'a repeated support too');
select is(pg_temp.rawset('teach', 'sn2', 'null', '''{}''::text[]', '''{}''::text[]', format('%L', pg_temp.op('v1'))) ->> 'error', 'P0001 INVALID invalid_needs', 'null profiles are INVALID');
select is(pg_temp.rawset('teach', 'sn2', '''{}''::text[]', 'null', '''{}''::text[]', format('%L', pg_temp.op('v1'))) ->> 'error', 'P0001 INVALID invalid_needs', 'null supports are INVALID');
select is(pg_temp.rawset('teach', 'sn2', '''{}''::text[]', '''{}''::text[]', 'null', format('%L', pg_temp.op('v1'))) ->> 'error', 'P0001 INVALID invalid_needs', 'null interests are INVALID');
select is(pg_temp.rawset('teach', 'sn2', 'array[null, ''adhd'']::text[]', '''{}''::text[]', '''{}''::text[]', format('%L', pg_temp.op('v1'))) ->> 'error', 'P0001 INVALID invalid_needs', 'a null inside the profiles is INVALID');
select is(pg_temp.rawset('teach', 'sn2', '''{}''::text[]', 'array[null]::text[]', '''{}''::text[]', format('%L', pg_temp.op('v1'))) ->> 'error', 'P0001 INVALID invalid_needs', 'a null inside the supports is INVALID');
select is(pg_temp.rawset('teach', 'sn2', '''{}''::text[]', '''{}''::text[]', 'array[null]::text[]', format('%L', pg_temp.op('v1'))) ->> 'error', 'P0001 INVALID invalid_needs', 'a null inside the interests is INVALID');
select is(pg_temp.rawset('teach', 'sn2', '''{}''::text[]', '''{}''::text[]', '''{}''::text[]', 'null') ->> 'error', 'P0001 INVALID invalid_op_key', 'a null op_id is INVALID invalid_op_key');
select is(pg_temp.setn('teach', 'sn2', '{}', '{}', '{""}', 'v1') ->> 'error', 'P0001 INVALID invalid_interests', 'an empty interest is INVALID invalid_interests');
select is(pg_temp.setn('teach', 'sn2', '{}', '{}', '{"   "}', 'v1') ->> 'error', 'P0001 INVALID invalid_interests', 'a blank interest too');
select is(pg_temp.setn('teach', 'sn2', '{}', '{}', ('{' || repeat('a', 61) || '}'), 'v1') ->> 'error', 'P0001 INVALID invalid_interests', 'an interest of 61 characters too');
select is(pg_temp.setn('teach', 'sn2', '{}', '{}', '{a,a}', 'v1') ->> 'error', 'P0001 INVALID invalid_interests', 'a repeated interest too');
select is(pg_temp.setn('teach', 'sn2', '{}', '{}', '{a," a"}', 'v1') ->> 'error', 'P0001 INVALID invalid_interests', 'and one that repeats once trimmed');
select is(pg_temp.setn('teach', 'sn2', '{}', '{}', '{a,b,c,d,e,f,g,h,i,j,k}', 'v1') ->> 'error', 'P0001 INVALID invalid_interests', 'eleven interests are too many');
select is(pg_temp.setn('teach', 'sn2', '{}', '{}', ('{' || repeat('a', 60) || '}'), 'v1') ->> 'revision', '1', 'an interest of exactly 60 characters is fine');
select is((select b.d from before_val b) = pg_temp.digest('i_n'), false, 'the one accepted call (60 characters) is the only change since the refusals');
select is(pg_temp.events('sn2'), 1::bigint, 'and wrote exactly one event');

-- Archived students take no edit, but a retry that already happened still answers.
select is(pg_temp.setn('teach', 'sn4', '{asd}', '{}', '{}', 'a1') ->> 'revision', '1', 'sn4 gets a profile');
select is(pg_temp.as_user('teach', format('select api.archive_student(%L, 1)', pg_temp.id('sn4'))) ->> 'revision', '2', 'then it is archived');
select is(pg_temp.setn('teach', 'sn4', '{adhd}', '{}', '{}', 'a2', '1') ->> 'error', 'P0001 INVALID archived', 'an archived student takes no edit');
select is(pg_temp.setn('teach', 'sn4', '{asd}', '{}', '{}', 'a1') ->> 'revision', '1', 'but repeating the edit that already happened answers the same');

-- ---------------------------------------------------------------------------------------------
-- Who may write: inclusion institution-wide, an admin only for groups they teach.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.setn('incl', 'sn3', '{dyslexia}', '{}', '{}', 'i1') ->> 'revision', '1', 'inclusion edits a student of any group of the institution');
select is((select e.actor_user_id = pg_temp.id('incl') from app.student_need_events e where e.op_id = pg_temp.id('i1')), true, 'and the event names them');
select is(pg_temp.setn('admin', 'sn3', '{motor}', '{}', '{}', 'i2') ->> 'error', 'P0001 FORBIDDEN forbidden', 'an admin does not edit needs');
select is(pg_temp.setn('teach', 'sn3', '{motor}', '{}', '{}', 'i2') ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher of another group does not even see the student');
select is(pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''admin'')', pg_temp.id('i_n'), pg_temp.id('adm2'))) is not null, true, 'adm2 is an admin of the institution');
select is(pg_temp.as_user('other', format('select api.add_group_staff(%L, %L, ''co_teacher'')', pg_temp.id('go_n'), pg_temp.id('adm2'))) is not null, true, '... and a co-teacher of go_n');
select is(pg_temp.setn('adm2', 'sn3', '{dyslexia,motor}', '{}', '{}', 'i3', '1') ->> 'revision', '2', 'an admin who teaches the group edits the needs of its students');
select is(pg_temp.setn('adm2', 'sn1', '{motor}', '{}', '{}', 'i4') ->> 'error', 'P0001 FORBIDDEN forbidden', 'but not those of a group they do not teach');

-- Another institution may reuse an op_id: the key is per institution.
insert into ids (k, id) select 'i_s', (pg_temp.as_service(format(
  $$ select api.internal_create_institution('Demo', 't1-3a-demo', 'sandbox', now() + interval '1 day', %L) $$, pg_temp.id('visitor'))) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_s'), pg_temp.id('visitor')));
insert into ids (k, id) select 'g_s', (pg_temp.as_user('visitor', format('select api.create_group(%L, ''Demo'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_s'))) ->> 'id')::uuid;
select pg_temp.new_student('ss1', 'visitor', 'g_s');
select is(pg_temp.setn('visitor', 'ss1', '{motor}', '{}', '{}', 'i1') ->> 'revision', '1', 'the sandbox visitor edits needs in their sandbox, with an op_id used in another institution');
select is((select s.interface from app.students s where s.id = pg_temp.id('ss1')), 'standard', 'and the interface does not follow');
select is(pg_temp.setn('visitor', 'ss1', '{motor}', '{}', '{}', 'i1') ->> 'revision', '1', 'repeating it in the sandbox answers the same: sandboxes keep the operation too');
select is(pg_temp.setn('visitor', 'ss1', '{asd}', '{}', '{}', 'i1') ->> 'error', 'P0001 CONFLICT op_key_reused', 'and another content with that op_id is CONFLICT');

-- ---------------------------------------------------------------------------------------------
-- Locks and guards
-- ---------------------------------------------------------------------------------------------
select ok(not pg_temp.holds('tiza.needs_op:' || pg_temp.id('i_n')::text || ':' || pg_temp.op('l1')::text), 'nothing holds the lock of a fresh op_id');
select is(pg_temp.setn('teach', 'sn5', '{asd}', '{}', '{}', 'l1') ->> 'revision', '1', 'set_student_needs writes');
select ok(pg_temp.holds('tiza.needs_op:' || pg_temp.id('i_n')::text || ':' || pg_temp.id('l1')::text),
  'and takes the (institution, op_id) lock before looking the op_id up, so two copies of a request are ordered');
select ok((select count(*) from pg_indexes where schemaname = 'app' and tablename = 'student_need_events' and indexdef ilike '%unique%(institution_id, op_id)%') = 1,
  'the unique index on (institution, op_id) stays as the last resort');
select throws_ok(format('update app.student_needs set student_id = %L where student_id = %L', pg_temp.id('sn6'), pg_temp.id('sn5')), 'P0004', null,
  'the student of a needs row can never change');
select throws_ok(format('update app.student_need_events set kind = ''cleared'' where op_id = %L', pg_temp.id('l1')), 'P0004', null,
  'an event is never rewritten');

-- ---------------------------------------------------------------------------------------------
-- Audited reads
-- ---------------------------------------------------------------------------------------------
-- State: sn1, sn2, sn4 (archived), sn5 in g_n with a row; sn3 in go_n; sn6 without a row.
select is(pg_temp.getn('teach', array['sn1', 'sn1', 'sn5']) -> 'items' -> 0 ->> 'studentId', least(pg_temp.id('sn1'), pg_temp.id('sn5'))::text,
  'get_student_needs lists the students asked, once each, by id');
select is((pg_temp.getn('teach', array['sn1', 'sn5']) -> 'items') -> 0 ->> 'profiles', (select case when pg_temp.id('sn1') < pg_temp.id('sn5') then '[]' else '["asd"]' end),
  'with their profiles');
select is(pg_temp.keys(pg_temp.getn('teach', array['sn1']) -> 'items' -> 0), 'interests,profiles,reviewDueOn,revision,studentId,supports',
  'each item has exactly the keys of StudentNeeds');
select is(pg_temp.keys(pg_temp.getn('teach', array['sn1'])), 'items', 'and the answer has only items');
-- Three calls so far (get_student_needs) by the teacher: one audit row each.
select is(pg_temp.audits('i_n', 'get_student_needs'), 4::bigint, 'every request wrote exactly one audit row (duplicates in the list do not add rows)');
select is((select concat_ws('|', count(*) filter (where a.student_ids::text = pg_temp.idset(array['sn1', 'sn5'])),
                              count(*) filter (where a.student_ids::text = pg_temp.idset(array['sn1'])),
                              bool_and(a.entity = 'student_needs'), bool_and(a.entity_id is null), bool_and(a.actor_user_id = pg_temp.id('teach')))
             from app.audit_log a where a.institution_id = pg_temp.id('i_n') and a.action = 'get_student_needs'),
  '2|2|t|t|t', 'each row has the entity, the actor and the set of students without repeats, sorted (two asked for sn1 and sn5, two for sn1)');
select is(pg_temp.getn('teach', array['sn6']), jsonb_build_object('items', '[]'::jsonb), 'a student with no needs row shows nothing');
select is(pg_temp.audits('i_n', 'get_student_needs'), 4::bigint, 'and writes no audit row: nobody was disclosed');
select is(pg_temp.getn('teach', array['sn1', 'sn3']) ->> 'error', 'P0001 NOT_FOUND not_found', 'one student the actor cannot see refuses the whole request');
select is(pg_temp.audits('i_n', 'get_student_needs'), 4::bigint, 'and writes no audit row');
select is(jsonb_array_length(pg_temp.getn('incl', array['sn1', 'sn3', 'sn5']) -> 'items'), 3, 'inclusion reads students of any group at once');
select is((select a.student_ids::text = pg_temp.idset(array['sn1', 'sn3', 'sn5']) from app.audit_log a
            where a.institution_id = pg_temp.id('i_n') and a.action = 'get_student_needs' and a.actor_user_id = pg_temp.id('incl')), true,
  'in one audit row with the three of them');
select is(jsonb_array_length(pg_temp.getn('teach', array['sn4']) -> 'items'), 1, 'an archived student can still be read');
select is(pg_temp.as_user('teach', 'select api.get_student_needs(array[]::uuid[])') ->> 'error', 'P0001 INVALID invalid_students', 'an empty list is INVALID invalid_students');
select is(pg_temp.as_user('teach', 'select api.get_student_needs(null)') ->> 'error', 'P0001 INVALID invalid_students', 'a null list too');
select is(pg_temp.as_user('teach', 'select api.get_student_needs(array[null, gen_random_uuid()]::uuid[])') ->> 'error', 'P0001 INVALID invalid_students', 'a null id too');
select is(pg_temp.as_user('teach', 'select api.get_student_needs(array(select gen_random_uuid() from generate_series(1, 201)))') ->> 'error', 'P0001 INVALID invalid_students', 'and 201 ids');
select is(pg_temp.as_user('teach', 'select api.get_student_needs(array[gen_random_uuid()])') ->> 'error', 'P0001 NOT_FOUND not_found', 'an id that does not exist is NOT_FOUND');
select pg_temp.mk('p');
select pg_temp.new_student('sp1', 'teach', 'g_p');
select pg_temp.setn('teach', 'sp1', '{adhd}', '{}', '{}', 'p1');
select is(pg_temp.getn('incl', array['sn1', 'sp1']) ->> 'error', 'P0001 INVALID invalid_students', 'students of two institutions in one request are INVALID invalid_students');
select is(pg_temp.audits('i_p', 'get_student_needs') + pg_temp.audits('i_n', 'get_student_needs'), 6::bigint, 'and write no audit row (six rows in all: the six requests that showed someone)');

select pg_temp.setn('teach', 'sn2', '{asd}', '{}', '{}', 'g2', '1');
select is(jsonb_array_length(pg_temp.getg('teach', 'g_n') -> 'items'), 3, 'get_group_needs shows the enrolled students that have needs: sn1, sn2 and sn5 (not sn4, archived)');
select is((select a.student_ids::text = pg_temp.idset(array['sn1', 'sn2', 'sn5']) and a.entity = 'group' and a.entity_id = pg_temp.id('g_n')
             from app.audit_log a where a.institution_id = pg_temp.id('i_n') and a.action = 'get_group_needs'), true,
  'with one audit row for the group and the set of the students shown');
select is(pg_temp.keys(pg_temp.getg('teach', 'g_n')), 'items', 'the answer has only items');
select is(pg_temp.keys(pg_temp.getg('teach', 'g_n') -> 'items' -> 0), 'interests,profiles,reviewDueOn,revision,studentId,supports', 'each item has exactly the keys of StudentNeeds');
select pg_temp.as_user('teach', format('select api.unenroll_student(%L, %L)', pg_temp.id('g_n'), pg_temp.id('sn5')));
select is(jsonb_array_length(pg_temp.getg('teach', 'g_n') -> 'items'), 2, 'a student who left the group is no longer shown');
select is(pg_temp.audits('i_n', 'get_group_needs'), 4::bigint, 'every read of the group wrote one audit row');
select is(jsonb_array_length(pg_temp.getg('incl', 'go_n') -> 'items'), 1, 'inclusion reads the group of any teacher');
select is(jsonb_array_length(pg_temp.getg('adm2', 'go_n') -> 'items'), 1, 'and an admin who teaches the group');
select is(pg_temp.getg('adm2', 'g_n') ->> 'error', 'P0001 FORBIDDEN forbidden', 'but not a group they do not teach');
insert into ids (k, id) select 'ge_n', (pg_temp.as_user('teach', format('select api.create_group(%L, ''Vacío'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid;
select is(pg_temp.audits('i_n', 'get_group_needs'), 6::bigint, 'one row per read of go_n');
select is(pg_temp.getg('teach', 'ge_n'), jsonb_build_object('items', '[]'::jsonb), 'a group where nobody has needs answers an empty list');
select is(pg_temp.audits('i_n', 'get_group_needs'), 6::bigint, 'and writes no audit row');

select is((pg_temp.evs('teach', 'sn1') ->> 'total')::integer, 7, 'list_student_need_events counts every event of the student');
select is(pg_temp.keys(pg_temp.evs('teach', 'sn1')), 'items,total', 'the page has items and total');
select is(pg_temp.keys(pg_temp.evs('teach', 'sn1') -> 'items' -> 0), 'actorUserId,after,before,createdAt,id,kind,needRevision,studentId', 'each event has exactly the keys of StudentNeedEvent');
select is((select string_agg((i ->> 'needRevision') || ':' || (i ->> 'kind'), ',') from jsonb_array_elements(pg_temp.evs('teach', 'sn1') -> 'items') i),
  '7:set,6:cleared,5:set,4:set,3:set,2:set,1:set', 'newest first, with the kind of each');
select is((pg_temp.evs('teach', 'sn1') -> 'items' -> 6 -> 'before'), 'null'::jsonb, 'the first event has no before');
select is(pg_temp.keys(pg_temp.evs('teach', 'sn1') -> 'items' -> 0 -> 'after'), 'interests,profiles,reviewDueOn,supports', 'and the after has the keys of NeedsFields');
select is((select a.student_ids::text = pg_temp.idset(array['sn1']) and a.entity = 'student' and a.entity_id = pg_temp.id('sn1')
             from app.audit_log a where a.institution_id = pg_temp.id('i_n') and a.action = 'list_student_need_events' order by a.created_at, a.id limit 1), true,
  'each request wrote one audit row for that student');
select is(pg_temp.audits('i_n', 'list_student_need_events'), 6::bigint, 'six requests so far (the shape checks above included), six rows');
select is((select string_agg(i ->> 'needRevision', ',') from jsonb_array_elements(pg_temp.evs('incl', 'sn1', '2', '1') -> 'items') i), '6,5', 'a page takes a limit and an offset');
select is(pg_temp.evs('incl', 'sn1', '2', '100'), jsonb_build_object('items', '[]'::jsonb, 'total', 7), 'an offset past the end is an empty page with the total');
select is(pg_temp.evs('teach', 'sn6'), jsonb_build_object('items', '[]'::jsonb, 'total', 0), 'a student with no history has an empty page');
select is(pg_temp.audits('i_n', 'list_student_need_events'), 7::bigint, 'the two requests with nothing to show wrote no audit row (the page of two did)');
select is(pg_temp.evs('teach', 'sn1', '0') ->> 'error', 'P0001 INVALID invalid_page', 'a limit of 0 is INVALID invalid_page');
select is(pg_temp.evs('teach', 'sn1', '201') ->> 'error', 'P0001 INVALID invalid_page', 'a limit of 201 too');
select is(pg_temp.evs('teach', 'sn1', '50', '-1') ->> 'error', 'P0001 INVALID invalid_page', 'a negative offset too');
select is(pg_temp.evs('teach', 'sn1', 'null', '0') ->> 'error', 'P0001 INVALID invalid_page', 'a null limit too');
select is(pg_temp.evs('teach', 'sn1', '50', 'null') ->> 'error', 'P0001 INVALID invalid_page', 'a null offset too');
select is(pg_temp.audits('i_n', 'list_student_need_events'), 7::bigint, 'and none of them wrote an audit row');

-- The request id the repos send in x-request-id goes to the audit row.
select set_config('request.headers', jsonb_build_object('x-request-id', pg_temp.op('rq'))::text, true);
select is(jsonb_array_length(pg_temp.getg('teach', 'g_n') -> 'items'), 2, 'a read with an x-request-id header');
select is((select count(*) from app.audit_log a where a.action = 'get_group_needs' and a.request_id = pg_temp.id('rq')), 1::bigint,
  'keeps it in the audit row');
select set_config('request.headers', '', true);

-- The sandbox: the same rules, and after it expires nothing is readable.
select is(jsonb_array_length(pg_temp.getg('visitor', 'g_s') -> 'items'), 1, 'the visitor reads the needs of their sandbox');
update app.institutions set expires_at = now() - interval '1 minute' where id = pg_temp.id('i_s');
select is(pg_temp.setn('visitor', 'ss1', '{asd}', '{}', '{}', 'e1', '1') ->> 'error', 'P0001 NOT_FOUND not_found', 'once the sandbox expires set_student_needs is NOT_FOUND');
select is(pg_temp.getg('visitor', 'g_s') ->> 'error', 'P0001 NOT_FOUND not_found', 'and so is get_group_needs');

-- ---------------------------------------------------------------------------------------------
-- The permission matrix by RPC: each role that must be denied, with code and reason, and the proof
-- that nothing changed (needs, events, interface and audit rows of the institution).
-- ---------------------------------------------------------------------------------------------
create function pg_temp.denied(p_sql text) returns text language plpgsql as $$
declare
  v_before text := pg_temp.digest('i_n');
  v_out text;
begin
  select string_agg(r.k || '=' || coalesce(pg_temp.as_user(r.k, p_sql) ->> 'error', 'ALLOWED'), ';' order by r.n) into v_out
    from (values (1, 'admin'), (2, 'stu_a'), (3, 'stu_b'), (4, 'other'), (5, 'userb'), (6, 'nobody'), (7, 'ghost')) as r(n, k);
  return v_out || ' changed=' || (v_before <> pg_temp.digest('i_n'))::text;
end
$$;
create function pg_temp.expect(p_admin text, p_self text, p_stu_b text) returns text language sql as $$
  select 'admin=P0001 ' || p_admin || ';stu_a=P0001 ' || p_self || ';stu_b=P0001 ' || p_stu_b
         || ';other=P0001 NOT_FOUND not_found;userb=P0001 NOT_FOUND not_found;nobody=P0001 NOT_FOUND not_found;ghost=P0001 FORBIDDEN no_session changed=false'
$$;
-- sn1 is in g_n and is stu_a. stu_b is sn3, of go_n: a student of the institution who is not sn1.
select is(pg_temp.denied(format('select api.set_student_needs(%L, ''{adhd}'', ''{}'', ''{}'', gen_random_uuid(), 7, null)', pg_temp.id('sn1'))),
  pg_temp.expect('FORBIDDEN forbidden', 'FORBIDDEN forbidden', 'NOT_FOUND not_found'), 'set_student_needs: every denied role gets its code and nothing changes');
select is(pg_temp.denied(format('select api.get_student_needs(array[%L]::uuid[])', pg_temp.id('sn1'))),
  pg_temp.expect('FORBIDDEN forbidden', 'FORBIDDEN forbidden', 'NOT_FOUND not_found'), 'get_student_needs: same, with no audit row');
select is(pg_temp.denied(format('select api.list_student_need_events(%L)', pg_temp.id('sn1'))),
  pg_temp.expect('FORBIDDEN forbidden', 'FORBIDDEN forbidden', 'NOT_FOUND not_found'), 'list_student_need_events: same, with no audit row');
select is(pg_temp.denied(format('select api.get_group_needs(%L)', pg_temp.id('g_n'))),
  pg_temp.expect('FORBIDDEN forbidden', 'FORBIDDEN forbidden', 'NOT_FOUND not_found'), 'get_group_needs: same, with no audit row');
select is(pg_temp.as_anon(format('select api.set_student_needs(%L, ''{}'', ''{}'', ''{}'', gen_random_uuid(), null, null)', pg_temp.id('sn6'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.get_student_needs(array[%L]::uuid[])', pg_temp.id('sn1'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.get_group_needs(%L)', pg_temp.id('g_n'))) ->> 'error' like '42501%'
          and pg_temp.as_anon(format('select api.list_student_need_events(%L)', pg_temp.id('sn1'))) ->> 'error' like '42501%', true,
  'anon cannot execute any of the four');
select is(pg_temp.setn('teach', 'sn3', '{adhd}', '{}', '{}', 'm1', '2') ->> 'error', 'P0001 NOT_FOUND not_found',
  'a teacher of another group cannot edit the student of a group they do not teach');
select is(pg_temp.getg('teach', 'go_n') ->> 'error', 'P0001 NOT_FOUND not_found', 'nor read the needs of that group');
select is((select needs.profiles::text from app.student_needs needs where needs.student_id = pg_temp.id('sn3')), '{dyslexia,motor}', 'and the student kept their profile');

select * from finish();
rollback;
