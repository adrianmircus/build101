-- T1.F9: the last two ownership guards of the closing review (F1-4, round 2).
-- student_pseudonyms has no touch_row, so its institution could be rewritten once the pseudonym is unlinked;
-- account_provisioning.auth_user_id, once set, could be swapped for another account and hand over the student.

create or replace function app.student_pseudonyms_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.institution_id is distinct from old.institution_id
     or new.created_at is distinct from old.created_at then
    raise exception 'app.student_pseudonyms_frozen: id, institution_id and created_at never change' using errcode = 'P0004';
  end if;
  -- The erasure unlinks it: student_id goes to NULL, never to another student.
  if new.student_id is distinct from old.student_id and new.student_id is not null then
    raise exception 'app.student_pseudonyms_frozen: student_id only goes to null' using errcode = 'P0004';
  end if;
  return new;
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
  -- An account is linked once; after that it only goes to NULL (the Auth account is deleted on erasure).
  if old.auth_user_id is not null and new.auth_user_id is not null and new.auth_user_id <> old.auth_user_id then
    raise exception 'app.account_provisioning_frozen: auth_user_id never moves to another account' using errcode = 'P0004';
  end if;
  return new;
end
$$;
