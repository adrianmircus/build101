-- T1.F15: the exhaustive sweep of the closing review (F1-4, round 8). Three medium paths, none high.
--
-- 1. Two direct writers at once. The link read the provisioning row without a lock: while another transaction had
--    written auth_user_id = B and not committed yet, the link to A saw NULL and went ahead, and the AFTER trigger
--    recorded nothing (its WHERE auth_user_id IS NULL was re-checked after B committed). The student ended linked to
--    A remembering B. Now the link locks the provisioning row (FOR UPDATE waits for the other writer and reads what it
--    committed) and the AFTER trigger fails if the row doesn't end up remembering the account. Lock order: the student
--    row (the UPDATE) and then its provisioning row, the same order internal_link_student_user takes (student FOR
--    UPDATE, then provisioning FOR UPDATE), so the RPC and a direct link never wait on each other in a cycle.
--    consents needs no change to its UPDATE guard: born empty, revoked_by can only be set by granted → revoked.
--    A provisioning row that gets its account while the student is linked to another one is refused as well.
-- 2. invitations.accepted_by could be born set (A) and replaced by B at the acceptance.
-- 3. consents.revoked_by could be born set (A) and replaced by B at the revocation.
--    Both are born empty now, and are set once, from NULL, by the acceptance or the revocation.

create or replace function app.students_user_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_found boolean;
  v_account uuid;
begin
  if old.user_id is not null and new.user_id is not null and new.user_id <> old.user_id then
    raise exception 'app.students_user_frozen: user_id never moves to another account' using errcode = 'P0004';
  end if;
  if old.user_id is not null and new.user_id is null
     and exists (select 1 from app.app_users u where u.id = old.user_id) then
    raise exception 'app.students_user_frozen: user_id only goes to null when the account is deleted' using errcode = 'P0004';
  end if;
  if old.user_id is null and new.user_id is not null then
    select true, ap.auth_user_id into v_found, v_account
      from app.account_provisioning ap where ap.student_id = new.id for update;
    if v_found is null then
      raise exception 'app.students_user_frozen: a student without its provisioning row is never linked' using errcode = 'P0004';
    end if;
    if v_account is not null and v_account <> new.user_id then
      raise exception 'app.students_user_frozen: a student once linked is never linked to another account' using errcode = 'P0004';
    end if;
  end if;
  return new;
end
$$;

create or replace function app.students_record_account() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.user_id is null and new.user_id is not null then
    update app.account_provisioning ap set auth_user_id = new.user_id
     where ap.student_id = new.id and ap.auth_user_id is null;
    if not exists (select 1 from app.account_provisioning ap where ap.student_id = new.id and ap.auth_user_id = new.user_id) then
      raise exception 'app.students_record_account: the provisioning row has to remember the account of the link' using errcode = 'P0004';
    end if;
  end if;
  return null;
end
$$;

create or replace function app.account_provisioning_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.student_id is distinct from old.student_id and new.student_id is not null then
    raise exception 'app.account_provisioning_frozen: student_id only goes to null' using errcode = 'P0004';
  end if;
  if old.student_id is not null and new.student_id is null
     and exists (select 1 from app.students s where s.id = old.student_id) then
    raise exception 'app.account_provisioning_frozen: student_id only goes to null when the student is deleted' using errcode = 'P0004';
  end if;
  if old.auth_user_id is not null and new.auth_user_id is distinct from old.auth_user_id then
    raise exception 'app.account_provisioning_frozen: auth_user_id never changes once set' using errcode = 'P0004';
  end if;
  if old.auth_user_id is null and new.auth_user_id is not null
     and exists (select 1 from app.students s
                  where s.id = new.student_id and s.user_id is not null and s.user_id <> new.auth_user_id) then
    raise exception 'app.account_provisioning_frozen: a linked student''s provisioning row remembers its account' using errcode = 'P0004';
  end if;
  if new.op_key is distinct from old.op_key then
    raise exception 'app.account_provisioning_frozen: op_key never changes' using errcode = 'P0004';
  end if;
  if new.op_identity is distinct from old.op_identity
     and not (new.op_identity is null and old.institution_id is not null
              and app.erasure_in_force() is not distinct from old.institution_id) then
    raise exception 'app.account_provisioning_frozen: op_identity only goes to null inside the erasure of its institution' using errcode = 'P0004';
  end if;
  return new;
end
$$;

-- invitations: accepted_by is born empty and set once, from NULL, by the acceptance.
create function app.invitations_born() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.accepted_by is not null then
    raise exception 'app.invitations_born: an invitation is created without whoever accepts it' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger invitations_born before insert on app.invitations
  for each row execute function app.invitations_born();

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
     and not (old.accepted_by is null and old.accepted_at is null and new.accepted_at is not null) then
    raise exception 'app.invitations_frozen: accepted_by is set only by the acceptance' using errcode = 'P0004';
  end if;
  if old.accepted_by is not null and new.accepted_by is null
     and exists (select 1 from app.app_users u where u.id = old.accepted_by) then
    raise exception 'app.invitations_frozen: accepted_by only goes to null when the account is deleted' using errcode = 'P0004';
  end if;
  return new;
end
$$;

-- consents: revoked_by is born empty and set once, from NULL, by the revocation. The rest is the guard of T1.F2.
create function app.consents_born() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.revoked_by is not null then
    raise exception 'app.consents_born: a consent is recorded without whoever revokes it' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger consents_born before insert on app.consents
  for each row execute function app.consents_born();
