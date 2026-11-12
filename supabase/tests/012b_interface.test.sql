-- T1.F8 (F1-1): students.interface is an accessibility setting the staff chooses, independent of the profile.
-- api.set_student_interface: who may, concurrency, idempotence, shape; set_student_needs no longer touches it;
-- student_home reflects it. Same scaffolding as 012_needs; rolled back.
begin;
select plan(41);

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
-- Helpers of this file
-- ---------------------------------------------------------------------------------------------
create function pg_temp.seti(p_user text, p_student text, p_interface text, p_rev text) returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.set_student_interface(%L, %L, %s)', pg_temp.id(p_student), p_interface, p_rev))
$$;
create function pg_temp.iface(p_student text) returns text language sql as $$
  select s.interface from app.students s where s.id = pg_temp.id(p_student)
$$;
create function pg_temp.rev(p_student text) returns text language sql as $$
  select s.revision::text from app.students s where s.id = pg_temp.id(p_student)
$$;

-- ---------------------------------------------------------------------------------------------
-- The setting, step by step (sn1 is in g_n, taught by teach; stu_a is the account of sn1)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.iface('sn1') || ':' || pg_temp.rev('sn1'), 'standard:1', 'a new student has the standard interface and revision 1');
select is(pg_temp.seti('teach', 'sn1', 'gaze', '1'), jsonb_build_object('id', pg_temp.id('sn1'), 'revision', 2),
  'a teacher of the group chooses gaze: revision 2');
select is(pg_temp.iface('sn1'), 'gaze', 'and the student has it');
select is(pg_temp.seti('teach', 'sn1', 'gaze', '2'), jsonb_build_object('id', pg_temp.id('sn1'), 'revision', 2),
  'the same value again is idempotent: the revision does not move');
select is(pg_temp.seti('teach', 'sn1', 'gaze', '1') ->> 'error', 'P0001 CONFLICT revision_mismatch',
  'a stale revision is CONFLICT revision_mismatch even for the same value');
select is(pg_temp.seti('teach', 'sn1', 'gaze', 'null') ->> 'error', 'P0001 INVALID revision_required', 'no revision is INVALID revision_required');
select is(pg_temp.seti('incl', 'sn1', 'voice', '2'), jsonb_build_object('id', pg_temp.id('sn1'), 'revision', 3),
  'inclusion of the institution chooses it too: revision 3');
select is(pg_temp.iface('sn1'), 'voice', 'voice');
select is(pg_temp.seti('teach', 'sn1', 'standard', '3') ->> 'revision', '4', 'and standard again: revision 4');

-- Shape: nothing else is accepted, and a null is not a pass.
select is(pg_temp.seti('teach', 'sn1', 'braille', '4') ->> 'error', 'P0001 INVALID invalid_interface', 'an unknown value is INVALID invalid_interface');
select is(pg_temp.seti('teach', 'sn1', '', '4') ->> 'error', 'P0001 INVALID invalid_interface', 'an empty value too');
select is(pg_temp.as_user('teach', format('select api.set_student_interface(%L, null, 4)', pg_temp.id('sn1'))) ->> 'error',
  'P0001 INVALID invalid_interface', 'and a null value');
select is(pg_temp.seti('teach', 'sn1', 'GAZE', '4') ->> 'error', 'P0001 INVALID invalid_interface', 'the case matters');
select is(pg_temp.iface('sn1') || ':' || pg_temp.rev('sn1'), 'standard:4', 'none of them changed anything');

-- The profile does not move it (F1-1): neither motor nor dysgraphia, in any order.
select pg_temp.setn('teach', 'sn1', '{motor}', '{}', '{}', 'f1');
select is(pg_temp.iface('sn1') || ':' || pg_temp.rev('sn1'), 'standard:4', 'registering motor leaves the interface and the revision alone');
select is(pg_temp.setn('teach', 'sn1', '{dysgraphia,motor}', '{}', '{}', 'f2', '1') ->> 'revision', '2', 'two profiles: revision 2 of the needs');
select is(pg_temp.iface('sn1') || ':' || pg_temp.rev('sn1'), 'standard:4', 'neither does dysgraphia with motor');
select is(pg_temp.seti('teach', 'sn1', 'gaze', '4') ->> 'revision', '5', 'the staff picks gaze with a motor profile: an explicit action');
select is(pg_temp.setn('teach', 'sn1', '{adhd}', '{}', '{}', 'f3', '2') ->> 'revision', '3', 'taking motor off the profile');
select is(pg_temp.iface('sn1'), 'gaze', 'does not take gaze off the student: the two are independent');
-- And the other way: gaze with no motor profile at all is just as possible.
select is(pg_temp.seti('teach', 'sn2', 'gaze', '1') ->> 'revision', '2', 'gaze for a student with no needs at all');

-- A student with a profile and the default interface looks the same as one with no profile.
select is((select count(*) from app.student_needs n join app.students s on s.id = n.student_id
            where n.student_id = pg_temp.id('sn1') and 'motor' = any (n.profiles)), 0::bigint, 'control: sn1 no longer has motor');

