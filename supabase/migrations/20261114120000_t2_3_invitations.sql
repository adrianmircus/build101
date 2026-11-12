-- T2.3 (docs/contratos/fase-2.md, «Invitaciones e institución», «Alta por invitación», «Correos de invitación»):
-- the invitation RPCs and the reads of the panel of the institution, replacing the stubs of 20261114100000_f2_contract.sql
-- with CREATE OR REPLACE and the same signatures, plus the EXECUTE grants («Nombres»: authenticated for the user RPCs,
-- service_role for internal_*).
--
-- Locks, always in this order: the advisory lock of the invitation pair (institution, email) first, then the row of the
-- invitation FOR UPDATE, then the identity lock of (institution, user) that internal_add_membership also takes. The op_key
-- lock of create_invitation comes before all of them and is the only one taken before the pair.

-- ---------------------------------------------------------------------------------------------
-- Helpers (app): nobody but the owner executes them; the RPCs below are SECURITY DEFINER.
-- ---------------------------------------------------------------------------------------------

-- An email as it is stored and compared: no spaces at the edges, lower case. The synthetic domain of the students never
-- gets an invitation (docs/contratos/fase-2.md, «Correo sintético»).
create function app.invitation_email(p_email text) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email, E' \t\r\n'));
begin
  if v_email is null or char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+$'
     or v_email ~ '@estudiantes[.]usetiza[.]app$' then
    perform app.raise_error('INVALID', 'invalid_email');
  end if;
  return v_email;
end
$$;

-- The pair (institution, email) is what the single pending invitation per email and role, the acceptance and the revocation
-- fight over: one advisory lock for all of them.
create function app.invitation_lock(p_institution_id uuid, p_email text) returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('tiza.invitation:' || p_institution_id::text || ':' || p_email, 0));
$$;

-- What the invitation is right now: a pending one past its expires_at reads as expired.
create function app.invitation_status(p_status text, p_expires_at timestamptz) returns text
language sql
stable
set search_path = ''
as $$
  select case when p_status = 'pending' and p_expires_at <= now() then 'expired' else p_status end
$$;

-- A pending invitation past its expiry still holds the unique index of pending ones: it becomes expired before a new
-- pending one is born for the same email and role.
create function app.expire_stale_invitations(p_institution_id uuid, p_email text, p_role text, p_except uuid) returns void
language sql
set search_path = ''
as $$
  update app.invitations i set status = 'expired'
   where i.institution_id = p_institution_id and i.email = p_email and i.role = p_role
     and i.status = 'pending' and i.expires_at <= now() and i.id is distinct from p_except;
$$;

