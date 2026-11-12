-- Contract, phase 1: publications, assignments, attempts, submissions, grades, group analyses and
-- feedback events. Born closed (see 20261111130100_identity.sql).
--
-- What a student receives never changes under them: a publication is an immutable copy, an attempt
-- points to one publication and one key revision, and a submitted answer sheet is frozen.

create table app.publications (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  assessment_id uuid not null,
  version_id uuid not null,
  -- The approved version revision that was copied.
  version_revision integer not null check (version_revision >= 1),
  -- Required for gaze; optional for typed and voice until phase 7.
  answer_key_revision_id uuid,
  -- { generalInstructions, exercises: [{ id, label, body }], questions: [{ id, exerciseId, stem,
  -- options }] }: never the correct option, never the changes or their reasons.
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  answer_mode text not null check (answer_mode in ('typed', 'gaze', 'voice')),
  aids jsonb not null default '{}' check (jsonb_typeof(aids) = 'object'),
  -- Historical identity, no FK: a publication is immutable, deleting the account must not rewrite it.
  published_by uuid,
  published_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  unique (institution_id, id),
  unique (institution_id, assessment_id, version_id, id),
  foreign key (institution_id, assessment_id, version_id) references app.versions (institution_id, assessment_id, id) on delete cascade,
  foreign key (institution_id, version_id, answer_key_revision_id) references app.answer_key_revisions (institution_id, version_id, id),
  check (withdrawn_at is null or withdrawn_at >= published_at)
);
create index publications_version_idx on app.publications (institution_id, version_id);

create function app.publications_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'withdrawn_at') <> (to_jsonb(old) - 'withdrawn_at') or old.withdrawn_at is not null then
    raise exception 'app.publications_guard: a publication is immutable; it can only be withdrawn once' using errcode = 'P0004';
  end if;
  return new;
end
$$;

-- One per assessment and student, with its overall status.
create table app.assignments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  assessment_id uuid not null,
  student_id uuid not null,
  status text not null default 'assigned' check (status in ('assigned', 'in_progress', 'submitted', 'graded', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  unique (institution_id, assessment_id, id),
  unique (assessment_id, student_id),
  foreign key (institution_id, assessment_id) references app.assessments (institution_id, id) on delete cascade,
  foreign key (institution_id, student_id) references app.students (institution_id, id) on delete cascade
);
create index assignments_student_idx on app.assignments (institution_id, student_id);

-- Each attempt is tied to one publication of the same assessment (composite FKs) and to the key
-- revision it is graded with. A reassigned attempt is superseded, never deleted.
create table app.assignment_attempts (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  assessment_id uuid not null,
  assignment_id uuid not null,
  version_id uuid not null,
  publication_id uuid not null,
  answer_key_revision_id uuid,
  number integer not null check (number >= 1),
  status text not null default 'opened' check (status in ('opened', 'started', 'submitted')),
  -- First time the student looked at it (opened stays the status until they start).
  first_viewed_at timestamptz,
  started_at timestamptz,
  submitted_at timestamptz,
  late boolean not null default false,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  unique (assignment_id, number),
  foreign key (institution_id, assessment_id, assignment_id) references app.assignments (institution_id, assessment_id, id) on delete cascade,
  foreign key (institution_id, assessment_id, version_id, publication_id) references app.publications (institution_id, assessment_id, version_id, id) on delete cascade,
  foreign key (institution_id, version_id, answer_key_revision_id) references app.answer_key_revisions (institution_id, version_id, id),
  check ((status = 'submitted') = (submitted_at is not null)),
  check (status = 'opened' or started_at is not null),
  check (late = false or status = 'submitted')
);
-- At most one attempt in force per assignment.
create unique index assignment_attempts_current_key on app.assignment_attempts (assignment_id) where superseded_at is null;
create index assignment_attempts_publication_idx on app.assignment_attempts (institution_id, publication_id);

-- Attempts only move forward: opened -> started -> submitted. The publication can only change
-- while nobody started (republishing moves unstarted attempts to the new publication).
create function app.attempts_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if array_position(array['opened', 'started', 'submitted'], new.status)
     < array_position(array['opened', 'started', 'submitted'], old.status) then
    raise exception 'app.attempts_guard: an attempt never goes back' using errcode = 'P0004';
  end if;
  if (new.publication_id <> old.publication_id or new.version_id <> old.version_id
      or new.answer_key_revision_id is distinct from old.answer_key_revision_id) and old.status <> 'opened' then
    raise exception 'app.attempts_guard: a started attempt keeps its publication and its key' using errcode = 'P0004';
  end if;
  if old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at then
    raise exception 'app.attempts_guard: superseded is final' using errcode = 'P0004';
  end if;
  return new;
end
$$;

-- An attempt is graded with its publication's key revision, never another one: the publication is
-- immutable, so after start (when the publication freezes) the key cannot move either.
create function app.attempts_key_matches() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.answer_key_revision_id is distinct from (
    select p.answer_key_revision_id from app.publications p where p.id = new.publication_id
  ) then
    raise exception 'app.attempts_key_matches: the key revision is the publication''s' using errcode = 'P0004';
  end if;
  return new;
end
$$;

-- The draft and, once submitted, the frozen answers. revision is the draft revision the student saw.
create table app.submissions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  attempt_id uuid not null unique,
  -- { <exercise_id>: { text, mode, transcript?, graph? } }
  answers jsonb not null default '{}' check (jsonb_typeof(answers) = 'object'),
  -- { <question_id>: "<option id>" }
  choices jsonb not null default '{}' check (jsonb_typeof(choices) = 'object'),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  foreign key (institution_id, attempt_id) references app.assignment_attempts (institution_id, id) on delete cascade
);

