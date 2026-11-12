-- T1.2a: identity and groups. Replaces the stubs of 20261111131000 (same signatures) and grants
-- EXECUTE as docs/contratos/fase-1.md says: internal_* to service_role, the rest to authenticated.
--
-- No new table. Two helpers in app and two triggers back the rules the RPCs share:
--   * app.group_gate: who may see and who may change a group, decided from the session, never from
--     a parameter. NOT_FOUND when the actor cannot see the group (so its existence is not revealed),
--     FORBIDDEN when they see it but their role is not enough.
--   * the student/staff triggers: nobody is a student and staff in the same institution, however
--     the rows get written (RPC, another ticket's RPC or a direct fix by an operator).

-- ---------------------------------------------------------------------------------------------
-- Student XOR staff
-- ---------------------------------------------------------------------------------------------

-- Staff roles are every membership role but 'student'. Two concurrent transactions that each add
-- one side would both pass a plain existence check, so both take the same advisory lock per
-- (institution, user) first: the second one sees the first one's committed row.
create function app.memberships_student_xor_staff() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.revoked_at is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tiza.identity:' || new.institution_id::text || ':' || new.user_id::text, 0));
  if new.role = 'student' then
    if exists (
      select 1 from app.memberships m
       where m.institution_id = new.institution_id and m.user_id = new.user_id
         and m.revoked_at is null and m.role <> 'student' and m.id <> new.id
    ) then
      raise exception 'a person cannot be a student and staff in the same institution' using errcode = '23514';
    end if;
  else
    if exists (
      select 1 from app.memberships m
       where m.institution_id = new.institution_id and m.user_id = new.user_id
         and m.revoked_at is null and m.role = 'student' and m.id <> new.id
    ) or exists (
      -- A student row already tied to this account counts even before the student membership exists.
      select 1 from app.students s where s.institution_id = new.institution_id and s.user_id = new.user_id
    ) then
      raise exception 'a person cannot be a student and staff in the same institution' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create trigger memberships_student_xor_staff
  before insert or update of role, revoked_at on app.memberships
  for each row execute function app.memberships_student_xor_staff();

-- The other direction: tying a student row to an account that is already staff there.
create function app.students_user_not_staff() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tiza.identity:' || new.institution_id::text || ':' || new.user_id::text, 0));
  if exists (
    select 1 from app.memberships m
     where m.institution_id = new.institution_id and m.user_id = new.user_id
       and m.revoked_at is null and m.role <> 'student'
  ) then
    raise exception 'a person cannot be a student and staff in the same institution' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger students_user_not_staff
  before insert or update of user_id on app.students
  for each row execute function app.students_user_not_staff();

-- ---------------------------------------------------------------------------------------------
-- Group gate
-- ---------------------------------------------------------------------------------------------

-- p_need = 'manage': an admin of the institution or staff of the group (owner or co-teacher).
-- p_need = 'staff':  who may change the group's staff: an admin or the owner, never in a sandbox.
-- Returns the group's institution. Reads without locking: the caller locks after being authorized,
-- so nobody can make the database lock rows the actor cannot even see.
create function app.group_gate(p_group_id uuid, p_need text) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_is_admin boolean;
  v_staff_role text;
  v_visible boolean;
begin
  select g.institution_id into v_institution_id from app.groups g where g.id = p_group_id;
  if v_institution_id is null
     or not app.is_member(v_institution_id, array['admin', 'teacher', 'inclusion', 'student']) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  v_is_admin := app.is_member(v_institution_id, array['admin']);
  if app.is_group_staff(p_group_id) then
    select gs.role into v_staff_role
      from app.group_staff gs
     where gs.group_id = p_group_id and gs.user_id = app.session_user_id() and gs.removed_at is null;
  end if;

  -- Who sees a group: admins and inclusion (institution-wide), its staff and its enrolled students.
  -- A teacher of another group does not, and a student of another group does not.
  v_visible := v_is_admin
    or v_staff_role is not null
    or app.is_member(v_institution_id, array['inclusion'])
    or exists (
      select 1 from app.enrollments e
        join app.students s on s.institution_id = e.institution_id and s.id = e.student_id
       where e.group_id = p_group_id and e.ended_at is null
         and s.user_id = app.session_user_id() and s.archived_at is null
    );
  if not v_visible then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  if p_need = 'staff' and app.institution_kind(v_institution_id) = 'sandbox' then
    perform app.raise_error('FORBIDDEN', 'sandbox_restricted');
  end if;
  -- coalesce: a null here (no staff role) must read as "not allowed", never as "unknown".
  if not coalesce(case p_need
            when 'manage' then v_is_admin or v_staff_role is not null
            when 'staff' then v_is_admin or v_staff_role = 'owner'
            else false
          end, false) then
    perform app.raise_error('FORBIDDEN', 'forbidden');
  end if;
  return v_institution_id;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Internal RPCs (service_role)
-- ---------------------------------------------------------------------------------------------

-- Idempotent by code: the same code with the same data returns the same institution; the same code
-- with other data is CONFLICT op_key_reused (it already means something else). The sandbox owner
-- is not made a member here: the caller adds the membership it wants with internal_add_membership.
create or replace function api.internal_create_institution(p_name text, p_code text, p_kind text, p_expires_at timestamptz default null, p_owner_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_code text := lower(btrim(p_code));
  v_name text := btrim(p_name);
  v_row app.institutions;
begin
  perform app.rpc_begin();
  if p_owner_user_id is not null and not exists (select 1 from app.app_users u where u.id = p_owner_user_id) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  -- The code's unique index is the arbiter between two concurrent creations of the same code.
  insert into app.institutions (name, code, kind, expires_at, owner_user_id)
  values (v_name, v_code, p_kind, p_expires_at, p_owner_user_id)
  on conflict (code) do nothing
  returning * into v_row;
  if v_row.id is not null then
    return jsonb_build_object('id', v_row.id);
  end if;
  select * into v_row from app.institutions i where i.code = v_code;
  if v_row.name = v_name and v_row.kind = p_kind
     and v_row.expires_at is not distinct from p_expires_at
     and v_row.owner_user_id is not distinct from p_owner_user_id then
    return jsonb_build_object('id', v_row.id);
  end if;
  perform app.raise_error('CONFLICT', 'op_key_reused');
  return null;
end
$$;

-- Upsert keyed by the Auth user. A null name never wipes an existing one, and an unchanged name
-- does not bump the revision.
create or replace function api.internal_upsert_app_user(p_user_id uuid, p_display_name text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.rpc_begin();
  if not exists (select 1 from auth.users a where a.id = p_user_id) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  insert into app.app_users as u (id, display_name) values (p_user_id, btrim(p_display_name))
  on conflict (id) do update
     set display_name = excluded.display_name, revision = u.revision + 1
   where excluded.display_name is not null and u.display_name is distinct from excluded.display_name
  returning u.id into v_id;
  if v_id is null then
    v_id := p_user_id;
  end if;
  return jsonb_build_object('id', v_id);
end
$$;

-- Idempotent: an active membership with the same role is returned, not duplicated. A user can hold
-- several roles (admin who also teaches), each once; student with staff is stopped by the trigger.
create or replace function api.internal_add_membership(p_institution_id uuid, p_user_id uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.rpc_begin();
  if not exists (select 1 from app.institutions i where i.id = p_institution_id)
     or not exists (select 1 from app.app_users u where u.id = p_user_id) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  insert into app.memberships (institution_id, user_id, role) values (p_institution_id, p_user_id, p_role)
  on conflict (institution_id, user_id, role) where revoked_at is null do nothing
  returning id into v_id;
  if v_id is null then
    select m.id into v_id from app.memberships m
     where m.institution_id = p_institution_id and m.user_id = p_user_id and m.role = p_role and m.revoked_at is null;
  end if;
  return jsonb_build_object('id', v_id);
end
$$;

-- The row stays, with revoked_at: who had access when is part of the access record. Revoking an
-- already revoked membership returns it unchanged.
create or replace function api.internal_revoke_membership(p_membership_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_revoked_at timestamptz;
begin
  perform app.rpc_begin();
  select m.revoked_at into v_revoked_at from app.memberships m where m.id = p_membership_id for update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if v_revoked_at is null then
    update app.memberships set revoked_at = now(), revision = revision + 1 where id = p_membership_id;
  end if;
  return jsonb_build_object('id', p_membership_id);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Institutions of the actor
-- ---------------------------------------------------------------------------------------------

-- Active memberships only, in institutions that are open: an expired sandbox is not listed.
create or replace function api.list_my_institutions()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
begin
  perform app.rpc_begin();
  v_actor := app.require_actor();
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'kind', t.kind, 'roles', t.roles) order by t.name, t.id)
      from (
        select i.id, i.name, i.kind, to_jsonb(array_agg(m.role order by m.role)) as roles
          from app.memberships m
          join app.institutions i on i.id = m.institution_id
         where m.user_id = v_actor and m.revoked_at is null
           and (i.expires_at is null or i.expires_at > now())
         group by i.id, i.name, i.kind
      ) t
  ), '[]'::jsonb));
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------------------------

