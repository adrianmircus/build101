-- T2.5a (docs/contratos/fase-2.md, «Sesión vigente en la base», «Cómo entra un estudiante», «Aprovisionar una cuenta de
-- estudiante», «Emitir tarjetas», «Cuentas de estudiantes (T2.5a)»): the student account RPCs replace their stubs of
-- 20261114100000_f2_contract.sql with CREATE OR REPLACE and the same signatures, plus the EXECUTE grants («Nombres»:
-- authenticated for the user RPCs, service_role for internal_*). It also completes app.session_alive() with the part of the
-- student and puts the foreign key of student_sessions on auth.sessions.
--
-- Locks, always in this order (a student is the first thing every one of these RPCs locks, so none of them can wait on another
-- in a cycle): the advisory lock of the op_key (issue_access_cards only) -> the rows of students FOR UPDATE, in id order ->
-- the row of account_provisioning FOR UPDATE -> the advisory lock of the Auth id (app.student_auth_lock, the same one the
-- triggers on auth.users and on account_provisioning take) -> auth.sessions. The triggers of auth.users take the row of
-- account_provisioning first and the advisory lock after, and never a student: they cannot close a cycle with these.

-- ---------------------------------------------------------------------------------------------
-- The session of a student is registered, and goes with the session of Auth.
-- ---------------------------------------------------------------------------------------------

-- The registry follows auth.sessions: signing out, a new card or deleting the account deletes the session and, by this
-- cascade, its registry row. A session restored by hand does not get its row back (F2C-78).
alter table app.student_sessions
  add constraint student_sessions_session_id_fkey foreign key (session_id) references auth.sessions (id) on delete cascade;

-- A new row exists only with the current version of the credential of its student (the bind checks it first, under the lock of
-- the student; this is the guard for anyone else writing the table).
create function app.student_sessions_born() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from app.student_credentials c
                  where c.student_id = new.student_id and c.institution_id = new.institution_id and c.version = new.version) then
    raise exception 'app.student_sessions_born: a session is registered only with the current version of the credential' using errcode = 'P0004';
  end if;
  return new;
end
$$;
create trigger student_sessions_born before insert on app.student_sessions
  for each row execute function app.student_sessions_born();

