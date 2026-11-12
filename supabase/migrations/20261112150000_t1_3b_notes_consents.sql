-- T1.3b: private notes and consents. Replaces the stubs of 20261111131000 (same signatures) and
-- grants EXECUTE to authenticated. No new table.
--
-- Who may do what, from the session and never from a parameter (docs/contratos/fase-1.md, matrix):
--   * notes (health-adjacent teacher text): only staff of a group where the student is enrolled right
--     now (a teacher, the sandbox visitor, an admin who also teaches that group) read and write; an
--     admin who does not teach it and inclusion are FORBIDDEN, the student themselves too, a teacher
--     of another group or another institution is NOT_FOUND. Only the author changes or archives a note
--     (FORBIDDEN not_author for any other reader);
--   * consents: read by admin, inclusion and the staff of the student's group; recorded and revoked by
--     the admin and the staff (app.student_gate of T1.2b); inclusion and the student are FORBIDDEN.
--
-- Locks. A note has no unique key and no operation id (the signatures carry none), so a note takes
-- only the student row `for share` before it writes and then its own row `for update`. Consents are
-- serialized per student with one advisory lock, taken by record_consent and revoke_consent before
-- any row: two registrations of the same purpose cannot leave two granted consents, and the partial
-- unique index consents_granted_key stays as the last resort (every writer of app.consents takes that
-- lock first, a future writer must too). Then the student row `for share`, the file `for share` and
-- the consents `for update`. No RPC here touches the assessment tree.
--
-- Idempotency. Neither signature has an op_key. record_consent compares what the call defines (the
-- student, the purpose, the text version, the expiry and the file) with the consent that is granted
-- now, under the lock: the same thing answers that consent and writes nothing, so a retry never
-- revokes the consent it just made. revoke_consent is a revision-checked write: a retry that carries
-- the revision it had read finds the consent revoked by the same actor one revision later and answers
-- the same result. create_student_note cannot be idempotent without an identity: the front disables
-- the button while the call is in flight.

-- ---------------------------------------------------------------------------------------------
-- Guards: columns that say who a row belongs to, or what was signed, never change.
-- ---------------------------------------------------------------------------------------------

-- The student never changes; the author only goes to null (ON DELETE SET NULL of the account); an
-- archived note is not edited or restored.
create function app.student_notes_frozen() returns trigger
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
  if old.archived_at is not null and (new.archived_at is distinct from old.archived_at or new.body is distinct from old.body) then
    raise exception 'app.student_notes_frozen: an archived note does not change' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create trigger student_notes_frozen
  before update on app.student_notes
  for each row execute function app.student_notes_frozen();

-- What was signed (student, purpose, text, dates) never changes; a file can be attached once; a
-- revoked consent stays revoked; the two account references only go to null.
create function app.consents_frozen() returns trigger
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
  if (new.revoked_by is distinct from old.revoked_by and old.revoked_by is not null and new.revoked_by is not null)
     or (new.recorded_by is distinct from old.recorded_by and old.recorded_by is not null and new.recorded_by is not null) then
    raise exception 'app.consents_frozen: who acted never changes' using errcode = 'P0004';
  end if;
  return new;
end
$$;

create trigger consents_frozen
  before update on app.consents
  for each row execute function app.consents_frozen();

-- ---------------------------------------------------------------------------------------------
-- Helpers (read without locking: the caller locks after being authorized). Both return the
-- institution of the student.
-- ---------------------------------------------------------------------------------------------

create function app.notes_gate(p_student_id uuid) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_institution_id uuid;
begin
  select s.institution_id into v_institution_id from app.students s where s.id = p_student_id;
  if v_institution_id is null
     or not app.is_member(v_institution_id, array['admin', 'teacher', 'inclusion', 'student']) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if exists (
    select 1 from app.enrollments e
     where e.institution_id = v_institution_id and e.student_id = p_student_id and e.ended_at is null
       and app.is_group_staff(e.group_id)
  ) then
    return v_institution_id;
  end if;
  -- Seen but not enough: an admin who does not teach the group, inclusion, the student.
  if app.is_member(v_institution_id, array['admin', 'inclusion']) or app.is_student_self(p_student_id) then
    perform app.raise_error('FORBIDDEN', 'forbidden');
  end if;
  perform app.raise_error('NOT_FOUND', 'not_found');
  return null;
