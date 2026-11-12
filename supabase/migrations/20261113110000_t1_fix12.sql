-- T1.F12: the memory of a student's first account has to live as long as the student (F1-4, round 5).
-- T1.F11 made account_provisioning.auth_user_id the memory that keeps students.user_id from going A → NULL → B. An
-- owner could still lose it: put student_id = NULL on the provisioning row (or delete the row), delete Auth A, and
-- link the student to B. Three rules close it:
--   1. account_provisioning.student_id goes to NULL only when the student row is gone (the FK's ON DELETE SET NULL,
--      which runs after the parent row is deleted: the erasure deletes the student, docs/contratos/fase-1.md).
--   2. A provisioning row is deleted only with its student or its institution (the cascades), never on its own.
--   3. A student is linked to an account only when it has its provisioning row (every student gets one at creation,
--      also in a sandbox as not_applicable), so a missing memory is never read as "never linked".

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

-- In a cascade from the institution the institution row is already gone when this runs; the student may not be yet.
create function app.account_provisioning_kept() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.student_id is not null
     and exists (select 1 from app.students s where s.id = old.student_id)
     and exists (select 1 from app.institutions i where i.id = old.institution_id) then
    raise exception 'app.account_provisioning_kept: a provisioning row is not deleted while its student exists' using errcode = 'P0004';
  end if;
  return old;
end
$$;
create trigger account_provisioning_kept before delete on app.account_provisioning
  for each row execute function app.account_provisioning_kept();

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
     and not exists (select 1 from app.account_provisioning ap where ap.student_id = new.id) then
    raise exception 'app.students_user_frozen: a student without its provisioning row is never linked' using errcode = 'P0004';
  end if;
  if old.user_id is null and new.user_id is not null
     and exists (select 1 from app.account_provisioning ap
                 where ap.student_id = new.id and ap.auth_user_id is not null and ap.auth_user_id <> new.user_id) then
    raise exception 'app.students_user_frozen: a student once linked is never linked to another account' using errcode = 'P0004';
  end if;
  return new;
end
$$;
