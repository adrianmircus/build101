-- Contract, phase 1: identity and membership.
--
-- Global tables (no institution_id): app_users, institutions, subjects. Everything else belongs to
-- one institution. Parents expose UNIQUE (institution_id, id) so children reference them with a
-- composite FK and can never point at another institution's row.
--
-- Every table is born closed: RLS enabled and forced, no policies and no grants. RLS with no
-- policies denies every role that does not bypass it; FORCE extends that to a non-bypassing owner,
-- so a future change of owner fails closed. The RPCs run as postgres, which has BYPASSRLS, and
-- authorize by themselves.

-- One row per Auth account. display_name is null for students (their name lives in students, only
-- once) and for the anonymous sandbox visitor.
create table app.app_users (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1)
);

create table app.institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  -- The short code students type at login, normalized to lower case.
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{2,31}$'),
  kind text not null check (kind in ('school', 'sandbox')),
  expires_at timestamptz,
  -- Only sandboxes have an owner (the anonymous visitor); deleting that user deletes the sandbox.
  owner_user_id uuid references app.app_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  check (
    (kind = 'school' and expires_at is null and owner_user_id is null)
    or (kind = 'sandbox' and expires_at is not null and owner_user_id is not null)
  )
);
create index institutions_owner_idx on app.institutions (owner_user_id) where owner_user_id is not null;

-- Subjects are a parameter, never a literal in code. The id is the folder name under
-- lib/server/ai/subjects/<id>/, so it is a text key and not a uuid.
create table app.subjects (
  id text primary key check (id ~ '^[a-z][a-z_]{1,30}$'),
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);
insert into app.subjects (id, enabled) values ('math', true), ('physics', false), ('chemistry', false);

create table app.memberships (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  user_id uuid not null references app.app_users (id) on delete cascade,
  role text not null check (role in ('admin', 'teacher', 'inclusion', 'student')),
  -- Revoking keeps the row: who had access when is part of the access record.
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id)
);
-- A user can hold several roles in one institution (an admin who also teaches), each once.
create unique index memberships_active_role_key on app.memberships (institution_id, user_id, role) where revoked_at is null;
-- What every authorization check asks: "is this user an active member of this institution?".
create index memberships_user_institution_idx on app.memberships (user_id, institution_id) where revoked_at is null;

create table app.invitations (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+$'),
  -- Students never get invitations: their accounts are provisioned (account_provisioning).
  role text not null check (role in ('admin', 'teacher', 'inclusion')),
  -- Only the hash of the token is stored; the token travels once, in the email.
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  invited_by uuid references app.app_users (id) on delete set null,
  accepted_by uuid references app.app_users (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  check ((status = 'accepted') = (accepted_at is not null))
);
create unique index invitations_pending_key on app.invitations (institution_id, email, role) where status = 'pending';

create trigger app_users_touch before update on app.app_users for each row execute function app.touch_row();
create trigger institutions_touch before update on app.institutions for each row execute function app.touch_row();
create trigger memberships_touch before update on app.memberships for each row execute function app.touch_row();
create trigger invitations_touch before update on app.invitations for each row execute function app.touch_row();

alter table app.app_users enable row level security;
alter table app.app_users force row level security;
alter table app.institutions enable row level security;
alter table app.institutions force row level security;
alter table app.subjects enable row level security;
alter table app.subjects force row level security;
alter table app.memberships enable row level security;
alter table app.memberships force row level security;
alter table app.invitations enable row level security;
alter table app.invitations force row level security;
