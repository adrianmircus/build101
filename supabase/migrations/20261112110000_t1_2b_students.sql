-- T1.2b: students, enrollments and the group/student projections. Replaces the stubs of
-- 20261111131000 (same signatures) and grants EXECUTE as docs/contratos/fase-1.md says:
-- internal_link_student_user to service_role, the rest to authenticated.
--
-- No new table. Two helpers in app decide who may touch a student and who may read a group, from
-- the session and never from a parameter:
--   * app.student_gate: manage a student = admin of the institution, or staff of a group where the
--     student is enrolled right now. NOT_FOUND when the actor cannot see the student (so its
--     existence is not revealed); FORBIDDEN for inclusion and for the student themselves, who do see
--     it but whose role is not enough.
--   * app.group_reader_gate: read a group = admin, inclusion (institution-wide) or its staff. An
--     enrolled student is FORBIDDEN (they see the group, the projections are for staff), anyone else
--     NOT_FOUND. It reuses app.group_gate for the cases it does not decide itself.
--
-- Lock order (none of these RPCs touches the assessment tree): the group row first, then the student
-- row, always `for share` unless the RPC changes it. Idempotency by op_key is checked under an
-- advisory lock on (institution, op_key) taken before any row lock, with the identity of the call.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

create function app.student_gate(p_student_id uuid) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_institution_id uuid;
begin
  select s.institution_id into v_institution_id from app.students s where s.id = p_student_id;
  if v_institution_id is null
     or not app.is_member(v_institution_id, array['admin', 'teacher', 'inclusion', 'student']) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if app.is_member(v_institution_id, array['admin']) then
    return v_institution_id;
  end if;
  if exists (
    select 1 from app.enrollments e
     where e.institution_id = v_institution_id and e.student_id = p_student_id and e.ended_at is null
       and app.is_group_staff(e.group_id)
  ) then
    return v_institution_id;
  end if;
  if app.is_member(v_institution_id, array['inclusion']) or app.is_student_self(p_student_id) then
    perform app.raise_error('FORBIDDEN', 'forbidden');
  end if;
  perform app.raise_error('NOT_FOUND', 'not_found');
  return null;
end
$$;

create function app.group_reader_gate(p_group_id uuid) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_institution_id uuid;
begin
  select g.institution_id into v_institution_id from app.groups g where g.id = p_group_id;
  if v_institution_id is not null
     and (app.is_member(v_institution_id, array['admin', 'inclusion']) or app.is_group_staff(p_group_id)) then
    return v_institution_id;
  end if;
  -- Not a reader: group_gate answers NOT_FOUND (cannot see it) or FORBIDDEN (an enrolled student).
  -- 'manage' can never succeed here, because an admin or staff member was accepted above.
  return app.group_gate(p_group_id, 'manage');
end
$$;

-- ---------------------------------------------------------------------------------------------
-- internal_link_student_user (service_role)
-- ---------------------------------------------------------------------------------------------