end
$$;

-- Read consents: like app.student_gate (admin, staff of the student's group) plus inclusion.
create function app.consents_read_gate(p_student_id uuid) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_institution_id uuid;
begin
  select s.institution_id into v_institution_id from app.students s where s.id = p_student_id;
  if v_institution_id is null
     or not app.is_member(v_institution_id, array['admin', 'teacher', 'inclusion', 'student']) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if app.is_member(v_institution_id, array['admin', 'inclusion']) then
    return v_institution_id;
  end if;
  if exists (
    select 1 from app.enrollments e
     where e.institution_id = v_institution_id and e.student_id = p_student_id and e.ended_at is null
       and app.is_group_staff(e.group_id)
  ) then
    return v_institution_id;
  end if;
  if app.is_student_self(p_student_id) then
    perform app.raise_error('FORBIDDEN', 'forbidden');
  end if;
  perform app.raise_error('NOT_FOUND', 'not_found');
  return null;
end
$$;

-- The note body as stored: trimmed like the schema does; null or empty or over 5000 is INVALID.
create function app.clean_note_body(p_body text) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_body text := btrim(p_body, E' \t\r\n');
begin
  if v_body is null or char_length(v_body) not between 1 and 5000 then
    perform app.raise_error('INVALID', 'invalid_note');
  end if;
  return v_body;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------------------------

-- Archived notes are listed too (archivedAt says so). A student with no notes shows nothing, so no
-- audit row is written.
create or replace function api.list_student_notes(p_student_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_items jsonb;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.notes_gate(p_student_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id, 'studentId', n.student_id, 'authorUserId', n.author_user_id, 'body', n.body,
           'archivedAt', n.archived_at, 'createdAt', n.created_at, 'revision', n.revision
         ) order by n.created_at desc, n.id), '[]'::jsonb)
    into v_items
    from app.student_notes n
   where n.institution_id = v_institution_id and n.student_id = p_student_id;
  if jsonb_array_length(v_items) > 0 then
    perform app.audit_disclosure(v_institution_id, 'list_student_notes', 'student', p_student_id, array[p_student_id]);
  end if;
  return jsonb_build_object('items', v_items);
end
$$;

create or replace function api.create_student_note(p_student_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_body text;
  v_archived_at timestamptz;
  v_id uuid;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.notes_gate(p_student_id);
  v_body := app.clean_note_body(p_body);

  select s.archived_at into v_archived_at from app.students s where s.id = p_student_id for share;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if v_archived_at is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;

  insert into app.student_notes (institution_id, student_id, author_user_id, body)
  values (v_institution_id, p_student_id, app.actor_id(), v_body)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'revision', 1);
end
$$;

