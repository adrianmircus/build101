-- T1.5d: what student_task answers at each moment, cell by cell. The table is the one of lib/domain/delivery/attempt-rules.ts
-- (and «Qué se puede hacer con cada intento» in docs/PLATAFORMA.md): the situations are no dates, in date, before publish_at,
-- after due_at, publication withdrawn, assignment withdrawn and attempt superseded; the statuses are opened, started and
-- submitted. Each cell runs in its own subtransaction that is rolled back, on the same attempt, so no cell sees what another
-- did. The moments are set with clock_timestamp() (the RPC compares against the moment of the call). A cell is "ok" with its
-- readOnly and late, or the refusal. Also: a submission of a replaced attempt is shown (T1.5b left it for this ticket), and
-- the list hides what the task hides. Placeholder text only. The whole file is rolled back.
begin;
-- Phase 1 links ordinary accounts (any email) to students; the shape guard of phase 2 (T2.5a) is off in this file. 040_f2_contract covers it.
alter table app.account_provisioning disable trigger student_auth_link_guard;
select plan(13);

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
create function pg_temp.err(p_res jsonb) returns text language sql
  as $$ select nullif(btrim(regexp_replace(p_res ->> 'error', '^P0001 ', '')), '') $$;

insert into ids (k, id) select k, gen_random_uuid() from unnest(array['teach', 'stu_a', 'stu_b']) as k;
insert into auth.users (id, email) select id, k || '@t1-5d-b.invalid' from ids;
do $$
declare
  k text;
begin
  for k in select ids.k from ids loop
    perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;