-- Who got access to what, and when, with no student in it: an audit row with an empty set of students. The request id is
-- the one of the header the repos send, as in app.audit_disclosure.
create function app.audit_event(p_institution_id uuid, p_action text, p_entity text, p_entity_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  begin
    v_request_id := (nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-request-id')::uuid;
  exception when others then
    v_request_id := null;
  end;
  insert into app.audit_log (institution_id, actor_user_id, action, entity, entity_id, request_id)
  values (p_institution_id, app.session_user_id(), p_action, p_entity, p_entity_id, v_request_id);
end
$$;

-- The admin of an institution: NOT_FOUND for who cannot see it (another institution), FORBIDDEN for a member who is not an
-- admin. With p_real, a sandbox is closed too: inviting is a real effect.
create function app.require_institution_admin(p_institution_id uuid, p_real boolean) returns void
language plpgsql
set search_path = ''
as $$
begin
  if not app.is_member(p_institution_id, array['admin', 'teacher', 'inclusion', 'student']) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if not app.is_member(p_institution_id, array['admin']) then
    perform app.raise_error('FORBIDDEN', 'forbidden');
  end if;
  if p_real and app.institution_kind(p_institution_id) = 'sandbox' then
    perform app.raise_error('FORBIDDEN', 'sandbox_restricted');
  end if;
end
$$;

-- The checks the three ways to create or rotate an invitation share. A hash that an invitation ever had is not valid
-- (the registry of hashes would reject it with P0004 anyway: this is the answer for a caller who sent a repeated one).
create function app.invitation_input(p_role text, p_token_hash bytea) returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_role is null or p_role not in ('admin', 'teacher', 'inclusion') then
    perform app.raise_error('INVALID', 'invalid_role');
  end if;
  if p_token_hash is null or octet_length(p_token_hash) <> 32
     or exists (select 1 from app.invitation_tokens t where t.token_hash = p_token_hash) then
    perform app.raise_error('INVALID', 'invalid_token');
  end if;
end
$$;

-- «Ya es miembro» and «ya hay una pendiente», in that order. Under the pair lock.
create function app.invitation_blockers(p_institution_id uuid, p_email text, p_role text, p_except uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from app.memberships m join auth.users u on u.id = m.user_id
              where m.institution_id = p_institution_id and m.role = p_role and m.revoked_at is null
                and lower(u.email) = p_email) then
    perform app.raise_error('INVALID', 'already_member');
  end if;
  perform app.expire_stale_invitations(p_institution_id, p_email, p_role, p_except);
  if exists (select 1 from app.invitations i
              where i.institution_id = p_institution_id and i.email = p_email and i.role = p_role
                and i.status = 'pending' and i.id is distinct from p_except) then
    perform app.raise_error('CONFLICT', 'invitation_pending');
  end if;
end
$$;

-- Inserts a new pending invitation; a unique violation that gets past the locks is translated, never raw (a repeated hash
-- is invalid_token, a second pending one is invitation_pending).
create function app.invitation_insert(p_institution_id uuid, p_email text, p_role text, p_token_hash bytea, p_invited_by uuid,
                                      p_op_key uuid, p_op_identity text) returns app.invitations
language plpgsql
set search_path = ''
as $$
declare
  v_row app.invitations;
  v_constraint text;
begin
  insert into app.invitations (institution_id, email, role, token_hash, expires_at, invited_by, op_key, op_identity)
  values (p_institution_id, p_email, p_role, p_token_hash, now() + interval '7 days', p_invited_by, p_op_key, p_op_identity)
  returning * into v_row;
  return v_row;
exception when unique_violation then
  get stacked diagnostics v_constraint = constraint_name;
  if v_constraint = 'invitations_pending_key' then
    perform app.raise_error('CONFLICT', 'invitation_pending');
  end if;
  perform app.raise_error('INVALID', 'invalid_token');
  return null;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- create_invitation
-- ---------------------------------------------------------------------------------------------
create or replace function api.create_invitation(p_institution_id uuid, p_email text, p_role text, p_token_hash bytea, p_op_key uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_email text;
  v_identity text;
  v_existing app.invitations;
  v_row app.invitations;
begin
  perform app.rpc_begin();
  v_actor := app.require_actor();
  perform app.require_institution_admin(p_institution_id, true);
  if p_op_key is null then
    perform app.raise_error('INVALID', 'invalid_op_key');
  end if;
  v_email := app.invitation_email(p_email);
  if p_role is null or p_role not in ('admin', 'teacher', 'inclusion') then
    perform app.raise_error('INVALID', 'invalid_role');
  end if;
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    perform app.raise_error('INVALID', 'invalid_token');
  end if;
  -- The identity of the operation: this RPC, the institution, the email and the role, as they were when it was created.
  v_identity := encode(sha256(convert_to(jsonb_build_array('create_invitation', p_institution_id, v_email, p_role)::text, 'utf8')), 'hex');

  -- One lock per (institution, op_key) before anything is read: two copies of the request serialize here.
  perform pg_advisory_xact_lock(hashtextextended('tiza.create_invitation:' || p_institution_id::text || ':' || p_op_key::text, 0));
  select * into v_existing from app.invitations i where i.institution_id = p_institution_id and i.op_key = p_op_key;
  if found then
    if v_existing.op_identity = v_identity then
      -- The same one, with the hash it has now (the one that this request sent is not used).
      return jsonb_build_object('id', v_existing.id, 'expiresAt', v_existing.expires_at, 'sentAt', v_existing.sent_at,
                                'revision', v_existing.revision, 'replayed', true);
    end if;
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;

  -- A new one: the state it depends on, under the lock of its pair.
  perform app.invitation_lock(p_institution_id, v_email);
  perform app.invitation_input(p_role, p_token_hash);
  perform app.invitation_blockers(p_institution_id, v_email, p_role, null);
  v_row := app.invitation_insert(p_institution_id, v_email, p_role, p_token_hash, v_actor, p_op_key, v_identity);
  perform app.audit_event(p_institution_id, 'invitation.created', 'invitation', v_row.id);
  return jsonb_build_object('id', v_row.id, 'expiresAt', v_row.expires_at, 'sentAt', v_row.sent_at,
                            'revision', v_row.revision, 'replayed', false);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- resend_invitation: a pending or expired one gets a new hash, 7 more days, revision + 1 and no sent_at
-- ---------------------------------------------------------------------------------------------
create or replace function api.resend_invitation(p_invitation_id uuid, p_revision integer, p_token_hash bytea)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_email text;
  v_row app.invitations;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  -- Authorize with a read that locks nothing: nobody locks what they cannot see.
  select i.institution_id, i.email into v_institution_id, v_email from app.invitations i where i.id = p_invitation_id;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform app.require_institution_admin(v_institution_id, true);

  perform app.invitation_lock(v_institution_id, v_email);
  select * into v_row from app.invitations i where i.id = p_invitation_id for update;
  if v_row.status in ('accepted', 'revoked') then
    perform app.raise_error('INVALID', 'invitation_closed');
  end if;
  perform app.assert_revision(p_revision, v_row.revision);
  perform app.invitation_input(v_row.role, p_token_hash);
  perform app.expire_stale_invitations(v_institution_id, v_row.email, v_row.role, v_row.id);
  if exists (select 1 from app.invitations i where i.institution_id = v_institution_id and i.email = v_row.email
                and i.role = v_row.role and i.status = 'pending' and i.id <> v_row.id) then
    perform app.raise_error('CONFLICT', 'invitation_pending');
  end if;
  update app.invitations
     set status = 'pending', token_hash = p_token_hash, expires_at = now() + interval '7 days',
         revision = revision + 1, sent_at = null
   where id = p_invitation_id
  returning * into v_row;
  perform app.audit_event(v_institution_id, 'invitation.resent', 'invitation', v_row.id);
  return jsonb_build_object('id', v_row.id, 'expiresAt', v_row.expires_at, 'revision', v_row.revision);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- revoke_invitation: only a pending or expired one
-- ---------------------------------------------------------------------------------------------
create or replace function api.revoke_invitation(p_invitation_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_email text;
  v_row app.invitations;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select i.institution_id, i.email into v_institution_id, v_email from app.invitations i where i.id = p_invitation_id;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform app.require_institution_admin(v_institution_id, true);

  perform app.invitation_lock(v_institution_id, v_email);
  select * into v_row from app.invitations i where i.id = p_invitation_id for update;
  if v_row.status in ('accepted', 'revoked') then
    perform app.raise_error('INVALID', 'invitation_closed');
  end if;
  perform app.assert_revision(p_revision, v_row.revision);
  update app.invitations set status = 'revoked', revision = revision + 1 where id = p_invitation_id;
  perform app.audit_event(v_institution_id, 'invitation.revoked', 'invitation', p_invitation_id);
  return jsonb_build_object('id', p_invitation_id);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- mark_invitation_sent: the email of the token of that revision went out. Another revision: the token rotated meanwhile.
-- ---------------------------------------------------------------------------------------------
create or replace function api.mark_invitation_sent(p_invitation_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_row app.invitations;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  select i.institution_id into v_institution_id from app.invitations i where i.id = p_invitation_id;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform app.require_institution_admin(v_institution_id, false);

  select * into v_row from app.invitations i where i.id = p_invitation_id for update;
  perform app.assert_revision(p_revision, v_row.revision);
  if v_row.status <> 'pending' then
    perform app.raise_error('INVALID', 'invitation_closed');
  end if;
  update app.invitations set sent_at = coalesce(sent_at, now()) where id = p_invitation_id;
  return jsonb_build_object('id', p_invitation_id);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Reads of the panel: admin of the institution
-- ---------------------------------------------------------------------------------------------
create or replace function api.list_invitations(p_institution_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform app.rpc_begin();
  perform app.require_actor();
  perform app.require_institution_admin(p_institution_id, false);
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'email', t.email, 'role', t.role, 'status', app.invitation_status(t.status, t.expires_at),
             'expiresAt', t.expires_at, 'sentAt', t.sent_at, 'invitedByName', t.inviter_name,
             'createdAt', t.created_at, 'revision', t.revision)
           order by t.created_at desc, t.id)
      from (select i.*, u.display_name as inviter_name
              from app.invitations i left join app.app_users u on u.id = i.invited_by
             where i.institution_id = p_institution_id
             order by i.created_at desc, i.id limit 500) t), '[]'::jsonb));
end
$$;

create or replace function api.list_institution_staff(p_institution_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform app.rpc_begin();
  perform app.require_actor();
  perform app.require_institution_admin(p_institution_id, false);
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'userId', s.user_id, 'displayName', s.display_name, 'email', s.email, 'roles', s.roles,
             'hasSignedIn', s.signed_in)
           order by s.display_name nulls last, s.email, s.user_id)
      from (select m.user_id, p.display_name, a.email, to_jsonb(array_agg(m.role order by m.role)) as roles,
                   a.last_sign_in_at is not null as signed_in
              from app.memberships m
              join auth.users a on a.id = m.user_id
              left join app.app_users p on p.id = m.user_id
             where m.institution_id = p_institution_id and m.revoked_at is null
               and m.role in ('admin', 'teacher', 'inclusion') and a.email is not null
             group by m.user_id, p.display_name, a.email, a.last_sign_in_at) s), '[]'::jsonb));