-- Edit: only the author, with the revision they read. A note of an archived student or an archived
-- note takes no edit.
create or replace function api.update_student_note(p_note_id uuid, p_revision integer, p_body text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_student_id uuid;
  v_author uuid;
  v_body text;
  v_student_archived timestamptz;
  v_note app.student_notes;
  v_revision integer;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select n.student_id, n.author_user_id into v_student_id, v_author from app.student_notes n where n.id = p_note_id;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform app.notes_gate(v_student_id);
  -- The author never changes (guard), so this unlocked read decides.
  if v_author is distinct from app.actor_id() then
    perform app.raise_error('FORBIDDEN', 'not_author');
  end if;
  v_body := app.clean_note_body(p_body);

  select s.archived_at into v_student_archived from app.students s where s.id = v_student_id for share;
  select * into v_note from app.student_notes n where n.id = p_note_id for update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform app.assert_revision(p_revision, v_note.revision);
  if v_note.archived_at is not null or v_student_archived is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;

  update app.student_notes set body = v_body, revision = revision + 1 where id = p_note_id returning revision into v_revision;
  return jsonb_build_object('id', p_note_id, 'revision', v_revision);
end
$$;

-- Archive: only the author, also when the student is archived (taking text out of sight is always
-- allowed). An archived note is not archived again: the retry carries an old revision.
create or replace function api.archive_student_note(p_note_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_student_id uuid;
  v_author uuid;
  v_note app.student_notes;
  v_revision integer;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select n.student_id, n.author_user_id into v_student_id, v_author from app.student_notes n where n.id = p_note_id;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform app.notes_gate(v_student_id);
  if v_author is distinct from app.actor_id() then
    perform app.raise_error('FORBIDDEN', 'not_author');
  end if;

  perform 1 from app.students s where s.id = v_student_id for share;
  select * into v_note from app.student_notes n where n.id = p_note_id for update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform app.assert_revision(p_revision, v_note.revision);
  if v_note.archived_at is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;

  update app.student_notes set archived_at = now(), revision = revision + 1 where id = p_note_id returning revision into v_revision;
  return jsonb_build_object('id', p_note_id, 'revision', v_revision);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Consents
-- ---------------------------------------------------------------------------------------------

-- Every consent of the student, revoked ones too (the history). A student with none shows nothing.
create or replace function api.list_student_consents(p_student_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_items jsonb;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.consents_read_gate(p_student_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'studentId', c.student_id, 'purpose', c.purpose, 'textVersion', c.text_version,
           'status', c.status, 'validFrom', c.valid_from, 'validUntil', c.valid_until,
           'revokedAt', c.revoked_at, 'fileId', c.file_id, 'revision', c.revision
         ) order by c.purpose, c.valid_from desc, c.created_at desc, c.id), '[]'::jsonb)
    into v_items
    from app.consents c
   where c.institution_id = v_institution_id and c.student_id = p_student_id;
  if jsonb_array_length(v_items) > 0 then
    perform app.audit_disclosure(v_institution_id, 'list_student_consents', 'student', p_student_id, array[p_student_id]);
  end if;
  return jsonb_build_object('items', v_items);
end
$$;

-- Records the consent for a purpose. The one that was granted for that purpose is revoked in the
-- same transaction, so there is always at most one. The same record again (same text, expiry and
-- file as the consent granted now: an expiry is always in the future, so that one has not expired)
-- answers that consent and writes nothing.
-- The effects of a consent on generations come in phase 9 (T9.3).
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
  -- The clock after the lock, not now(): the transaction may have waited behind another one, and the
  -- expiry must be in the future of the moment the consent is written (clock_timestamp, not the
  -- start of the transaction). The revocation and the new consent share this instant.
  v_now := clock_timestamp();
  if p_valid_until is not null and p_valid_until <= v_now then
    perform app.raise_error('INVALID', 'invalid_valid_until');
  end if;
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
  if found and v_current.text_version = p_text_version
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

-- Revokes with the revision the caller read. Allowed for an archived student too: a family can
-- always withdraw a consent. Its effects (stopping generations, deleting derived data) are T9.3.
create or replace function api.revoke_consent(p_consent_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_student_id uuid;
  v_consent app.consents;
  v_revision integer;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select c.student_id into v_student_id from app.consents c where c.id = p_consent_id;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform app.student_gate(v_student_id);

  perform pg_advisory_xact_lock(hashtextextended('tiza.consents:' || v_student_id::text, 0));
  select * into v_consent from app.consents c where c.id = p_consent_id for update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  -- A retry of a revocation that went through: revoked by this actor, one revision after the one
  -- they read. Answers what that call answered.
  if v_consent.status = 'revoked' and v_consent.revision = p_revision + 1
     and v_consent.revoked_by is not distinct from app.actor_id() then
    return jsonb_build_object('id', p_consent_id, 'revision', v_consent.revision);
  end if;
  perform app.assert_revision(p_revision, v_consent.revision);
  if v_consent.status = 'revoked' then
    perform app.raise_error('INVALID', 'already_revoked');
  end if;

  update app.consents
     set status = 'revoked', revoked_at = clock_timestamp(), revoked_by = app.actor_id(), revision = revision + 1
   where id = p_consent_id returning revision into v_revision;
  return jsonb_build_object('id', p_consent_id, 'revision', v_revision);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges: nothing in api has a default grant.
-- ---------------------------------------------------------------------------------------------

grant execute on function api.list_student_notes(uuid) to authenticated;
grant execute on function api.create_student_note(uuid, text) to authenticated;
grant execute on function api.update_student_note(uuid, integer, text) to authenticated;
grant execute on function api.archive_student_note(uuid, integer) to authenticated;
grant execute on function api.list_student_consents(uuid) to authenticated;
grant execute on function api.record_consent(uuid, text, text, timestamptz, uuid) to authenticated;
grant execute on function api.revoke_consent(uuid, integer) to authenticated;
