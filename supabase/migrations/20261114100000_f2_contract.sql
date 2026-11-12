-- Contract, phase 2 (docs/contratos/fase-2.md, version 11): closed tables and columns, their guards, and the stubs of the
-- new RPCs.
--
-- Tables born closed as in phase 1: RLS enabled and forced, no policies, no grants, app.no_truncate.
-- Stubs answer UNAVAILABLE/not_implemented until the ticket that owns each one replaces the body with
-- CREATE OR REPLACE in a new migration, keeping the exact signature (changing it is a contract change:
-- BLOQUEADO). No GRANT here: the implementing ticket grants EXECUTE to authenticated for user RPCs and
-- to service_role for internal_* ones. In api nothing has a default grant, and EXECUTE for PUBLIC is
-- revoked by the default privileges of postgres (20261111120000_revoke_defaults.sql).
-- app.rpc_begin() is not changed here: the check of the live session is T2.7.

-- An issue of cards: one transaction, kept for idempotency. It never changes (issued_by only goes to NULL with the account). It
-- keeps no student ids: op_identity is the sha256 (hex) of the group and the sorted set of students, only to compare repeats.
create table app.access_card_issues (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  group_id uuid not null,
  op_key uuid not null,
  op_identity text not null check (op_identity ~ '^[0-9a-f]{64}$'),
  issued_by uuid references app.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (institution_id, id),
  unique (institution_id, op_key),
  -- No cascade (F2C-73): a group with issues is not deleted, it is archived. NO ACTION and not RESTRICT, so that deleting the whole
  -- institution, which takes everything in the same statement, still works.
  foreign key (institution_id, group_id) references app.groups (institution_id, id)
);

-- An access card: the QR that fills in the school and the username. One active per student.
create table app.access_cards (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  student_id uuid not null,
  issue_id uuid not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (institution_id, id),
  foreign key (institution_id, student_id) references app.students (institution_id, id) on delete cascade,
  foreign key (institution_id, issue_id) references app.access_card_issues (institution_id, id) on delete cascade,
  check ((status = 'revoked') = (revoked_at is not null))
);
create unique index access_cards_active_key on app.access_cards (student_id) where status = 'active';

-- The password of a student: a scrypt hash, never in Auth. A credential: sensitive, for the server only.
create table app.student_credentials (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  student_id uuid not null unique,
  password_hash text not null check (password_hash ~ '^scrypt[$]15[$]8[$]1[$][A-Za-z0-9+/=]+[$][A-Za-z0-9+/=]+$'),
  -- Goes up with every card: the login compares it before it hands over the session.
  version integer not null default 1 check (version >= 1),
  -- The issue that put this hash: the current one, not the first.
  issue_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, id),
  foreign key (institution_id, student_id) references app.students (institution_id, id) on delete cascade,
  foreign key (institution_id, issue_id) references app.access_card_issues (institution_id, id) on delete cascade
);

-- The sessions of the students that our server registered at the bind (F2C-75). Nothing in it changes: it is inserted (the bind)
-- or deleted (a new card, or the cascade of the student).
create table app.student_sessions (
  session_id uuid primary key,
  institution_id uuid not null references app.institutions (id) on delete cascade,
  student_id uuid not null,
  version integer not null check (version >= 1),
  created_at timestamptz not null default now(),
  foreign key (institution_id, student_id) references app.students (institution_id, id) on delete cascade
);

-- Register of every invitation hash that ever existed. A hash enters once, through the unique index, and is not deleted
-- while its institution exists: so it is never born again, neither step by step nor with two connections.
create table app.invitation_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  invitation_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (institution_id, invitation_id) references app.invitations (institution_id, id) on delete cascade
);

-- Invitations: idempotency and when the email of the current token went out.
alter table app.invitations add column op_key uuid;
alter table app.invitations add column op_identity text;
alter table app.invitations add column sent_at timestamptz;
create unique index invitations_op_key on app.invitations (institution_id, op_key) where op_key is not null;

alter table app.access_card_issues enable row level security;
alter table app.access_card_issues force row level security;
alter table app.access_cards enable row level security;
alter table app.access_cards force row level security;
alter table app.invitation_tokens enable row level security;
alter table app.invitation_tokens force row level security;
alter table app.student_credentials enable row level security;
alter table app.student_credentials force row level security;
alter table app.student_sessions enable row level security;
alter table app.student_sessions force row level security;

