-- T1.F14: a student is born unlinked (F1-4, round 7).
-- The memory of the first account is recorded by the link, an UPDATE of students.user_id (T1.F11, T1.F12). A student
-- inserted with user_id already set skipped it: delete its Auth account, add an empty provisioning row and link it to
-- another one. No RPC inserts a linked student (create_student inserts it with user_id NULL and the provisioning row;
-- internal_link_student_user links it afterwards), so the INSERT is refused: the only way to a first account is the
-- link, which requires the provisioning row and records the account there.

create function app.students_born_unlinked() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is not null then
    raise exception 'app.students_born_unlinked: a student is inserted without an account and linked afterwards' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger students_born_unlinked before insert on app.students
  for each row execute function app.students_born_unlinked();