-- Is the session of the caller still alive? Same as T2.7 plus: its user is the `sub` of the JWT (a session of another user,
-- or a JWT that names no user, is not this caller's), and for the account of a student (students.user_id = sub) the session
-- has to be registered by our server in app.student_sessions with the current version of his credential (F2C-75): a session
-- that Auth made by another way never reads anything. Staff and claims without session_id pass as before.
create or replace function app.session_alive() returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_session text;
  v_sub text;
  v_user uuid;
  v_student uuid;
begin
  if v_claims is null then
    return true;
  end if;
  v_session := v_claims::jsonb ->> 'session_id';
  if v_session is null then
    return true;
  end if;
  -- Something that is not a uuid cannot be a session that exists, nor a user.
  if v_session !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_sub := v_claims::jsonb ->> 'sub';
  if v_sub is null or v_sub !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  select s.user_id into v_user from auth.sessions s where s.id = v_session::uuid;
  if v_user is null or v_user <> v_sub::uuid then
    return false;
  end if;
  select st.id into v_student from app.students st where st.user_id = v_user;
  if v_student is null then
    return true;
  end if;
  return exists (select 1 from app.student_sessions ss
                   join app.student_credentials c on c.student_id = ss.student_id and c.version = ss.version
                  where ss.session_id = v_session::uuid and ss.student_id = v_student);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Helper: the shape of p_cards.
-- ---------------------------------------------------------------------------------------------

-- [{studentId, tokenHash, passwordHash}], 1 to 60, exactly those keys, each one a string of its shape, no student and no token
-- twice. Always a boolean (a NULL never gets through): the caller refuses with `is not true`.
create function app.access_cards_valid(p_cards jsonb) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_card jsonb;
  v_students uuid[] := '{}';
  v_tokens text[] := '{}';
  v_id uuid;
begin
  if p_cards is null or jsonb_typeof(p_cards) <> 'array' or jsonb_array_length(p_cards) not between 1 and 60 then
    return false;
  end if;
  for v_card in select e from jsonb_array_elements(p_cards) as e loop
    if jsonb_typeof(v_card) <> 'object' or (select count(*) from jsonb_object_keys(v_card)) <> 3
       or not (v_card ?& array['studentId', 'tokenHash', 'passwordHash']) then
      return false;
    end if;
    if jsonb_typeof(v_card -> 'studentId') is distinct from 'string' or jsonb_typeof(v_card -> 'tokenHash') is distinct from 'string'
       or jsonb_typeof(v_card -> 'passwordHash') is distinct from 'string' then
      return false;
    end if;
    if (v_card ->> 'studentId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (v_card ->> 'tokenHash') !~ '^[0-9a-f]{64}$'
       or (v_card ->> 'passwordHash') !~ '^scrypt[$]15[$]8[$]1[$][A-Za-z0-9+/=]+[$][A-Za-z0-9+/=]+$' then
      return false;
    end if;
    v_id := (v_card ->> 'studentId')::uuid;
    if v_id = any (v_students) or (v_card ->> 'tokenHash') = any (v_tokens) then
      return false;
    end if;
    v_students := v_students || v_id;
    v_tokens := v_tokens || (v_card ->> 'tokenHash');
  end loop;
  return true;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- list_taken_usernames
-- ---------------------------------------------------------------------------------------------
create or replace function api.list_taken_usernames(p_institution_id uuid, p_bases text[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_items jsonb;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  -- NOT_FOUND for who cannot see the institution; FORBIDDEN for a member who is not an admin or a teacher (inclusion, student).
  if p_institution_id is null or not app.is_member(p_institution_id, array['admin', 'teacher', 'inclusion', 'student']) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if not app.is_member(p_institution_id, array['admin', 'teacher']) then
    perform app.raise_error('FORBIDDEN', 'forbidden');
  end if;
  if p_bases is null or coalesce(cardinality(p_bases), 0) not between 1 and 200
     or exists (select 1 from unnest(p_bases) as b(base) where b.base is null or b.base !~ '^[a-z0-9]{1,40}$') then
    perform app.raise_error('INVALID', 'invalid_username');
  end if;
  -- A base, or a base followed by digits only (the ones that «luciaf», «luciaf2», «luciaf3»… would collide with). Archived students
  -- count: the username is unique in the institution whoever holds it.
  select coalesce(jsonb_agg(u.username order by u.username), '[]'::jsonb) into v_items
    from (select distinct s.username
            from app.students s
            join unnest(p_bases) as b(base)
              on s.username = b.base
              or (s.username like b.base || '%' and substr(s.username, char_length(b.base) + 1) ~ '^[0-9]+$')
           where s.institution_id = p_institution_id) as u;
  return jsonb_build_object('items', v_items);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- list_group_accounts
-- ---------------------------------------------------------------------------------------------
create or replace function api.list_group_accounts(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_sandbox boolean;
  v_group_name text;
  v_code text;
  v_items jsonb;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  -- Admin or staff of the group, the same gate issue_access_cards uses; whoever passes it can issue unless the institution is a sandbox.
  v_institution_id := app.group_gate(p_group_id, 'manage');
  v_sandbox := app.institution_kind(v_institution_id) = 'sandbox';
  select g.name, i.code into v_group_name, v_code
    from app.groups g join app.institutions i on i.id = g.institution_id where g.id = p_group_id;

  -- Every student of a school has a provisioning row from the day he is created (phase 1): a missing one is a data error. A
  -- sandbox without one is read as «none».
  if not v_sandbox and exists (
       select 1 from app.enrollments e
         join app.students s on s.institution_id = e.institution_id and s.id = e.student_id
        where e.institution_id = v_institution_id and e.group_id = p_group_id and e.ended_at is null and s.archived_at is null
          and not exists (select 1 from app.account_provisioning ap where ap.student_id = s.id)) then
    raise exception 'list_group_accounts: a student of a school has no provisioning row' using errcode = 'P0004';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'studentId', r.id, 'displayName', r.display_name, 'username', r.username, 'accountStatus', r.account_status,
           'hasSignedIn', r.has_signed_in, 'lastCardAt', r.last_card_at) order by r.display_name, r.id), '[]'::jsonb)
    into v_items
    from (
      select s.id, s.display_name, s.username,
             case when ap.id is null or ap.status = 'not_applicable' then 'none' else ap.status end as account_status,
             coalesce((select u.last_sign_in_at is not null from auth.users u where u.id = s.user_id), false) as has_signed_in,
             (select max(c.created_at) from app.access_cards c where c.student_id = s.id) as last_card_at
        from app.enrollments e
        join app.students s on s.institution_id = e.institution_id and s.id = e.student_id
        left join app.account_provisioning ap on ap.student_id = s.id
       where e.institution_id = v_institution_id and e.group_id = p_group_id and e.ended_at is null and s.archived_at is null
         and ap.status is distinct from 'deleted'
    ) as r;
  return jsonb_build_object('groupName', v_group_name, 'institutionCode', v_code, 'canIssueCards', not v_sandbox, 'items', v_items);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- issue_access_cards
-- ---------------------------------------------------------------------------------------------
-- One transaction (docs/contratos/fase-2.md, «Emitir tarjetas»); it writes nothing in Auth but the deletion of the sessions of
-- the students. Order: authorize and check the shape, then the lock of the op_key and its search (a repeat never depends on
-- the references that can change), then the students FOR UPDATE in id order and, for a new issue, the references.
create or replace function api.issue_access_cards(p_group_id uuid, p_cards jsonb, p_op_key uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_ids uuid[];
  v_identity text;
  v_existing app.access_card_issues;
  v_issue_id uuid;
  v_student app.students;
  v_card jsonb;
  v_items jsonb;
  v_code text;
  v_name text;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.group_gate(p_group_id, 'manage');
  if app.institution_kind(v_institution_id) = 'sandbox' then
    perform app.raise_error('FORBIDDEN', 'sandbox_restricted');
  end if;
  if p_op_key is null then
    perform app.raise_error('INVALID', 'invalid_op_key');
  end if;
  if app.access_cards_valid(p_cards) is not true then
    perform app.raise_error('INVALID', 'invalid_cards');
  end if;

  select array_agg((c ->> 'studentId')::uuid order by (c ->> 'studentId')::uuid) into v_ids from jsonb_array_elements(p_cards) as c;
  -- The identity: the group and the sorted set of students, as a digest (the issue keeps no student id).
  v_identity := encode(sha256(convert_to(jsonb_build_array('issue_access_cards', p_group_id, to_jsonb(v_ids))::text, 'utf8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended('tiza.issue_access_cards:' || v_institution_id::text || ':' || p_op_key::text, 0));
  select * into v_existing from app.access_card_issues i where i.institution_id = v_institution_id and i.op_key = p_op_key;
  if found then
    -- The passwords were never kept, so a repeat cannot be answered: the screen offers a new issue with another op_key.
    if v_existing.op_identity = v_identity then
      perform app.raise_error('CONFLICT', 'card_issue_done');
    end if;
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;

  -- The students, locked in id order: two issues that share students wait for each other in the same order and the last one to
  -- commit leaves its card and its password.
  perform 1 from app.students s where s.institution_id = v_institution_id and s.id = any (v_ids) order by s.id for update;
  if (select count(*) from app.students s
        join app.enrollments e on e.institution_id = s.institution_id and e.student_id = s.id and e.group_id = p_group_id and e.ended_at is null
        join app.account_provisioning ap on ap.student_id = s.id and ap.status = 'active' and ap.auth_user_id = s.user_id
       where s.institution_id = v_institution_id and s.id = any (v_ids) and s.archived_at is null and s.user_id is not null)
     <> cardinality(v_ids) then
    perform app.raise_error('INVALID', 'not_enrolled');
  end if;

  begin
    insert into app.access_card_issues (institution_id, group_id, op_key, op_identity, issued_by)
    values (v_institution_id, p_group_id, p_op_key, v_identity, app.actor_id())
    returning id into v_issue_id;
  exception when unique_violation then
    -- The lock above makes this unreachable; the unique index decides if it ever is.
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end;

  for v_student in
    select s.* from app.students s where s.institution_id = v_institution_id and s.id = any (v_ids) order by s.id
  loop
    select c into v_card from jsonb_array_elements(p_cards) as c where (c ->> 'studentId')::uuid = v_student.id;
    update app.access_cards set status = 'revoked', revoked_at = now() where student_id = v_student.id and status = 'active';
    begin
      insert into app.access_cards (institution_id, student_id, issue_id, token_hash)
      values (v_institution_id, v_student.id, v_issue_id, decode(v_card ->> 'tokenHash', 'hex'));
    exception when unique_violation then
      -- A token that already exists is not a token of 32 random bytes.
      perform app.raise_error('INVALID', 'invalid_cards');
    end;
    -- The next version and the issue that put this hash (the guard of the table asks for both together).
    insert into app.student_credentials (institution_id, student_id, password_hash, version, issue_id)
    values (v_institution_id, v_student.id, v_card ->> 'passwordHash', 1, v_issue_id)
    on conflict (student_id) do update
      set password_hash = excluded.password_hash, issue_id = excluded.issue_id, version = app.student_credentials.version + 1;
    -- What was open stops reading: the registered sessions and the sessions of Auth of his account (refresh tokens go by cascade).
    delete from app.student_sessions where student_id = v_student.id;
    delete from auth.sessions where user_id = v_student.user_id;
  end loop;

  perform app.audit_disclosure(v_institution_id, 'access_card.issued', 'access_card_issue', v_issue_id, v_ids);

  select i.code, i.name into v_code, v_name from app.institutions i where i.id = v_institution_id;
  select coalesce(jsonb_agg(jsonb_build_object('studentId', s.id, 'displayName', s.display_name, 'username', s.username)
                            order by s.display_name, s.id), '[]'::jsonb)
    into v_items from app.students s where s.institution_id = v_institution_id and s.id = any (v_ids);
  return jsonb_build_object('institutionCode', v_code, 'institutionName', v_name, 'items', v_items);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- internal_get_student_accounts
-- ---------------------------------------------------------------------------------------------
-- A row of a sandbox (not_applicable) is not an account and is not listed.
create or replace function api.internal_get_student_accounts(p_student_ids uuid[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_items jsonb;
begin
  perform app.rpc_begin();
  if p_student_ids is null or coalesce(cardinality(p_student_ids), 0) not between 1 and 60
     or exists (select 1 from unnest(p_student_ids) as u(id) where u.id is null) then
    raise exception 'internal_get_student_accounts: between 1 and 60 student ids are required' using errcode = 'P0004';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('studentId', ap.student_id, 'provisioningId', ap.id, 'status', ap.status,
                                               'authUserId', ap.auth_user_id) order by ap.student_id), '[]'::jsonb)
    into v_items
    from app.account_provisioning ap
   where ap.student_id = any (p_student_ids) and ap.status <> 'not_applicable';
  return jsonb_build_object('items', v_items);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- internal_remember_student_account
-- ---------------------------------------------------------------------------------------------
-- Order (F2C-70, F2C-71): the student, his row FOR UPDATE, the advisory lock of the id, and only then the check that an
-- incompatible account of Auth is not there: one that shows up in the middle gives {ok: false}, not P0004.
create or replace function api.internal_remember_student_account(p_provisioning_id uuid, p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_student_id uuid;
  v_row app.account_provisioning;
begin
  perform app.rpc_begin();
  if p_provisioning_id is null or p_auth_user_id is null then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  select ap.student_id into v_student_id from app.account_provisioning ap where ap.id = p_provisioning_id;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  -- A row whose student is gone is the mark of an erasure: nothing is remembered in it.
  if v_student_id is null then
    return jsonb_build_object('ok', false);
  end if;
  perform 1 from app.students s where s.id = v_student_id for update;
  select * into v_row from app.account_provisioning ap where ap.id = p_provisioning_id for update;
  if not found or v_row.status in ('deleted', 'not_applicable') then
    return jsonb_build_object('ok', false);
  end if;
  -- The one that was kept wins, whatever this call proposes.
  if v_row.auth_user_id is not null then
    return jsonb_build_object('ok', true, 'authUserId', v_row.auth_user_id);
  end if;

  perform app.student_auth_lock(p_auth_user_id);
  if exists (select 1 from auth.users u
              where u.id = p_auth_user_id
                and (lower(coalesce(u.email, '')) is distinct from u.id::text || '@estudiantes.usetiza.app'
                     or coalesce(u.encrypted_password, '') <> ''))
     or exists (select 1 from app.account_provisioning ap where ap.auth_user_id = p_auth_user_id) then
    return jsonb_build_object('ok', false);
  end if;
  begin
    update app.account_provisioning set auth_user_id = p_auth_user_id, revision = revision + 1 where id = p_provisioning_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false);
  end;
  return jsonb_build_object('ok', true, 'authUserId', p_auth_user_id);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- internal_fail_student_account
-- ---------------------------------------------------------------------------------------------
-- Only pending -> failed and failed -> failed: a late process never undoes the success of another (active) nor an erasure.
create or replace function api.internal_fail_student_account(p_provisioning_id uuid, p_error_code text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_student_id uuid;
  v_row app.account_provisioning;
begin
  perform app.rpc_begin();
  if p_provisioning_id is null then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if p_error_code is null or p_error_code !~ '^[a-z][a-z0-9_]{1,62}$' then
    perform app.raise_error('INVALID', 'invalid_error_code');
  end if;
  select ap.student_id into v_student_id from app.account_provisioning ap where ap.id = p_provisioning_id;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if v_student_id is not null then
    perform 1 from app.students s where s.id = v_student_id for update;
  end if;
  select * into v_row from app.account_provisioning ap where ap.id = p_provisioning_id for update;
  if not found or v_row.status = 'not_applicable' then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if v_row.status in ('pending', 'failed') then
    update app.account_provisioning
       set status = 'failed', attempts = attempts + 1, error_code = p_error_code, revision = revision + 1
     where id = p_provisioning_id
    returning * into v_row;
  end if;
  return jsonb_build_object('status', v_row.status, 'attempts', v_row.attempts);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- internal_list_unfinished_accounts
-- ---------------------------------------------------------------------------------------------
-- What reconcile has to pick up, without archived students and never a deleted row: a provisioning that started (the id is
-- remembered) and did not finish, with fewer than 5 attempts; and an active account that is no longer in auth.users (somebody
-- deleted it by hand, F2C-72), so the same id can be created again.
create or replace function api.internal_list_unfinished_accounts(p_limit integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_items jsonb;
begin
  perform app.rpc_begin();
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'internal_list_unfinished_accounts: p_limit is between 1 and 200' using errcode = 'P0004';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('studentId', t.student_id, 'provisioningId', t.id, 'status', t.status,
                                               'authUserId', t.auth_user_id) order by t.updated_at, t.id), '[]'::jsonb)
    into v_items
    from (
      select ap.id, ap.student_id, ap.status, ap.auth_user_id, ap.updated_at
        from app.account_provisioning ap
        join app.students s on s.id = ap.student_id
       where s.archived_at is null and ap.auth_user_id is not null
         and ((ap.status in ('pending', 'failed') and ap.attempts < 5)
              or (ap.status = 'active' and not exists (select 1 from auth.users u where u.id = ap.auth_user_id)))
       order by ap.updated_at, ap.id
       limit p_limit
    ) as t;
  return jsonb_build_object('items', v_items);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- internal_find_institution
-- ---------------------------------------------------------------------------------------------
create or replace function api.internal_find_institution(p_code text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_row app.institutions;
begin
  perform app.rpc_begin();
  select * into v_row from app.institutions i where i.kind = 'school' and i.code = lower(btrim(p_code));
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  return jsonb_build_object('code', v_row.code, 'name', v_row.name);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- internal_get_student_login
-- ---------------------------------------------------------------------------------------------
-- The only RPC that returns a password hash, and only to service_role. The three last fields come together or not at all: the
-- student exists, is not archived, his account is active and he has a credential. The code of a school is not a secret, so
-- «institutionFound» says it.
create or replace function api.internal_get_student_login(p_code text, p_username text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_auth_user_id uuid;
  v_hash text;
  v_version integer;
begin
  perform app.rpc_begin();
  select i.id into v_institution_id from app.institutions i where i.kind = 'school' and i.code = lower(btrim(p_code));
  if v_institution_id is null then
    return jsonb_build_object('institutionFound', false, 'authUserId', null, 'passwordHash', null, 'version', null);
  end if;
  select ap.auth_user_id, c.password_hash, c.version into v_auth_user_id, v_hash, v_version
    from app.students s
    join app.account_provisioning ap on ap.student_id = s.id and ap.status = 'active'
    join app.student_credentials c on c.student_id = s.id
   where s.institution_id = v_institution_id and s.username = lower(btrim(p_username)) and s.archived_at is null
     and s.user_id is not null and ap.auth_user_id = s.user_id;
  if not found then
    return jsonb_build_object('institutionFound', true, 'authUserId', null, 'passwordHash', null, 'version', null);
  end if;
  return jsonb_build_object('institutionFound', true, 'authUserId', v_auth_user_id, 'passwordHash', v_hash, 'version', v_version);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- internal_bind_student_session
-- ---------------------------------------------------------------------------------------------
-- The last step before the cookies (F2C-56, F2C-75): under the same lock as issue_access_cards, the version that was checked is
-- still the current one -> the session is registered; otherwise it is deleted from auth.sessions and nothing is registered.
create or replace function api.internal_bind_student_session(p_auth_user_id uuid, p_session_id uuid, p_version integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_student_id uuid;
  v_institution_id uuid;
  v_archived_at timestamptz;
  v_current integer;
begin
  perform app.rpc_begin();
  if p_auth_user_id is null or p_session_id is null then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  select s.id into v_student_id from app.students s where s.user_id = p_auth_user_id;
  if v_student_id is not null then
    select s.institution_id, s.archived_at into v_institution_id, v_archived_at from app.students s where s.id = v_student_id for update;
    if not found then
      v_student_id := null;
    end if;
  end if;
  if v_student_id is not null then
    select c.version into v_current from app.student_credentials c where c.student_id = v_student_id;
  end if;
  -- Not a student, archived, or another version (a card was issued between the check of the password and now): the session goes.
  if v_student_id is null or v_archived_at is not null or v_current is distinct from p_version then
    delete from auth.sessions where id = p_session_id and user_id = p_auth_user_id;
    return jsonb_build_object('ok', false);
  end if;
  if not exists (select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_auth_user_id) then
    return jsonb_build_object('ok', false);
  end if;
  begin
    insert into app.student_sessions (session_id, institution_id, student_id, version)
    values (p_session_id, v_institution_id, v_student_id, p_version)
    on conflict (session_id) do nothing;
  exception when foreign_key_violation then
    -- The session was deleted (a sign out) between the check and the insert.
    return jsonb_build_object('ok', false);
  end;
  return jsonb_build_object('ok', exists (select 1 from app.student_sessions ss
                                           where ss.session_id = p_session_id and ss.student_id = v_student_id and ss.version = p_version));
end
$$;

-- ---------------------------------------------------------------------------------------------
-- internal_resolve_access_card
-- ---------------------------------------------------------------------------------------------
-- What the page of a card needs to complete the form: the school and the username. A revoked card, an archived student, an
-- account that is not active and a sandbox all answer the same NOT_FOUND. Never the name of the student.
create or replace function api.internal_resolve_access_card(p_token_hash bytea)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_code text;
  v_name text;
  v_username text;
begin
  perform app.rpc_begin();
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  select i.code, i.name, s.username into v_code, v_name, v_username
    from app.access_cards c
    join app.students s on s.institution_id = c.institution_id and s.id = c.student_id
    join app.institutions i on i.id = c.institution_id
    join app.account_provisioning ap on ap.student_id = s.id and ap.status = 'active'
   where c.token_hash = p_token_hash and c.status = 'active' and s.archived_at is null and i.kind = 'school';
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  return jsonb_build_object('institutionCode', v_code, 'institutionName', v_name, 'username', v_username);
end
$$;

grant execute on function api.list_taken_usernames(uuid, text[]) to authenticated;
grant execute on function api.list_group_accounts(uuid) to authenticated;
grant execute on function api.issue_access_cards(uuid, jsonb, uuid) to authenticated;
grant execute on function api.internal_get_student_accounts(uuid[]) to service_role;
grant execute on function api.internal_remember_student_account(uuid, uuid) to service_role;
grant execute on function api.internal_fail_student_account(uuid, text) to service_role;
grant execute on function api.internal_list_unfinished_accounts(integer) to service_role;
grant execute on function api.internal_find_institution(text) to service_role;
grant execute on function api.internal_get_student_login(text, text) to service_role;
grant execute on function api.internal_bind_student_session(uuid, uuid, integer) to service_role;
grant execute on function api.internal_resolve_access_card(bytea) to service_role;
