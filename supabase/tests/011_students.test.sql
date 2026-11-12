-- T1.2b: students, enrollments and the group/student projections, through the RPCs, as each role
-- of the matrix would call them. Every section builds its own institution (through the internal RPCs,
-- the way the factories will) and the whole file is rolled back, so it depends on no other test and
-- clobbers none.
begin;
select plan(227);

-- Calls an RPC the way PostgREST would: claims for p_user (null = no session) and p_role switched
-- with SET LOCAL ROLE. Returns the jsonb result, or {"error": "<sqlstate> <message> <detail>"}.
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

-- Same as above for code that runs as the owner.
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
-- The keys of a jsonb object, sorted, as one string: compared with a literal list.
create function pg_temp.keys(p_obj jsonb) returns text language sql
  as $$ select string_agg(k, ',' order by k) from jsonb_object_keys(p_obj) k $$;

-- Users. Auth rows first (the real ones are made by Auth), app_users through the RPC.
insert into ids (k, id) select k, gen_random_uuid() from unnest(array[
  'admin', 'teach', 'other', 'incl', 'userb', 'visitor', 'nobody', 'ghost',
  'stu_c', 'stu_u', 'stu_e', 'stu_l', 'stu_l2', 'stu_p', 'stu_r1', 'stu_r2', 'stu_r3', 'stu_r4'
]) as k;
insert into auth.users (id, email) select id, k || '@t1-2b.invalid' from ids where k <> 'ghost';
do $$
declare
  k text;
begin
  for k in select ids.k from ids where ids.k <> 'ghost' loop
    perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;

-- One institution per section: admin, two teachers, inclusion, a group of each teacher. The teacher
-- 'other' owns a second group, so 'teach' is a teacher of another group there. 'userb' belongs to
-- no section institution: it is the person from another institution.
create function pg_temp.mk(p text) returns void language plpgsql as $$
declare
  v_inst uuid;
begin
  v_inst := (pg_temp.as_service(format('select api.internal_create_institution(%L, %L, ''school'')', 'Liceo ' || p, 't1-2b-' || p)) ->> 'id')::uuid;
  insert into ids (k, id) values ('i_' || p, v_inst);
  perform pg_temp.as_service(format('select api.internal_add_membership(%L, %L, %L)', v_inst, pg_temp.id(u.k), u.role))
     from (values ('admin', 'admin'), ('teach', 'teacher'), ('other', 'teacher'), ('incl', 'inclusion')) as u(k, role);
  insert into ids (k, id) values
    ('g_' || p, (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', v_inst)) ->> 'id')::uuid),
    ('go_' || p, (pg_temp.as_user('other', format('select api.create_group(%L, ''3.º B'', ''math'', 2026, gen_random_uuid())', v_inst)) ->> 'id')::uuid);
end
$$;

-- A student created by the RPC, the way the teacher does it.
create function pg_temp.new_student(p_user text, p_group text, p_name text, p_username text, p_op uuid default gen_random_uuid()) returns jsonb
language sql as $$
  select pg_temp.as_user(p_user, format('select api.create_student(%L, %L, %L, %L)', pg_temp.id(p_group), p_name, p_username, p_op))
$$;

-- A user from another institution, in one that no section uses.
select pg_temp.as_service(format($$ select api.internal_create_institution('Liceo B', 't1-2b-liceo-b', 'school') $$));
insert into ids (k, id) select 'i_b', i.id from app.institutions i where i.code = 't1-2b-liceo-b';
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_b'), pg_temp.id('userb')));

-- ---------------------------------------------------------------------------------------------
-- create_student
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('c');
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''student'')', pg_temp.id('i_c'), pg_temp.id('stu_c')));
insert into ids (k, id) values ('op1', gen_random_uuid());
insert into ids (k, id) select 'sc1', (pg_temp.new_student('teach', 'g_c', '  Ana Pérez ', ' Ana.Perez ', pg_temp.id('op1')) ->> 'id')::uuid;

select is(pg_temp.keys(pg_temp.new_student('teach', 'g_c', 'Bruno', 'bruno.c')), 'id,provisioningId,revision',
  'create_student answers exactly id, revision and provisioningId');
select is((select s.display_name || ':' || s.username || ':' || s.revision || ':' || s.interface || ':' || coalesce(s.user_id::text, 'none')
             from app.students s where s.id = pg_temp.id('sc1')),
  'Ana Pérez:ana.perez:1:standard:none', 'the student is stored trimmed, with a normalized username, no account and the standard interface');
select is((select count(*) from app.enrollments e where e.student_id = pg_temp.id('sc1') and e.group_id = pg_temp.id('g_c') and e.ended_at is null),
  1::bigint, 'and is enrolled in the group');
select is((select count(*) from app.student_pseudonyms p where p.student_id = pg_temp.id('sc1') and p.unlinked_at is null),
  1::bigint, 'and has a pseudonym');
select is((select ap.status || ':' || ap.attempts || ':' || (ap.op_key = pg_temp.id('op1'))::text from app.account_provisioning ap where ap.student_id = pg_temp.id('sc1')),
  'pending:0:true', 'and a pending account provisioning carrying the op_key');

-- The same op_key, group and username: the same answer, nothing created twice.
select is(pg_temp.new_student('teach', 'g_c', 'Ana Pérez', 'ana.perez', pg_temp.id('op1')) ->> 'id', pg_temp.id('sc1')::text,
  'the same op_key with the same group and username returns the student already created');
select is((select count(*) from app.students where institution_id = pg_temp.id('i_c') and username = 'ana.perez')
          + (select count(*) from app.account_provisioning where op_key = pg_temp.id('op1')), 2::bigint,
  'and creates nothing twice');
select is(pg_temp.new_student('teach', 'g_c', 'Ana', 'otro.usuario', pg_temp.id('op1')) ->> 'error', 'P0001 CONFLICT op_key_reused',
  'the same op_key for another username is CONFLICT op_key_reused');
select is(pg_temp.new_student('admin', 'go_c', 'Ana', 'ana.perez', pg_temp.id('op1')) ->> 'error', 'P0001 CONFLICT op_key_reused',
  'the same op_key for another group is CONFLICT op_key_reused');
select is(pg_temp.new_student('teach', 'g_c', 'Otra Ana', 'ana.perez') ->> 'error', 'P0001 CONFLICT username_taken',
  'a username already in the institution is CONFLICT username_taken');
select is(pg_temp.new_student('other', 'go_c', 'Otra Ana', 'ANA.PEREZ') ->> 'error', 'P0001 CONFLICT username_taken',
  'in any group of the institution, and whatever the case');
select is(pg_temp.new_student('teach', 'g_c', 'X', 'a') ->> 'error', 'P0001 INVALID invalid_username', 'a username that is too short is INVALID');
select is(pg_temp.new_student('teach', 'g_c', '   ', 'ok.name') ->> 'error', 'P0001 INVALID invalid_name', 'an empty name is INVALID');
select is(pg_temp.new_student('admin', 'g_c', 'Carla', 'carla.c') ->> 'revision', '1', 'an admin creates students in any group');
select is(pg_temp.new_student('incl', 'g_c', 'Dani', 'dani.c') ->> 'error', 'P0001 FORBIDDEN forbidden', 'inclusion cannot create students');
select is(pg_temp.new_student('other', 'g_c', 'Dani', 'dani.c') ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher of another group gets NOT_FOUND');
select is(pg_temp.new_student('userb', 'g_c', 'Dani', 'dani.c') ->> 'error', 'P0001 NOT_FOUND not_found', 'a user of another institution gets NOT_FOUND');
select is(pg_temp.new_student('nobody', 'g_c', 'Dani', 'dani.c') ->> 'error', 'P0001 NOT_FOUND not_found', 'a user with no membership gets NOT_FOUND');
select is(pg_temp.new_student('ghost', 'g_c', 'Dani', 'dani.c') ->> 'error', 'P0001 FORBIDDEN no_session', 'no app user, no student');
select is(pg_temp.as_anon(format('select api.create_student(%L, ''Dani'', ''dani.c'', gen_random_uuid())', pg_temp.id('g_c'))) ->> 'error' like '42501%', true,
  'anon cannot execute create_student');
select is((select count(*) from app.students where institution_id = pg_temp.id('i_c') and username = 'dani.c'), 0::bigint,
  'none of the refused calls created a student');
-- A student of the institution sees the group but is not allowed to create.
do $$ begin
  perform pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('sc1'), pg_temp.id('stu_c')));