create trigger access_card_issues_no_truncate before truncate on app.access_card_issues
  for each statement execute function app.no_truncate();
create trigger access_cards_no_truncate before truncate on app.access_cards
  for each statement execute function app.no_truncate();
create trigger invitation_tokens_no_truncate before truncate on app.invitation_tokens
  for each statement execute function app.no_truncate();
create trigger student_credentials_no_truncate before truncate on app.student_credentials
  for each statement execute function app.no_truncate();
create trigger student_sessions_no_truncate before truncate on app.student_sessions
  for each statement execute function app.no_truncate();

create function app.student_sessions_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'app.student_sessions_frozen: a registered session never changes' using errcode = 'P0004';
end
$$;
create trigger student_sessions_frozen before update on app.student_sessions
  for each row execute function app.student_sessions_frozen();
create trigger student_credentials_touch before update on app.student_credentials
  for each row execute function app.touch_row();

-- Born in the first state: a card is born active.
create function app.access_cards_born() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'active' or new.revoked_at is not null then
    raise exception 'app.access_cards_born: a card is born active' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger access_cards_born before insert on app.access_cards
  for each row execute function app.access_cards_born();

-- Ownership and states (phase 1, T1.F8 and T1.F15): an issue never changes, and issued_by only goes to NULL when the account is
-- deleted; a card goes from active to revoked and no further; a credential keeps its owners.
create function app.access_card_issues_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'issued_by') is distinct from (to_jsonb(old) - 'issued_by') then
    raise exception 'app.access_card_issues_frozen: an issue never changes' using errcode = 'P0004';
  end if;
  if new.issued_by is distinct from old.issued_by
     and not (new.issued_by is null and old.issued_by is not null
              and not exists (select 1 from app.app_users u where u.id = old.issued_by)) then
    raise exception 'app.access_card_issues_frozen: issued_by only goes to null when the account is deleted' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger access_card_issues_frozen before update on app.access_card_issues
  for each row execute function app.access_card_issues_frozen();

create function app.access_cards_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'app.access_cards_frozen: id and created_at never change' using errcode = 'P0004';
  end if;
  if new.institution_id is distinct from old.institution_id or new.student_id is distinct from old.student_id
     or new.issue_id is distinct from old.issue_id then
    raise exception 'app.access_cards_frozen: institution_id, student_id and issue_id never change' using errcode = 'P0004';
  end if;
  if new.token_hash is distinct from old.token_hash then
    raise exception 'app.access_cards_frozen: token_hash never changes' using errcode = 'P0004';
  end if;
  if new.status is distinct from old.status and not (old.status = 'active' and new.status = 'revoked') then
    raise exception 'app.access_cards_frozen: active goes to revoked, and revoked is final' using errcode = 'P0004';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'app.access_cards_frozen: revoked_at never changes once set' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger access_cards_frozen before update on app.access_cards
  for each row execute function app.access_cards_frozen();

create function app.student_credentials_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.institution_id is distinct from old.institution_id or new.student_id is distinct from old.student_id then
    raise exception 'app.student_credentials_frozen: institution_id and student_id never change' using errcode = 'P0004';
  end if;
  -- password_hash, issue_id and version change together or not at all; if they change, the issue is another one and the
  -- version goes up by exactly one.
  if new.password_hash is distinct from old.password_hash or new.issue_id is distinct from old.issue_id
     or new.version is distinct from old.version then
    if new.issue_id is not distinct from old.issue_id or new.version is distinct from old.version + 1 then
      raise exception 'app.student_credentials_frozen: a new hash comes with another issue and the next version' using errcode = 'P0004';
    end if;
  end if;
  return new;
end
$$;
create trigger student_credentials_frozen before update on app.student_credentials
  for each row execute function app.student_credentials_frozen();

-- Memory of the revoked: a card or an issue is deleted only with its student, its group or its institution (the cascade
-- runs after the parent is gone), so a revoked hash never comes back as a current one. Not even the owner deletes one by hand.
create function app.access_cards_kept() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from app.students s where s.id = old.student_id)
     and exists (select 1 from app.access_card_issues i where i.id = old.issue_id)
     and exists (select 1 from app.institutions n where n.id = old.institution_id) then
    raise exception 'app.access_cards_kept: a card goes only with its student' using errcode = 'P0004';
  end if;
  return old;
