-- Contract, phase 1: files, syllabi and consents. Born closed (see 20261111130100_identity.sql).
--
-- Files have an external effect (an object in Storage), so their owner FKs have no ON DELETE action:
-- deleting a group or a student that still owns files fails, and the erasure or purge has to delete
-- the objects and then the rows, never leave orphan objects without a row that names them.

create table app.files (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  bucket text not null check (bucket in ('uploads', 'consents')),
  -- Immutable path, always <institution_id>/<file_id>.
  path text not null unique,
  purpose text not null check (purpose in ('assessment_source', 'syllabus', 'consent_form', 'specialist_report')),
  -- The owning entity, by purpose: a group for teaching material, a student for signed documents.
  group_id uuid,
  student_id uuid,
  max_bytes integer not null check (max_bytes between 1 and 20971520),
  size_bytes integer check (size_bytes is null or size_bytes between 1 and max_bytes),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  status text not null default 'reserved' check (status in ('reserved', 'ready', 'rejected', 'missing')),
  reserved_by uuid references app.app_users (id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  foreign key (institution_id, group_id) references app.groups (institution_id, id),
  foreign key (institution_id, student_id) references app.students (institution_id, id),
  check (path = institution_id::text || '/' || id::text),
  check (
    (purpose in ('assessment_source', 'syllabus') and bucket = 'uploads' and group_id is not null and student_id is null)
    or (purpose in ('consent_form', 'specialist_report') and bucket = 'consents' and student_id is not null and group_id is null)
  ),
  check ((status = 'ready') = (confirmed_at is not null and size_bytes is not null))
);
create index files_group_idx on app.files (institution_id, group_id) where group_id is not null;
create index files_student_idx on app.files (institution_id, student_id) where student_id is not null;
-- cleanup_files looks for old reservations.
create index files_reserved_idx on app.files (created_at) where status = 'reserved';

-- The group's syllabus: units with stable ids (the topics exercises point to).
create table app.syllabi (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  group_id uuid not null unique,
  -- [{ "id": "<uuid>", "title": "...", "contents": "..." }], validated by zod on every read.
  units jsonb not null default '[]' check (jsonb_typeof(units) = 'array'),
  file_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  foreign key (institution_id, group_id) references app.groups (institution_id, id) on delete cascade,
  foreign key (institution_id, file_id) references app.files (institution_id, id)
);

-- Sensitive. One consent per purpose; storing the profile is a purpose of its own.
create table app.consents (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  student_id uuid not null,
  purpose text not null check (purpose in ('store_profile', 'ai_adaptation', 'ai_dictation', 'ai_analysis')),
  -- Which approved text the guardian signed (for example "2026-11").
  text_version text not null check (text_version ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  status text not null default 'granted' check (status in ('granted', 'revoked')),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references app.app_users (id) on delete set null,
  file_id uuid,
  recorded_by uuid references app.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  foreign key (institution_id, student_id) references app.students (institution_id, id) on delete cascade,
  foreign key (institution_id, file_id) references app.files (institution_id, id),
  check ((status = 'revoked') = (revoked_at is not null)),
  check (valid_until is null or valid_until > valid_from)
);
-- At most one granted consent per student and purpose; revoked ones stay as history.
create unique index consents_granted_key on app.consents (student_id, purpose) where status = 'granted';
create index consents_student_idx on app.consents (institution_id, student_id);

create trigger files_touch before update on app.files for each row execute function app.touch_row();
create trigger syllabi_touch before update on app.syllabi for each row execute function app.touch_row();
create trigger consents_touch before update on app.consents for each row execute function app.touch_row();

alter table app.files enable row level security;
alter table app.files force row level security;
alter table app.syllabi enable row level security;
alter table app.syllabi force row level security;
alter table app.consents enable row level security;
alter table app.consents force row level security;
