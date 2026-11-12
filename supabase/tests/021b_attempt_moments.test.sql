-- T1.5b: what can be done with an attempt at each moment, cell by cell against the four RPCs. The table is the one of
-- lib/domain/delivery/attempt-rules.ts (and «Qué se puede hacer con cada intento» in docs/PLATAFORMA.md): the situations
-- are no dates, in date, before publish_at, after due_at, publication withdrawn, assignment withdrawn and attempt
-- superseded; the statuses are opened, started and submitted; the operations are open, start, save and submit. Each cell
-- runs in its own subtransaction that is rolled back, on the same attempt, so no cell sees what another did. The moments
-- are set with clock_timestamp() (the RPCs compare against the moment of the call, not the start of the transaction).
-- Who may call and the protocol itself are in 021a. Placeholder text only. The whole file is rolled back.
begin;
select plan(26);

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
-- A refused call as "CODE reason" (what the front gets); null when it worked.
create function pg_temp.err(p_res jsonb) returns text language sql
  as $$ select nullif(btrim(regexp_replace(p_res ->> 'error', '^P0001 ', '')), '') $$;

insert into ids (k, id) select k, gen_random_uuid() from unnest(array[
  'admin', 'teach', 'incl', 'userb', 'nobody', 'ghost', 'stu_a', 'stu_b', 'stu_c', 'stu_x'
]) as k;
insert into auth.users (id, email) select id, k || '@t1-5b.invalid' from ids where k <> 'ghost';
do $$
declare
  k text;
begin
  for k in select ids.k from ids where ids.k <> 'ghost' loop
    perform pg_temp.as_service(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k));
  end loop;
end
$$;

-- Institution n: admin, the teacher teach (group g_n), inclusion. Students s1 (account stu_a), s2 (stu_b) and s3 (stu_c) in
-- g_n. Institution b: the teacher userb, with the group g_b and the student sx (account stu_x). Placeholder names only.
insert into ids (k, id) select 'i_n', (pg_temp.as_service($$ select api.internal_create_institution('Liceo N', 't1-5b', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, %L)', pg_temp.id('i_n'), pg_temp.id(u.k), u.role))
  from (values ('admin', 'admin'), ('teach', 'teacher'), ('incl', 'inclusion')) as u(k, role);
insert into ids (k, id) values
  ('g_n', (pg_temp.as_user('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_n'))) ->> 'id')::uuid);
insert into ids (k, id)
  select 's' || n, (pg_temp.as_user('teach', format('select api.create_student(%L, %L, %L, gen_random_uuid())', pg_temp.id('g_n'), 'Estudiante ' || n, 'est.' || n)) ->> 'id')::uuid
    from generate_series(1, 3) n;
select pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id(l.s), pg_temp.id(l.u)))
  from (values ('s1', 'stu_a'), ('s2', 'stu_b'), ('s3', 'stu_c')) as l(s, u);
