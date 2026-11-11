-- Contract, phase 1: who is calling and what they belong to.
--
-- The RPCs never take the actor as a parameter: it comes from auth.uid() here. The helpers are
-- SECURITY DEFINER with an empty search_path so that, if a later ticket uses them inside an RLS
-- policy, they read memberships without recursing into that table's own policies. Nobody gets
-- EXECUTE on them: RPCs run as their owner and call them directly.
--
-- Two flavours: boolean checks for one resource (what an RPC asks), and set-returning ones for
-- policies and listings written over sets (a policy must not assume a per-row function runs once).
-- An expired sandbox counts as no membership at all: after expires_at its visitor sees nothing.

-- The calling user, or null when there is no session or the Auth user has no app_users row yet.
create function app.actor_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from app.app_users u where u.id = auth.uid()
$$;

create function app.require_actor() returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.actor_id();
begin
  if v_actor is null then
    perform app.raise_error('FORBIDDEN', 'no_session');
  end if;
  return v_actor;
end
$$;

create function app.institution_is_open(p_institution_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.institutions i
     where i.id = p_institution_id and (i.expires_at is null or i.expires_at > now())
  )
$$;

-- Institutions where the actor holds one of the roles, with an active membership.
create function app.actor_institutions(p_roles text[]) returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct m.institution_id
    from app.memberships m
    join app.institutions i on i.id = m.institution_id
   where m.user_id = auth.uid()
     and m.revoked_at is null
     and m.role = any (p_roles)
     and (i.expires_at is null or i.expires_at > now())
$$;

create function app.is_member(p_institution_id uuid, p_roles text[]) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app.actor_institutions(p_roles) as t(id) where t.id = p_institution_id)
$$;

-- Groups the actor is staff of: an active group_staff row backed by an active teacher or admin
-- membership in the group's institution. Removing a teacher from the institution therefore removes
-- every group at once, without touching group_staff.
create function app.actor_staff_groups() returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select gs.group_id
    from app.group_staff gs
   where gs.user_id = auth.uid()
     and gs.removed_at is null
     and gs.institution_id in (select app.actor_institutions(array['teacher', 'admin']))
$$;

create function app.is_group_staff(p_group_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app.actor_staff_groups() as t(id) where t.id = p_group_id)
$$;

-- The student row of the calling user, if the user is an active, non-archived student.
create function app.actor_student_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
    from app.students s
   where s.user_id = auth.uid()
     and s.archived_at is null
     and s.institution_id in (select app.actor_institutions(array['student']))
$$;

create function app.is_student_self(p_student_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_student_id is not null and app.actor_student_id() = p_student_id
$$;

create function app.institution_kind(p_institution_id uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select i.kind from app.institutions i where i.id = p_institution_id
$$;
