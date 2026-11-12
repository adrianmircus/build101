-- Contract, phase 1: RPC signatures for identity, groups, students and their sensitive data.
--
-- Stubs. Each one answers UNAVAILABLE/not_implemented until its ticket replaces the body with
-- CREATE OR REPLACE in a new migration, keeping the exact signature (changing it is a contract
-- change: BLOQUEADO). No GRANT here: the implementing ticket grants EXECUTE to authenticated for
-- user RPCs and to service_role for internal_* ones (nothing in api has a default grant), and to
-- nobody else.
--
-- Conventions (docs/contratos/fase-1.md): typed p_ parameters, jsonb output built key by key in
-- camelCase (never to_jsonb(row)), the actor from auth.uid(), errors with app.raise_error.

-- T1.2a · internal (service_role): the admin command, provisioning and test factories use these.
create function api.internal_create_institution(p_name text, p_code text, p_kind text, p_expires_at timestamptz default null, p_owner_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_upsert_app_user(p_user_id uuid, p_display_name text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_add_membership(p_institution_id uuid, p_user_id uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.internal_revoke_membership(p_membership_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- T1.2a · institutions of the actor, for the institution selector: [{ id, name, kind, roles }].
create function api.list_my_institutions()
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- T1.2a · groups. The institution is a selector validated against the actor's memberships.
create function api.create_group(p_institution_id uuid, p_name text, p_subject_id text, p_school_year integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.update_group(p_group_id uuid, p_revision integer, p_name text, p_school_year integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.archive_group(p_group_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.restore_group(p_group_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.add_group_staff(p_group_id uuid, p_user_id uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.remove_group_staff(p_group_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- T1.2b · internal (service_role): ties a student row to its Auth account. Phase 2 (T2.5) runs it
-- from account_provisioning; the factories use it to log in as a student.
create function api.internal_link_student_user(p_student_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- T1.2b · students. create_student also enrolls in the group, creates the pseudonym and, outside
-- a sandbox, the pending account_provisioning row (op_key makes a double click create one).
create function api.create_student(p_group_id uuid, p_display_name text, p_username text, p_op_key uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.update_student(p_student_id uuid, p_revision integer, p_display_name text, p_username text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.archive_student(p_student_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.restore_student(p_student_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.enroll_student(p_group_id uuid, p_student_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.unenroll_student(p_group_id uuid, p_student_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- T1.2b · projections without sensitive fields, paginated.
create function api.list_my_groups(p_institution_id uuid, p_include_archived boolean default false, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.get_group(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.list_group_students(p_group_id uuid, p_include_archived boolean default false, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- T1.3a · needs (health data). Writes keep student_need_events; reads are audited per disclosure.
create function api.set_student_needs(
  p_student_id uuid, p_profiles text[], p_supports text[], p_interests text[], p_op_id uuid,
  p_revision integer default null, p_review_due_on date default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.get_student_needs(p_student_ids uuid[])
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.get_group_needs(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.list_student_need_events(p_student_id uuid, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- T1.3b · private notes (sensitive, audited reads).
create function api.list_student_notes(p_student_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.create_student_note(p_student_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.update_student_note(p_note_id uuid, p_revision integer, p_body text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.archive_student_note(p_note_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- T1.3b · consents (sensitive, audited reads). Their effects on generations come in phase 9.
create function api.list_student_consents(p_student_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.record_consent(p_student_id uuid, p_purpose text, p_text_version text, p_valid_until timestamptz default null, p_file_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.revoke_consent(p_consent_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;