end $$;
select is(pg_temp.new_student('stu_c', 'g_c', 'Dani', 'dani.c') ->> 'error', 'P0001 FORBIDDEN forbidden', 'an enrolled student cannot create students');
do $$ begin
  perform pg_temp.as_user('teach', format('select api.archive_group(%L, 1)', pg_temp.id('g_c')));
end $$;
select is(pg_temp.new_student('admin', 'g_c', 'Dani', 'dani.c') ->> 'error', 'P0001 INVALID archived', 'an archived group takes no new student');
select is(pg_temp.new_student('admin', 'g_c', 'Ana Pérez', 'ana.perez', pg_temp.id('op1')) ->> 'id', pg_temp.id('sc1')::text,
  'but repeating a creation that already happened still answers the same');

-- Sandbox: the visitor is a teacher there, no real account is ever provisioned.
insert into ids (k, id) select 'i_s', (pg_temp.as_service(format(
  $$ select api.internal_create_institution('Demo', 't1-2b-demo', 'sandbox', now() + interval '1 day', %L) $$, pg_temp.id('visitor'))) ->> 'id')::uuid;
do $$ begin
  perform pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_s'), pg_temp.id('visitor')));
end $$;
insert into ids (k, id) select 'g_s', (pg_temp.as_user('visitor', format('select api.create_group(%L, ''Demo'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_s'))) ->> 'id')::uuid;
insert into ids (k, id) select 'ss1', (pg_temp.new_student('visitor', 'g_s', 'Demo Uno', 'demo.uno') ->> 'id')::uuid;
select is(pg_temp.new_student('visitor', 'g_s', 'Demo Dos', 'demo.dos') -> 'provisioningId', 'null'::jsonb,
  'in a sandbox provisioningId is null');
select is((select string_agg(distinct ap.status, ',') || ':' || count(*) from app.account_provisioning ap where ap.institution_id = pg_temp.id('i_s')),
  'not_applicable:2', 'and its provisioning rows are not_applicable: the key is remembered, no real account is made');
select is((select count(*) from app.student_pseudonyms where institution_id = pg_temp.id('i_s'))
          + (select count(*) from app.enrollments where institution_id = pg_temp.id('i_s')), 4::bigint,
  'but the students still get their pseudonym and enrollment');
select is(pg_temp.new_student('visitor', 'g_s', 'Demo Uno', 'demo.uno') ->> 'error', 'P0001 CONFLICT username_taken',
  'a repeated username in a sandbox is CONFLICT username_taken');
update app.institutions set expires_at = now() - interval '1 minute' where id = pg_temp.id('i_s');
select is(pg_temp.new_student('visitor', 'g_s', 'Demo Tres', 'demo.tres') ->> 'error', 'P0001 NOT_FOUND not_found',
  'after the sandbox expires nothing can be created in it');

-- ---------------------------------------------------------------------------------------------
-- update_student / archive_student / restore_student
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('u');
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''student'')', pg_temp.id('i_u'), pg_temp.id('stu_u')));
insert into ids (k, id) select 'su1', (pg_temp.new_student('teach', 'g_u', 'Elena', 'elena.u') ->> 'id')::uuid;
insert into ids (k, id) select 'su2', (pg_temp.new_student('teach', 'g_u', 'Fede', 'fede.u') ->> 'id')::uuid;
create function pg_temp.upd(p_user text, p_rev integer, p_name text default 'Elena G.', p_username text default 'elena.u', p_student text default 'su1') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.update_student(%L, %s, %L, %L)', pg_temp.id(p_student), p_rev, p_name, p_username))
$$;
create function pg_temp.arch(p_user text, p_rev integer, p_fn text default 'archive_student', p_student text default 'su1') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.%I(%L, %s)', p_fn, pg_temp.id(p_student), p_rev))
$$;

select is(pg_temp.upd('teach', 1), jsonb_build_object('id', pg_temp.id('su1'), 'revision', 2), 'a teacher of the group updates the student');
select is((select display_name from app.students where id = pg_temp.id('su1')), 'Elena G.', 'the new data is stored');
select is(pg_temp.upd('teach', 1) ->> 'error', 'P0001 CONFLICT revision_mismatch', 'an old revision is CONFLICT');
select is(pg_temp.upd('teach', 2) ->> 'revision', '2', 'the same data with the current revision changes nothing');
select is(pg_temp.upd('teach', 2, 'Elena', 'elena.nueva') ->> 'revision', '3', 'a new username bumps the revision');
select is(pg_temp.upd('teach', 3, 'Elena', 'FEDE.U') ->> 'error', 'P0001 CONFLICT username_taken', 'a username of another student is CONFLICT username_taken');
select is((select revision from app.students where id = pg_temp.id('su1')), 3, 'and changed nothing');
select is(pg_temp.upd('teach', 3, '', 'elena.u') ->> 'error', 'P0001 INVALID invalid_name', 'an empty name is INVALID');
select is(pg_temp.upd('teach', 3, 'Elena', 'x y') ->> 'error', 'P0001 INVALID invalid_username', 'a malformed username is INVALID');
select is(pg_temp.upd('admin', 3, 'Elena Gómez', 'elena.u') ->> 'revision', '4', 'an admin updates any student of the institution');
select is(pg_temp.upd('incl', 4) ->> 'error', 'P0001 FORBIDDEN forbidden', 'inclusion sees the student but cannot change it');
select is(pg_temp.upd('other', 4) ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher of another group cannot even see the student');
select is(pg_temp.upd('userb', 4) ->> 'error', 'P0001 NOT_FOUND not_found', 'a user of another institution gets NOT_FOUND');
select is(pg_temp.upd('nobody', 4) ->> 'error', 'P0001 NOT_FOUND not_found', 'a user with no membership gets NOT_FOUND');
select is(pg_temp.as_user('teach', format('select api.update_student(%L, 4, ''X'', ''xx'')', gen_random_uuid())) ->> 'error', 'P0001 NOT_FOUND not_found',
  'an unknown student is NOT_FOUND');
do $$ begin
  perform pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('su1'), pg_temp.id('stu_u')));
end $$;
select is(pg_temp.upd('stu_u', 4) ->> 'error', 'P0001 FORBIDDEN forbidden', 'the student themselves cannot edit their record');
select is(pg_temp.as_anon(format('select api.update_student(%L, 1, ''X'', ''xx'')', pg_temp.id('su1'))) ->> 'error' like '42501%', true,
  'anon cannot execute update_student');
select is((select revision from app.students where id = pg_temp.id('su1')), 4, 'none of the refused calls changed the student');

select is(pg_temp.arch('teach', 4), jsonb_build_object('id', pg_temp.id('su1'), 'revision', 5), 'a teacher archives the student');
select ok((select archived_at is not null from app.students where id = pg_temp.id('su1')), 'and it is marked archived');
select is((select count(*) from app.enrollments where student_id = pg_temp.id('su1') and ended_at is null), 1::bigint,
  'archiving keeps the enrollment');
select is(pg_temp.arch('teach', 4) ->> 'error', 'P0001 CONFLICT revision_mismatch', 'archiving with an old revision is CONFLICT');
select is(pg_temp.arch('teach', 5) ->> 'revision', '5', 'archiving an archived student with the current revision changes nothing');
select is(pg_temp.upd('teach', 5) ->> 'error', 'P0001 INVALID archived', 'an archived student cannot be edited');
select is(pg_temp.arch('incl', 5, 'restore_student') ->> 'error', 'P0001 FORBIDDEN forbidden', 'inclusion cannot restore it');
select is(pg_temp.arch('other', 5, 'restore_student') ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher of another group cannot restore it');
select is(pg_temp.arch('userb', 5, 'restore_student') ->> 'error', 'P0001 NOT_FOUND not_found', 'a user of another institution cannot restore it');
select is(pg_temp.arch('teach', 4, 'restore_student') ->> 'error', 'P0001 CONFLICT revision_mismatch', 'restoring with an old revision is CONFLICT');
select is(pg_temp.arch('admin', 5, 'restore_student'), jsonb_build_object('id', pg_temp.id('su1'), 'revision', 6), 'an admin restores it');
select ok((select archived_at is null from app.students where id = pg_temp.id('su1')), 'and it is active again');
select is(pg_temp.arch('teach', 6, 'restore_student') ->> 'revision', '6', 'restoring an active student with the current revision changes nothing');
select is(pg_temp.arch('stu_u', 6) ->> 'error', 'P0001 FORBIDDEN forbidden', 'the student themselves cannot archive their record');
select is(
  (select string_agg(left(pg_temp.as_anon(format('select api.%I(gen_random_uuid(), 1)', f)) ->> 'error', 5), ',')
     from unnest(array['archive_student', 'restore_student']) as f),
  '42501,42501', 'anon cannot execute archive_student or restore_student');
-- Once the student left the group, its teacher no longer reaches them; the admin still does.
do $$ begin
  perform pg_temp.as_user('teach', format('select api.unenroll_student(%L, %L)', pg_temp.id('g_u'), pg_temp.id('su2')));
end $$;
select is(pg_temp.upd('teach', 1, 'Fede F.', 'fede.u', 'su2') ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher cannot edit a student who left their group');
select is(pg_temp.upd('admin', 1, 'Fede F.', 'fede.u', 'su2') ->> 'revision', '2', 'an admin still can');

-- ---------------------------------------------------------------------------------------------
-- enroll_student / unenroll_student
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('e');
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''student'')', pg_temp.id('i_e'), pg_temp.id('stu_e')));
insert into ids (k, id) select 'se1', (pg_temp.new_student('teach', 'g_e', 'Gina', 'gina.e') ->> 'id')::uuid;
insert into ids (k, id) select 'se2', (pg_temp.new_student('teach', 'g_e', 'Hugo', 'hugo.e') ->> 'id')::uuid;
create function pg_temp.enr(p_user text, p_group text, p_student text, p_fn text default 'enroll_student') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.%I(%L, %L)', p_fn, pg_temp.id(p_group), pg_temp.id(p_student)))
$$;

select is(pg_temp.keys(pg_temp.enr('other', 'go_e', 'se1')), 'id', 'enroll_student answers exactly the id of the enrollment');
select is((select count(*) from app.enrollments where student_id = pg_temp.id('se1') and ended_at is null), 2::bigint,
  'a student can be in two groups at once');
insert into ids (k, id) select 'en1', (pg_temp.enr('teach', 'g_e', 'se1') ->> 'id')::uuid;
select is((select e.id from app.enrollments e where e.group_id = pg_temp.id('g_e') and e.student_id = pg_temp.id('se1') and e.ended_at is null),
  pg_temp.id('en1'), 'enrolling someone already in the group returns the active enrollment');
select is((select count(*) from app.enrollments where group_id = pg_temp.id('g_e') and student_id = pg_temp.id('se1')), 1::bigint,
  'and does not duplicate it');
select is(left(pg_temp.err(format('insert into app.enrollments (institution_id, group_id, student_id) values (%L, %L, %L)',
    pg_temp.id('i_e'), pg_temp.id('g_e'), pg_temp.id('se1'))), 5), '23505', 'the table refuses a second active enrollment in the same group');
select is(pg_temp.keys(pg_temp.enr('teach', 'g_e', 'se1', 'unenroll_student')), 'id', 'unenroll_student answers exactly the id');
select ok((select ended_at is not null and revision = 2 from app.enrollments where id = pg_temp.id('en1')), 'the enrollment stays, ended, with its revision bumped');
select is(pg_temp.enr('teach', 'g_e', 'se1', 'unenroll_student') ->> 'id', pg_temp.id('en1')::text, 'unenrolling twice returns the same enrollment');
select is((select revision from app.enrollments where id = pg_temp.id('en1')), 2, 'and does not bump it again');
select is(pg_temp.enr('teach', 'g_e', 'se1') ->> 'id' <> pg_temp.id('en1')::text, true, 'enrolling again after leaving makes a new enrollment');
select is((select count(*) from app.enrollments where group_id = pg_temp.id('g_e') and student_id = pg_temp.id('se1')), 2::bigint,
  'and the history keeps both');
select is((select count(*) from app.enrollments where group_id = pg_temp.id('g_e') and student_id = pg_temp.id('se1') and ended_at is null), 1::bigint,
  'with only one of them active');
select is(pg_temp.enr('admin', 'go_e', 'se2') ->> 'error', null, 'an admin enrolls in any group');
select is(pg_temp.enr('teach', 'go_e', 'se2', 'unenroll_student') ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher of another group cannot unenroll there');
select is(pg_temp.enr('admin', 'g_e', 'se1', 'unenroll_student') ->> 'error', null, 'an admin unenrolls');
select is(pg_temp.enr('admin', 'g_e', 'se1', 'unenroll_student') ->> 'error', null, 'and again, without error');
select is(pg_temp.as_user('admin', format('select api.unenroll_student(%L, %L)', pg_temp.id('go_e'), pg_temp.id('se1'))) ->> 'error', null,
  'a student that is in the group can be unenrolled by an admin');
select is(pg_temp.as_user('admin', format('select api.unenroll_student(%L, %L)', pg_temp.id('go_e'), pg_temp.id('se1'))) ->> 'error', null,
  'twice');
select is(pg_temp.as_user('admin', format('select api.unenroll_student(%L, %L)', pg_temp.id('go_e'), gen_random_uuid())) ->> 'error', 'P0001 NOT_FOUND not_enrolled',
  'someone who was never in the group is NOT_FOUND not_enrolled');
select is(pg_temp.enr('incl', 'g_e', 'se1') ->> 'error', 'P0001 FORBIDDEN forbidden', 'inclusion cannot enroll');
select is(pg_temp.enr('incl', 'g_e', 'se1', 'unenroll_student') ->> 'error', 'P0001 FORBIDDEN forbidden', 'nor unenroll');
select is(pg_temp.enr('other', 'g_e', 'se1') ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher of another group cannot enroll in this one');
select is(pg_temp.enr('userb', 'g_e', 'se1') ->> 'error', 'P0001 NOT_FOUND not_found', 'a user of another institution gets NOT_FOUND');
select is(pg_temp.enr('nobody', 'g_e', 'se1') ->> 'error', 'P0001 NOT_FOUND not_found', 'a user with no membership gets NOT_FOUND');
do $$ begin
  perform pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('se2'), pg_temp.id('stu_e')));
end $$;
select is(pg_temp.enr('stu_e', 'g_e', 'se1') ->> 'error', 'P0001 FORBIDDEN forbidden', 'an enrolled student cannot enroll anyone');
select is(pg_temp.enr('teach', 'g_e', 'se1') ->> 'error', null, 'the teacher can enroll them again');
-- A student of another institution is not reachable by id.
insert into app.students (id, institution_id, display_name, username) values (gen_random_uuid(), pg_temp.id('i_b'), 'De B', 'de.b.t1');
insert into ids (k, id) select 'sbx', s.id from app.students s where s.username = 'de.b.t1' and s.institution_id = pg_temp.id('i_b');
select is(pg_temp.enr('teach', 'g_e', 'sbx') ->> 'error', 'P0001 NOT_FOUND not_found', 'a student of another institution is NOT_FOUND');
select is(pg_temp.enr('teach', 'g_e', 'se1', 'enroll_student') ->> 'error', null, 'and the refused call did not break the group');
insert into ids (k, id) select 'se3', (pg_temp.new_student('teach', 'g_e', 'Ines', 'ines.e') ->> 'id')::uuid;
insert into ids (k, id) select 'se4', (pg_temp.new_student('teach', 'g_e', 'Joel', 'joel.e') ->> 'id')::uuid;
do $$ begin
  perform pg_temp.as_user('teach', format('select api.archive_student(%L, 1)', pg_temp.id('se3')));
end $$;
select is(pg_temp.enr('admin', 'go_e', 'se3') ->> 'error', 'P0001 INVALID archived', 'an archived student takes no new enrollment');
select is(pg_temp.enr('teach', 'g_e', 'se3') ->> 'error', null, 'but one who is already in the group is answered with their enrollment');
do $$ begin
  perform pg_temp.as_user('other', format('select api.archive_group(%L, 1)', pg_temp.id('go_e')));
end $$;
select is(pg_temp.enr('other', 'go_e', 'se2') ->> 'error', null, 'a student already in an archived group is answered with their enrollment');
select is(pg_temp.enr('admin', 'go_e', 'se4') ->> 'error', 'P0001 INVALID archived', 'an archived group takes no new enrollment');
select is(
  (select string_agg(left(pg_temp.as_anon(format('select api.%I(gen_random_uuid(), gen_random_uuid())', f)) ->> 'error', 5), ',')
     from unnest(array['enroll_student', 'unenroll_student']) as f),
  '42501,42501', 'anon cannot execute enroll_student or unenroll_student');

-- ---------------------------------------------------------------------------------------------
-- internal_link_student_user
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('l');
insert into ids (k, id) select 'sl1', (pg_temp.new_student('teach', 'g_l', 'Iris', 'iris.l') ->> 'id')::uuid;
insert into ids (k, id) select 'sl2', (pg_temp.new_student('teach', 'g_l', 'Juan', 'juan.l') ->> 'id')::uuid;
create function pg_temp.link(p_student text, p_user text) returns jsonb language sql as $$
  select pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id(p_student), pg_temp.id(p_user)))