end
$$;
create trigger access_cards_kept before delete on app.access_cards
  for each row execute function app.access_cards_kept();

create function app.access_card_issues_kept() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from app.institutions n where n.id = old.institution_id) then
    raise exception 'app.access_card_issues_kept: an issue goes only with its institution' using errcode = 'P0004';
  end if;
  return old;
end
$$;
create trigger access_card_issues_kept before delete on app.access_card_issues
  for each row execute function app.access_card_issues_kept();

-- A credential is deleted only with its student (or its issue or institution, which go after the student or the group).
create function app.student_credentials_kept() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from app.students s where s.id = old.student_id)
     and exists (select 1 from app.access_card_issues i where i.id = old.issue_id)
     and exists (select 1 from app.institutions n where n.id = old.institution_id) then
    raise exception 'app.student_credentials_kept: a credential goes only with its student' using errcode = 'P0004';
  end if;
  return old;
end
$$;
create trigger student_credentials_kept before delete on app.student_credentials
  for each row execute function app.student_credentials_kept();

-- Registered hashes are born with the invitation and never change.
create function app.invitation_tokens_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'app.invitation_tokens_frozen: a registered hash never changes' using errcode = 'P0004';
end
$$;
create trigger invitation_tokens_frozen before update on app.invitation_tokens
  for each row execute function app.invitation_tokens_frozen();

-- Memory: while the institution exists, neither an invitation nor a registered hash is deleted (the cascade of the
-- institution runs after it is gone). A hash never comes back by DELETE and INSERT.
create function app.invitations_kept() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from app.institutions n where n.id = old.institution_id) then
    raise exception 'app.invitations_kept: an invitation goes only with its institution' using errcode = 'P0004';
  end if;
  return old;
end
$$;
create trigger invitations_kept before delete on app.invitations
  for each row execute function app.invitations_kept();
create trigger invitation_tokens_kept before delete on app.invitation_tokens
  for each row execute function app.invitations_kept();

-- Invitations. Born pending (and, as in phase 1, without whoever accepts).
create or replace function app.invitations_born() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.accepted_by is not null then
    raise exception 'app.invitations_born: an invitation is created without whoever accepts it' using errcode = 'P0004';
  end if;
  if new.status <> 'pending' then
    raise exception 'app.invitations_born: an invitation is born pending' using errcode = 'P0004';
  end if;
  return new;
end
$$;

-- The current guard (20261113140000_t1_fix15.sql) plus: op_key and op_identity never change; accepted and revoked are
-- final; token_hash changes only in the step to pending (pending or expired to pending). The registry of hashes is kept by
-- the AFTER trigger below.
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
  if new.op_key is distinct from old.op_key or new.op_identity is distinct from old.op_identity then
    raise exception 'app.invitations_frozen: op_key and op_identity never change' using errcode = 'P0004';
  end if;
  if new.status is distinct from old.status
     and not ((old.status = 'pending' and new.status in ('accepted', 'revoked', 'expired'))
              or (old.status = 'expired' and new.status in ('pending', 'revoked'))) then
    raise exception 'app.invitations_frozen: accepted and revoked are final' using errcode = 'P0004';
  end if;
  if old.status = 'expired' and new.status = 'pending' and new.token_hash is not distinct from old.token_hash then
    raise exception 'app.invitations_frozen: an expired invitation goes back to pending only with a new token_hash' using errcode = 'P0004';
  end if;
  if new.token_hash is distinct from old.token_hash then
    if not (old.status in ('pending', 'expired') and new.status = 'pending') then
      raise exception 'app.invitations_frozen: token_hash changes only in the step to pending' using errcode = 'P0004';
    end if;
  end if;
  return new;
end
$$;

-- Every hash that is born or arrives at an invitation goes into the registry in the same statement, with a plain insert: if it
-- was ever there, the unique index refuses it (and waits for a concurrent transaction inserting it, at any isolation
-- level). The unique_violation becomes P0004. There is no "current" or "spent": the current one is the one the invitation
-- has, and every other is history.
create function app.invitations_register_hash() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.token_hash is not distinct from old.token_hash then
    return null;
  end if;
  begin
    insert into app.invitation_tokens (token_hash, institution_id, invitation_id) values (new.token_hash, new.institution_id, new.id);
  exception when unique_violation then
    raise exception 'app.invitations_register_hash: a hash that existed is never used again' using errcode = 'P0004';
  end;
  return null;
