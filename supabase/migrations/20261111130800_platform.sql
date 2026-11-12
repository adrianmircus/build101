-- Contract, phase 1: audit log, erasures, rate limits, presets, notifications, import runs and
-- sandbox sessions. Born closed (see 20261111130100_identity.sql).

-- Who was shown or changed sensitive data: one row per disclosure (one request, the set of
-- students). No FK on institution_id or actor on purpose: the record outlives both and is removed
-- only by retention (five years).
create table app.audit_log (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null,
  actor_user_id uuid,
  action text not null check (action ~ '^[a-z][a-z0-9_.]{2,63}$'),
  entity text not null check (entity ~ '^[a-z][a-z0-9_]{2,63}$'),
  entity_id uuid,
  student_ids uuid[] not null default '{}' check (app.is_uuid_set(student_ids)),
  request_id uuid,
  created_at timestamptz not null default now()
);
create index audit_log_institution_idx on app.audit_log (institution_id, created_at);
-- "Who saw this student's profile?" for the admin view and for incidents.
create index audit_log_students_idx on app.audit_log using gin (student_ids);

-- Erasure record, without personal data: the pseudonym (already unlinked) and dates. Marked before
-- anything is deleted, so every pending effect can check it and write nothing about that person.
-- No FK on institution_id: the record survives the institution's own removal. Copied out of the
-- database in the same action (external_copied_at), so a restore cannot roll it back.
create table app.erasures (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null,
  kind text not null check (kind in ('student', 'institution')),
  pseudonym_id uuid,
  status text not null default 'marked' check (status in ('marked', 'done')),
  marked_at timestamptz not null default now(),
  completed_at timestamptz,
  external_copied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'student') = (pseudonym_id is not null)),
  check ((status = 'done') = (completed_at is not null))
);
create unique index erasures_pseudonym_key on app.erasures (pseudonym_id) where pseudonym_id is not null;
create index erasures_institution_idx on app.erasures (institution_id);

-- Counters per key and window. Global: login and sandbox limits run before there is an
-- institution. Keys never hold a raw IP or an email: "<scope>:<sha256 hex>".
create table app.rate_limits (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,30}:[0-9a-f]{64}$'),
  window_start timestamptz not null,
  window_seconds integer not null check (window_seconds between 1 and 86400),
  count integer not null default 0 check (count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key, window_start)
);
create index rate_limits_window_idx on app.rate_limits (window_start);

-- Configurations a teacher saves (profiles, supports, interests): not tied to any student.
create table app.presets (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  owner_user_id uuid not null references app.app_users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id)
);
create index presets_owner_idx on app.presets (owner_user_id, institution_id);

-- In-app notices. data holds ids only, never names: the UI resolves them with the reader's rights.
create table app.notifications (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  user_id uuid not null references app.app_users (id) on delete cascade,
  kind text not null check (kind in ('versions_ready', 'task_new', 'submission_received')),
  entity text not null check (entity ~ '^[a-z][a-z0-9_]{2,63}$'),
  entity_id uuid not null,
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id)
);
create index notifications_unread_idx on app.notifications (user_id, institution_id, created_at) where read_at is null;

-- Imports from the browser's localStorage (phase 4), idempotent by op_key and resumable by parts.
create table app.import_runs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  user_id uuid references app.app_users (id) on delete set null,
  op_key uuid not null,
  format_version integer not null check (format_version >= 1),
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  parts_total integer not null check (parts_total >= 1),
  parts_done integer not null default 0 check (parts_done >= 0),
  -- { "<old local id>": "<new uuid>" }
  id_map jsonb not null default '{}' check (jsonb_typeof(id_map) = 'object'),
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  unique (institution_id, id),
  unique (institution_id, op_key),
  check (parts_done <= parts_total)
);