end
$$;

create or replace function api.get_institution_summary(p_institution_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform app.rpc_begin();
  perform app.require_actor();
  perform app.require_institution_admin(p_institution_id, false);
  return (select jsonb_build_object(
      'id', i.id, 'name', i.name, 'code', i.code,
      'staffCount', (select count(distinct m.user_id) from app.memberships m
                      where m.institution_id = i.id and m.revoked_at is null and m.role in ('admin', 'teacher', 'inclusion')),
      'pendingInvitations', (select count(*) from app.invitations v
                              where v.institution_id = i.id and v.status = 'pending' and v.expires_at > now()),
      'groupCount', (select count(*) from app.groups g where g.institution_id = i.id and g.archived_at is null),
      'studentCount', (select count(*) from app.students s where s.institution_id = i.id and s.archived_at is null))
    from app.institutions i where i.id = p_institution_id);
end
$$;

-- The subjects that can be chosen for a new group. Whoever can create a group asks (an admin or a teacher of any
-- institution); the Spanish name of each comes from the catalog in the code.
create or replace function api.list_enabled_subjects()
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform app.rpc_begin();
  perform app.require_actor();
  if not exists (select 1 from app.actor_institutions(array['admin', 'teacher'])) then
    perform app.raise_error('FORBIDDEN', 'forbidden');
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id) order by s.id) from app.subjects s where s.enabled), '[]'::jsonb));
end
$$;