end
$$;
create trigger invitations_register_hash after insert or update of token_hash on app.invitations
  for each row execute function app.invitations_register_hash();

-- deleted is final: a provisioning row of an erased student never goes to another state. Against the owner too.
create function app.account_provisioning_deleted_final() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'deleted' and new.status is distinct from old.status then
    raise exception 'app.account_provisioning_deleted_final: deleted never changes state' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger account_provisioning_deleted_final before update on app.account_provisioning
  for each row execute function app.account_provisioning_deleted_final();

-- A deleted provisioning row is not deleted while its institution exists, even when its student is gone: it is the mark that keeps
-- the account of an erased student from being born again. (The guard of 20261113110000_t1_fix12.sql, plus the deleted mark.)
create or replace function app.account_provisioning_kept() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from app.institutions i where i.id = old.institution_id)
     and ((old.student_id is not null and exists (select 1 from app.students s where s.id = old.student_id))
          or old.status = 'deleted') then
    raise exception 'app.account_provisioning_kept: a provisioning row is not deleted while its student exists, nor a deleted mark while its institution does' using errcode = 'P0004';
  end if;
  return old;
end
$$;

-- The Auth accounts of the students have a fixed shape (docs/contratos/fase-2.md, «Cómo entra un estudiante»): for every remembered
-- id the email is exactly <id>@estudiantes.usetiza.app (also NULL or another domain is refused, on INSERT too) and a synthetic email
-- belongs only to a remembered row that is not deleted; on INSERT the password is set to NULL (createUser without a password
-- still makes a random one, which nobody knows and which is erased before it is stored); on UPDATE a remembered account keeps no
-- password, its id never changes, and its email and password never change in value (values, not columns: GoTrue may rewrite
-- the whole row on a login). Staff accounts are not touched. SECURITY DEFINER because supabase_auth_admin has no access to app.
-- Both ends of the relation take the same advisory lock on the id first (app.student_auth_lock), and refuse (40001) outside READ COMMITTED, where the next query would not see what the other one committed.
-- Order of the locks (F2C-70): always the row of account_provisioning first and the advisory lock after. On the side of
-- account_provisioning the row is already locked by the INSERT or UPDATE itself when its trigger runs.
create function app.student_auth_lock(p_a uuid, p_b uuid default null) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('student_auth:' || least(p_a, coalesce(p_b, p_a))::text, 0));
  if p_b is not null and p_b <> p_a then
    perform pg_advisory_xact_lock(hashtextextended('student_auth:' || greatest(p_a, p_b)::text, 0));
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'app.student_auth_lock: needs READ COMMITTED to see what the other end committed' using errcode = '40001';
  end if;
end
$$;

-- The only trigger on auth.users (it absorbs the old birth guard). In this order: FOR SHARE of the provisioning rows with the old and
-- the new id (if they exist), the advisory lock of those ids in order, and then every check.
create function app.student_auth_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain constant text := '@estudiantes.usetiza.app';
  v_remembered boolean;
  v_old_remembered boolean := false;
begin
  perform 1 from app.account_provisioning ap
   where ap.auth_user_id = new.id or (tg_op = 'UPDATE' and ap.auth_user_id = old.id)
   order by ap.id for share;
  perform app.student_auth_lock(new.id, case when tg_op = 'UPDATE' then old.id end);
  v_remembered := exists (select 1 from app.account_provisioning ap where ap.auth_user_id = new.id);
  -- Suppress wins: an account whose id is remembered in a deleted row is not born, nor armed by an UPDATE of the id.
  if (tg_op = 'INSERT' or new.id is distinct from old.id)
     and exists (select 1 from app.account_provisioning ap where ap.auth_user_id = new.id and ap.status = 'deleted') then
    raise exception 'app.student_auth_guard: the account of an erased student is not born again' using errcode = 'P0004';
  end if;
  if v_remembered and lower(coalesce(new.email, '')) is distinct from new.id::text || v_domain then
    raise exception 'app.student_auth_guard: the email of the account of a student is exactly its id at the synthetic domain' using errcode = 'P0004';
  end if;
  if lower(coalesce(new.email, '')) like '%' || v_domain
     and not (lower(new.email) = new.id::text || v_domain
              and exists (select 1 from app.account_provisioning ap where ap.auth_user_id = new.id and ap.status <> 'deleted')) then
    raise exception 'app.student_auth_guard: a synthetic email is exactly <id> of a remembered account' using errcode = 'P0004';
  end if;
  if tg_op = 'INSERT' then
    -- createUser without a password still makes a random one, which nobody knows: it is erased before it is stored.
    if v_remembered then
      new.encrypted_password := null;
    end if;
    return new;
  end if;
  v_old_remembered := exists (select 1 from app.account_provisioning ap where ap.auth_user_id = old.id);
  if v_remembered and coalesce(new.encrypted_password, '') <> '' then
    raise exception 'app.student_auth_guard: the Auth account of a student has no password' using errcode = 'P0004';
  end if;
  if new.id is distinct from old.id
     and (v_old_remembered or v_remembered
          or lower(coalesce(old.email, '')) like '%' || v_domain or lower(coalesce(new.email, '')) like '%' || v_domain) then
    raise exception 'app.student_auth_guard: the id of the account of a student never changes' using errcode = 'P0004';
  end if;
  if v_old_remembered and (new.email is distinct from old.email or new.encrypted_password is distinct from old.encrypted_password) then
    raise exception 'app.student_auth_guard: the password and the email of the account of a student never change' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger student_auth_guard before insert or update on auth.users
  for each row execute function app.student_auth_guard();

