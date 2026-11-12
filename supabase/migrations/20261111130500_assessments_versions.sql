-- Contract, phase 1: assessments, their exercises, versions and what hangs from a version.
-- Born closed (see 20261111130100_identity.sql).
--
-- Some parents expose a three-column UNIQUE (institution_id, <parent>, id) so a child can prove two
-- things with one FK: that it stays in the institution and that it belongs to the right parent
-- (an adapted exercise points at an original exercise of the same assessment as its version).
--
-- Sensitive fields: versions.config and versions.answer_mode (together with the recipients they
-- reveal profiles), version_recipients.*, and the adapted content of a version (it can show the
-- adaptation). question_keys never reach a student.

create table app.assessments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  group_id uuid not null,
  -- Always the group's subject: the composite FK below makes any other value impossible.
  subject_id text not null,
  kind text not null check (kind in ('worksheet', 'exam')),
  topic text not null default '' check (char_length(topic) <= 200),
  -- What comes before the first exercise ("Elegí dos y justificá"). Never dropped (R3-18).
  general_instructions text not null default '' check (char_length(general_instructions) <= 5000),
  status text not null default 'draft' check (status in ('draft', 'ready', 'published', 'archived')),
  publish_at timestamptz,
  due_at timestamptz,
  -- The uploaded document it was read from, if any (the spec's source_id).
  source_file_id uuid,
  created_by uuid references app.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  foreign key (institution_id, group_id, subject_id) references app.groups (institution_id, id, subject_id) on delete cascade,
  foreign key (institution_id, source_file_id) references app.files (institution_id, id),
  check (due_at is null or publish_at is null or due_at > publish_at)
);
create index assessments_group_idx on app.assessments (institution_id, group_id);

create table app.assessment_exercises (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  assessment_id uuid not null,
  -- Order of display. Not unique: reordering rewrites positions in one statement.
  position integer not null check (position >= 0),
  -- The number the teacher sees ("1", "2b").
  label text not null check (char_length(btrim(label)) between 1 and 20),
  body text not null check (char_length(body) between 1 and 20000),
  -- A unit id of the group's syllabus (syllabi.units[].id), if tagged.
  topic_id uuid,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  unique (institution_id, assessment_id, id),
  foreign key (institution_id, assessment_id) references app.assessments (institution_id, id) on delete cascade
);
create index assessment_exercises_order_idx on app.assessment_exercises (assessment_id, position);

create table app.versions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  assessment_id uuid not null,
  -- Neutral display order ("Versión 1"): a listing never needs the profile to name a version.
  position integer not null check (position >= 1),
  base_version_id uuid,
  -- The version's own copy of the general instructions (adapted or not). It is part of what the
  -- teacher approves and what a publication copies: changing the assessment's instructions marks
  -- the version stale but never changes an approved text under the teacher (R3-18).
  general_instructions text not null default '' check (char_length(general_instructions) <= 5000),
  -- Provenance of the instructions, like version_exercises: their own revision and the generation
  -- that wrote it (null when a person did). See written_by_generation_id there.
  instructions_revision integer not null default 1 check (instructions_revision >= 1),
  instructions_written_by uuid,
  -- Sensitive: { profiles, supports, interests, keep }. Validated by zod on every read.
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object'),
  answer_mode text not null default 'typed' check (answer_mode in ('typed', 'gaze', 'voice')),
  status text not null default 'empty' check (status in ('empty', 'generating', 'ready', 'error')),
  stale boolean not null default false,
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  -- The complete generation in force (FK added with generations).
  current_generation_id uuid,
  -- Approval is of one revision: any later change leaves approved_revision behind revision.
  approved_revision integer check (approved_revision is null or approved_revision between 1 and revision),
  archived_at timestamptz,
  created_by uuid references app.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  unique (institution_id, assessment_id, id),
  foreign key (institution_id, assessment_id) references app.assessments (institution_id, id) on delete cascade,
  foreign key (institution_id, base_version_id) references app.versions (institution_id, id)
);
create unique index versions_position_key on app.versions (assessment_id, position) where archived_at is null;

create table app.version_exercises (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  assessment_id uuid not null,
  version_id uuid not null,
  exercise_id uuid not null,
  -- The revision of the original exercise this adaptation was made from (staleness).
  source_revision integer not null check (source_revision >= 1),
  body text not null default '' check (char_length(body) <= 20000),
  -- [{ "what": "...", "why": "..." }]: for the teacher only, never in a student DTO.
  changes jsonb not null default '[]' check (jsonb_typeof(changes) = 'array'),
  status text not null default 'pending' check (status in ('pending', 'generating', 'ready', 'error')),
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  current_generation_id uuid,
  -- The generation that wrote the current revision; null when a person did. An output of the
  -- generation in force applies when the revision is the one it started from OR this column says
  -- the generation itself made the later revisions (its text and its gaze questions land in any
  -- order). A manual edit sets it to null, so later outputs of that generation are obsolete.
  written_by_generation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Covers the text, the changes and this exercise's questions and keys: editing a question, its
  -- options or its correct option bumps the parent exercise too (docs/contratos/fase-1.md, «Clave»).
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  unique (institution_id, version_id, id),
  unique (version_id, exercise_id),
  foreign key (institution_id, assessment_id, version_id) references app.versions (institution_id, assessment_id, id) on delete cascade,
  foreign key (institution_id, assessment_id, exercise_id) references app.assessment_exercises (institution_id, assessment_id, id) on delete cascade
);