$$;

select is(pg_temp.link('sl1', 'stu_l'), jsonb_build_object('id', pg_temp.id('sl1')), 'internal_link_student_user answers the student id');
select is((select s.user_id from app.students s where s.id = pg_temp.id('sl1')), pg_temp.id('stu_l'), 'the student is tied to the account');
select is((select count(*) from app.memberships m where m.institution_id = pg_temp.id('i_l') and m.user_id = pg_temp.id('stu_l') and m.role = 'student' and m.revoked_at is null),
  1::bigint, 'the student membership exists');
select is((select ap.status || ':' || (ap.auth_user_id = pg_temp.id('stu_l'))::text || ':' || ap.revision from app.account_provisioning ap where ap.student_id = pg_temp.id('sl1')),
  'active:true:2', 'the provisioning is active and knows the account');
select is((select revision from app.students where id = pg_temp.id('sl1')), 1, 'linking does not bump the student revision');
select is(pg_temp.link('sl1', 'stu_l') ->> 'id', pg_temp.id('sl1')::text, 'linking the same account again answers the same');
select is((select count(*) from app.memberships where institution_id = pg_temp.id('i_l') and user_id = pg_temp.id('stu_l') and role = 'student'), 1::bigint,
  'and does not duplicate the membership');
select is((select revision from app.account_provisioning where student_id = pg_temp.id('sl1')), 2, 'nor touch the provisioning');
select is(pg_temp.link('sl1', 'stu_l2') ->> 'error', 'P0001 CONFLICT op_key_reused', 'another account for the same student is CONFLICT op_key_reused');
select is(pg_temp.link('sl2', 'stu_l') ->> 'error', 'P0001 CONFLICT op_key_reused', 'the account of another student is CONFLICT op_key_reused');
select is(pg_temp.link('sl2', 'teach') ->> 'error', 'P0001 CONFLICT role_conflict', 'an account that is staff in the institution is CONFLICT role_conflict');
select is((select s.user_id from app.students s where s.id = pg_temp.id('sl2')), null, 'and the student stays unlinked');
select is(pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', gen_random_uuid(), pg_temp.id('stu_l2'))) ->> 'error', 'P0001 NOT_FOUND not_found',
  'an unknown student is NOT_FOUND');