-- Submitting freezes the answers (today's updateSubmission rule, now in the database).
create function app.submissions_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.submitted_at is not null then
    perform app.raise_error('CONFLICT', 'already_submitted');
  end if;
  return new;
end
$$;

create table app.grades (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  attempt_id uuid not null unique,
  -- Today's scale (lib/groups/grades.ts): a whole number from 1 to 10.
  score smallint check (score is null or score between 1 and 10),
  feedback text not null default '' check (char_length(feedback) <= 5000),
  -- { <exercise_id>: { status: correct|partial|wrong|blank, errors: [<tag>] } }
  exercise_results jsonb not null default '{}' check (jsonb_typeof(exercise_results) = 'object'),
  graded_by uuid references app.app_users (id) on delete set null,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  foreign key (institution_id, attempt_id) references app.assignment_attempts (institution_id, id) on delete cascade
);

-- The AI's reading of a group. pseudonym_map ({ "E1": <pseudonym id> }) never travels to the AI.
create table app.group_analyses (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  group_id uuid not null,
  assessment_id uuid,
  operation_id uuid,
  -- Hash of the inputs, which include the snapshot of which pseudonym is each student (R3-12).
  inputs_hash text not null check (inputs_hash ~ '^[0-9a-f]{64}$'),
  analyzer_version text not null check (char_length(analyzer_version) between 1 and 80),
  pseudonym_map jsonb not null check (jsonb_typeof(pseudonym_map) = 'object'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, id),
  unique (institution_id, group_id, inputs_hash, analyzer_version),
  foreign key (institution_id, group_id) references app.groups (institution_id, id) on delete cascade,
  foreign key (institution_id, assessment_id) references app.assessments (institution_id, id) on delete cascade,
  foreign key (institution_id, operation_id) references app.operations (institution_id, id)
);

-- Append-only student feedback and usage signals (written from phase 8), by pseudonym only.
create table app.feedback_events (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  pseudonym_id uuid not null,
  kind text not null check (kind in ('opened', 'started', 'submitted', 'exercise_time', 'aid_used', 'student_feedback')),
  publication_id uuid,
  -- An exercise id inside the publication's content; no FK, the publication is the reference.
  exercise_id uuid,
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (institution_id, id),
  foreign key (institution_id, pseudonym_id) references app.student_pseudonyms (institution_id, id),
  foreign key (institution_id, publication_id) references app.publications (institution_id, id) on delete cascade
);
create index feedback_events_pseudonym_idx on app.feedback_events (institution_id, pseudonym_id, occurred_at);

create trigger publications_guard before update on app.publications for each row execute function app.publications_guard();
create trigger assignments_touch before update on app.assignments for each row execute function app.touch_row();
create trigger assignment_attempts_touch before update on app.assignment_attempts for each row execute function app.touch_row();
create trigger assignment_attempts_guard before update on app.assignment_attempts for each row execute function app.attempts_guard();
create trigger assignment_attempts_key before insert or update on app.assignment_attempts for each row execute function app.attempts_key_matches();
create trigger submissions_guard before update on app.submissions for each row execute function app.submissions_guard();
create trigger submissions_touch before update on app.submissions for each row execute function app.touch_row();
create trigger grades_touch before update on app.grades for each row execute function app.touch_row();
create trigger group_analyses_touch before update on app.group_analyses for each row execute function app.touch_row();
create trigger feedback_events_append_only before update on app.feedback_events for each row execute function app.append_only();

alter table app.publications enable row level security;
alter table app.publications force row level security;
alter table app.assignments enable row level security;
alter table app.assignments force row level security;
alter table app.assignment_attempts enable row level security;
alter table app.assignment_attempts force row level security;
alter table app.submissions enable row level security;
alter table app.submissions force row level security;
alter table app.grades enable row level security;
alter table app.grades force row level security;
alter table app.group_analyses enable row level security;
alter table app.group_analyses force row level security;
alter table app.feedback_events enable row level security;
alter table app.feedback_events force row level security;