-- 2 to 4 options, each an object with a one-letter id, ids never repeated: an ambiguous [A, A]
-- could never be graded.
create function app.is_option_list(p_options jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_options) <> 'array' then false else
    jsonb_array_length(p_options) between 2 and 4
    and not exists (
      select 1 from jsonb_array_elements(p_options) as o
       where jsonb_typeof(o) <> 'object' or coalesce(o ->> 'id', '') !~ '^[A-Z]$')
    and (select count(distinct o ->> 'id') from jsonb_array_elements(p_options) as o) = jsonb_array_length(p_options)
  end
$$;

-- Multiple-choice questions for gaze answers, without the answer.
create table app.version_questions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  version_id uuid not null,
  version_exercise_id uuid not null,
  position integer not null check (position >= 0),
  stem text not null check (char_length(stem) between 1 and 5000),
  -- [{ "id": "A", "text": "...", "graph": {...} }], validated by zod.
  options jsonb not null check (app.is_option_list(options)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  unique (institution_id, version_id, id),
  foreign key (institution_id, version_id, version_exercise_id) references app.version_exercises (institution_id, version_id, id) on delete cascade
);
create index version_questions_version_idx on app.version_questions (version_id, position);

-- The correct option of each question: read by the teacher and by grading, never by a student.
create table app.question_keys (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  version_id uuid not null,
  question_id uuid not null unique,
  correct_option_id text not null check (correct_option_id ~ '^[A-Z]$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  foreign key (institution_id, version_id, question_id) references app.version_questions (institution_id, version_id, id) on delete cascade
);

-- Sensitive. Who a version was for at each moment. Rows are closed (valid_to), never rewritten.
create table app.version_recipients (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  assessment_id uuid not null,
  version_id uuid not null,
  student_id uuid not null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  unique (institution_id, id),
  foreign key (institution_id, assessment_id, version_id) references app.versions (institution_id, assessment_id, id) on delete cascade,
  foreign key (institution_id, student_id) references app.students (institution_id, id) on delete cascade,
  check (valid_to is null or valid_to >= valid_from)
);
create unique index version_recipients_active_key on app.version_recipients (version_id, student_id) where valid_to is null;
-- A student receives at most one version of an assessment at a time.
create unique index version_recipients_one_per_assessment_key on app.version_recipients (assessment_id, student_id) where valid_to is null;
create index version_recipients_student_idx on app.version_recipients (institution_id, student_id);

create trigger assessments_touch before update on app.assessments for each row execute function app.touch_row();
create trigger assessment_exercises_touch before update on app.assessment_exercises for each row execute function app.touch_row();
create trigger versions_touch before update on app.versions for each row execute function app.touch_row();
create trigger version_exercises_touch before update on app.version_exercises for each row execute function app.touch_row();
create trigger version_questions_touch before update on app.version_questions for each row execute function app.touch_row();
create trigger question_keys_touch before update on app.question_keys for each row execute function app.touch_row();

-- A key always names one of its question's options, whatever is edited first. The RPCs check this
-- before writing and answer INVALID (unknown_option, correct_option_removed); these triggers are
-- the backstop, so a bug cannot leave a key pointing at an option that does not exist.
create function app.question_key_in_options() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from app.version_questions q cross join lateral jsonb_array_elements(q.options) as o
     where q.id = new.question_id and o ->> 'id' = new.correct_option_id
  ) then
    raise exception 'app.question_key_in_options: the correct option is one of the question''s options' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create function app.question_options_keep_key() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from app.question_keys k
     where k.question_id = new.id
       and not exists (select 1 from jsonb_array_elements(new.options) as o where o ->> 'id' = k.correct_option_id)
  ) then
    raise exception 'app.question_options_keep_key: an edit cannot remove the correct option' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create trigger question_keys_in_options before insert or update on app.question_keys for each row execute function app.question_key_in_options();
create trigger version_questions_keep_key before update of options on app.version_questions for each row execute function app.question_options_keep_key();

alter table app.assessments enable row level security;
alter table app.assessments force row level security;
alter table app.assessment_exercises enable row level security;
alter table app.assessment_exercises force row level security;
alter table app.versions enable row level security;
alter table app.versions force row level security;
alter table app.version_exercises enable row level security;
alter table app.version_exercises force row level security;
alter table app.version_questions enable row level security;
alter table app.version_questions force row level security;
alter table app.question_keys enable row level security;
alter table app.question_keys force row level security;
alter table app.version_recipients enable row level security;
alter table app.version_recipients force row level security;
