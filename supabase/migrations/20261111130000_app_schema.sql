-- Contract, phase 1: the internal schema and the generic helpers every later migration uses.
--
-- Why a separate schema: PostgREST only exposes the schemas listed in config.toml (public and
-- graphql_public). Tables live in `app`, so even a GRANT added by mistake cannot turn into a REST
-- endpoint. Everything users reach is an RPC in public, SECURITY DEFINER, that authorizes the actor
-- itself. Helpers live in `app` too: they are building blocks for those RPCs, never endpoints.

create schema app;
comment on schema app is 'Internal: tables and helpers. Not exposed by PostgREST. Reached only through RPCs in public.';

-- Nobody but the owner uses the schema. service_role is listed on purpose: the privileged server
-- code goes through internal RPCs too, never through tables.
revoke all on schema app from public, anon, authenticated, service_role;

-- Future objects in app start closed for every API role. Supabase grants nothing here by default
-- (its defaults are per schema, for public), so this documents and pins the intent.
alter default privileges for role postgres in schema app revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema app revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema app revoke all on functions from public, anon, authenticated, service_role;

-- Error convention. Every expected failure of an RPC goes through here:
--   SQLSTATE P0001, MESSAGE = one of the AppError codes, DETAIL = a snake_case reason key.
-- The Spanish text for the user lives in lib/domain/errors/reasons.ts, keyed by the reason, so SQL
-- can never put data into a user-facing message: an unknown reason falls back to the code's default
-- text, and anything that is not this shape is treated by the repos as an unexpected error.
create function app.raise_error(p_code text, p_reason text) returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_code is null or p_code not in ('NOT_FOUND', 'FORBIDDEN', 'INVALID', 'CONFLICT', 'RATE_LIMITED', 'UNAVAILABLE') then
    raise exception 'app.raise_error: unknown code' using errcode = 'P0004';
  end if;
  if p_reason is null or p_reason !~ '^[a-z][a-z0-9_]{1,62}$' then
    raise exception 'app.raise_error: the reason must be a snake_case key' using errcode = 'P0004';
  end if;
  raise exception using errcode = 'P0001', message = p_code, detail = p_reason;
end
$$;

-- Revision compare-and-swap. The caller reads the row FOR UPDATE, authorizes, then calls this with
-- the revision the client sent. A mismatch is CONFLICT ("someone changed this while you edited").
create function app.assert_revision(p_expected integer, p_current integer) returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_expected is null then
    perform app.raise_error('INVALID', 'revision_required');
  end if;
  if p_expected <> p_current then
    perform app.raise_error('CONFLICT', 'revision_mismatch');
  end if;
end
$$;

-- Trigger for every editable row: keeps updated_at honest, keeps identity columns frozen and makes
-- revision move forward by exactly one or stay. The RPC bumps revision itself in the CAS update
-- (a trigger that always bumped it would also bump on status-only changes such as approving, and an
-- approved revision would never match). Works for tables with or without institution_id/revision.
create function app.touch_row() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
begin
  if v_new -> 'id' is distinct from v_old -> 'id'
     or v_new -> 'institution_id' is distinct from v_old -> 'institution_id'
     or v_new -> 'created_at' is distinct from v_old -> 'created_at' then
    raise exception 'app.touch_row: id, institution_id and created_at never change' using errcode = 'P0004';
  end if;
  if v_new ? 'revision'
     and (v_new ->> 'revision')::integer not in ((v_old ->> 'revision')::integer, (v_old ->> 'revision')::integer + 1) then
    raise exception 'app.touch_row: revision only moves forward by one' using errcode = 'P0004';
  end if;
  new.updated_at := now();
  return new;
end
$$;

-- Trigger for append-only tables (events, outputs, key revisions, audit). Rows are never rewritten:
-- they are the feedback the learning engine learns from and the evidence of who saw what. DELETE
-- stays possible on purpose: erasure and retention remove rows, they never edit them.
create function app.append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'app.append_only: % rows are never updated', tg_table_name using errcode = 'P0004';
end
$$;

-- CHECK helpers. CHECK constraints cannot hold subqueries, so array rules live in immutable functions.

-- A set of catalogue keys (profiles, supports): snake_case, no duplicates, bounded.
create function app.is_key_set(p_values text[], p_max integer) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(p_values), 0) <= p_max
     and not exists (select 1 from unnest(p_values) as v where v is null or v !~ '^[a-z][a-z0-9_]{0,39}$')
     and (select count(distinct v) from unnest(p_values) as v) = coalesce(cardinality(p_values), 0)
$$;

-- Short free-text items (interests): trimmed, non-empty, bounded in count and length.
create function app.is_short_text_list(p_values text[], p_max_items integer, p_max_length integer) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(p_values), 0) <= p_max_items
     and not exists (
       select 1 from unnest(p_values) as v
        where v is null or v <> btrim(v) or char_length(v) not between 1 and p_max_length
     )
$$;

-- A set of uuids without duplicates or nulls (audit_log.student_ids, answer_key_revisions.question_ids).
create function app.is_uuid_set(p_values uuid[]) returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (select 1 from unnest(p_values) as v where v is null)
     and (select count(distinct v) from unnest(p_values) as v) = coalesce(cardinality(p_values), 0)
$$;