insert into ids (k, id) select 'i_b', (pg_temp.as_service($$ select api.internal_create_institution('Liceo B', 't1-5b-b', 'school') $$) ->> 'id')::uuid;
select pg_temp.as_service(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('i_b'), pg_temp.id('userb')));
insert into ids (k, id) values
  ('g_b', (pg_temp.as_user('userb', format('select api.create_group(%L, ''1.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('i_b'))) ->> 'id')::uuid);
insert into ids (k, id) values
  ('sx', (pg_temp.as_user('userb', format('select api.create_student(%L, ''Estudiante X'', ''est.x'', gen_random_uuid())', pg_temp.id('g_b'))) ->> 'id')::uuid);
select pg_temp.as_service(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('sx'), pg_temp.id('stu_x')));

-- Builders: everything goes through the RPCs, except the gaze questions (no RPC writes them yet).
create function pg_temp.mk_asm(p_key text, p_instr text) returns void language plpgsql as $$
begin
  perform pg_temp.keep(p_key, pg_temp.as_user('teach', format('select api.create_assessment(%L, ''worksheet'', ''Repaso'', %L, gen_random_uuid())', pg_temp.id('g_n'), p_instr)));
end $$;
create function pg_temp.mk_ex(p_asm text, p_key text, p_body text) returns void language plpgsql as $$
begin
  perform pg_temp.keep(p_key, pg_temp.as_user('teach', format('select api.add_exercise(%L, %L, %L, gen_random_uuid(), null)', pg_temp.id(p_asm), right(p_key, 1), p_body)));
end $$;
create function pg_temp.mkv(p text, p_n integer, p_mode text) returns void language plpgsql as $$
declare
  i integer;
begin
  perform pg_temp.mk_asm('a_' || p, 'Instrucciones');
  for i in 1..p_n loop
    perform pg_temp.mk_ex('a_' || p, 'e_' || p || i, 'Enunciado ' || i);
  end loop;
  perform pg_temp.keep(p, pg_temp.as_user('teach', format($q$ select api.create_version(%L, '{"profiles":["motor"],"supports":[],"interests":[]}'::jsonb, %L, gen_random_uuid(), null) $q$,
    pg_temp.id('a_' || p), p_mode)));
  insert into ids (k, id) select 'x_' || p || row_number() over (order by e.position), ve.id
    from app.version_exercises ve join app.assessment_exercises e on e.id = ve.exercise_id where ve.version_id = pg_temp.id(p);
  for i in 1..p_n loop
    perform pg_temp.as_user('teach', format('select api.update_version_exercise(%L, %s, %L, gen_random_uuid())', pg_temp.id('x_' || p || i),
      (select revision from app.version_exercises where id = pg_temp.id('x_' || p || i)), 'Adaptado ' || i));
  end loop;
end $$;
-- A question (options A, B, C) in each adapted exercise, with its correct option B.
create function pg_temp.gazeq(p text, p_n integer) returns void language plpgsql as $$
declare
  i integer;
begin
  for i in 1..p_n loop
    insert into ids (k, id) values ('q_' || p || i, gen_random_uuid());
    insert into app.version_questions (id, institution_id, version_id, version_exercise_id, position, stem, options)
      select pg_temp.id('q_' || p || i), ve.institution_id, ve.version_id, ve.id, 0, '¿Cuánto es 2 + 2?', '[{"id":"A","text":"3"},{"id":"B","text":"4"},{"id":"C","text":"5"}]'::jsonb
        from app.version_exercises ve where ve.id = pg_temp.id('x_' || p || i);
    perform pg_temp.as_user('teach', format('select api.set_question_key(%L, ''B'', null)', pg_temp.id('q_' || p || i)));
  end loop;
end $$;
create function pg_temp.rev(p_ver text) returns text language sql as $$ select v.revision::text from app.versions v where v.id = pg_temp.id(p_ver) $$;
create function pg_temp.kc(p_ver text) returns text language sql as $$
  select jsonb_build_object(
    'exercises', coalesce((select jsonb_object_agg(ve.id::text, jsonb_build_object('answer', 'Respuesta')) from app.version_exercises ve where ve.version_id = pg_temp.id(p_ver)), '{}'::jsonb),
    'questions', coalesce((select jsonb_object_agg(k.question_id::text, k.correct_option_id) from app.question_keys k where k.version_id = pg_temp.id(p_ver)), '{}'::jsonb))::text
$$;
create function pg_temp.cur(p_ver text) returns text language sql as $$
  select coalesce((select quote_literal(k.current_revision_id) from app.answer_keys k where k.version_id = pg_temp.id(p_ver)), 'null')
$$;
-- Publishes the version p: ready, with the recipients and approved (gaze: with its questions and key).
create function pg_temp.publish(p text, p_n integer, p_mode text, p_students text[]) returns jsonb language plpgsql as $$
declare
  v_res jsonb;
begin
  perform pg_temp.mkv(p, p_n, p_mode);
  if p_mode = 'gaze' then
    perform pg_temp.gazeq(p, p_n);
    v_res := pg_temp.as_user('teach', format('select api.edit_answer_key(%L, %L::jsonb, %s)', pg_temp.id(p), pg_temp.kc(p), pg_temp.cur(p)));
    if v_res ? 'error' then raise exception 'key %: %', p, v_res; end if;
  end if;
  perform pg_temp.as_user('teach', format('select api.set_version_recipients(%L, %s, array[%s]::uuid[], gen_random_uuid())', pg_temp.id(p), pg_temp.rev(p),
    (select string_agg(quote_literal(pg_temp.id(s)), ',') from unnest(p_students) s)));
  perform pg_temp.as_user('teach', format('select api.approve_version(%L, %s, gen_random_uuid())', pg_temp.id(p), pg_temp.rev(p)));
  v_res := pg_temp.as_user('teach', format('select api.publish_version(%L, %s, gen_random_uuid(), null)', pg_temp.id(p), pg_temp.rev(p)));
  if v_res ->> 'publicationId' is null then raise exception 'publish %: %', p, v_res; end if;
  insert into ids (k, id) values ('p_' || p, (v_res ->> 'publicationId')::uuid);
  return v_res;
end $$;
-- Remembers the attempt in force (t_<student>_<p>) and the assignment (a_<student>_<p>) of a student on the assessment of p.
create function pg_temp.remember(p text, p_student text) returns void language plpgsql as $$
begin
  insert into ids (k, id)
    select 't_' || p_student || '_' || p, t.id from app.assignment_attempts t join app.assignments a on a.id = t.assignment_id
     where a.student_id = pg_temp.id(p_student) and a.assessment_id = pg_temp.id('a_' || p) and t.superseded_at is null;
  insert into ids (k, id)
    select 'as_' || p_student || '_' || p, a.id from app.assignments a
     where a.student_id = pg_temp.id(p_student) and a.assessment_id = pg_temp.id('a_' || p);
end $$;

-- Everything the attempt protocol can write, as one string: the assignments, the attempts and the drafts of the institution.
create function pg_temp.digest() returns text language sql as $$
  select md5(coalesce((select string_agg(a::text, ';' order by a.id) from app.assignments a where a.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(t::text, ';' order by t.id) from app.assignment_attempts t where t.institution_id = pg_temp.id('i_n')), '')
          || coalesce((select string_agg(s::text, ';' order by s.id) from app.submissions s where s.institution_id = pg_temp.id('i_n')), ''))
$$;
-- A student call: the user (null: a session of nobody) and the RPC with its arguments as SQL.
create function pg_temp.call(p_user text, p_sql text) returns jsonb language sql as $$
  select case when p_user is null then pg_temp.rpc(null, 'authenticated', p_sql) else pg_temp.as_user(p_user, p_sql) end
$$;
-- A refused call: its error and whether it changed anything.
create function pg_temp.refused(p_user text, p_sql text) returns text language plpgsql as $$
declare
  v_before text := pg_temp.digest();
  v_err text;
begin
  v_err := pg_temp.err(pg_temp.call(p_user, p_sql));
  return coalesce(v_err, 'ok') || ' changed=' || (v_before <> pg_temp.digest())::text;
end $$;

create function pg_temp.q_open(p_assignment text) returns text language sql as $$
  select format('select api.student_open_attempt(%L)', pg_temp.id(p_assignment)) $$;
create function pg_temp.q_start(p_attempt text) returns text language sql as $$
  select format('select api.student_start_attempt(%L)', pg_temp.id(p_attempt)) $$;
create function pg_temp.q_save(p_attempt text, p_rev text, p_answers text, p_choices text) returns text language sql as $$
  select format('select api.student_save_draft(%L, %s, %L::jsonb, %L::jsonb)', pg_temp.id(p_attempt), p_rev, p_answers, p_choices) $$;
create function pg_temp.q_submit(p_attempt text, p_rev text) returns text language sql as $$
  select format('select api.student_submit_attempt(%L, %s)', pg_temp.id(p_attempt), p_rev) $$;
create function pg_temp.draft(p_attempt text) returns text language sql as $$
  select s.revision::text from app.submissions s where s.attempt_id = pg_temp.id(p_attempt) $$;
create function pg_temp.ans(p_exercises text[], p_text text) returns text language sql as $$
  select coalesce(jsonb_object_agg(pg_temp.id(x)::text, jsonb_build_object('text', p_text, 'mode', 'typed')), '{}'::jsonb)::text from unnest(p_exercises) x $$;

select pg_temp.publish('vt', 1, 'typed', array['s1', 's2']);
select pg_temp.remember('vt', 's1');
select pg_temp.remember('vt', 's2');

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
    update app.assignment_attempts set status = 'submitted', submitted_at = clock_timestamp(), revision = revision + 1 where id = v_t;
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

-- One cell: what the student gets ("ok", or "CODE reason", plus CHANGED if a refusal wrote something).
create function pg_temp.cell(p_situation text, p_status text, p_op text) returns text language plpgsql as $$
declare
  v_out text;
  v_sql text;
begin
  begin
    perform pg_temp.setup(p_situation, p_status);
    v_sql := case p_op
      when 'open' then pg_temp.q_open('as_s1_vt')
      when 'start' then pg_temp.q_start('t_s1_vt')
      when 'save' then pg_temp.q_save('t_s1_vt', coalesce(pg_temp.draft('t_s1_vt'), '1'), pg_temp.ans(array['x_vt1'], 'a'), '{}')
      else pg_temp.q_submit('t_s1_vt', coalesce(pg_temp.draft('t_s1_vt'), '1')) end;
    v_out := pg_temp.refused('stu_a', v_sql);
    raise exception using errcode = 'P0099', message = 'rollback of the cell';
  exception when sqlstate 'P0099' then
    return case when v_out like 'ok%' then 'ok' else replace(v_out, ' changed=false', '') end;
  end;
end $$;
-- open | start | save | submit
create function pg_temp.cells(p_situation text, p_status text) returns text language sql as $$
  select pg_temp.cell(p_situation, p_status, 'open') || ' | ' || pg_temp.cell(p_situation, p_status, 'start') || ' | '
      || pg_temp.cell(p_situation, p_status, 'save') || ' | ' || pg_temp.cell(p_situation, p_status, 'submit') $$;

create temp table before_cells as select pg_temp.digest() as d;

-- Published (or no dates at all), and within the due date or after it: the same table. Starting is its own step: an opened
-- attempt cannot be saved or submitted; once it started or was submitted, starting again answers the same.
select is(pg_temp.cells('no dates', 'opened'), 'ok | ok | CONFLICT attempt_not_started | CONFLICT attempt_not_started', 'no dates, opened: read and start; save and submit need the start');
select is(pg_temp.cells('no dates', 'started'), 'ok | ok | ok | ok', 'no dates, started: read, save and submit (starting again answers the same)');
select is(pg_temp.cells('no dates', 'submitted'), 'ok | ok | CONFLICT already_submitted | ok', 'no dates, submitted: read only; saving is refused and submitting again does nothing');
select is(pg_temp.cells('in date', 'opened'), 'ok | ok | CONFLICT attempt_not_started | CONFLICT attempt_not_started', 'in date, opened: read and start');
select is(pg_temp.cells('in date', 'started'), 'ok | ok | ok | ok', 'in date, started: read, save and submit');
select is(pg_temp.cells('in date', 'submitted'), 'ok | ok | CONFLICT already_submitted | ok', 'in date, submitted: read only');
select is(pg_temp.cells('after due_at', 'opened'), 'ok | ok | CONFLICT attempt_not_started | CONFLICT attempt_not_started', 'after due_at, opened: still readable and startable');
select is(pg_temp.cells('after due_at', 'started'), 'ok | ok | ok | ok', 'after due_at, started: save and submit still work (the submission is marked late)');
select is(pg_temp.cells('after due_at', 'submitted'), 'ok | ok | CONFLICT already_submitted | ok', 'after due_at, submitted: read only');
-- Before publish_at nothing opens: not even to read. (A started or submitted attempt cannot exist before it in real life; the
-- table still closes it, except what only answers the same and changes nothing.)
select is(pg_temp.cells('before publish_at', 'opened'), 'CONFLICT not_published | CONFLICT not_published | CONFLICT attempt_not_started | CONFLICT attempt_not_started',
  'before publish_at, opened: it cannot be read or started (CONFLICT not_published)');
select is(pg_temp.cells('before publish_at', 'started'), 'CONFLICT not_published | ok | CONFLICT not_published | CONFLICT not_published',
  'before publish_at, started: it cannot be read, saved or submitted');
select is(pg_temp.cells('before publish_at', 'submitted'), 'CONFLICT not_published | ok | CONFLICT already_submitted | ok',
  'before publish_at, submitted: the table closes the reading; submitting again still does nothing');
-- A withdrawn publication or assignment, and a superseded attempt: only what was submitted, and read only.
select is(pg_temp.cells('withdrawn', 'opened'), 'NOT_FOUND not_found | CONFLICT attempt_closed | CONFLICT attempt_not_started | CONFLICT attempt_not_started',
  'publication withdrawn, opened: nothing to read, start is refused');
select is(pg_temp.cells('withdrawn', 'started'), 'NOT_FOUND not_found | ok | CONFLICT attempt_closed | CONFLICT attempt_closed',
  'publication withdrawn, started: it cannot be read, saved or submitted (CONFLICT attempt_closed)');
select is(pg_temp.cells('withdrawn', 'submitted'), 'ok | ok | CONFLICT already_submitted | ok', 'publication withdrawn, submitted: what was submitted can still be read');
select is(pg_temp.cells('assignment withdrawn', 'opened'), 'NOT_FOUND not_found | CONFLICT attempt_closed | CONFLICT attempt_not_started | CONFLICT attempt_not_started',
  'assignment withdrawn, opened: nothing to read, start is refused');
select is(pg_temp.cells('assignment withdrawn', 'started'), 'NOT_FOUND not_found | ok | CONFLICT attempt_closed | CONFLICT attempt_closed',
  'assignment withdrawn, started: it cannot be read, saved or submitted');
select is(pg_temp.cells('assignment withdrawn', 'submitted'), 'ok | ok | CONFLICT already_submitted | ok', 'assignment withdrawn, submitted: what was submitted can still be read');
-- A superseded attempt is not the one in force of its assignment, so "open" (which takes the assignment) does not find it:
-- reading what a superseded attempt submitted is the task of student_task (T1.5d).
select is(pg_temp.cells('superseded', 'opened'), 'NOT_FOUND not_found | CONFLICT attempt_closed | CONFLICT attempt_not_started | CONFLICT attempt_not_started',
  'attempt superseded, opened: nothing to read, start is refused');
select is(pg_temp.cells('superseded', 'started'), 'NOT_FOUND not_found | ok | CONFLICT attempt_closed | CONFLICT attempt_closed',
  'attempt superseded, started: it cannot be saved or submitted');
select is(pg_temp.cells('superseded', 'submitted'), 'NOT_FOUND not_found | ok | CONFLICT already_submitted | ok',
  'attempt superseded, submitted: open does not find it (it is not the one in force); saving is refused, submitting again does nothing');

select is(pg_temp.digest(), (select d from before_cells), 'every cell ran in its own subtransaction: after all of them nothing was written');

-- Republishing moves an opened attempt to the new publication; the student then starts that one.
select is(pg_temp.err(pg_temp.as_user('teach', format('select api.publish_version(%L, %s, gen_random_uuid(), null)', pg_temp.id('vt'), pg_temp.rev('vt')))), null, 'the teacher republishes the version');
select is((select t.publication_id <> pg_temp.id('p_vt') and t.status = 'opened' from app.assignment_attempts t where t.id = pg_temp.id('t_s2_vt')), true, 'the opened attempt of s2 moved to the new publication');
select is(pg_temp.as_user('stu_b', pg_temp.q_start('t_s2_vt')) -> 'status', '"started"'::jsonb, 'and s2 starts it');
select is((select t.publication_id <> pg_temp.id('p_vt') and t.status = 'started' and t.revision = 3 from app.assignment_attempts t where t.id = pg_temp.id('t_s2_vt')), true,
  'started on the new publication, which it keeps from now on');

select * from finish();
rollback;