-- ---------------------------------------------------------------------------------------------
-- internal_get_invitation: the page of an invitation, opened by somebody with no session
-- ---------------------------------------------------------------------------------------------
create or replace function api.internal_get_invitation(p_token_hash bytea)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform app.rpc_begin();
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    perform app.raise_error('INVALID', 'invalid_token');
  end if;
  select jsonb_build_object(
           'id', i.id, 'institutionName', n.name, 'role', i.role, 'email', i.email, 'inviterName', u.display_name,
           'status', app.invitation_status(i.status, i.expires_at), 'expiresAt', i.expires_at,
           'hasAccount', exists (select 1 from auth.users a where lower(a.email) = i.email))
    into v_result
    from app.invitations i
    join app.institutions n on n.id = i.institution_id
    left join app.app_users u on u.id = i.invited_by
   where i.token_hash = p_token_hash;
  if v_result is null then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- internal_create_invitation: only for the administration command; no actor, so invited_by stays NULL
-- ---------------------------------------------------------------------------------------------
create or replace function api.internal_create_invitation(p_institution_id uuid, p_email text, p_role text, p_token_hash bytea)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_email text;
  v_row app.invitations;
begin
  perform app.rpc_begin();
  if not exists (select 1 from app.institutions n where n.id = p_institution_id) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if app.institution_kind(p_institution_id) = 'sandbox' then
    perform app.raise_error('FORBIDDEN', 'sandbox_restricted');
  end if;
  v_email := app.invitation_email(p_email);
  perform app.invitation_lock(p_institution_id, v_email);
  perform app.invitation_input(p_role, p_token_hash);
  perform app.invitation_blockers(p_institution_id, v_email, p_role, null);
  v_row := app.invitation_insert(p_institution_id, v_email, p_role, p_token_hash, null, null, null);
  perform app.audit_event(p_institution_id, 'invitation.created', 'invitation', v_row.id);
  return jsonb_build_object('id', v_row.id, 'expiresAt', v_row.expires_at, 'revision', v_row.revision);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- The acceptance. Both ways end in the same step: the app_user (if missing), the membership and the invitation accepted,
