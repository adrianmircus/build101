-- T1.F10: the last immutability guards of phase 1 (Codex's closing review, round 3, F1-4).
-- Rule: technical identities (ids, keys of a window), ownership (whom a row belongs to) and operation identity
-- (op_key, op_identity, kind) never change. The only documented transitions are to NULL: the actors that a foreign
-- key sets to NULL when the account is deleted, student_id of the erasure, and op_identity of account_provisioning
-- inside the erasure mode in force for the institution (docs/contratos/fase-1.md, "Seudónimos y supresiones").
-- No column is added. CREATE OR REPLACE of guards that exist, new triggers for tables that had none, and one foreign
-- key removed (generations.requested_by, see below).

-- ---------------------------------------------------------------------------------------------
-- account_provisioning: auth_user_id once set never changes (not even to NULL: the contract keeps the UUID after the Auth
-- account is deleted and no foreign key sets it to NULL); op_key never changes; op_identity only goes to NULL inside the
-- erasure of the institution (it allows checking candidate usernames, so the erasure forgets it; the op_key stays).
-- ---------------------------------------------------------------------------------------------
create or replace function app.account_provisioning_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.student_id is distinct from old.student_id and new.student_id is not null then
    raise exception 'app.account_provisioning_frozen: student_id only goes to null' using errcode = 'P0004';
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

-- ---------------------------------------------------------------------------------------------
-- generations: requested_by is a historical actor. It has no foreign key (like the actors of the history tables): deleting
-- the account leaves the id as it was, and the guard freezes it. The rest of the guard is the one of T1.4d.
-- ---------------------------------------------------------------------------------------------
alter table app.generations drop constraint generations_requested_by_fkey;

create or replace function app.generations_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'running' and new.status is distinct from old.status then
    raise exception 'app.generations_guard: a finished generation never reopens' using errcode = 'P0004';
  end if;
  -- Inside an erasure only inputs may change (redacting a student's free text); the rest never.
  if new.version_id <> old.version_id or new.kind <> old.kind or new.op_key <> old.op_key
     or new.profiles_hash <> old.profiles_hash or new.profiles_revision <> old.profiles_revision or new.prompt_version <> old.prompt_version
     or new.required_jobs <> old.required_jobs or new.subject_id <> old.subject_id or new.target_revision <> old.target_revision
     or (new.inputs <> old.inputs
         and not app.redaction_allowed('generations', new.institution_id, to_jsonb(old), to_jsonb(new)))
     or new.target_exercise_id is distinct from old.target_exercise_id
     or new.requested_by is distinct from old.requested_by then
    raise exception 'app.generations_guard: what a generation was asked never changes' using errcode = 'P0004';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- invitations: the addressee never changes, not even after accepting.
-- ---------------------------------------------------------------------------------------------
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
  if old.accepted_by is not null and new.accepted_by is distinct from old.accepted_by and new.accepted_by is not null then
    raise exception 'app.invitations_frozen: accepted_by only goes to null once set' using errcode = 'P0004';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- operations and import_runs: the identity of the operation (it holds the retries). The erasure never forgets these.
-- ---------------------------------------------------------------------------------------------
create or replace function app.operations_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id is distinct from old.group_id
     or (old.assessment_id is not null and new.assessment_id is distinct from old.assessment_id)
     or (old.file_id is not null and new.file_id is distinct from old.file_id) then
    raise exception 'app.operations_frozen: group_id, assessment_id and file_id never change' using errcode = 'P0004';
  end if;
  if new.op_key is distinct from old.op_key or new.kind is distinct from old.kind then
    raise exception 'app.operations_frozen: op_key and kind never change' using errcode = 'P0004';
  end if;
  if new.requested_by is distinct from old.requested_by and new.requested_by is not null then
    raise exception 'app.operations_frozen: requested_by only goes to null' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create or replace function app.import_runs_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.op_key is distinct from old.op_key then
    raise exception 'app.import_runs_frozen: op_key never changes' using errcode = 'P0004';
  end if;
  if new.user_id is distinct from old.user_id and new.user_id is not null then
    raise exception 'app.import_runs_frozen: user_id only goes to null' using errcode = 'P0004';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Technical identities of tables with no ownership guard: subjects.id, rate_limits.key and window_start,
-- student_rpc_windows.id and txid (the deferred check of the window reads txid at commit).
-- ---------------------------------------------------------------------------------------------
create function app.subjects_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'app.subjects_frozen: id and created_at never change' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger subjects_frozen before update on app.subjects
  for each row execute function app.subjects_frozen();

create function app.rate_limits_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.key is distinct from old.key or new.window_start is distinct from old.window_start then
    raise exception 'app.rate_limits_frozen: key and window_start never change' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger rate_limits_frozen before update on app.rate_limits
  for each row execute function app.rate_limits_frozen();

create function app.student_rpc_windows_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.txid is distinct from old.txid or new.created_at is distinct from old.created_at then
    raise exception 'app.student_rpc_windows_frozen: id, txid and created_at never change' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger student_rpc_windows_frozen before update on app.student_rpc_windows
  for each row execute function app.student_rpc_windows_frozen();

-- ---------------------------------------------------------------------------------------------
-- The final sweep of the 45 tables found four more identity columns that nothing froze:
--   files.bucket, path and purpose (the object a row stands for: rewriting path points it at another object);
--   institutions.code and kind (code is the natural key of internal_create_institution; kind decides sandbox vs school);
--   erasures.kind (student or institution);
--   assessments.source_file_id once set (the original the practice came from, like operations.file_id).
-- No RPC updates any of them.
-- ---------------------------------------------------------------------------------------------
create or replace function app.files_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id is distinct from old.group_id or new.student_id is distinct from old.student_id then
    raise exception 'app.files_frozen: group_id and student_id never change' using errcode = 'P0004';
  end if;
  if new.bucket is distinct from old.bucket or new.path is distinct from old.path or new.purpose is distinct from old.purpose then
    raise exception 'app.files_frozen: bucket, path and purpose never change' using errcode = 'P0004';
  end if;
  if new.reserved_by is distinct from old.reserved_by and new.reserved_by is not null then
    raise exception 'app.files_frozen: reserved_by only goes to null' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create or replace function app.institutions_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is distinct from old.code or new.kind is distinct from old.kind then
    raise exception 'app.institutions_frozen: code and kind never change' using errcode = 'P0004';
  end if;
  if old.owner_user_id is not null and new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'app.institutions_frozen: owner_user_id never changes' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create or replace function app.erasures_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'app.erasures_frozen: kind never changes' using errcode = 'P0004';
  end if;
  if old.pseudonym_id is not null and new.pseudonym_id is distinct from old.pseudonym_id then
    raise exception 'app.erasures_frozen: pseudonym_id never changes' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create or replace function app.assessments_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id is distinct from old.group_id or new.subject_id is distinct from old.subject_id then
    raise exception 'app.assessments_frozen: group_id and subject_id never change' using errcode = 'P0004';
  end if;
  if old.source_file_id is not null and new.source_file_id is distinct from old.source_file_id then
    raise exception 'app.assessments_frozen: source_file_id never changes once set' using errcode = 'P0004';
  end if;
  if new.created_by is distinct from old.created_by and new.created_by is not null then
    raise exception 'app.assessments_frozen: created_by only goes to null' using errcode = 'P0004';
  end if;
  if old.status = 'archived' and new.status <> 'archived' then
    raise exception 'app.assessments_frozen: an archived assessment is not reopened' using errcode = 'P0004';
  end if;
  return new;
end
$$;
