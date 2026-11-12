-- Contract, phase 1: groups, students, enrollments, pseudonyms, account provisioning, needs and notes.
-- Born closed (see 20261111130100_identity.sql). Consents come after files, which they reference.
--
-- Sensitive fields (no direct read ever; audited RPCs only): student_needs.*, student_need_events.*,
-- student_notes.body. Personal but not sensitive: students.display_name and username.

create table app.groups (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  subject_id text not null references app.subjects (id),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  school_year smallint not null check (school_year between 2020 and 2100),
  archived_at timestamptz,
  created_by uuid references app.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  -- Lets assessments prove their subject is their group's (see assessments).
  unique (institution_id, id, subject_id)
);

create table app.group_staff (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  group_id uuid not null,
  user_id uuid not null references app.app_users (id) on delete cascade,
  role text not null check (role in ('owner', 'co_teacher')),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  foreign key (institution_id, group_id) references app.groups (institution_id, id) on delete cascade
);
create unique index group_staff_active_key on app.group_staff (group_id, user_id) where removed_at is null;
create unique index group_staff_one_owner_key on app.group_staff (group_id) where role = 'owner' and removed_at is null;
-- What "is this user staff of this group?" and "which groups can this user see?" ask.
create index group_staff_user_group_idx on app.group_staff (user_id, group_id) where removed_at is null;
create index group_staff_user_institution_idx on app.group_staff (user_id, institution_id) where removed_at is null;

create table app.students (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  -- Typed at login together with the institution code: normalized, unique per institution.
  username text not null check (username ~ '^[a-z0-9][a-z0-9._-]{1,39}$'),
  -- The student's Auth account once provisioned (phase 2).
  user_id uuid unique references app.app_users (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  unique (institution_id, username)
);

create table app.enrollments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  group_id uuid not null,
  student_id uuid not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  foreign key (institution_id, group_id) references app.groups (institution_id, id) on delete cascade,
  foreign key (institution_id, student_id) references app.students (institution_id, id) on delete cascade,
  check (ended_at is null or ended_at >= started_at)
);
-- One active enrollment per group and student; history stays as ended rows.
create unique index enrollments_active_key on app.enrollments (group_id, student_id) where ended_at is null;
create index enrollments_student_idx on app.enrollments (institution_id, student_id);

-- The pseudonym IS the id of this row. Feedback and analyses carry it instead of the student id.
-- Erasure unlinks (student_id := null, unlinked_at := now()) before the student row goes: the FK has
-- no ON DELETE action, so deleting a student whose pseudonym is still linked fails. That is the
-- "mark first" rule enforced by the schema. Unlinking does not anonymize what remains (R3-7).
create table app.student_pseudonyms (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  student_id uuid unique,
  unlinked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (institution_id, id),
  foreign key (institution_id, student_id) references app.students (institution_id, id),
  check ((student_id is null) = (unlinked_at is not null))
);

-- One row per student account (phase 2 runs it). The 'deleted' mark must outlive the student so
-- reconcile_accounts never recreates the account: the FK sets only student_id to null, and the
-- CHECK only allows that once the row is already marked 'deleted'.
create table app.account_provisioning (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  student_id uuid unique,
  op_key uuid not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'failed', 'deleted')),
  attempts integer not null default 0 check (attempts >= 0),
  -- No FK to auth.users on purpose: the mark has to survive the Auth account.
  auth_user_id uuid unique,
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  unique (institution_id, op_key),
  foreign key (institution_id, student_id) references app.students (institution_id, id) on delete set null (student_id),
  check (status = 'deleted' or student_id is not null)
);

-- Sensitive (health data). One row per student. Profile and support ids are catalogue keys checked
-- for shape here and against the approved catalogue by the RPC (data/profiles is not in the database).
create table app.student_needs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  student_id uuid not null unique,
  profiles text[] not null default '{}' check (app.is_key_set(profiles, 10)),
  supports text[] not null default '{}' check (app.is_key_set(supports, 10)),
  interests text[] not null default '{}' check (app.is_short_text_list(interests, 10, 60)),
  review_due_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  foreign key (institution_id, student_id) references app.students (institution_id, id) on delete cascade
);

-- Sensitive. History of student_needs, append-only. before/after hold the same fields as the row.
create table app.student_need_events (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  student_id uuid not null,
  op_id uuid not null,
  kind text not null check (kind in ('set', 'cleared')),
  need_revision integer not null check (need_revision >= 1),
  before jsonb check (before is null or jsonb_typeof(before) = 'object'),
  after jsonb not null check (jsonb_typeof(after) = 'object'),
  -- Historical identity, no FK: an append-only row never changes, so deleting the account must
  -- not rewrite it. The id stops resolving to anyone, as in audit_log.
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  unique (institution_id, id),
  unique (institution_id, op_id),
  foreign key (institution_id, student_id) references app.students (institution_id, id) on delete cascade
);
create index student_need_events_student_idx on app.student_need_events (institution_id, student_id, created_at);

-- Sensitive. Private notes of the teacher about a student.
create table app.student_notes (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  student_id uuid not null,
  author_user_id uuid references app.app_users (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  foreign key (institution_id, student_id) references app.students (institution_id, id) on delete cascade
);
create index student_notes_student_idx on app.student_notes (institution_id, student_id);

create trigger groups_touch before update on app.groups for each row execute function app.touch_row();
create trigger group_staff_touch before update on app.group_staff for each row execute function app.touch_row();
create trigger students_touch before update on app.students for each row execute function app.touch_row();
create trigger enrollments_touch before update on app.enrollments for each row execute function app.touch_row();
create trigger account_provisioning_touch before update on app.account_provisioning for each row execute function app.touch_row();
create trigger student_needs_touch before update on app.student_needs for each row execute function app.touch_row();
create trigger student_need_events_append_only before update on app.student_need_events for each row execute function app.append_only();
create trigger student_notes_touch before update on app.student_notes for each row execute function app.touch_row();

alter table app.groups enable row level security;
alter table app.groups force row level security;
alter table app.group_staff enable row level security;
alter table app.group_staff force row level security;
alter table app.students enable row level security;
alter table app.students force row level security;
alter table app.enrollments enable row level security;
alter table app.enrollments force row level security;
alter table app.student_pseudonyms enable row level security;
alter table app.student_pseudonyms force row level security;
alter table app.account_provisioning enable row level security;
alter table app.account_provisioning force row level security;
alter table app.student_needs enable row level security;
alter table app.student_needs force row level security;
alter table app.student_need_events enable row level security;
alter table app.student_need_events force row level security;
alter table app.student_notes enable row level security;
alter table app.student_notes force row level security;
