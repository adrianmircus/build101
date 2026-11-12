-- Contract, phase 2 (docs/contratos/fase-2.md, version 3): closed tables and columns, their guards, and the stubs of the
-- new RPCs.
--
-- Tables born closed as in phase 1: RLS enabled and forced, no policies, no grants, app.no_truncate.
-- Stubs answer UNAVAILABLE/not_implemented until the ticket that owns each one replaces the body with
-- CREATE OR REPLACE in a new migration, keeping the exact signature (changing it is a contract change:
-- BLOQUEADO). No GRANT here: the implementing ticket grants EXECUTE to authenticated for user RPCs and
-- to service_role for internal_* ones. In api nothing has a default grant, and EXECUTE for PUBLIC is
-- revoked by the default privileges of postgres (20261111120000_revoke_defaults.sql).
-- app.rpc_begin() is not changed here: the check of the live session is T2.7.

-- An issue of cards: the operation that changes passwords in Auth, with a lease. It keeps no student ids: op_identity is the
-- sha256 (hex) of the group and the sorted set of students, only to compare repeats.
create table app.access_card_issues (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  group_id uuid not null,
  op_key uuid not null,
  op_identity text not null check (op_identity ~ '^[0-9a-f]{64}$'),
  issued_by uuid references app.app_users (id) on delete set null,
  status text not null default 'running' check (status in ('running', 'done', 'abandoned')),
  lease_until timestamptz not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (institution_id, id),
  unique (institution_id, op_key),
  foreign key (institution_id, group_id) references app.groups (institution_id, id) on delete cascade,
  check ((status = 'running') = (finished_at is null))
);

-- An access card: the QR that fills in the school and the username.
create table app.access_cards (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  student_id uuid not null,
  issue_id uuid not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  revoked_at timestamptz,
  unique (institution_id, id),
  foreign key (institution_id, student_id) references app.students (institution_id, id) on delete cascade,
  foreign key (institution_id, issue_id) references app.access_card_issues (institution_id, id) on delete cascade,
  check ((status = 'revoked') = (revoked_at is not null)),
  check (status = 'pending' or activated_at is not null or status = 'revoked')
);
create unique index access_cards_active_key on app.access_cards (student_id) where status = 'active';
create unique index access_cards_pending_key on app.access_cards (student_id) where status = 'pending';

-- The invitation hashes that no longer serve (rotated, accepted, revoked): they are never born current again.
create table app.invitation_spent_tokens (
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  invitation_id uuid not null,
  spent_at timestamptz not null default now(),
  foreign key (institution_id, invitation_id) references app.invitations (institution_id, id) on delete cascade
);

-- Invitations: idempotency and when the email of the current token went out.
alter table app.invitations add column op_key uuid;
alter table app.invitations add column op_identity text;
alter table app.invitations add column sent_at timestamptz;
create unique index invitations_op_key on app.invitations (institution_id, op_key) where op_key is not null;

-- The lease of whoever is creating the Auth account of a student. Only the provisioning RPCs change it.
alter table app.account_provisioning add column lease_until timestamptz;

alter table app.access_card_issues enable row level security;
alter table app.access_card_issues force row level security;
alter table app.access_cards enable row level security;
alter table app.access_cards force row level security;
alter table app.invitation_spent_tokens enable row level security;
alter table app.invitation_spent_tokens force row level security;

create trigger access_card_issues_no_truncate before truncate on app.access_card_issues
  for each statement execute function app.no_truncate();
create trigger access_cards_no_truncate before truncate on app.access_cards
  for each statement execute function app.no_truncate();
create trigger invitation_spent_tokens_no_truncate before truncate on app.invitation_spent_tokens
  for each statement execute function app.no_truncate();

-- Born in the first state.
create function app.access_card_issues_born() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'running' then
    raise exception 'app.access_card_issues_born: an issue is born running' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger access_card_issues_born before insert on app.access_card_issues
  for each row execute function app.access_card_issues_born();

create function app.access_cards_born() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'pending' or new.activated_at is not null or new.revoked_at is not null then
    raise exception 'app.access_cards_born: a card is born pending' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger access_cards_born before insert on app.access_cards
  for each row execute function app.access_cards_born();