-- The teacher's saved session while they "see as Paula" (phase 4). The refresh token is encrypted
-- by the server before it gets here; single use, bound to the sandbox and its owner.
create table app.sandbox_sessions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  owner_user_id uuid not null references app.app_users (id) on delete cascade,
  refresh_token_ciphertext bytea not null,
  claim_token uuid,
  claimed_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, id),
  check (expires_at > created_at),
  check ((claim_token is null) = (claimed_at is null))
);
create unique index sandbox_sessions_live_key on app.sandbox_sessions (institution_id) where consumed_at is null;

create trigger audit_log_append_only before update on app.audit_log for each row execute function app.append_only();
create trigger erasures_touch before update on app.erasures for each row execute function app.touch_row();
create trigger rate_limits_touch before update on app.rate_limits for each row execute function app.touch_row();
create trigger presets_touch before update on app.presets for each row execute function app.touch_row();
create trigger notifications_touch before update on app.notifications for each row execute function app.touch_row();
create trigger import_runs_touch before update on app.import_runs for each row execute function app.touch_row();
create trigger sandbox_sessions_touch before update on app.sandbox_sessions for each row execute function app.touch_row();

alter table app.audit_log enable row level security;
alter table app.audit_log force row level security;
alter table app.erasures enable row level security;
alter table app.erasures force row level security;
alter table app.rate_limits enable row level security;
alter table app.rate_limits force row level security;
alter table app.presets enable row level security;
alter table app.presets force row level security;
alter table app.notifications enable row level security;
alter table app.notifications force row level security;
alter table app.import_runs enable row level security;
alter table app.import_runs force row level security;
alter table app.sandbox_sessions enable row level security;
alter table app.sandbox_sessions force row level security;

-- The audited-read helper every sensitive RPC calls before returning data. One row per request,
-- the set of students deduplicated and sorted; nothing is logged when nobody was disclosed.
-- The request id comes from the x-request-id header the repos send (PostgREST exposes request
-- headers as a setting), so support can join a log line and an audit row without any data.
create function app.audit_disclosure(p_institution_id uuid, p_action text, p_entity text, p_entity_id uuid, p_student_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  if coalesce(cardinality(p_student_ids), 0) = 0 then
    return;
  end if;
  begin
    v_request_id := (nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-request-id')::uuid;
  exception when others then
    v_request_id := null;
  end;
  insert into app.audit_log (institution_id, actor_user_id, action, entity, entity_id, student_ids, request_id)
  values (
    p_institution_id, auth.uid(), p_action, p_entity, p_entity_id,
    array(select distinct s from unnest(p_student_ids) as s where s is not null order by s),
    v_request_id
  );
end
$$;

-- Erasure mode: the only way to rewrite a historical row. Erasing one student must also take them
-- out of rows that belong to other students too (a shared version's events, outputs, key revisions
-- or publication), and those rows reject UPDATE. app.begin_erasure(id) opens a transaction-local
-- window, valid only for an erasure already marked (status 'marked', so the mark always comes
-- first); app.append_only, app.publications_guard (content only) and app.generations_guard
-- (inputs only) let redactions through while it is open. It closes with the transaction, and the
-- erasure row moving to 'done' closes it for good. Only the internal erasure RPC (T9.5, service_role)
-- calls begin_erasure: no user can set the setting, and nothing grants EXECUTE on app functions.
create function app.in_erasure() returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_setting text := coalesce(current_setting('tiza.erasure', true), '');
begin
  if v_setting !~ '^[0-9a-f-]{36}$' then
    return false;
  end if;
  return exists (select 1 from app.erasures e where e.id = v_setting::uuid and e.status = 'marked');
end
$$;

create function app.begin_erasure(p_erasure_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from app.erasures e where e.id = p_erasure_id and e.status = 'marked') then
    raise exception 'app.begin_erasure: only a marked erasure opens erasure mode' using errcode = 'P0004';
  end if;
  perform set_config('tiza.erasure', p_erasure_id::text, true);
end
$$;