-- Ties the student to its Auth account, makes the student membership and moves the provisioning row
-- (if the student has one) to active. The same call again changes nothing and answers the same;
-- another account for the student, or the account of another student, is CONFLICT op_key_reused.
-- An account that is staff in the institution is INVALID user_is_staff (the T1.2a triggers refuse).
create or replace function api.internal_link_student_user(p_student_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_user_id uuid;
  v_status text;
begin
  perform app.rpc_begin();
  select s.institution_id, s.user_id into v_institution_id, v_user_id
    from app.students s where s.id = p_student_id for update;
  if not found or not exists (select 1 from app.app_users u where u.id = p_user_id) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if v_user_id is not null and v_user_id <> p_user_id then
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;
  if v_user_id is null and exists (select 1 from app.students s where s.user_id = p_user_id) then
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;
  -- A deleted account stays deleted: reconcile_accounts must never bring it back.
  select ap.status into v_status from app.account_provisioning ap where ap.student_id = p_student_id for update;
  if v_status = 'deleted' then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  begin
    if v_user_id is null then
      -- No revision bump: linking an account is not an edit anyone could be racing against.
      update app.students set user_id = p_user_id where id = p_student_id;
    end if;
    insert into app.memberships (institution_id, user_id, role)
    values (v_institution_id, p_user_id, 'student')
    on conflict (institution_id, user_id, role) where revoked_at is null do nothing;
  exception when check_violation then
    perform app.raise_error('INVALID', 'user_is_staff');
  end;

  if v_status is not null and v_status <> 'active' then
    update app.account_provisioning
       set status = 'active', auth_user_id = p_user_id, error_code = null, revision = revision + 1
     where student_id = p_student_id;
  end if;
  return jsonb_build_object('id', p_student_id);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Students
-- ---------------------------------------------------------------------------------------------

-- Creates the student, its enrollment in the group, its pseudonym and, outside a sandbox, the
-- pending account_provisioning row that carries p_op_key. The same op_key for the same group and
-- username answers what was created; for anything else it is CONFLICT op_key_reused. A sandbox has
-- no provisioning row to keep the key in, so there a repeated call finds the username taken.
create or replace function api.create_student(p_group_id uuid, p_display_name text, p_username text, p_op_key uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_name text := btrim(p_display_name);
  v_username text := lower(btrim(p_username));
  v_archived_at timestamptz;
  v_sandbox boolean;
  v_prov app.account_provisioning;
  v_student app.students;
  v_provisioning_id uuid;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.group_gate(p_group_id, 'manage');
  v_sandbox := app.institution_kind(v_institution_id) = 'sandbox';
  if char_length(v_name) not between 1 and 120 then
    perform app.raise_error('INVALID', 'invalid_name');
  end if;
  if v_username !~ '^[a-z0-9][a-z0-9._-]{1,39}$' then
    perform app.raise_error('INVALID', 'invalid_username');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tiza.create_student:' || v_institution_id::text || ':' || p_op_key::text, 0));
  select g.archived_at into v_archived_at from app.groups g where g.id = p_group_id for share;

  select * into v_prov from app.account_provisioning ap
   where ap.institution_id = v_institution_id and ap.op_key = p_op_key;
  if found then
    select * into v_student from app.students s where s.id = v_prov.student_id;
    if v_student.id is not null and v_student.username = v_username and exists (
      select 1 from app.enrollments e where e.group_id = p_group_id and e.student_id = v_student.id
    ) then
      return jsonb_build_object('id', v_student.id, 'revision', v_student.revision, 'provisioningId', v_prov.id);
    end if;
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;

  if v_archived_at is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;
  insert into app.students (institution_id, display_name, username)
  values (v_institution_id, v_name, v_username)
  on conflict (institution_id, username) do nothing
  returning * into v_student;
  if v_student.id is null then
    perform app.raise_error('CONFLICT', 'username_taken');
  end if;
  insert into app.enrollments (institution_id, group_id, student_id) values (v_institution_id, p_group_id, v_student.id);
  insert into app.student_pseudonyms (institution_id, student_id) values (v_institution_id, v_student.id);
  if not v_sandbox then
    insert into app.account_provisioning (institution_id, student_id, op_key)
    values (v_institution_id, v_student.id, p_op_key)
    returning id into v_provisioning_id;
  end if;
  return jsonb_build_object('id', v_student.id, 'revision', v_student.revision, 'provisioningId', v_provisioning_id);
end
$$;

-- Same data with the current revision changes nothing and does not bump the revision.
create or replace function api.update_student(p_student_id uuid, p_revision integer, p_display_name text, p_username text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := btrim(p_display_name);
  v_username text := lower(btrim(p_username));
  v_student app.students;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  perform app.student_gate(p_student_id);
  if char_length(v_name) not between 1 and 120 then
    perform app.raise_error('INVALID', 'invalid_name');
  end if;
  if v_username !~ '^[a-z0-9][a-z0-9._-]{1,39}$' then
    perform app.raise_error('INVALID', 'invalid_username');
  end if;
  select * into v_student from app.students s where s.id = p_student_id for update;
  perform app.assert_revision(p_revision, v_student.revision);
  if v_student.archived_at is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;
  if v_student.display_name <> v_name or v_student.username <> v_username then
    begin
      update app.students set display_name = v_name, username = v_username, revision = revision + 1
       where id = p_student_id returning revision into v_student.revision;
    exception when unique_violation then
      perform app.raise_error('CONFLICT', 'username_taken');
    end;
  end if;
  return jsonb_build_object('id', p_student_id, 'revision', v_student.revision);
end
$$;

-- Archiving keeps the enrollments: restoring puts the student back where they were. Archiving an
-- archived student (and restoring an active one) with the current revision answers the same.
create or replace function api.archive_student(p_student_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_revision integer;
  v_archived_at timestamptz;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  perform app.student_gate(p_student_id);
  select s.revision, s.archived_at into v_revision, v_archived_at from app.students s where s.id = p_student_id for update;
  perform app.assert_revision(p_revision, v_revision);
  if v_archived_at is null then
    update app.students set archived_at = now(), revision = revision + 1
     where id = p_student_id returning revision into v_revision;
  end if;
  return jsonb_build_object('id', p_student_id, 'revision', v_revision);
end
$$;

create or replace function api.restore_student(p_student_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_revision integer;
  v_archived_at timestamptz;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  perform app.student_gate(p_student_id);
  select s.revision, s.archived_at into v_revision, v_archived_at from app.students s where s.id = p_student_id for update;
  perform app.assert_revision(p_revision, v_revision);
  if v_archived_at is not null then
    update app.students set archived_at = null, revision = revision + 1
     where id = p_student_id returning revision into v_revision;
  end if;
  return jsonb_build_object('id', p_student_id, 'revision', v_revision);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Enrollments
-- ---------------------------------------------------------------------------------------------

-- Enrolling someone already enrolled returns the active enrollment. The student must be of the
-- group's institution (another one is NOT_FOUND). An archived group or student takes no new
-- enrollment. The partial unique index is the arbiter between two concurrent enrollments.
create or replace function api.enroll_student(p_group_id uuid, p_student_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_group_archived_at timestamptz;
  v_student_archived_at timestamptz;
  v_id uuid;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.group_gate(p_group_id, 'manage');
  select g.archived_at into v_group_archived_at from app.groups g where g.id = p_group_id for share;
  select s.archived_at into v_student_archived_at
    from app.students s where s.id = p_student_id and s.institution_id = v_institution_id for share;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  select e.id into v_id from app.enrollments e
   where e.group_id = p_group_id and e.student_id = p_student_id and e.ended_at is null;
  if v_id is not null then
    return jsonb_build_object('id', v_id);
  end if;
  if v_group_archived_at is not null or v_student_archived_at is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;
  insert into app.enrollments (institution_id, group_id, student_id)
  values (v_institution_id, p_group_id, p_student_id)
  on conflict (group_id, student_id) where ended_at is null do nothing
  returning id into v_id;
  if v_id is null then
    select e.id into v_id from app.enrollments e
     where e.group_id = p_group_id and e.student_id = p_student_id and e.ended_at is null;
  end if;
  return jsonb_build_object('id', v_id);
end
$$;

-- The row stays, with ended_at: who was in the group when is history. Unenrolling twice returns the
-- enrollment that ended; someone who never was in the group is NOT_FOUND not_enrolled.
create or replace function api.unenroll_student(p_group_id uuid, p_student_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  perform app.group_gate(p_group_id, 'manage');
  perform 1 from app.groups g where g.id = p_group_id for share;
  select e.id into v_id from app.enrollments e
   where e.group_id = p_group_id and e.student_id = p_student_id and e.ended_at is null
   for update;
  if found then
    update app.enrollments set ended_at = now(), revision = revision + 1 where id = v_id;
    return jsonb_build_object('id', v_id);
  end if;
  select e.id into v_id from app.enrollments e
   where e.group_id = p_group_id and e.student_id = p_student_id
   order by e.ended_at desc limit 1;
  if v_id is null then
    perform app.raise_error('NOT_FOUND', 'not_enrolled');
  end if;
  return jsonb_build_object('id', v_id);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Projections: exactly the keys of their schema, built one by one (never to_jsonb of a row).
-- ---------------------------------------------------------------------------------------------

-- Admin and inclusion list every group of the institution, a teacher only theirs. myRole is the
-- caller's staff role in that group, null when they read it without teaching it.
create or replace function api.list_my_groups(p_institution_id uuid, p_include_archived boolean default false, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_all boolean;
  v_total integer;
  v_items jsonb;
begin
  perform app.rpc_begin();
  v_actor := app.require_actor();
  if not app.is_member(p_institution_id, array['admin', 'teacher', 'inclusion', 'student']) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if not app.is_member(p_institution_id, array['admin', 'teacher', 'inclusion']) then
    perform app.raise_error('FORBIDDEN', 'forbidden');
  end if;
  if p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset < 0 then
    perform app.raise_error('INVALID', 'invalid_page');
  end if;
  v_all := app.is_member(p_institution_id, array['admin', 'inclusion']);

  with mine as (
    select g.id, g.name, g.subject_id, g.school_year, g.archived_at, g.revision,
           (select gs.role from app.group_staff gs
             where gs.group_id = g.id and gs.user_id = v_actor and gs.removed_at is null
               and g.id in (select app.actor_staff_groups())) as my_role,
           count(*) over () as total
      from app.groups g
     where g.institution_id = p_institution_id
       and (coalesce(p_include_archived, false) or g.archived_at is null)
       and (v_all or g.id in (select app.actor_staff_groups()))
     order by g.name, g.id
     limit p_limit offset p_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'name', m.name, 'subjectId', m.subject_id, 'schoolYear', m.school_year::integer,
           'archivedAt', m.archived_at, 'revision', m.revision, 'myRole', m.my_role,
           'studentCount', (select count(*) from app.enrollments e
                              join app.students s on s.institution_id = e.institution_id and s.id = e.student_id
                             where e.group_id = m.id and e.ended_at is null and s.archived_at is null)
         ) order by m.name, m.id), '[]'::jsonb),
         coalesce(max(m.total), 0)
    into v_items, v_total
    from mine m;
  -- An offset past the end returns no rows, so the window count is lost: count again.
  if v_total = 0 and p_offset > 0 then
    select count(*) into v_total from app.groups g
     where g.institution_id = p_institution_id
       and (coalesce(p_include_archived, false) or g.archived_at is null)
       and (v_all or g.id in (select app.actor_staff_groups()));
  end if;
  return jsonb_build_object('items', v_items, 'total', v_total);
end
$$;

create or replace function api.get_group(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_group app.groups;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.group_reader_gate(p_group_id);
  select * into v_group from app.groups g where g.id = p_group_id;
  return jsonb_build_object(
    'id', v_group.id, 'name', v_group.name, 'subjectId', v_group.subject_id,
    'schoolYear', v_group.school_year::integer, 'archivedAt', v_group.archived_at,
    'revision', v_group.revision, 'institutionId', v_institution_id,
    'myRole', (select gs.role from app.group_staff gs
                where gs.group_id = p_group_id and gs.user_id = app.session_user_id() and gs.removed_at is null
                  and app.is_group_staff(p_group_id)),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('userId', gs.user_id, 'displayName', u.display_name, 'role', gs.role)
                       order by (gs.role = 'owner') desc, u.display_name, gs.user_id)
        from app.group_staff gs
        join app.app_users u on u.id = gs.user_id
       where gs.group_id = p_group_id and gs.removed_at is null
         and exists (select 1 from app.memberships m
                      where m.institution_id = v_institution_id and m.user_id = gs.user_id
                        and m.revoked_at is null and m.role in ('teacher', 'admin'))
    ), '[]'::jsonb));
end
$$;

-- Students enrolled now (not the ones who left the group). No profile, note or interface: names
-- are personal but not sensitive, and any reader of the group may see them.
create or replace function api.list_group_students(p_group_id uuid, p_include_archived boolean default false, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_total integer;
  v_items jsonb;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.group_reader_gate(p_group_id);
  if p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset < 0 then
    perform app.raise_error('INVALID', 'invalid_page');
  end if;

  with roster as (
    select s.id, s.display_name, s.username, s.archived_at, e.started_at, (s.user_id is not null) as has_account,
           s.revision, count(*) over () as total
      from app.enrollments e
      join app.students s on s.institution_id = e.institution_id and s.id = e.student_id
     where e.institution_id = v_institution_id and e.group_id = p_group_id and e.ended_at is null
       and (coalesce(p_include_archived, false) or s.archived_at is null)
     order by s.display_name, s.id
     limit p_limit offset p_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'displayName', r.display_name, 'username', r.username, 'archivedAt', r.archived_at,
           'enrolledAt', r.started_at, 'hasAccount', r.has_account, 'revision', r.revision
         ) order by r.display_name, r.id), '[]'::jsonb),
         coalesce(max(r.total), 0)
    into v_items, v_total
    from roster r;
  -- An offset past the end returns no rows, so the window count is lost: count again.
  if v_total = 0 and p_offset > 0 then
    select count(*) into v_total
      from app.enrollments e
      join app.students s on s.institution_id = e.institution_id and s.id = e.student_id
     where e.institution_id = v_institution_id and e.group_id = p_group_id and e.ended_at is null
       and (coalesce(p_include_archived, false) or s.archived_at is null);
  end if;
  return jsonb_build_object('items', v_items, 'total', v_total);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: nothing in api has a default grant.
-- ---------------------------------------------------------------------------------------------

grant execute on function api.internal_link_student_user(uuid, uuid) to service_role;
grant execute on function api.create_student(uuid, text, text, uuid) to authenticated;
grant execute on function api.update_student(uuid, integer, text, text) to authenticated;
grant execute on function api.archive_student(uuid, integer) to authenticated;
grant execute on function api.restore_student(uuid, integer) to authenticated;
grant execute on function api.enroll_student(uuid, uuid) to authenticated;
grant execute on function api.unenroll_student(uuid, uuid) to authenticated;
grant execute on function api.list_my_groups(uuid, boolean, integer, integer) to authenticated;
grant execute on function api.get_group(uuid) to authenticated;
grant execute on function api.list_group_students(uuid, boolean, integer, integer) to authenticated;