-- under the lock of the pair and of the invitation row.
-- ---------------------------------------------------------------------------------------------

-- Adds the membership and closes the invitation as accepted by p_user_id. The caller already holds the locks and checked that
-- the invitation is pending and valid and that the account has the invited email.
create function app.invitation_accept(p_invitation app.invitations, p_user_id uuid, p_display_name text) returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into app.app_users (id, display_name) values (p_user_id, p_display_name)
  on conflict (id) do update set display_name = excluded.display_name
   where app.app_users.display_name is null and excluded.display_name is not null;
  perform app.identity_lock(p_invitation.institution_id, p_user_id);
  insert into app.memberships (institution_id, user_id, role)
  values (p_invitation.institution_id, p_user_id, p_invitation.role)
  on conflict (institution_id, user_id, role) where revoked_at is null do nothing;
  update app.invitations set status = 'accepted', accepted_by = p_user_id, accepted_at = now() where id = p_invitation.id;
  perform app.audit_event(p_invitation.institution_id, 'invitation.accepted', 'invitation', p_invitation.id);
end
$$;

-- A name that the table would accept, or null.
create function app.display_name_or_null(p_name text) returns text
language sql
immutable
set search_path = ''
as $$
  select case when char_length(btrim(p_name)) between 1 and 120 then btrim(p_name) end
$$;

-- Somebody who has an account and a session. The email is read now from auth.users (not from the JWT, which keeps the old
-- one after a change of email) and has to be confirmed.
create or replace function api.accept_invitation(p_token_hash bytea)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := app.session_user_id();
  v_found app.invitations;
  v_row app.invitations;
  v_email text;
  v_confirmed boolean;
  v_name text;
