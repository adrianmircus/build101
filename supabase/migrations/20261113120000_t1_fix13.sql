-- T1.F13: TRUNCATE skips every row guard (F1-4, round 6).
-- The guards of phase 1 are BEFORE UPDATE / DELETE row triggers; TRUNCATE runs none of them. Truncating
-- account_provisioning and inserting an empty row for the student forgot its first account, and the same holds for
-- every memory the guards keep (history, op_key identities, erasure marks). No RPC, seed or test truncates an app
-- table, and the API roles have no TRUNCATE privilege; the owner doesn't get to either. A pgTAP test (024b) checks that
-- every table of app has this trigger, so a new table can't be added without it.
-- Out of scope, as in every round: DDL by the owner (DISABLE TRIGGER, CREATE OR REPLACE of a guard) changes the rules
-- themselves and goes through a reviewed migration.

create function app.no_truncate() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'app.no_truncate: % is never truncated', tg_table_name using errcode = 'P0004';
end
$$;

do $$
declare
  v_table text;
begin
  for v_table in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'app' and c.relkind in ('r', 'p') order by c.relname
  loop
    execute format('create trigger %I before truncate on app.%I for each statement execute function app.no_truncate()',
                   v_table || '_no_truncate', v_table);
  end loop;
end
$$;

-- A provisioning row created after the student was linked (a row lost some other way, recreated by hand) has to
-- remember the account the student has now; an empty row would read as "never linked".
create function app.account_provisioning_born() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from app.students s
              where s.id = new.student_id and s.user_id is not null and s.user_id is distinct from new.auth_user_id) then
    raise exception 'app.account_provisioning_born: a linked student''s provisioning row remembers its account' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger account_provisioning_born before insert on app.account_provisioning
  for each row execute function app.account_provisioning_born();