-- What the student sees: student_home reflects the setting, and shows nothing of the profile.
select is(pg_temp.as_user('stu_a', 'select api.student_home()') ->> 'interface', 'gaze', 'student_home shows the interface the staff chose');
select is(pg_temp.keys(pg_temp.as_user('stu_a', 'select api.student_home()')), 'displayName,groups,interface', 'with the same keys as always');
select is(pg_temp.seti('teach', 'sn1', 'standard', '5') ->> 'revision', '6', 'the staff changes it back');
select is(pg_temp.as_user('stu_a', 'select api.student_home()') ->> 'interface', 'standard', 'student_home follows');
select is(pg_temp.seti('teach', 'sn1', 'voice', '6') ->> 'revision', '7', 'voice');
select is(pg_temp.as_user('stu_a', 'select api.student_home()') ->> 'interface', 'standard',
  'but without the dictation consent in force student_home still offers the standard one');
select pg_temp.as_user('teach', format('select api.record_consent(%L, ''ai_dictation'', ''v1'')', pg_temp.id('sn1')));
select is(pg_temp.as_user('stu_a', 'select api.student_home()') ->> 'interface', 'voice', 'with the consent it is voice');

-- Archived: nothing changes in an archived student.
select pg_temp.as_user('teach', format('select api.archive_student(%L, %s)', pg_temp.id('sn6'), pg_temp.rev('sn6')));
select is(pg_temp.seti('teach', 'sn6', 'gaze', pg_temp.rev('sn6')) ->> 'error', 'P0001 INVALID archived', 'an archived student is INVALID archived');
select is(pg_temp.iface('sn6'), 'standard', 'and keeps its interface');

-- A student that is in the institution but whose group nobody of the staff teaches is just as closed as for the needs.
select is(pg_temp.seti('teach', 'sn3', 'gaze', '1') ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher cannot set it on a student of a group they do not teach');
select is(pg_temp.seti('other', 'sn3', 'gaze', '1') ->> 'revision', '2', 'the teacher of that group can');
select is(pg_temp.seti('incl', 'sn3', 'standard', '2') ->> 'revision', '3', 'and inclusion on any student of the institution');

-- The sandbox: the visitor sets it in their sandbox, and after it expires nothing.
insert into ids (k, id) select 'i_s', (pg_temp.as_service(format(
  $$ select api.internal_create_institution('Demo', 't1-f8-demo', 'sandbox', now() + interval '1 day', %L) $$, pg_temp.id('visitor'))) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_s'), pg_temp.id('visitor')));
insert into ids (k, id) select 'g_s', (pg_temp.as_user('visitor', format('select api.create_group(%L, ''Demo'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_s'))) ->> 'id')::uuid;
select pg_temp.new_student('ss1', 'visitor', 'g_s');
select is(pg_temp.seti('visitor', 'ss1', 'gaze', '1') ->> 'revision', '2', 'the sandbox visitor sets it in their sandbox');
update app.institutions set expires_at = now() - interval '1 minute' where id = pg_temp.id('i_s');
select is(pg_temp.seti('visitor', 'ss1', 'standard', '2') ->> 'error', 'P0001 NOT_FOUND not_found', 'once the sandbox expires it is NOT_FOUND');

-- ---------------------------------------------------------------------------------------------
-- The matrix, by RPC: each role that must be denied, with code and reason, and the proof that nothing changed.
-- admin does not teach the group: FORBIDDEN like the needs; the student themselves: FORBIDDEN; another student: NOT_FOUND.
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
select is(pg_temp.denied(format('select api.set_student_interface(%L, ''gaze'', %s)', pg_temp.id('sn1'), pg_temp.rev('sn1'))),
  'admin=P0001 FORBIDDEN forbidden;stu_a=P0001 FORBIDDEN forbidden;stu_b=P0001 NOT_FOUND not_found;other=P0001 NOT_FOUND not_found;userb=P0001 NOT_FOUND not_found;nobody=P0001 NOT_FOUND not_found;ghost=P0001 FORBIDDEN no_session changed=false',
  'set_student_interface: every denied role gets its code and nothing changes');
select is(pg_temp.as_anon(format('select api.set_student_interface(%L, ''gaze'', 1)', pg_temp.id('sn1'))) ->> 'error' like '42501%', true,
  'anon cannot execute it');
select is(pg_temp.as_user('teach', format('select api.set_student_interface(%L, ''gaze'', 1)', gen_random_uuid())) ->> 'error', 'P0001 NOT_FOUND not_found',
  'a student that does not exist is NOT_FOUND');
select is(pg_temp.as_user('teach', 'select api.set_student_interface(null, ''gaze'', 1)') ->> 'error', 'P0001 NOT_FOUND not_found', 'and so is a null student');
-- The admin who also teaches the group is staff of it, like for the needs.
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_n'), pg_temp.id('admin')));
select pg_temp.as_user('teach', format('select api.add_group_staff(%L, %L, ''co_teacher'')', pg_temp.id('g_n'), pg_temp.id('admin')));
select is(pg_temp.seti('admin', 'sn1', 'gaze', pg_temp.rev('sn1')) ->> 'revision', '8', 'an admin who also teaches the group can');

select * from finish();
rollback;