begin
  perform app.rpc_begin();
  if v_user is null then
    perform app.raise_error('FORBIDDEN', 'no_session');
  end if;
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    perform app.raise_error('INVALID', 'invalid_token');
  end if;
  select * into v_found from app.invitations i where i.token_hash = p_token_hash;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  perform app.invitation_lock(v_found.institution_id, v_found.email);
  -- By the hash again: it may have been rotated while this waited.
  select * into v_row from app.invitations i where i.id = v_found.id and i.token_hash = p_token_hash for update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  select lower(a.email), a.email_confirmed_at is not null, a.raw_user_meta_data ->> 'display_name'
    into v_email, v_confirmed, v_name
    from auth.users a where a.id = v_user;
  if not found then
    perform app.raise_error('FORBIDDEN', 'no_session');
  end if;
  -- Accepted by this same user (a repeated click, a second tab): the same answer.
  if v_row.status = 'accepted' and v_row.accepted_by = v_user then
    return jsonb_build_object('institutionId', v_row.institution_id, 'role', v_row.role);
  end if;
  if v_confirmed is not true or v_email is distinct from v_row.email then
    perform app.raise_error('FORBIDDEN', 'invitation_email_mismatch');
  end if;
  if v_row.status in ('accepted', 'revoked') then
    perform app.raise_error('INVALID', 'invitation_closed');
  end if;
  if app.invitation_status(v_row.status, v_row.expires_at) = 'expired' then
    perform app.raise_error('INVALID', 'invitation_expired');
  end if;
  perform app.invitation_accept(v_row, v_user, app.display_name_or_null(v_name));
  return jsonb_build_object('institutionId', v_row.institution_id, 'role', v_row.role);
end
$$;

-- The step of the signup of somebody with no account (the account was just created by the server with the admin client):
-- one transaction, with the lock of the invitation. The account has to exist with this email, confirmed and with this
-- invitation_id in its app_metadata. An invitation that was revoked, rotated or expired in between leaves the account with no
-- membership at all.
create or replace function api.internal_finish_invitation_signup(p_token_hash bytea, p_user_id uuid, p_display_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_found app.invitations;
  v_row app.invitations;
  v_name text := app.display_name_or_null(p_display_name);
  v_email text;
  v_confirmed boolean;
  v_invitation text;
begin
  perform app.rpc_begin();
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    perform app.raise_error('INVALID', 'invalid_token');
  end if;
  if v_name is null then
    perform app.raise_error('INVALID', 'invalid_name');
  end if;
  select * into v_found from app.invitations i where i.token_hash = p_token_hash;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  perform app.invitation_lock(v_found.institution_id, v_found.email);
  select * into v_row from app.invitations i where i.id = v_found.id and i.token_hash = p_token_hash for update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if v_row.status in ('accepted', 'revoked') then
    perform app.raise_error('INVALID', 'invitation_closed');
  end if;
  if app.invitation_status(v_row.status, v_row.expires_at) = 'expired' then
    perform app.raise_error('INVALID', 'invitation_expired');
  end if;
  select lower(a.email), a.email_confirmed_at is not null, a.raw_app_meta_data ->> 'invitation_id'
    into v_email, v_confirmed, v_invitation
    from auth.users a where a.id = p_user_id;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if v_email is distinct from v_row.email then
    perform app.raise_error('FORBIDDEN', 'invitation_email_mismatch');
  end if;
  if v_confirmed is not true or v_invitation is distinct from v_row.id::text then
    perform app.raise_error('FORBIDDEN', 'forbidden');
  end if;
  perform app.invitation_accept(v_row, p_user_id, v_name);
  return jsonb_build_object('institutionId', v_row.institution_id, 'role', v_row.role);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants («Nombres»): in api nothing has a default grant.
-- ---------------------------------------------------------------------------------------------
grant execute on function api.create_invitation(uuid, text, text, bytea, uuid) to authenticated;
grant execute on function api.resend_invitation(uuid, integer, bytea) to authenticated;
grant execute on function api.revoke_invitation(uuid, integer) to authenticated;
grant execute on function api.mark_invitation_sent(uuid, integer) to authenticated;
grant execute on function api.list_invitations(uuid) to authenticated;
grant execute on function api.list_institution_staff(uuid) to authenticated;
grant execute on function api.get_institution_summary(uuid) to authenticated;
grant execute on function api.list_enabled_subjects() to authenticated;
grant execute on function api.accept_invitation(bytea) to authenticated;
grant execute on function api.internal_get_invitation(bytea) to service_role;
grant execute on function api.internal_create_invitation(uuid, text, text, bytea) to service_role;
grant execute on function api.internal_finish_invitation_signup(bytea, uuid, text) to service_role;