select is(pg_temp.link('sl2', 'ghost') ->> 'error', 'P0001 NOT_FOUND not_found', 'an account with no app user is NOT_FOUND');
update app.account_provisioning set status = 'deleted' where student_id = pg_temp.id('sl2');
select is(pg_temp.link('sl2', 'stu_l2') ->> 'error', 'P0001 NOT_FOUND not_found', 'an account marked deleted is never brought back');
-- deleted is final (phase 2, F2C-48): to test what a later link does with a failed row, the guard is off for this one statement.
alter table app.account_provisioning disable trigger account_provisioning_deleted_final;
update app.account_provisioning set status = 'failed', error_code = 'auth_unavailable' where student_id = pg_temp.id('sl2');
alter table app.account_provisioning enable trigger account_provisioning_deleted_final;
select is(pg_temp.link('sl2', 'stu_l2') ->> 'id', pg_temp.id('sl2')::text, 'a failed provisioning is completed by a later link');
select is((select ap.status || ':' || coalesce(ap.error_code, 'none') from app.account_provisioning ap where ap.student_id = pg_temp.id('sl2')), 'active:none',
  'and its error is cleared');
-- A sandbox student has no provisioning row: the link still works (the factories use it).
select is((select ap.status from app.account_provisioning ap where ap.student_id = pg_temp.id('ss1')), 'not_applicable', 'the sandbox student has a not_applicable provisioning');
select is(
  (select string_agg(left(pg_temp.rpc(u.uid, u.role, format('select api.internal_link_student_user(%L, %L)', pg_temp.id('sl1'), pg_temp.id('stu_l'))) ->> 'error', 5), ',' order by u.n)
     from (values (1, pg_temp.id('teach'), 'authenticated'), (2, null::uuid, 'anon')) as u(n, uid, role)),
  '42501,42501', 'authenticated and anon are refused (42501)');
