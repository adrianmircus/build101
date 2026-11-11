-- Contract, phase 1: generations, operations, raw AI outputs, version events, answer keys and their
-- immutable revisions. Born closed (see 20261111130100_identity.sql).
--
-- History is never lost: references from events, outputs and key revisions to exercises and
-- generations have no ON DELETE action, so only deleting the whole version (erasure of an individual
-- version) removes them, together with the version.

create table app.generations (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  version_id uuid not null,
  kind text not null check (kind in ('version', 'exercise', 'answer_key')),
  -- Only for kind 'exercise': the adapted exercise it regenerates.
  target_exercise_id uuid,
  -- The revision of the target (version or exercise) the result expects to find when it lands.
  target_revision integer not null check (target_revision >= 1),
  -- Sent by the browser. A double click finds the same generation; "retry" sends a new one.
  op_key uuid not null,
  subject_id text not null references app.subjects (id),
  -- Sensitive: the inputs exactly as sent (redacted exercises, config, syllabus), never names.
  inputs jsonb not null check (jsonb_typeof(inputs) = 'object'),
  -- Which approved data/profiles/*.md were used, so an old adaptation can be explained.
  profiles_hash text not null check (profiles_hash ~ '^[0-9a-f]{64}$'),
  profiles_revision text not null check (char_length(profiles_revision) between 1 and 80),
  prompt_version text not null check (char_length(prompt_version) between 1 and 80),
  required_jobs integer not null check (required_jobs >= 0),
  status text not null default 'running' check (status in ('running', 'done', 'failed', 'cancelled', 'superseded')),
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  requested_by uuid references app.app_users (id) on delete set null,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, id),
  unique (institution_id, version_id, id),
  -- Stricter than "per institution and resource": an op_key reused on another resource is a
  -- CONFLICT, never a second generation.
  unique (institution_id, op_key),
  foreign key (institution_id, version_id) references app.versions (institution_id, id) on delete cascade,
  foreign key (institution_id, version_id, target_exercise_id) references app.version_exercises (institution_id, version_id, id),
  check ((kind = 'exercise') = (target_exercise_id is not null)),
  check ((status = 'running') = (finished_at is null))
);
-- In force per resource: one running generation of each kind per target.
create unique index generations_running_version_key on app.generations (version_id) where kind = 'version' and status = 'running';
create unique index generations_running_exercise_key on app.generations (target_exercise_id) where kind = 'exercise' and status = 'running';
create unique index generations_running_answer_key_key on app.generations (version_id) where kind = 'answer_key' and status = 'running';

-- Terminal states never reopen (R3-1): done, failed, cancelled and superseded are final.
create function app.generations_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'running' and new.status is distinct from old.status then
    raise exception 'app.generations_guard: a finished generation never reopens' using errcode = 'P0004';
  end if;
  if new.version_id <> old.version_id or new.kind <> old.kind or new.op_key <> old.op_key
     or new.inputs <> old.inputs or new.target_exercise_id is distinct from old.target_exercise_id then
    raise exception 'app.generations_guard: what a generation was asked never changes' using errcode = 'P0004';
  end if;
  return new;
end
$$;

-- Composite operations that are not a version: reading a document, a syllabus, analyzing a group.
create table app.operations (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  kind text not null check (kind in ('read_document', 'read_syllabus', 'analyze_group')),
  op_key uuid not null,
  group_id uuid not null,
  assessment_id uuid,
  file_id uuid,
  -- Fixed at creation: the merge consumes exactly this set (R3-13).
  required_parts integer not null check (required_parts >= 1),
  status text not null default 'running' check (status in ('running', 'merging', 'done', 'failed', 'cancelled')),
  merge_result jsonb check (merge_result is null or jsonb_typeof(merge_result) = 'object'),
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  requested_by uuid references app.app_users (id) on delete set null,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, id),
  unique (institution_id, op_key),
  foreign key (institution_id, group_id) references app.groups (institution_id, id) on delete cascade,
  foreign key (institution_id, assessment_id) references app.assessments (institution_id, id) on delete cascade,
  foreign key (institution_id, file_id) references app.files (institution_id, id),
  check ((status in ('running', 'merging')) = (finished_at is null)),
  check (kind <> 'read_document' or file_id is not null)
);

create function app.operations_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('done', 'failed', 'cancelled') and new.status is distinct from old.status then
    raise exception 'app.operations_guard: a finished operation never reopens' using errcode = 'P0004';
  end if;
  if new.required_parts <> old.required_parts then
    raise exception 'app.operations_guard: required parts are fixed at creation' using errcode = 'P0004';
  end if;
  return new;
end
$$;

-- What the AI returned, as it arrived and before any edit. Kept even when not applied (obsolete).
create table app.generation_outputs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  version_id uuid not null,
  generation_id uuid not null,
  version_exercise_id uuid,
  kind text not null check (kind in ('exercise', 'gaze_questions', 'answer_key')),
  output jsonb not null check (jsonb_typeof(output) = 'object'),
  expected_revision integer check (expected_revision is null or expected_revision >= 1),
  outcome text not null check (outcome in ('applied', 'obsolete', 'discarded')),
  created_at timestamptz not null default now(),
  unique (institution_id, id),
  -- A retried job writes the same output once.
  unique nulls not distinct (generation_id, kind, version_exercise_id),
  foreign key (institution_id, version_id) references app.versions (institution_id, id) on delete cascade,
  foreign key (institution_id, version_id, generation_id) references app.generations (institution_id, version_id, id),
  foreign key (institution_id, version_id, version_exercise_id) references app.version_exercises (institution_id, version_id, id)
);

-- Append-only feedback of a version. op_id makes each operation write its event once.
create table app.version_events (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  version_id uuid not null,
  op_id uuid not null,
  kind text not null check (kind in ('generated', 'edited', 'approved', 'rejected', 'regenerated', 'recipients_changed')),
  generation_id uuid,
  version_exercise_id uuid,
  version_revision integer not null check (version_revision >= 1),
  exercise_revision integer check (exercise_revision is null or exercise_revision >= 1),
  -- edited: { body }; rejected: { reasons }; regenerated: { instruction }; recipients_changed:
  -- { added, removed } (sensitive). Validated by zod.
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  actor_user_id uuid references app.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (institution_id, id),
  unique (institution_id, op_id),
  foreign key (institution_id, version_id) references app.versions (institution_id, id) on delete cascade,
  foreign key (institution_id, version_id, generation_id) references app.generations (institution_id, version_id, id),
  foreign key (institution_id, version_id, version_exercise_id) references app.version_exercises (institution_id, version_id, id),
  check (kind <> 'generated' or generation_id is not null)
);
-- Exactly one 'generated' event per generation, however many jobs race to close it.
create unique index version_events_generated_key on app.version_events (generation_id) where kind = 'generated';
create index version_events_version_idx on app.version_events (version_id, created_at);

create table app.answer_keys (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  version_id uuid not null unique,
  current_generation_id uuid,
  current_revision_id uuid,
  approved_revision_id uuid,
  status text not null default 'empty' check (status in ('empty', 'generating', 'ready', 'error')),
  -- An exercise or question changed after current_revision_id: regenerate or confirm before publishing.
  stale boolean not null default false,
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  unique (institution_id, version_id, id),
  foreign key (institution_id, version_id) references app.versions (institution_id, id) on delete cascade,
  foreign key (institution_id, version_id, current_generation_id) references app.generations (institution_id, version_id, id)
);

-- Immutable revisions of a key (R3-3). Each is tied to the version revision, the revision of every
-- adapted exercise and the question ids it was made for. Attempts are graded against one of these.
create table app.answer_key_revisions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  version_id uuid not null,
  answer_key_id uuid not null,
  number integer not null check (number >= 1),
  source text not null check (source in ('generated', 'edited', 'confirmed')),
  -- { exercises: { <version_exercise_id>: {...} }, questions: { <question_id>: "A" } }.
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  version_revision integer not null check (version_revision >= 1),
  -- { <version_exercise_id>: <revision> } at the moment this revision was made.
  exercise_revisions jsonb not null check (jsonb_typeof(exercise_revisions) = 'object'),
  question_ids uuid[] not null default '{}' check (app.is_uuid_set(question_ids)),
  generation_id uuid,
  author_user_id uuid references app.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (institution_id, id),
  unique (institution_id, version_id, id),
  unique (answer_key_id, number),
  foreign key (institution_id, version_id, answer_key_id) references app.answer_keys (institution_id, version_id, id) on delete cascade,
  foreign key (institution_id, version_id, generation_id) references app.generations (institution_id, version_id, id),
  check ((source = 'generated') = (generation_id is not null))
);

-- The FKs that close the cycles: what is in force always belongs to the same version.
alter table app.versions
  add foreign key (institution_id, id, current_generation_id) references app.generations (institution_id, version_id, id);
alter table app.version_exercises
  add foreign key (institution_id, version_id, current_generation_id) references app.generations (institution_id, version_id, id);
alter table app.answer_keys
  add foreign key (institution_id, version_id, current_revision_id) references app.answer_key_revisions (institution_id, version_id, id),
  add foreign key (institution_id, version_id, approved_revision_id) references app.answer_key_revisions (institution_id, version_id, id);

create trigger generations_touch before update on app.generations for each row execute function app.touch_row();
create trigger generations_guard before update on app.generations for each row execute function app.generations_guard();
create trigger operations_touch before update on app.operations for each row execute function app.touch_row();
create trigger operations_guard before update on app.operations for each row execute function app.operations_guard();
create trigger generation_outputs_append_only before update on app.generation_outputs for each row execute function app.append_only();
create trigger version_events_append_only before update on app.version_events for each row execute function app.append_only();
create trigger answer_keys_touch before update on app.answer_keys for each row execute function app.touch_row();
create trigger answer_key_revisions_append_only before update on app.answer_key_revisions for each row execute function app.append_only();

alter table app.generations enable row level security;
alter table app.generations force row level security;
alter table app.operations enable row level security;
alter table app.operations force row level security;
alter table app.generation_outputs enable row level security;
alter table app.generation_outputs force row level security;
alter table app.version_events enable row level security;
alter table app.version_events force row level security;
alter table app.answer_keys enable row level security;
alter table app.answer_keys force row level security;
alter table app.answer_key_revisions enable row level security;
alter table app.answer_key_revisions force row level security;
