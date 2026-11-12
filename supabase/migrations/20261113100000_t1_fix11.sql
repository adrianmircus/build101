-- T1.F11: the last two A → NULL → B paths of the closing review (F1-4, round 4).
-- A link that was emptied could be pointed at another person afterwards: a guard that only compares old and new
-- values forgets the first link. Each of these columns now has a memory of it.

-- students.user_id: it goes to NULL only when its app_user is deleted (the FK's ON DELETE SET NULL runs after the
-- parent row is gone), and a student who was ever linked is never linked to another account. The memory is
-- account_provisioning.auth_user_id, which is set once and never changes (T1.F10).
create or replace function app.students_user_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.user_id is not null and new.user_id is not null and new.user_id <> old.user_id then
    raise exception 'app.students_user_frozen: user_id never moves to another account' using errcode = 'P0004';
  end if;
  if old.user_id is not null and new.user_id is null
     and exists (select 1 from app.app_users u where u.id = old.user_id) then
    raise exception 'app.students_user_frozen: user_id only goes to null when the account is deleted' using errcode = 'P0004';
  end if;
  if old.user_id is null and new.user_id is not null
     and exists (select 1 from app.account_provisioning ap
                 where ap.student_id = new.id and ap.auth_user_id is not null and ap.auth_user_id <> new.user_id) then
    raise exception 'app.students_user_frozen: a student once linked is never linked to another account' using errcode = 'P0004';
  end if;
  return new;
end
$$;

-- The memory has to exist for every student, also in a sandbox, where the provisioning row is not_applicable and the
-- link RPC doesn't write auth_user_id. The first link records it; T1.F10's guard keeps it from changing after that.
create function app.students_record_account() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.user_id is null and new.user_id is not null then
    update app.account_provisioning ap set auth_user_id = new.user_id
     where ap.student_id = new.id and ap.auth_user_id is null;
  end if;
  return null;
end
$$;
create trigger students_record_account after update of user_id on app.students
  for each row execute function app.students_record_account();

-- invitations.accepted_by: it is set only by the acceptance itself (the same update that sets accepted_at), goes to
-- NULL only when its app_user is deleted, and accepted_at never changes once set.
create or replace function app.invitations_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    raise exception 'app.invitations_frozen: email never changes' using errcode = 'P0004';
  end if;
  if new.invited_by is distinct from old.invited_by and new.invited_by is not null then
    raise exception 'app.invitations_frozen: invited_by only goes to null' using errcode = 'P0004';
  end if;
  if old.accepted_at is not null and new.accepted_at is distinct from old.accepted_at then
    raise exception 'app.invitations_frozen: accepted_at never changes once set' using errcode = 'P0004';
  end if;
  if new.accepted_by is distinct from old.accepted_by and new.accepted_by is not null
     and not (old.accepted_at is null and new.accepted_at is not null) then
    raise exception 'app.invitations_frozen: accepted_by is set only by the acceptance' using errcode = 'P0004';
  end if;
  if old.accepted_by is not null and new.accepted_by is null
     and exists (select 1 from app.app_users u where u.id = old.accepted_by) then
    raise exception 'app.invitations_frozen: accepted_by only goes to null when the account is deleted' using errcode = 'P0004';
  end if;
  return new;
end
$$;