select is(
  (select string_agg(p.proname, ',' order by p.proname) from pg_proc p
    where p.pronamespace = 'api'::regnamespace and p.proname = 'internal_link_student_user'
      and has_function_privilege('service_role', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')),
  'internal_link_student_user', 'EXECUTE is for service_role and nobody else');
select is(
  (select string_agg(p.proname, ',' order by p.proname) from pg_proc p
    where p.pronamespace = 'api'::regnamespace
      and p.proname in ('create_student', 'update_student', 'archive_student', 'restore_student', 'enroll_student', 'unenroll_student',
                        'list_my_groups', 'get_group', 'list_group_students')
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('service_role', p.oid, 'execute')),
  'archive_student,create_student,enroll_student,get_group,list_group_students,list_my_groups,restore_student,unenroll_student,update_student',
  'the nine user RPCs: EXECUTE for authenticated and nobody else');

-- ---------------------------------------------------------------------------------------------
-- Projections: list_my_groups, get_group, list_group_students
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('p');
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''student'')', pg_temp.id('i_p'), pg_temp.id('stu_p')));
insert into ids (k, id) select 'sp1', (pg_temp.new_student('teach', 'g_p', 'Kira', 'kira.p') ->> 'id')::uuid;
insert into ids (k, id) select 'sp2', (pg_temp.new_student('teach', 'g_p', 'Abel', 'abel.p') ->> 'id')::uuid;
insert into ids (k, id) select 'sp3', (pg_temp.new_student('teach', 'g_p', 'Zoe', 'zoe.p') ->> 'id')::uuid;
insert into ids (k, id) select 'sp4', (pg_temp.new_student('other', 'go_p', 'Otto', 'otto.p') ->> 'id')::uuid;
do $$ begin
  perform pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('sp1'), pg_temp.id('stu_p')));
  perform pg_temp.as_user('teach', format('select api.archive_student(%L, 1)', pg_temp.id('sp3')));
  perform pg_temp.as_user('teach', format('select api.unenroll_student(%L, %L)', pg_temp.id('g_p'), pg_temp.id('sp2')));
  perform pg_temp.as_user('teach', format('select api.enroll_student(%L, %L)', pg_temp.id('g_p'), pg_temp.id('sp2')));
  -- Sensitive data of the students exists, and must not leak through any projection.
  insert into app.student_needs (institution_id, student_id, profiles) select i_p.id, sp1.id, array['adhd']
    from ids i_p, ids sp1 where i_p.k = 'i_p' and sp1.k = 'sp1';
end $$;
select pg_temp.mk('q');  -- a second institution for the teacher, to be sure listings do not mix them
insert into ids (k, id) select 'ga_p', (pg_temp.as_user('teach', format('select api.create_group(%L, ''Archivado'', ''math'', 2025, gen_random_uuid())', pg_temp.id('i_p'))) ->> 'id')::uuid;
do $$ begin perform pg_temp.as_user('teach', format('select api.archive_group(%L, 1)', pg_temp.id('ga_p'))); end $$;

create function pg_temp.mine(p_user text, p_args text default '') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.list_my_groups(%L%s)', pg_temp.id('i_p'), p_args))
$$;
create function pg_temp.grp(p_user text, p_group text default 'g_p') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.get_group(%L)', pg_temp.id(p_group)))
$$;
create function pg_temp.roster(p_user text, p_args text default '', p_group text default 'g_p') returns jsonb language sql as $$
  select pg_temp.as_user(p_user, format('select api.list_group_students(%L%s)', pg_temp.id(p_group), p_args))
$$;

-- list_my_groups
select is(pg_temp.keys(pg_temp.mine('teach')), 'items,total', 'list_my_groups answers items and total');
select is(pg_temp.keys(pg_temp.mine('teach') -> 'items' -> 0), 'archivedAt,id,myRole,name,revision,schoolYear,studentCount,subjectId',
  'each group has exactly the keys of GroupSummary');
select is(pg_temp.mine('teach') ->> 'total', '1', 'a teacher sees only their own groups (the archived one is left out)');
select is(pg_temp.mine('teach') -> 'items' -> 0 ->> 'myRole', 'owner', 'with their role');
select is(pg_temp.mine('teach') -> 'items' -> 0 ->> 'studentCount', '2', 'and the students enrolled now, not the archived or the ones who left');
select is(pg_temp.mine('other') -> 'items' -> 0 ->> 'id', pg_temp.id('go_p')::text, 'another teacher sees theirs');
select is(pg_temp.mine('teach', ', true') ->> 'total', '2', 'with p_include_archived the archived group appears');
select is((select count(*) from jsonb_array_elements(pg_temp.mine('admin') -> 'items') e where e -> 'myRole' = 'null'::jsonb), 2::bigint,
  'an admin sees every active group of the institution with myRole null');
select is((select count(*) from jsonb_array_elements(pg_temp.mine('incl') -> 'items') e where e -> 'myRole' = 'null'::jsonb), 2::bigint,
  'and so does inclusion');
select is((select count(*) from jsonb_array_elements(pg_temp.mine('admin') -> 'items') e where e ->> 'id' = pg_temp.id('g_q')::text), 0::bigint,
  'no listing mixes in the groups of another institution');
select is(pg_temp.mine('admin', ', false, 1, 1') ->> 'total', '2', 'pagination keeps the total');
select is(jsonb_array_length(pg_temp.mine('admin', ', false, 1, 1') -> 'items'), 1, 'and returns one item per page');
select is(pg_temp.mine('admin', ', false, 1, 1') -> 'items' -> 0 ->> 'name', '3.º B', 'in the order of name and id');
select is(pg_temp.mine('admin', ', false, 50, 10') ->> 'total', '2', 'an offset past the end still reports the total');
select is(jsonb_array_length(pg_temp.mine('admin', ', false, 50, 10') -> 'items'), 0, 'and no items');
select is(pg_temp.mine('admin', ', false, 0, 0') ->> 'error', 'P0001 INVALID invalid_page', 'a limit of zero is INVALID');
select is(pg_temp.mine('admin', ', false, 5, -1') ->> 'error', 'P0001 INVALID invalid_page', 'a negative offset is INVALID');
select is(pg_temp.mine('stu_p') ->> 'error', 'P0001 FORBIDDEN forbidden', 'a student cannot list groups');
select is(pg_temp.mine('userb') ->> 'error', 'P0001 NOT_FOUND not_found', 'a user of another institution gets NOT_FOUND');
select is(pg_temp.mine('nobody') ->> 'error', 'P0001 NOT_FOUND not_found', 'a user with no membership gets NOT_FOUND');
select is(pg_temp.mine('ghost') ->> 'error', 'P0001 FORBIDDEN no_session', 'no app user, no list');
select is(pg_temp.as_anon(format('select api.list_my_groups(%L)', pg_temp.id('i_p'))) ->> 'error' like '42501%', true, 'anon cannot execute list_my_groups');
-- An admin who also teaches gets the real role in the groups they teach.
do $$ begin
  perform pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_p'), pg_temp.id('admin')));
  perform pg_temp.as_user('teach', format('select api.add_group_staff(%L, %L, ''co_teacher'')', pg_temp.id('g_p'), pg_temp.id('admin')));
end $$;
select is((select e ->> 'myRole' from jsonb_array_elements(pg_temp.mine('admin') -> 'items') e where e ->> 'id' = pg_temp.id('g_p')::text),
  'co_teacher', 'an admin who also teaches a group sees their role in it, and null in the rest');

