-- T1.3a: reconstruction. A teacher of the group calls every staff RPC that is not an audited read
-- and none of the answers may carry a profile, a support, an interest, a review date, the interface
-- of a student, the configuration of a version or its recipients: those come out only through the
-- audited reads. The students are seeded with real needs through set_student_needs first, so
-- there is something to leak. Every later ticket that adds a non-audited staff read adds its call
-- here (the last test fails until it does). The student_* reads are not here: a teacher cannot call
-- them, and 023_student_dto and the leak test cover them.
begin;
select plan(18);

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

insert into ids (k, id) select k, gen_random_uuid() from unnest(array['admin', 'teach', 'other', 'incl']) as k;
insert into auth.users (id, email) select id, k || '@t1-3a-rec.invalid' from ids;
do $$
declare
  k text;
begin
  for k in select ids.k from ids loop
    perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;

-- Institution with admin, two teachers and inclusion; group g (teach) and go (other).
insert into ids (k, id) select 'inst', (pg_temp.as_service(
  $$ select api.internal_create_institution('Liceo R', 't1-3a-rec', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, %L)', pg_temp.id('inst'), pg_temp.id(u.k), u.role))
  from (values ('admin', 'admin'), ('teach', 'teacher'), ('other', 'teacher'), ('incl', 'inclusion')) as u(k, role);
insert into ids (k, id) values
  ('g', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026)', pg_temp.id('inst'))) ->> 'id')::uuid),
  ('go', (pg_temp.as_user('other', format('select api.create_group(%L, ''3.º B'', ''math'', 2026)', pg_temp.id('inst'))) ->> 'id')::uuid);
-- Three students in g, one in go.
insert into ids (k, id)
  select 's' || n, (pg_temp.as_user('teach', format('select api.create_student(%L, %L, %L, gen_random_uuid())',
           pg_temp.id('g'), 'Estudiante ' || n, 'est.' || n)) ->> 'id')::uuid
    from generate_series(1, 3) n;
insert into ids (k, id) values
  ('s4', (pg_temp.as_user('other', format('select api.create_student(%L, ''Estudiante 4'', ''est.4'', gen_random_uuid())', pg_temp.id('go'))) ->> 'id')::uuid);

-- Seed real needs, with interests nobody would write by accident.
select is((pg_temp.as_user('teach', format($$ select api.set_student_needs(%L, '{motor,adhd}', '{preguntas_guia,recordatorio}', '{centinela-ajedrez}', gen_random_uuid(), null, '2027-05-01') $$, pg_temp.id('s1'))) ->> 'revision'), '1',
  'the first student gets a motor and adhd profile, supports, an interest and a review date');
select is((pg_temp.as_user('teach', format($$ select api.set_student_needs(%L, '{dysgraphia}', '{ejemplo_resuelto}', '{centinela-dibujo}', gen_random_uuid(), null, null) $$, pg_temp.id('s2'))) ->> 'revision'), '1',
  'the second one a dysgraphia profile');
select is((pg_temp.as_user('teach', format($$ select api.set_student_needs(%L, '{dyslexia,asd}', '{numeros_simples}', '{centinela-musica}', gen_random_uuid(), null, null) $$, pg_temp.id('s3'))) ->> 'revision'), '1',
  'the third one dyslexia and asd');
select is((select string_agg(s.interface, ',' order by s.username) from app.students s where s.institution_id = pg_temp.id('inst') and s.username in ('est.1', 'est.2', 'est.3')),
  'gaze,voice,standard', 'so their interface is not the default one: it would show if a projection returned it');

-- The detector: the keys and the values that must never appear in a non-audited answer.
create function pg_temp.leaks(p_res jsonb) returns text language sql as $$
  select concat_ws(',',
    case when p_res::text ~ '"(profiles|supports|interests|reviewDueOn|interface|config|answerMode|recipients|recipientIds|studentIds|needs)"\s*:' then 'key' end,
    case when lower(p_res::text) ~ '\m(adhd|asd|dysgraphia|dyslexia|motor|preguntas_guia|recordatorio|ejemplo_resuelto|numeros_simples|gaze|voice|standard)\M' then 'catalogue' end,
    case when p_res::text ilike '%centinela%' then 'interest' end,
    case when p_res::text like '%2027-05-01%' then 'date' end)
$$;
-- A control: the detector does flag the audited read of the same data, so a green result below is not a blind detector.
select is(pg_temp.leaks(pg_temp.as_user('teach', format('select api.get_student_needs(array[%L, %L, %L]::uuid[])',
    pg_temp.id('s1'), pg_temp.id('s2'), pg_temp.id('s3')))), 'key,catalogue,interest,date', 'control: the detector flags the audited read of the seeded needs');
select is(pg_temp.leaks('{"id": "x", "name": "ok"}'::jsonb), '', 'and flags nothing in a harmless answer');

-- Every non-audited staff RPC the database has today, called as the teacher of the group.
create temp table answers (name text primary key, res jsonb not null);
create function pg_temp.call(p_name text, p_sql text) returns void language plpgsql as $$
begin
  insert into answers (name, res) values (p_name, pg_temp.as_user('teach', p_sql));
end
$$;
select pg_temp.call('list_my_institutions', 'select api.list_my_institutions()');
select pg_temp.call('create_group', format('select api.create_group(%L, ''Taller'', ''math'', 2026)', pg_temp.id('inst')));
insert into ids (k, id) select 'gx', (res ->> 'id')::uuid from answers where name = 'create_group';
select pg_temp.call('update_group', format('select api.update_group(%L, 1, ''Taller 2'', 2026)', pg_temp.id('gx')));
select pg_temp.call('archive_group', format('select api.archive_group(%L, 2)', pg_temp.id('gx')));
select pg_temp.call('restore_group', format('select api.restore_group(%L, 3)', pg_temp.id('gx')));
select pg_temp.call('add_group_staff', format('select api.add_group_staff(%L, %L, ''co_teacher'')', pg_temp.id('g'), pg_temp.id('other')));
select pg_temp.call('remove_group_staff', format('select api.remove_group_staff(%L, %L)', pg_temp.id('g'), pg_temp.id('other')));
select pg_temp.call('create_student', format('select api.create_student(%L, ''Estudiante 5'', ''est.5'', gen_random_uuid())', pg_temp.id('g')));
insert into ids (k, id) select 's5', (res ->> 'id')::uuid from answers where name = 'create_student';
select pg_temp.call('update_student', format('select api.update_student(%L, 1, ''Estudiante Cinco'', ''est.5'')', pg_temp.id('s5')));
select pg_temp.call('archive_student', format('select api.archive_student(%L, 2)', pg_temp.id('s5')));
select pg_temp.call('restore_student', format('select api.restore_student(%L, 3)', pg_temp.id('s5')));
select pg_temp.call('enroll_student', format('select api.enroll_student(%L, %L)', pg_temp.id('gx'), pg_temp.id('s1')));
select pg_temp.call('unenroll_student', format('select api.unenroll_student(%L, %L)', pg_temp.id('gx'), pg_temp.id('s1')));
select pg_temp.call('list_my_groups', format('select api.list_my_groups(%L, true, 50, 0)', pg_temp.id('inst')));
select pg_temp.call('get_group', format('select api.get_group(%L)', pg_temp.id('g')));
select pg_temp.call('list_group_students', format('select api.list_group_students(%L, true, 50, 0)', pg_temp.id('g')));
-- set_student_needs is a write: what it answers is only the student and the revision.
select pg_temp.call('set_student_needs', format($$ select api.set_student_needs(%L, '{motor}', '{recordatorio}', '{centinela-otro}', gen_random_uuid(), 1, null) $$, pg_temp.id('s1')));

select is((select count(*) from answers where res ? 'error'), 0::bigint, 'every call worked: none answered an error (so each answer is a real one)');
select is((select string_agg(a.name, ',' order by a.name) from answers a where pg_temp.leaks(a.res) <> ''), null::text,
  'no answer carries a profile, a support, an interest, a review date or an interface');
select is((select count(*) from answers), 17::bigint, 'seventeen RPCs were called');
select is(jsonb_array_length((select res -> 'items' from answers where name = 'list_group_students')), 4,
  'and the roster answer did list the students that have needs (so there was something to leak)');
select is((select string_agg(k, ',' order by k) from (select jsonb_object_keys(res -> 'items' -> 0) k from answers where name = 'list_group_students') t),
  'archivedAt,displayName,enrolledAt,hasAccount,id,revision,username', 'a roster entry has exactly the keys of its schema');
select is((select string_agg(k, ',' order by k) from (select jsonb_object_keys(res) k from answers where name = 'get_group') t),
  'archivedAt,id,institutionId,myRole,name,revision,schoolYear,staff,subjectId', 'and so does the group');
select is((select string_agg(k, ',' order by k) from (select jsonb_object_keys(res -> 'items' -> 0) k from answers where name = 'list_my_groups') t),
  'archivedAt,id,myRole,name,revision,schoolYear,studentCount,subjectId', 'and the list of groups');
select is((select string_agg(k, ',' order by k) from (select jsonb_object_keys(res) k from answers where name = 'set_student_needs') t),
  'revision,studentId', 'set_student_needs answers only the student and the revision');

-- The projections that other staff roles read, with the same seeded data.
create temp table answers_other (name text, who text, res jsonb not null);
insert into answers_other (name, who, res)
  select r.name, r.who, pg_temp.as_user(r.who, format(r.sql, pg_temp.id('inst'), pg_temp.id('g')))
    from (values
      ('list_my_groups', 'admin', 'select api.list_my_groups(%1$L, true, 50, 0)'),
      ('list_my_groups', 'incl', 'select api.list_my_groups(%1$L, true, 50, 0)'),
      ('get_group', 'admin', 'select api.get_group(%2$L)'),
      ('get_group', 'incl', 'select api.get_group(%2$L)'),
      ('list_group_students', 'admin', 'select api.list_group_students(%2$L, true, 50, 0)'),
      ('list_group_students', 'incl', 'select api.list_group_students(%2$L, true, 50, 0)'),
      ('list_my_institutions', 'incl', 'select api.list_my_institutions()')
    ) as r(name, who, sql);
select is((select count(*) from answers_other where res ? 'error'), 0::bigint, 'the admin and inclusion read the same projections without an error');
select is((select string_agg(a.who || ':' || a.name, ',' order by a.who, a.name) from answers_other a where pg_temp.leaks(a.res) <> ''), null::text,
  'and none of their answers carries needs: not even inclusion, who may read them through the audited RPCs');

-- Nothing the calls above did wrote an audit row: only the audited reads do.
select is((select count(*) from app.audit_log a where a.institution_id = pg_temp.id('inst')), 1::bigint,
  'the only audit row is the control read of get_student_needs: the non-audited RPCs disclose nothing, so they log nothing');

-- Coverage: a new RPC that authenticated can execute must be called above or be an audited read.
select is((select string_agg(p.proname, ',' order by p.proname)
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'api' and has_function_privilege('authenticated', p.oid, 'execute')
              and p.proname not like 'student\_%'
              and p.proname not in (select a.name from answers a)
              and p.proname not in ('get_student_needs', 'get_group_needs', 'list_student_need_events')), null::text,
  'every RPC an authenticated user can run is either called here or one of the audited reads: add the call of the ticket that adds a new one');

select * from finish();
rollback;