-- Institution n: the teacher teach (group g_n) and the students s1 (stu_a) and s2 (stu_b). Placeholder names only.
insert into ids (k, id) select 'i_n', (pg_temp.as_service($$ select api.internal_create_institution('Liceo N', 't1-5d-b', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_n'), pg_temp.id('teach')));
insert into ids (k, id) values
  ('g_n', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid);
insert into ids (k, id)
  select 's' || n, (pg_temp.as_user('teach', format('select api.create_student(%L, %L, %L, gen_random_uuid())', pg_temp.id('g_n'), 'Estudiante ' || n, 'est.' || n)) ->> 'id')::uuid
    from generate_series(1, 2) n;
select pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id(l.s), pg_temp.id(l.u)))
  from (values ('s1', 'stu_a'), ('s2', 'stu_b')) as l(s, u);

-- A typed version of one exercise for s1 and s2, published through the RPCs.
select pg_temp.keep('a_vt', pg_temp.as_user('teach', format('select api.create_assessment(%L, ''worksheet'', ''Repaso'', ''Instrucciones'', gen_random_uuid())', pg_temp.id('g_n'))));
select pg_temp.keep('e_vt1', pg_temp.as_user('teach', format('select api.add_exercise(%L, ''1'', ''Enunciado 1'', gen_random_uuid(), null)', pg_temp.id('a_vt'))));
select pg_temp.keep('vt', pg_temp.as_user('teach', format($q$ select api.create_version(%L, '{"profiles":["motor"],"supports":[],"interests":[]}'::jsonb, 'typed', gen_random_uuid(), null) $q$, pg_temp.id('a_vt'))));
insert into ids (k, id) select 'x_vt1', ve.id from app.version_exercises ve where ve.version_id = pg_temp.id('vt');
select pg_temp.as_user('teach', format('select api.update_version_exercise(%L, %s, ''Adaptado 1'', gen_random_uuid())', pg_temp.id('x_vt1'),
  (select revision from app.version_exercises where id = pg_temp.id('x_vt1'))));
select pg_temp.as_user('teach', format('select api.set_version_recipients(%L, %s, array[%L, %L]::uuid[], gen_random_uuid())', pg_temp.id('vt'),
  (select revision from app.versions where id = pg_temp.id('vt')), pg_temp.id('s1'), pg_temp.id('s2')));
select pg_temp.as_user('teach', format('select api.approve_version(%L, %s, gen_random_uuid())', pg_temp.id('vt'), (select revision from app.versions where id = pg_temp.id('vt'))));
insert into ids (k, id) select 'p_vt', (pg_temp.as_user('teach', format('select api.publish_version(%L, %s, gen_random_uuid(), null)', pg_temp.id('vt'),
  (select revision from app.versions where id = pg_temp.id('vt')))) ->> 'publicationId')::uuid;
insert into ids (k, id)
  select 't_' || x.s || '_vt', t.id from app.assignment_attempts t join app.assignments a on a.id = t.assignment_id
    join (values ('s1'), ('s2')) as x(s) on a.student_id = pg_temp.id(x.s) where t.superseded_at is null;
insert into ids (k, id)
  select 'as_' || x.s || '_vt', a.id from app.assignments a join (values ('s1'), ('s2')) as x(s) on a.student_id = pg_temp.id(x.s);

create function pg_temp.digest() returns text language sql as $$
  select md5(coalesce((select string_agg(a::text, ';' order by a.id) from app.assignments a where a.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(t::text, ';' order by t.id) from app.assignment_attempts t where t.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(s::text, ';' order by s.id) from app.submissions s where s.institution_id = pg_temp.id('i_n')), ''))
$$;

-- The attempt of s1 in the status and the situation of the cell, written as the owner (inside the subtransaction of the cell).
create function pg_temp.setup(p_situation text, p_status text) returns void language plpgsql as $$
declare
  v_t uuid := pg_temp.id('t_s1_vt');
  v_a uuid := pg_temp.id('as_s1_vt');
begin
  if p_status in ('started', 'submitted') then
    update app.assignment_attempts set status = 'started', started_at = clock_timestamp(), first_viewed_at = clock_timestamp(), revision = revision + 1 where id = v_t;
    insert into app.submissions (institution_id, attempt_id) select t.institution_id, t.id from app.assignment_attempts t where t.id = v_t;
    update app.assignments set status = 'in_progress' where id = v_a;
  end if;
  if p_status = 'submitted' then
    update app.submissions set submitted_at = clock_timestamp() where attempt_id = v_t;
    update app.assignment_attempts set status = 'submitted', submitted_at = clock_timestamp(), late = (p_situation = 'after due_at'), revision = revision + 1 where id = v_t;
    update app.assignments set status = 'submitted' where id = v_a;
  end if;
  if p_situation in ('in date', 'withdrawn', 'superseded', 'assignment withdrawn') then
    update app.assessments set publish_at = clock_timestamp() - interval '2 hours', due_at = clock_timestamp() + interval '1 hour' where id = pg_temp.id('a_vt');
  elsif p_situation = 'before publish_at' then
    update app.assessments set publish_at = clock_timestamp() + interval '1 hour', due_at = clock_timestamp() + interval '2 hours' where id = pg_temp.id('a_vt');
  elsif p_situation = 'after due_at' then
    update app.assessments set publish_at = clock_timestamp() - interval '2 hours', due_at = clock_timestamp() - interval '1 hour' where id = pg_temp.id('a_vt');
  end if;
  if p_situation = 'withdrawn' then
    update app.publications set withdrawn_at = clock_timestamp() where id = pg_temp.id('p_vt');
  elsif p_situation = 'superseded' then
    update app.assignment_attempts set superseded_at = clock_timestamp() where id = v_t;
  elsif p_situation = 'assignment withdrawn' then
    update app.assignments set status = 'withdrawn' where id = v_a;
  end if;
end $$;

-- One cell: what student_task gives s1 ("ok ro=<readOnly> late=<late>", or "CODE reason"), and that it wrote nothing.
create function pg_temp.cell(p_situation text, p_status text) returns text language plpgsql as $$
declare
  v_before text;
  v_res jsonb;
  v_out text;
begin
  begin
    perform pg_temp.setup(p_situation, p_status);
    v_before := pg_temp.digest();
    v_res := pg_temp.as_user('stu_a', format('select api.student_task(%L)', pg_temp.id('t_s1_vt')));
    v_out := case when v_res ? 'error' then pg_temp.err(v_res)
                  else 'ok ro=' || (v_res ->> 'readOnly') || ' late=' || (v_res ->> 'late') end;
    if v_before <> pg_temp.digest() then v_out := v_out || ' CHANGED'; end if;
    raise exception using errcode = 'P0099', message = 'rollback of the cell';
  exception when sqlstate 'P0099' then
    return v_out;
  end;
end $$;
-- opened | started | submitted
create function pg_temp.cells(p_situation text) returns text language sql as $$
  select pg_temp.cell(p_situation, 'opened') || ' | ' || pg_temp.cell(p_situation, 'started') || ' | ' || pg_temp.cell(p_situation, 'submitted') $$;

-- Publication open (or no dates at all): a task in progress is read to be solved; a submitted one is read only.
select is(pg_temp.cells('no dates'), 'ok ro=false late=false | ok ro=false late=false | ok ro=true late=false', 'no dates: opened and started are read to solve, submitted is read only');
select is(pg_temp.cells('in date'), 'ok ro=false late=false | ok ro=false late=false | ok ro=true late=false', 'in date: the same');
-- After the due date nothing closes: it is shown, and late says that submitting now would be late (or that it was).
select is(pg_temp.cells('after due_at'), 'ok ro=false late=true | ok ro=false late=true | ok ro=true late=true', 'after due_at: still shown, late is true, and a submission keeps the late it was marked with');
-- Before publish_at nothing opens, not even to read.
select is(pg_temp.cells('before publish_at'), 'CONFLICT not_published | CONFLICT not_published | CONFLICT not_published', 'before publish_at: CONFLICT not_published, whatever the status');
-- A withdrawn publication or assignment, and a replaced attempt: only what was submitted, read only; the rest is NOT_FOUND.
select is(pg_temp.cells('withdrawn'), 'NOT_FOUND not_found | NOT_FOUND not_found | ok ro=true late=false', 'publication withdrawn: only what was submitted, read only');
select is(pg_temp.cells('assignment withdrawn'), 'NOT_FOUND not_found | NOT_FOUND not_found | ok ro=true late=false', 'assignment withdrawn: the same');
select is(pg_temp.cells('superseded'), 'NOT_FOUND not_found | NOT_FOUND not_found | ok ro=true late=false', 'attempt replaced: the same (student_open_attempt does not find it; this does)');

-- The list shows what the task shows: before publish_at it is listed (with its dates), a withdrawn task that was not submitted is not.
create function pg_temp.listed(p_situation text, p_status text) returns text language plpgsql as $$
declare
  v_out text;
begin
  begin
    perform pg_temp.setup(p_situation, p_status);
    v_out := coalesce((select string_agg((x ->> 'status') || '/' || (x ->> 'late'), ',') from jsonb_array_elements(pg_temp.as_user('stu_a', 'select api.student_task_list()') -> 'tasks') x), 'none');
    raise exception using errcode = 'P0099', message = 'rollback of the cell';
  exception when sqlstate 'P0099' then
    return v_out;
  end;
end $$;
select is(pg_temp.listed('before publish_at', 'opened') || ' | ' || pg_temp.listed('after due_at', 'started') || ' | ' || pg_temp.listed('after due_at', 'submitted'),
  'not_started/false | in_progress/true | submitted/true', 'the list: not yet published is listed as not started; overdue says late; a submission keeps its own late');
select is(pg_temp.listed('withdrawn', 'opened') || ' | ' || pg_temp.listed('assignment withdrawn', 'started') || ' | ' || pg_temp.listed('superseded', 'opened'),
  'none | none | none', 'the list: a withdrawn or replaced task that was not submitted is not listed');
select is(pg_temp.listed('withdrawn', 'submitted') || ' | ' || pg_temp.listed('assignment withdrawn', 'submitted'),
  'submitted/false | submitted/false', 'the list: what was submitted stays listed after the publication or the assignment is withdrawn');

-- A replaced attempt shows what the student handed in (what T1.5b left for this ticket): the answers, read only.
select pg_temp.as_user('stu_b', format('select api.student_start_attempt(%L)', pg_temp.id('t_s2_vt')));
select pg_temp.as_user('stu_b', format('select api.student_save_draft(%L, 1, %L::jsonb, ''{}''::jsonb)', pg_temp.id('t_s2_vt'),
  jsonb_build_object(pg_temp.id('x_vt1')::text, jsonb_build_object('text', 'lo que entregué', 'mode', 'typed'))::text));
select pg_temp.as_user('stu_b', format('select api.student_submit_attempt(%L, 2)', pg_temp.id('t_s2_vt')));
update app.assignment_attempts set superseded_at = clock_timestamp() where id = pg_temp.id('t_s2_vt');
select is(pg_temp.as_user('stu_b', format('select api.student_task(%L)', pg_temp.id('t_s2_vt'))) #>> '{draft,answers}',
  jsonb_build_object(pg_temp.id('x_vt1')::text, jsonb_build_object('text', 'lo que entregué', 'mode', 'typed'))::text, 'a replaced attempt shows the answers the student handed in');
select is((pg_temp.as_user('stu_b', format('select api.student_task(%L)', pg_temp.id('t_s2_vt'))) ->> 'readOnly') || '|' || (pg_temp.as_user('stu_b', format('select api.student_task(%L)', pg_temp.id('t_s2_vt'))) #>> '{draft,revision}'),
  'true|2', 'read only, with the revision of the frozen draft');
select is(pg_temp.err(pg_temp.as_user('stu_a', format('select api.student_task(%L)', pg_temp.id('t_s2_vt')))), 'NOT_FOUND not_found', 'and no one else can read it');
select * from finish();
rollback;