-- get_group
select is(pg_temp.keys(pg_temp.grp('teach')), 'archivedAt,id,institutionId,myRole,name,revision,schoolYear,staff,subjectId',
  'get_group has exactly the keys of GroupDetail');
select is(pg_temp.keys(pg_temp.grp('teach') -> 'staff' -> 0), 'displayName,role,userId', 'and each staff entry has exactly its three keys');
select is(pg_temp.grp('teach') ->> 'myRole', 'owner', 'the owner sees their role');
select is(pg_temp.grp('teach') -> 'staff' -> 0 ->> 'role', 'owner', 'the staff lists the owner first');
select is(jsonb_array_length(pg_temp.grp('teach') -> 'staff'), 2, 'and the active staff of the group');
select is(pg_temp.grp('teach') ->> 'institutionId', pg_temp.id('i_p')::text, 'with its institution');
select is(pg_temp.grp('admin', 'go_p') -> 'myRole', 'null'::jsonb, 'an admin reads a group they do not teach with myRole null');
select is(pg_temp.grp('incl') -> 'myRole', 'null'::jsonb, 'an inclusion member reads a group with myRole null');
select is(pg_temp.grp('incl') ->> 'id', pg_temp.id('g_p')::text, 'and sees it whole');
select is(pg_temp.grp('other') ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher of another group gets NOT_FOUND');
select is(pg_temp.grp('userb') ->> 'error', 'P0001 NOT_FOUND not_found', 'a user of another institution gets NOT_FOUND');
select is(pg_temp.grp('nobody') ->> 'error', 'P0001 NOT_FOUND not_found', 'a user with no membership gets NOT_FOUND');
select is(pg_temp.grp('stu_p') ->> 'error', 'P0001 FORBIDDEN forbidden', 'an enrolled student sees the group exists but is FORBIDDEN');
select is(pg_temp.as_user('teach', format('select api.get_group(%L)', gen_random_uuid())) ->> 'error', 'P0001 NOT_FOUND not_found', 'an unknown group is NOT_FOUND');
select is(pg_temp.as_anon(format('select api.get_group(%L)', pg_temp.id('g_p'))) ->> 'error' like '42501%', true, 'anon cannot execute get_group');
select is(pg_temp.grp('teach', 'ga_p') ->> 'archivedAt' is not null, true, 'an archived group is readable, with its archivedAt');

-- list_group_students
select is(pg_temp.keys(pg_temp.roster('teach')), 'items,total', 'list_group_students answers items and total');
select is(pg_temp.keys(pg_temp.roster('teach') -> 'items' -> 0), 'archivedAt,displayName,enrolledAt,hasAccount,id,revision,username',
  'each student has exactly the keys of GroupStudent: no interface, no needs, no user id');
select is(pg_temp.roster('teach') ->> 'total', '2', 'only the students enrolled now and not archived');
select is((select string_agg(e ->> 'displayName', ',' order by ord) from jsonb_array_elements(pg_temp.roster('teach') -> 'items') with ordinality as t(e, ord)),
  'Abel,Kira', 'in the order of name');
select is((select e ->> 'hasAccount' from jsonb_array_elements(pg_temp.roster('teach') -> 'items') e where e ->> 'username' = 'kira.p'), 'true', 'a linked student has an account');
select is((select e ->> 'hasAccount' from jsonb_array_elements(pg_temp.roster('teach') -> 'items') e where e ->> 'username' = 'abel.p'), 'false', 'an unlinked one does not');
select is(pg_temp.roster('teach', ', true') ->> 'total', '3', 'with p_include_archived the archived student appears');
select is((select e ->> 'archivedAt' is not null from jsonb_array_elements(pg_temp.roster('teach', ', true') -> 'items') e where e ->> 'username' = 'zoe.p'), true,
  'marked as archived');
select is(pg_temp.roster('teach', ', false, 1, 1') ->> 'total', '2', 'pagination keeps the total');
select is(pg_temp.roster('teach', ', false, 1, 1') -> 'items' -> 0 ->> 'displayName', 'Kira', 'and the second page has the second student');
select is(jsonb_array_length(pg_temp.roster('teach', ', false, 1, 9') -> 'items'), 0, 'an offset past the end has no items');
select is(pg_temp.roster('teach', ', false, 1, 9') ->> 'total', '2', 'and still the total');
select is(pg_temp.roster('teach', ', false, 201, 0') ->> 'error', 'P0001 INVALID invalid_page', 'a limit over 200 is INVALID');
select is(pg_temp.roster('admin') ->> 'total', '2', 'an admin reads any roster');
select is(pg_temp.roster('incl') ->> 'total', '2', 'so does inclusion');
select is(pg_temp.roster('incl', '', 'go_p') -> 'items' -> 0 ->> 'username', 'otto.p', 'in every group of the institution');
select is(pg_temp.roster('other') ->> 'error', 'P0001 NOT_FOUND not_found', 'a teacher of another group gets NOT_FOUND');
select is(pg_temp.roster('userb') ->> 'error', 'P0001 NOT_FOUND not_found', 'a user of another institution gets NOT_FOUND');
select is(pg_temp.roster('nobody') ->> 'error', 'P0001 NOT_FOUND not_found', 'a user with no membership gets NOT_FOUND');
select is(pg_temp.roster('stu_p') ->> 'error', 'P0001 FORBIDDEN forbidden', 'a student cannot read the roster of their own group');
select is(pg_temp.roster('ghost') ->> 'error', 'P0001 FORBIDDEN no_session', 'no app user, no roster');
select is(pg_temp.as_anon(format('select api.list_group_students(%L)', pg_temp.id('g_p'))) ->> 'error' like '42501%', true, 'anon cannot execute list_group_students');
select is(pg_temp.as_user('teach', format('select api.list_group_students(%L)', gen_random_uuid())) ->> 'error', 'P0001 NOT_FOUND not_found', 'an unknown group is NOT_FOUND');
-- The projections hide what is sensitive even when it exists: the needs row is there and no key reveals it.
select is((select count(*) from app.student_needs where student_id = pg_temp.id('sp1')), 1::bigint, 'the student has a profile stored');
select is(position('adhd' in (pg_temp.roster('teach')::text || pg_temp.grp('teach')::text || pg_temp.mine('teach')::text)), 0,
  'and no projection mentions it');

-- ---------------------------------------------------------------------------------------------
-- T1.2b-fix (docs/revisiones/fase-1-t1-2b-codex.md)
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('f');
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''student'')', pg_temp.id('i_f'), pg_temp.id(u)))
  from unnest(array['stu_r1', 'stu_r2']) as u;
insert into ids (k, id) select 'sf1', (pg_temp.new_student('teach', 'g_f', 'Lola', 'lola.f') ->> 'id')::uuid;
insert into ids (k, id) select 'sf2', (pg_temp.new_student('other', 'go_f', 'Mati', 'mati.f') ->> 'id')::uuid;
insert into ids (k, id) select 'sf3', (pg_temp.new_student('teach', 'g_f', 'Nico', 'nico.f') ->> 'id')::uuid;
do $$ begin
  perform pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('sf1'), pg_temp.id('stu_r1')));
  perform pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('sf2'), pg_temp.id('stu_r2')));
end $$;