-- The institution is a selector, checked against the actor's memberships: not a member is
-- NOT_FOUND (the institution is not revealed), a member who does not teach (inclusion, student) is
-- FORBIDDEN. The creator becomes the owner.
create or replace function api.create_group(p_institution_id uuid, p_name text, p_subject_id text, p_school_year integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_group app.groups;
begin
  perform app.rpc_begin();
  v_actor := app.require_actor();
  if not app.is_member(p_institution_id, array['admin', 'teacher', 'inclusion', 'student']) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if not app.is_member(p_institution_id, array['admin', 'teacher']) then
    perform app.raise_error('FORBIDDEN', 'forbidden');
  end if;
  -- A subject that is off (not rolled out yet) is as good as missing.
  if not exists (select 1 from app.subjects s where s.id = p_subject_id and s.enabled) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  insert into app.groups (institution_id, subject_id, name, school_year, created_by)
  values (p_institution_id, p_subject_id, btrim(p_name), p_school_year, v_actor)
  returning * into v_group;
  insert into app.group_staff (institution_id, group_id, user_id, role)
  values (p_institution_id, v_group.id, v_actor, 'owner');
  return jsonb_build_object('id', v_group.id, 'revision', v_group.revision);
end
$$;

create or replace function api.update_group(p_group_id uuid, p_revision integer, p_name text, p_school_year integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_revision integer;
  v_archived_at timestamptz;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  perform app.group_gate(p_group_id, 'manage');
  select g.revision, g.archived_at into v_revision, v_archived_at from app.groups g where g.id = p_group_id for update;
  perform app.assert_revision(p_revision, v_revision);
  if v_archived_at is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;
  update app.groups set name = btrim(p_name), school_year = p_school_year, revision = revision + 1
   where id = p_group_id returning revision into v_revision;
  return jsonb_build_object('id', p_group_id, 'revision', v_revision);
end
$$;

-- Archiving an archived group (and restoring an active one) with the current revision changes
-- nothing and answers the same: a double click is not an error.
create or replace function api.archive_group(p_group_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_revision integer;
  v_archived_at timestamptz;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  perform app.group_gate(p_group_id, 'manage');
  select g.revision, g.archived_at into v_revision, v_archived_at from app.groups g where g.id = p_group_id for update;
  perform app.assert_revision(p_revision, v_revision);
  if v_archived_at is null then
    update app.groups set archived_at = now(), revision = revision + 1
     where id = p_group_id returning revision into v_revision;
  end if;
  return jsonb_build_object('id', p_group_id, 'revision', v_revision);
end
$$;

create or replace function api.restore_group(p_group_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_revision integer;
  v_archived_at timestamptz;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  perform app.group_gate(p_group_id, 'manage');
  select g.revision, g.archived_at into v_revision, v_archived_at from app.groups g where g.id = p_group_id for update;
  perform app.assert_revision(p_revision, v_revision);
  if v_archived_at is not null then
    update app.groups set archived_at = null, revision = revision + 1
     where id = p_group_id returning revision into v_revision;
  end if;
  return jsonb_build_object('id', p_group_id, 'revision', v_revision);
end
$$;

-- Only an admin or the owner, never in a sandbox (an invitation or a real person has no place
-- there). The new person must be an active teacher or admin of the same institution; anyone else,
-- including a user that does not exist, is INVALID not_a_member. Same person and role again returns
-- the same row; another role, or a second owner, is CONFLICT: someone already decided otherwise.
create or replace function api.add_group_staff(p_group_id uuid, p_user_id uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_archived_at timestamptz;
  v_staff app.group_staff;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.group_gate(p_group_id, 'staff');
  -- The group row serializes every change to its staff.
  select g.archived_at into v_archived_at from app.groups g where g.id = p_group_id for update;
  if v_archived_at is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;
  if not exists (
    select 1 from app.memberships m
     where m.institution_id = v_institution_id and m.user_id = p_user_id
       and m.revoked_at is null and m.role in ('teacher', 'admin')
  ) then
    perform app.raise_error('INVALID', 'not_a_member');
  end if;
  select * into v_staff from app.group_staff gs
   where gs.group_id = p_group_id and gs.user_id = p_user_id and gs.removed_at is null;
  if found then
    if v_staff.role <> p_role then
      perform app.raise_error('CONFLICT', 'revision_mismatch');
    end if;
    return jsonb_build_object('id', v_staff.id);
  end if;
  if p_role = 'owner' and exists (
    select 1 from app.group_staff gs where gs.group_id = p_group_id and gs.role = 'owner' and gs.removed_at is null
  ) then
    perform app.raise_error('CONFLICT', 'revision_mismatch');
  end if;
  insert into app.group_staff (institution_id, group_id, user_id, role)
  values (v_institution_id, p_group_id, p_user_id, p_role)
  returning * into v_staff;
  return jsonb_build_object('id', v_staff.id);
end
$$;

-- Removing someone already removed returns the row that was removed; someone who never was staff is
-- NOT_FOUND. The owner can only be taken out by an admin (who then names another owner): an owner
-- removing themselves would leave the group with nobody who can manage its staff.
create or replace function api.remove_group_staff(p_group_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_staff app.group_staff;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.group_gate(p_group_id, 'staff');
  perform 1 from app.groups g where g.id = p_group_id for update;
  select * into v_staff from app.group_staff gs
   where gs.group_id = p_group_id and gs.user_id = p_user_id and gs.removed_at is null
   for update;
  if not found then
    select * into v_staff from app.group_staff gs
     where gs.group_id = p_group_id and gs.user_id = p_user_id
     order by gs.removed_at desc limit 1;
    if not found then
      perform app.raise_error('NOT_FOUND', 'not_found');
    end if;
    return jsonb_build_object('id', v_staff.id);
  end if;
  if v_staff.role = 'owner' and not app.is_member(v_institution_id, array['admin']) then
    perform app.raise_error('FORBIDDEN', 'forbidden');
  end if;
  update app.group_staff set removed_at = now(), revision = revision + 1 where id = v_staff.id;
  return jsonb_build_object('id', v_staff.id);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: nothing in api has a default grant.
-- ---------------------------------------------------------------------------------------------

grant execute on function api.internal_create_institution(text, text, text, timestamptz, uuid) to service_role;
grant execute on function api.internal_upsert_app_user(uuid, text) to service_role;
grant execute on function api.internal_add_membership(uuid, uuid, text) to service_role;
grant execute on function api.internal_revoke_membership(uuid) to service_role;
grant execute on function api.list_my_institutions() to authenticated;
grant execute on function api.create_group(uuid, text, text, integer) to authenticated;
grant execute on function api.update_group(uuid, integer, text, integer) to authenticated;
grant execute on function api.archive_group(uuid, integer) to authenticated;
grant execute on function api.restore_group(uuid, integer) to authenticated;
grant execute on function api.add_group_staff(uuid, uuid, text) to authenticated;
grant execute on function api.remove_group_staff(uuid, uuid) to authenticated;