-- Ownership and states (phase 1, T1.F8 and T1.F15): what says whom a row belongs to never changes (issued_by only goes to
-- NULL when the account is deleted) and states only advance.
create function app.access_card_issues_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'app.access_card_issues_frozen: id and created_at never change' using errcode = 'P0004';
  end if;
  if new.institution_id is distinct from old.institution_id or new.group_id is distinct from old.group_id then
    raise exception 'app.access_card_issues_frozen: institution_id and group_id never change' using errcode = 'P0004';
  end if;
  if new.op_key is distinct from old.op_key then
    raise exception 'app.access_card_issues_frozen: op_key never changes' using errcode = 'P0004';
  end if;
  if new.op_identity is distinct from old.op_identity then
    raise exception 'app.access_card_issues_frozen: op_identity never changes' using errcode = 'P0004';
  end if;
  if new.issued_by is distinct from old.issued_by
     and not (new.issued_by is null and old.issued_by is not null
              and not exists (select 1 from app.app_users u where u.id = old.issued_by)) then
    raise exception 'app.access_card_issues_frozen: issued_by only goes to null when the account is deleted' using errcode = 'P0004';
  end if;
  if new.status is distinct from old.status and not (old.status = 'running' and new.status in ('done', 'abandoned')) then
    raise exception 'app.access_card_issues_frozen: running goes to done or abandoned, and those are final' using errcode = 'P0004';
  end if;
  if old.finished_at is not null and new.finished_at is distinct from old.finished_at then
    raise exception 'app.access_card_issues_frozen: finished_at never changes once set' using errcode = 'P0004';
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
  if new.status is distinct from old.status
     and not ((old.status = 'pending' and new.status in ('active', 'revoked')) or (old.status = 'active' and new.status = 'revoked')) then
    raise exception 'app.access_cards_frozen: pending goes to active or revoked, active to revoked, and revoked is final' using errcode = 'P0004';
  end if;
  if old.activated_at is not null and new.activated_at is distinct from old.activated_at then
    raise exception 'app.access_cards_frozen: activated_at never changes once set' using errcode = 'P0004';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'app.access_cards_frozen: revoked_at never changes once set' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger access_cards_frozen before update on app.access_cards
  for each row execute function app.access_cards_frozen();

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
  if exists (select 1 from app.groups g where g.id = old.group_id)
     and exists (select 1 from app.institutions n where n.id = old.institution_id) then
    raise exception 'app.access_card_issues_kept: an issue goes only with its group' using errcode = 'P0004';
  end if;
  return old;
end
$$;
create trigger access_card_issues_kept before delete on app.access_card_issues
  for each row execute function app.access_card_issues_kept();

-- Spent tokens are born and die with the invitation and never change.
create function app.invitation_spent_tokens_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'app.invitation_spent_tokens_frozen: a spent hash never changes' using errcode = 'P0004';
end
$$;
create trigger invitation_spent_tokens_frozen before update on app.invitation_spent_tokens
  for each row execute function app.invitation_spent_tokens_frozen();

-- Memory: while the institution exists, neither an invitation nor a spent hash is deleted (the cascade of the institution
-- runs after it is gone). A spent hash never comes back as a current one by DELETE and INSERT.
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
create trigger invitation_spent_tokens_kept before delete on app.invitation_spent_tokens
  for each row execute function app.invitations_kept();

-- Invitations. Born pending (and, as in phase 1, without whoever accepts), with a hash that was never spent.
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
  if exists (select 1 from app.invitation_spent_tokens t where t.token_hash = new.token_hash) then
    raise exception 'app.invitations_born: a spent hash is never current again' using errcode = 'P0004';
  end if;
  return new;
end
$$;

-- The current guard (20261113140000_t1_fix15.sql) plus: op_key and op_identity never change; accepted and revoked are
-- final; token_hash changes only in the step to pending (pending or expired to pending), and the hash that goes away is
-- spent in the same statement, as is the current one when the invitation ends accepted or revoked.
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
    if exists (select 1 from app.invitation_spent_tokens t where t.token_hash = new.token_hash) then
      raise exception 'app.invitations_frozen: a spent hash is never current again' using errcode = 'P0004';
    end if;
    insert into app.invitation_spent_tokens (token_hash, institution_id, invitation_id) values (old.token_hash, old.institution_id, old.id);
  elsif new.status in ('accepted', 'revoked') and old.status is distinct from new.status then
    insert into app.invitation_spent_tokens (token_hash, institution_id, invitation_id) values (old.token_hash, old.institution_id, old.id);
  end if;
  return new;
end
$$;

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

create function api.begin_access_cards(p_group_id uuid, p_cards jsonb, p_op_key uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.finish_access_cards(p_issue_id uuid, p_done uuid[])
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_claim_card_password(p_issue_id uuid, p_student_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_claim_provisioning(p_provisioning_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_get_student_accounts(p_student_ids uuid[])
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_remember_student_account(p_provisioning_id uuid, p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_fail_student_account(p_provisioning_id uuid, p_error_code text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_list_unfinished_accounts(p_limit integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_find_institution(p_code text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_resolve_student_login(p_code text, p_username text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_resolve_access_card(p_token_hash bytea)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;