-- W2-1: the identity of an op_key is the original group and username, not what the student is now.
insert into ids (k, id) values ('opf', gen_random_uuid());
insert into ids (k, id) select 'sf4', (pg_temp.new_student('teach', 'g_f', 'Olga', 'olga.f', pg_temp.id('opf')) ->> 'id')::uuid;
select is((select ap.op_identity ~ '^[0-9a-f]{64}$' from app.account_provisioning ap where ap.student_id = pg_temp.id('sf4')), true,
  'the creation stores the identity of the call (a sha256, not the username)');
do $$ begin
  perform pg_temp.as_user('admin', format('select api.enroll_student(%L, %L)', pg_temp.id('go_f'), pg_temp.id('sf4')));
end $$;
select is(pg_temp.new_student('other', 'go_f', 'Olga', 'olga.f', pg_temp.id('opf')) ->> 'error', 'P0001 CONFLICT op_key_reused',
  'created in G1, enrolled in G2: reusing the op_key in G2 is CONFLICT op_key_reused');
select is((select count(*) from app.students where institution_id = pg_temp.id('i_f') and username = 'olga.f'), 1::bigint, 'and creates nothing');
select is(pg_temp.upd('teach', 1, 'Olga P.', 'olga.nueva', 'sf4') ->> 'revision', '2', 'the teacher renames the student afterwards');
select is(pg_temp.new_student('teach', 'g_f', 'Olga', 'olga.f', pg_temp.id('opf')),
  jsonb_build_object('id', pg_temp.id('sf4'), 'revision', 1,
                     'provisioningId', (select ap.id from app.account_provisioning ap where ap.student_id = pg_temp.id('sf4'))),
  'after the rename, the exact original request answers the original result');
select is(pg_temp.new_student('teach', 'g_f', 'Olga', 'olga.nueva', pg_temp.id('opf')) ->> 'error', 'P0001 CONFLICT op_key_reused',
  'and the current username is not the identity of the operation');
do $$ begin
  perform pg_temp.as_user('teach', format('select api.unenroll_student(%L, %L)', pg_temp.id('g_f'), pg_temp.id('sf4')));
end $$;
select is(pg_temp.new_student('admin', 'g_f', 'Olga', 'olga.f', pg_temp.id('opf')) ->> 'id', pg_temp.id('sf4')::text,
  'nor is the enrollment: the original request answers the same after the student left the group');
-- The erasure forgets the identity (T1.F10: outside the erasure of its institution the guard refuses it); then the mode is closed.
insert into ids (k, id) values ('era_f', gen_random_uuid());
insert into app.erasures (id, institution_id, kind) values (pg_temp.id('era_f'), pg_temp.id('i_f'), 'institution');
select app.begin_erasure(pg_temp.id('era_f'));
update app.account_provisioning set op_identity = null where student_id = pg_temp.id('sf4');
select set_config('tiza.erasure', '', true);
select is(pg_temp.new_student('admin', 'g_f', 'Olga', 'olga.f', pg_temp.id('opf')) ->> 'error', 'P0001 CONFLICT op_key_reused',
  'a row with no stored identity is never answered by guesswork');

-- W2-2: a sandbox remembers the operation too, without provisioning anything.
update app.institutions set expires_at = now() + interval '1 day' where id = pg_temp.id('i_s');
insert into ids (k, id) values ('ops', gen_random_uuid());
insert into ids (k, id) select 'ss3', (pg_temp.new_student('visitor', 'g_s', 'Demo Cuatro', 'demo.cuatro', pg_temp.id('ops')) ->> 'id')::uuid;
select is((select ap.status from app.account_provisioning ap where ap.institution_id = pg_temp.id('i_s') and ap.op_key = pg_temp.id('ops')),
  'not_applicable', 'the sandbox creation stores its op_key');
select is(pg_temp.new_student('visitor', 'g_s', 'Demo Cuatro', 'demo.cuatro', pg_temp.id('ops')),
  jsonb_build_object('id', pg_temp.id('ss3'), 'revision', 1, 'provisioningId', null),
  'repeating it exactly in a sandbox answers the same, not username_taken');
select is(pg_temp.new_student('visitor', 'g_s', 'Otro', 'demo.otro', pg_temp.id('ops')) ->> 'error', 'P0001 CONFLICT op_key_reused',
  'the same op_key with another username in a sandbox is CONFLICT op_key_reused');
select is((select count(*) from app.students where institution_id = pg_temp.id('i_s') and username in ('demo.cuatro', 'demo.otro')), 1::bigint,
  'and no second student is created');
select is(pg_temp.link('ss3', 'stu_r3') ->> 'id', pg_temp.id('ss3')::text, 'a sandbox student can be linked to an account');
select is((select ap.status || ':' || coalesce(ap.auth_user_id::text, 'none') from app.account_provisioning ap where ap.student_id = pg_temp.id('ss3')),
  'not_applicable:' || pg_temp.id('stu_r3')::text, 'and its row stays not_applicable, remembering the account it was linked to (T1.F11)');

-- W2-6: nulls are INVALID, never a silent success.
select is(pg_temp.as_user('teach', format('select api.create_student(%L, null, ''nulo.f'', gen_random_uuid())', pg_temp.id('g_f'))) ->> 'error',
  'P0001 INVALID invalid_name', 'create_student with a null name is INVALID');
select is(pg_temp.as_user('teach', format('select api.create_student(%L, ''Nulo'', null, gen_random_uuid())', pg_temp.id('g_f'))) ->> 'error',
  'P0001 INVALID invalid_username', 'with a null username is INVALID');
select is(pg_temp.as_user('teach', format('select api.create_student(%L, ''Nulo'', ''nulo.f'', null)', pg_temp.id('g_f'))) ->> 'error',
  'P0001 INVALID invalid_op_key', 'with a null op_key is INVALID');
select is((select count(*) from app.students where institution_id = pg_temp.id('i_f') and username = 'nulo.f'), 0::bigint, 'and none of them creates a student');
select is(pg_temp.as_user('teach', format('select api.update_student(%L, 1, null, ''lola.f'')', pg_temp.id('sf1'))) ->> 'error',
  'P0001 INVALID invalid_name', 'update_student with a null name is INVALID');
select is(pg_temp.as_user('teach', format('select api.update_student(%L, 1, ''Lola'', null)', pg_temp.id('sf1'))) ->> 'error',
  'P0001 INVALID invalid_username', 'with a null username is INVALID');
select is(pg_temp.as_user('teach', format('select api.update_student(%L, null, ''Lola'', ''lola.f'')', pg_temp.id('sf1'))) ->> 'error',
  'P0001 INVALID revision_required', 'with a null revision is INVALID');
select is((select revision from app.students where id = pg_temp.id('sf1')), 1, 'and the student did not change');

-- W2-4: the account lock is by account alone, and a second student cannot take an account in use,
-- inside the institution or in another one.
select pg_temp.mk('g');
insert into ids (k, id) select 'sg1', (pg_temp.new_student('teach', 'g_g', 'Pablo', 'pablo.g') ->> 'id')::uuid;
select is(pg_temp.link('sg1', 'stu_r1') ->> 'error', 'P0001 CONFLICT op_key_reused',
  'an account already tied to a student of another institution is CONFLICT op_key_reused (never a raw 23505)');
select is(pg_temp.link('sf3', 'stu_r1') ->> 'error', 'P0001 CONFLICT op_key_reused', 'and so is one tied to a student of the same institution');
select is((select s.user_id from app.students s where s.id in (pg_temp.id('sg1'), pg_temp.id('sf3')) and s.user_id is not null limit 1), null,
  'and neither student got the account');
select is(pg_temp.link('sf3', 'teach') ->> 'error', 'P0001 CONFLICT role_conflict',
  'a staff account is CONFLICT role_conflict (the T1.2a trigger), the only way left to refuse it');