-- The other end: an id is remembered only if the row of Auth with that id, when there already is one, has the fixed shape. The row
-- of account_provisioning is already locked by the INSERT or UPDATE itself, so the advisory lock comes second, as in the guard above.
create function app.student_auth_link_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new uuid := new.auth_user_id;
  v_old uuid := case when tg_op = 'UPDATE' then old.auth_user_id end;
begin
  if v_new is null and v_old is null then
    return new;
  end if;
  -- Also when the status changes (an erasure marks the row deleted): the advisory lock of the remembered id, old and new in order.
  perform app.student_auth_lock(coalesce(v_new, v_old), v_old);
  if v_new is not null and (tg_op = 'INSERT' or v_new is distinct from v_old)
     and exists (select 1 from auth.users u
                  where u.id = v_new
                    and (lower(coalesce(u.email, '')) is distinct from u.id::text || '@estudiantes.usetiza.app'
                         or coalesce(u.encrypted_password, '') <> '')) then
    raise exception 'app.student_auth_link_guard: the account of Auth with that id does not have the fixed shape' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger student_auth_link_guard before insert or update of auth_user_id, status on app.account_provisioning
  for each row execute function app.student_auth_link_guard();

-- Session (T2.7).
create function api.internal_revoke_user_sessions(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- Attempt limits (T2.7). rate_limits already exists.
create function api.internal_rate_limit_hit(p_keys text[], p_limits integer[], p_window_seconds integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_rate_limit_clear(p_keys text[])
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- Invitations (T2.3).
create function api.create_invitation(p_institution_id uuid, p_email text, p_role text, p_token_hash bytea, p_op_key uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.resend_invitation(p_invitation_id uuid, p_revision integer, p_token_hash bytea)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.revoke_invitation(p_invitation_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.mark_invitation_sent(p_invitation_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.list_invitations(p_institution_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.list_institution_staff(p_institution_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.get_institution_summary(p_institution_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.list_enabled_subjects()
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_get_invitation(p_token_hash bytea)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_create_invitation(p_institution_id uuid, p_email text, p_role text, p_token_hash bytea)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_finish_invitation_signup(p_token_hash bytea, p_user_id uuid, p_display_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.accept_invitation(p_token_hash bytea)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- Student accounts (T2.5a).
create function api.list_taken_usernames(p_institution_id uuid, p_bases text[])
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.list_group_accounts(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.issue_access_cards(p_group_id uuid, p_cards jsonb, p_op_key uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_bind_student_session(p_auth_user_id uuid, p_session_id uuid, p_version integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_get_student_accounts(p_student_ids uuid[])
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- Once implemented it answers {ok: false} also when auth.users already has a row with that id that does not have the fixed shape.
create function api.internal_remember_student_account(p_provisioning_id uuid, p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_fail_student_account(p_provisioning_id uuid, p_error_code text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- Also lists the active rows whose authUserId is no longer in auth.users (an account somebody deleted by hand).
create function api.internal_list_unfinished_accounts(p_limit integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_find_institution(p_code text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_get_student_login(p_code text, p_username text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_resolve_access_card(p_token_hash bytea)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;
