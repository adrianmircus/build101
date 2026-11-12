-- T1.2a-fix: review fixes (docs/revisiones/fase-1-tanda-1-codex.md, W1-2 to W1-6 and W1-9).
-- 20261112100000 is already merged and is not edited: everything here replaces its functions.
--
-- One lock for identity: every path that adds, revokes or changes a membership (or ties a student
-- row to an account) takes app.identity_lock(institution, user) first and row locks after, so two
-- transactions about the same person in the same institution never interleave.

create function app.identity_lock(p_institution_id uuid, p_user_id uuid) returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('tiza.identity:' || p_institution_id::text || ':' || p_user_id::text, 0));
$$;

-- ---------------------------------------------------------------------------------------------
-- W1-5: student/staff conflict is an expected business error (CONFLICT role_conflict, P0001),
-- not a bare 23514 the repositories cannot recognise.
-- ---------------------------------------------------------------------------------------------

create or replace function app.memberships_student_xor_staff() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.revoked_at is not null then
    return new;
  end if;
  perform app.identity_lock(new.institution_id, new.user_id);
  if new.role = 'student' then
    if exists (
      select 1 from app.memberships m
       where m.institution_id = new.institution_id and m.user_id = new.user_id
         and m.revoked_at is null and m.role <> 'student' and m.id <> new.id
    ) then
      perform app.raise_error('CONFLICT', 'role_conflict');
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
      perform app.raise_error('CONFLICT', 'role_conflict');
    end if;
  end if;
  return new;
end
$$;

create or replace function app.students_user_not_staff() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is null then
    return new;
  end if;
  perform app.identity_lock(new.institution_id, new.user_id);
  if exists (
    select 1 from app.memberships m
     where m.institution_id = new.institution_id and m.user_id = new.user_id
       and m.revoked_at is null and m.role <> 'student'
  ) then
    perform app.raise_error('CONFLICT', 'role_conflict');
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- W1-2: a membership never changes owner. Reassigning user_id would skip the student/staff check
-- (the trigger watches role and revoked_at); to move access, revoke and add.
-- ---------------------------------------------------------------------------------------------

create function app.memberships_user_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'app.memberships: user_id never changes; revoke the membership and add another' using errcode = 'P0004';
  end if;
  return new;
end
$$;

drop trigger if exists memberships_user_immutable on app.memberships;
create trigger memberships_user_immutable
  before update of user_id on app.memberships
  for each row execute function app.memberships_user_immutable();

-- ---------------------------------------------------------------------------------------------
-- W1-3: add and revoke share the identity lock, so the repeat of an add cannot see the row
-- revoked between its ON CONFLICT and its SELECT. Order: identity lock, then the row.
-- ---------------------------------------------------------------------------------------------

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
  perform app.identity_lock(p_institution_id, p_user_id);
  insert into app.memberships (institution_id, user_id, role) values (p_institution_id, p_user_id, p_role)
  on conflict (institution_id, user_id, role) where revoked_at is null do nothing
  returning id into v_id;
  if v_id is null then
    -- Under the lock nobody can revoke it now, and each READ COMMITTED statement sees what the
    -- previous holder committed. Still a defensive check: a null id would break the contract.
    select m.id into v_id from app.memberships m
     where m.institution_id = p_institution_id and m.user_id = p_user_id and m.role = p_role and m.revoked_at is null;
    if v_id is null then
      raise exception 'internal_add_membership: no active membership after the conflict' using errcode = 'P0004';
    end if;
  end if;
  return jsonb_build_object('id', v_id);
end
$$;

create or replace function api.internal_revoke_membership(p_membership_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_user_id uuid;
  v_revoked_at timestamptz;
begin
  perform app.rpc_begin();
  select m.institution_id, m.user_id into v_institution_id, v_user_id from app.memberships m where m.id = p_membership_id;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform app.identity_lock(v_institution_id, v_user_id);
  select m.revoked_at into v_revoked_at from app.memberships m where m.id = p_membership_id for update;
  if v_revoked_at is null then
    update app.memberships set revoked_at = now(), revision = revision + 1 where id = p_membership_id;
  end if;
  return jsonb_build_object('id', p_membership_id);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- W1-4 and W1-9: remove_group_staff.
--   * Archived group: INVALID archived under the group lock, like add (staff is frozen).
--   * The person must be an active teacher or admin of the institution (INVALID not_a_member),
--     except that removing someone who already is out of the staff stays idempotent.
-- ---------------------------------------------------------------------------------------------

create or replace function api.remove_group_staff(p_group_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_archived_at timestamptz;
  v_is_member boolean;
  v_staff app.group_staff;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.group_gate(p_group_id, 'staff');
  select g.archived_at into v_archived_at from app.groups g where g.id = p_group_id for update;
  if v_archived_at is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;
  v_is_member := exists (
    select 1 from app.memberships m
     where m.institution_id = v_institution_id and m.user_id = p_user_id
       and m.revoked_at is null and m.role in ('teacher', 'admin')
  );
  select * into v_staff from app.group_staff gs
   where gs.group_id = p_group_id and gs.user_id = p_user_id and gs.removed_at is null
   for update;
  if not found then
    select * into v_staff from app.group_staff gs
     where gs.group_id = p_group_id and gs.user_id = p_user_id
     order by gs.removed_at desc limit 1;
    if found then
      return jsonb_build_object('id', v_staff.id);
    end if;
    if not v_is_member then
      perform app.raise_error('INVALID', 'not_a_member');
    end if;
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if not v_is_member then
    perform app.raise_error('INVALID', 'not_a_member');
  end if;
  if v_staff.role = 'owner' and not app.is_member(v_institution_id, array['admin']) then
    perform app.raise_error('FORBIDDEN', 'forbidden');
  end if;
  update app.group_staff set removed_at = now(), revision = revision + 1 where id = v_staff.id;
  return jsonb_build_object('id', v_staff.id);
end
$$;

grant execute on function api.internal_add_membership(uuid, uuid, text) to service_role;
grant execute on function api.internal_revoke_membership(uuid) to service_role;
grant execute on function api.remove_group_staff(uuid, uuid) to authenticated;