-- Locks. pgTAP runs in one session: the races cannot be staged here, so the test checks that each
-- RPC takes, before touching rows, the advisory lock every competing RPC takes (as in 010). The
-- keys are those of fresh pairs, so nothing taken earlier in this transaction can fake a pass.
create function pg_temp.holds(p_key text) returns boolean language sql as $$
  select exists (
    select 1 from pg_locks l
     where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
       and l.classid = ((k.k >> 32) & 4294967295)::oid and l.objid = (k.k & 4294967295)::oid
  ) from (select hashtextextended(p_key, 0) as k) k
$$;
create function pg_temp.enr_key(p_group text, p_student text) returns text language sql as $$
  select 'tiza.enrollment:' || pg_temp.id(p_group)::text || ':' || pg_temp.id(p_student)::text $$;
-- sf5 is a student with no account, made only for this lock check: sf2 must stay out of g_f, because
-- the matrix below needs a student of the institution who is NOT in the group (NOT_FOUND for them).
insert into ids (k, id) select 'sf5', (pg_temp.new_student('other', 'go_f', 'Rita', 'rita.f') ->> 'id')::uuid;
select ok(not pg_temp.holds(pg_temp.enr_key('g_f', 'sf5')), 'nothing holds the enrollment lock of a fresh pair');
select is(pg_temp.enr('teach', 'g_f', 'sf5') ->> 'error', null, 'enroll_student enrolls');
select ok(pg_temp.holds(pg_temp.enr_key('g_f', 'sf5')), 'and takes the (group, student) lock');
select ok(not pg_temp.holds(pg_temp.enr_key('go_f', 'sf3')), 'nothing holds the lock of the pair that will leave');
select is(pg_temp.enr('admin', 'go_f', 'sf3') ->> 'error', null, 'enrolling in the other group');
select is(pg_temp.enr('admin', 'go_f', 'sf3', 'unenroll_student') ->> 'error', null, 'and unenrolling');
select ok(pg_temp.holds(pg_temp.enr_key('go_f', 'sf3')), 'both take the same lock for the pair: they cannot interleave');
insert into ids (k, id) values ('opl', gen_random_uuid());
select ok(not pg_temp.holds('tiza.create_student:' || pg_temp.id('i_f')::text || ':' || pg_temp.id('opl')::text), 'nothing holds the lock of a fresh op_key');
select is(pg_temp.new_student('teach', 'g_f', 'Quique', 'quique.f', pg_temp.id('opl')) ->> 'error', null, 'create_student creates');
select ok(pg_temp.holds('tiza.create_student:' || pg_temp.id('i_f')::text || ':' || pg_temp.id('opl')::text),
  'and takes the (institution, op_key) lock, before looking the key up');
select ok(not pg_temp.holds('tiza.student_account:' || pg_temp.id('stu_r4')::text), 'nothing holds the lock of an account nobody linked');
select is(pg_temp.link('sf3', 'stu_r4') ->> 'id', pg_temp.id('sf3')::text, 'internal_link_student_user links it');
select ok(pg_temp.holds('tiza.student_account:' || pg_temp.id('stu_r4')::text),
  'and takes the lock of the account alone (not of the institution), so it also serializes across institutions');

-- W2-5: the permission matrix by RPC. Each role that must be denied, with code and reason, and the
-- proof that nothing changed (a digest of the institution before and after).
create function pg_temp.digest(p_inst text) returns text language sql as $$
  select md5(coalesce((select string_agg(concat_ws('|', s.id, s.revision, s.display_name, s.username, s.archived_at, s.user_id), ';' order by s.id)
                         from app.students s where s.institution_id = pg_temp.id(p_inst)), '')
          || coalesce((select string_agg(concat_ws('|', e.id, e.revision, e.group_id, e.student_id, e.ended_at), ';' order by e.id)
                         from app.enrollments e where e.institution_id = pg_temp.id(p_inst)), '')
          || coalesce((select string_agg(concat_ws('|', a.id, a.revision, a.status), ';' order by a.id)
                         from app.account_provisioning a where a.institution_id = pg_temp.id(p_inst)), ''))
$$;
-- Calls p_sql (with %L for the user's own student left to the caller) as each denied role.
create function pg_temp.denied(p_sql text) returns text language plpgsql as $$
declare
  v_before text := pg_temp.digest('i_f');
  v_out text;
begin
  select string_agg(r.k || '=' || coalesce(pg_temp.as_user(r.k, p_sql) ->> 'error', 'ALLOWED'), ';' order by r.n) into v_out
    from (values (1, 'incl'), (2, 'stu_r1'), (3, 'stu_r2'), (4, 'other'), (5, 'userb'), (6, 'nobody')) as r(n, k);
  return v_out || ' changed=' || (v_before <> pg_temp.digest('i_f'))::text;
end
$$;
create function pg_temp.expect(p_incl text, p_stu text, p_stu2 text) returns text language sql as $$
  select 'incl=P0001 ' || p_incl || ';stu_r1=P0001 ' || p_stu || ';stu_r2=P0001 ' || p_stu2
         || ';other=P0001 NOT_FOUND not_found;userb=P0001 NOT_FOUND not_found;nobody=P0001 NOT_FOUND not_found changed=false'
$$;
-- sf1 is in g_f (stu_r1 is sf1); sf2 is in go_f only and never in g_f (stu_r2 is sf2); 'other' teaches go_f, not g_f.
-- A student enrolled in the group gets FORBIDDEN from its RPCs (they see the group). A student of the institution who is not
-- in the group (stu_r2) gets NOT_FOUND: the group's existence is not revealed. Another student's record is NOT_FOUND for both.
select is(pg_temp.denied(format('select api.create_student(%L, ''Zeta'', ''zeta.f'', gen_random_uuid())', pg_temp.id('g_f'))),
  pg_temp.expect('FORBIDDEN forbidden', 'FORBIDDEN forbidden', 'NOT_FOUND not_found'), 'create_student: every denied role gets its code and nothing changes');
select is(pg_temp.denied(format('select api.update_student(%L, 1, ''Z'', ''zeta.f'')', pg_temp.id('sf1'))),
  pg_temp.expect('FORBIDDEN forbidden', 'FORBIDDEN forbidden', 'NOT_FOUND not_found'), 'update_student: same');
select is(pg_temp.denied(format('select api.archive_student(%L, 1)', pg_temp.id('sf1'))),
  pg_temp.expect('FORBIDDEN forbidden', 'FORBIDDEN forbidden', 'NOT_FOUND not_found'), 'archive_student: same');
select is(pg_temp.denied(format('select api.restore_student(%L, 1)', pg_temp.id('sf1'))),
  pg_temp.expect('FORBIDDEN forbidden', 'FORBIDDEN forbidden', 'NOT_FOUND not_found'), 'restore_student: same');
select is(pg_temp.denied(format('select api.enroll_student(%L, %L)', pg_temp.id('g_f'), pg_temp.id('sf2'))),
  pg_temp.expect('FORBIDDEN forbidden', 'FORBIDDEN forbidden', 'NOT_FOUND not_found'), 'enroll_student: same');
select is(pg_temp.denied(format('select api.unenroll_student(%L, %L)', pg_temp.id('g_f'), pg_temp.id('sf1'))),
  pg_temp.expect('FORBIDDEN forbidden', 'FORBIDDEN forbidden', 'NOT_FOUND not_found'), 'unenroll_student: same');

select * from finish();
rollback;
