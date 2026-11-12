-- T1.F2: two small fixes.
--
-- 1. unenroll_student ended the enrollment with now(), the start of the transaction. A transaction
--    that began before another one that enrolled the same pair, and got the lock after it, stamped an
--    ended_at earlier than the started_at of that enrollment: raw 23514 from enrollments_check. The
--    clock is now taken after the lock with clock_timestamp(). Only app.enrollments has a check that
--    compares two dates (ended_at >= started_at). memberships.revoked_at, group_staff.removed_at,
--    groups.archived_at and students.archived_at have none, so they keep now(); enroll_student keeps
--    the default started_at (nothing written later by a waiting transaction is compared with it
--    other than the end of that same enrollment, which reads the clock after the lock).
--
-- 2. create_student_note had no op_key: a double submit created two notes. It gets p_op_key (contract
--    change, additive and approved). The identity of the operation is stored with the note, as it was
--    when it was created: sha256(student_id ':' body). The body can be edited later, so the identity
--    is never rebuilt from the row. The key is per author (a note is the author's own; another
--    teacher's key cannot collide with it). Under the lock of (author, op_key): the same identity
--    answers the original {id, revision: 1}, another is CONFLICT op_key_reused.
--    p_op_key is required (no default): a null is INVALID invalid_op_key, like create_student.
--    The hash is derived from a health-adjacent text, so it lives and dies with the note (it goes
--    with the row on erasure).

-- ---------------------------------------------------------------------------------------------
-- 1. unenroll_student
-- ---------------------------------------------------------------------------------------------
create or replace function api.unenroll_student(p_group_id uuid, p_student_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  perform app.group_gate(p_group_id, 'manage');
  perform pg_advisory_xact_lock(hashtextextended('tiza.enrollment:' || p_group_id::text || ':' || coalesce(p_student_id::text, ''), 0));
  perform 1 from app.groups g where g.id = p_group_id for share;
  select e.id into v_id from app.enrollments e
   where e.group_id = p_group_id and e.student_id = p_student_id and e.ended_at is null
   for update;
  if found then
    -- The clock after the lock: now() is the start of the transaction, which may be earlier than the
    -- started_at of an enrollment another transaction made while this one waited.
    update app.enrollments set ended_at = clock_timestamp(), revision = revision + 1 where id = v_id;
    return jsonb_build_object('id', v_id);
  end if;
  select e.id into v_id from app.enrollments e
   where e.group_id = p_group_id and e.student_id = p_student_id
   order by e.ended_at desc limit 1;
  if v_id is null then
    perform app.raise_error('NOT_FOUND', 'not_enrolled');
  end if;
  return jsonb_build_object('id', v_id);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. create_student_note with op_key
-- ---------------------------------------------------------------------------------------------
alter table app.student_notes
  add column op_key uuid,
  add column op_identity text check (op_identity is null or op_identity ~ '^[0-9a-f]{64}$'),
  add check ((op_key is null) = (op_identity is null));

create unique index student_notes_op_key_key on app.student_notes (author_user_id, op_key) where op_key is not null;

-- What was stored with the note at creation never changes.
create or replace function app.student_notes_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.student_id is distinct from old.student_id then
    raise exception 'app.student_notes_frozen: student_id never changes' using errcode = 'P0004';
  end if;
  if new.author_user_id is distinct from old.author_user_id and new.author_user_id is not null then
    raise exception 'app.student_notes_frozen: author_user_id never changes' using errcode = 'P0004';
  end if;
  if new.op_key is distinct from old.op_key or new.op_identity is distinct from old.op_identity then
    raise exception 'app.student_notes_frozen: the operation of a note never changes' using errcode = 'P0004';
  end if;
  if old.archived_at is not null and (new.archived_at is distinct from old.archived_at or new.body is distinct from old.body) then
    raise exception 'app.student_notes_frozen: an archived note does not change' using errcode = 'P0004';
  end if;
  return new;
end
$$;

drop function api.create_student_note(uuid, text);

create function api.create_student_note(p_student_id uuid, p_body text, p_op_key uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_body text;
  v_identity text;
  v_archived_at timestamptz;
  v_existing app.student_notes;
  v_id uuid;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.notes_gate(p_student_id);
  v_body := app.clean_note_body(p_body);
  if p_op_key is null then
    perform app.raise_error('INVALID', 'invalid_op_key');
  end if;
  v_identity := encode(sha256(convert_to(p_student_id::text || ':' || v_body, 'utf8')), 'hex');

  -- One lock per (author, op_key): two submits of the same key are serialized before anybody reads.
  perform pg_advisory_xact_lock(hashtextextended('tiza.create_note:' || app.actor_id()::text || ':' || p_op_key::text, 0));
  select s.archived_at into v_archived_at from app.students s where s.id = p_student_id for share;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  select * into v_existing from app.student_notes n
   where n.author_user_id = app.actor_id() and n.op_key = p_op_key;
  if found then
    if v_existing.op_identity is not distinct from v_identity then
      return jsonb_build_object('id', v_existing.id, 'revision', 1);
    end if;
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;
  if v_archived_at is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;

  insert into app.student_notes (institution_id, student_id, author_user_id, body, op_key, op_identity)
  values (v_institution_id, p_student_id, app.actor_id(), v_body, p_op_key, v_identity)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'revision', 1);
end
$$;

grant execute on function api.create_student_note(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. record_consent: the clock after every lock that can block (R-3)
-- ---------------------------------------------------------------------------------------------
-- Same signature. v_now was taken right after the advisory lock but before the student row and the
-- consent form `for share`, which can wait behind another transaction (set_student_needs holds the
-- student row `for update`): an expiry could pass while it waited and still be accepted. Now the
-- clock is read once every lock is held, just before anything is validated against it or written;
-- the revocation and the new consent still share that instant.
create or replace function api.record_consent(
  p_student_id uuid, p_purpose text, p_text_version text, p_valid_until timestamptz default null, p_file_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_archived_at timestamptz;
  v_current app.consents;
  v_id uuid;
  v_now timestamptz;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.student_gate(p_student_id);

  -- Shape first: a null is INVALID, never a silent pass (a regex or an IN with null is null).
  if p_purpose is null or p_purpose not in ('store_profile', 'ai_adaptation', 'ai_dictation', 'ai_analysis') then
    perform app.raise_error('INVALID', 'invalid_purpose');
  end if;
  if p_text_version is null or p_text_version !~ '^[a-z0-9][a-z0-9._-]{0,31}$' then
    perform app.raise_error('INVALID', 'invalid_text_version');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tiza.consents:' || p_student_id::text, 0));
  select s.archived_at into v_archived_at from app.students s where s.id = p_student_id for share;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  -- The signed form must be a ready consent form of this student, in this institution.
  if p_file_id is not null then
    perform 1 from app.files f
     where f.institution_id = v_institution_id and f.id = p_file_id and f.student_id = p_student_id
       and f.purpose = 'consent_form' and f.status = 'ready'
       for share;
    if not found then
      perform app.raise_error('INVALID', 'invalid_file');
    end if;
  end if;
  select * into v_current from app.consents c
   where c.student_id = p_student_id and c.purpose = p_purpose and c.status = 'granted'
     for update;

  -- Every lock is held: from here nothing waits. The expiry must be in the future of this instant.
  v_now := clock_timestamp();
  if p_valid_until is not null and p_valid_until <= v_now then
    perform app.raise_error('INVALID', 'invalid_valid_until');
  end if;
  if v_current.id is not null and v_current.text_version = p_text_version
     and v_current.valid_until is not distinct from p_valid_until
     and v_current.file_id is not distinct from p_file_id then
    return jsonb_build_object('id', v_current.id, 'revision', v_current.revision);
  end if;
  if v_archived_at is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;

  if v_current.id is not null then
    update app.consents
       set status = 'revoked', revoked_at = v_now, revoked_by = app.actor_id(), revision = revision + 1
     where id = v_current.id;
  end if;
  insert into app.consents (institution_id, student_id, purpose, text_version, valid_from, valid_until, file_id, recorded_by)
  values (v_institution_id, p_student_id, p_purpose, p_text_version, v_now, p_valid_until, p_file_id, app.actor_id())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'revision', 1);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. consents_frozen: who acted (R-4)
-- ---------------------------------------------------------------------------------------------
-- recorded_by and revoked_by only go to null (the account is deleted). Nobody can be assigned to a
-- consent that had none, and revoked_by is set only by the revocation itself (granted -> revoked).
create or replace function app.consents_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.student_id is distinct from old.student_id or new.purpose is distinct from old.purpose
     or new.text_version is distinct from old.text_version or new.valid_from is distinct from old.valid_from
     or new.valid_until is distinct from old.valid_until then
    raise exception 'app.consents_frozen: what was signed never changes' using errcode = 'P0004';
  end if;
  if new.file_id is distinct from old.file_id and old.file_id is not null then
    raise exception 'app.consents_frozen: file_id never changes once set' using errcode = 'P0004';
  end if;
  if old.status = 'revoked' and (new.status <> 'revoked' or new.revoked_at is distinct from old.revoked_at) then
    raise exception 'app.consents_frozen: a revoked consent is not reopened' using errcode = 'P0004';
  end if;
  if new.recorded_by is distinct from old.recorded_by and new.recorded_by is not null then
    raise exception 'app.consents_frozen: who recorded never changes' using errcode = 'P0004';
  end if;
  if new.revoked_by is distinct from old.revoked_by and new.revoked_by is not null
     and not (old.status = 'granted' and new.status = 'revoked') then
    raise exception 'app.consents_frozen: who revoked is set once, by the revocation' using errcode = 'P0004';
  end if;
  return new;
end
$$;
