-- T1.2b-fix: review fixes (docs/revisiones/fase-1-t1-2b-codex.md, W2-1 to W2-4 and W2-6).
-- 20261112110000 is already merged and is not edited: everything here replaces its functions.
--
-- Contract change, additive (docs/contratos/fase-1.md, "Decisiones que cambian el spec"):
--   * account_provisioning.op_identity: sha256 of the original (group, username) of the creation.
--     The identity of a create_student op_key can no longer drift with later edits of the student.
--   * account_provisioning.status accepts 'not_applicable': a sandbox keeps the row (so the op_key is
--     remembered) but no real account is ever provisioned for it.

alter table app.account_provisioning add column op_identity text
  check (op_identity is null or op_identity ~ '^[0-9a-f]{64}$');

alter table app.account_provisioning drop constraint account_provisioning_status_check;
alter table app.account_provisioning add constraint account_provisioning_status_check
  check (status in ('pending', 'active', 'failed', 'deleted', 'not_applicable'));

-- Rows made before this fix: the best identity left is the current one (the first group the
-- student was enrolled in). Only test data exists at this point; a row without identity is refused
-- as CONFLICT op_key_reused by create_student, never answered by guesswork.
update app.account_provisioning ap
   set op_identity = encode(sha256(convert_to(
         (select e.group_id::text from app.enrollments e where e.student_id = ap.student_id order by e.started_at, e.id limit 1)
         || ':' || (select s.username from app.students s where s.id = ap.student_id), 'utf8')), 'hex')
 where ap.student_id is not null
   and exists (select 1 from app.enrollments e where e.student_id = ap.student_id);

-- ---------------------------------------------------------------------------------------------
-- W2-4 (and the dead code T1.2a-fix left): internal_link_student_user.
-- students.user_id is unique across the whole database, so the lock that serializes two links of
-- the same account is by account alone (not by institution). Order: account lock, identity lock
-- (taken by the triggers), then rows. The unique index stays as the last resort and is translated.
-- The student/staff conflict is raised by the T1.2a triggers as CONFLICT role_conflict.
-- ---------------------------------------------------------------------------------------------

create or replace function api.internal_link_student_user(p_student_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_user_id uuid;
  v_status text;
begin
  perform app.rpc_begin();
  if p_student_id is null or p_user_id is null then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tiza.student_account:' || p_user_id::text, 0));
  select s.institution_id, s.user_id into v_institution_id, v_user_id
    from app.students s where s.id = p_student_id for update;
  if not found or not exists (select 1 from app.app_users u where u.id = p_user_id) then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  if v_user_id is not null and v_user_id <> p_user_id then
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;
  if v_user_id is null and exists (select 1 from app.students s where s.user_id = p_user_id) then
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;
  -- A deleted account stays deleted: reconcile_accounts must never bring it back.
  select ap.status into v_status from app.account_provisioning ap where ap.student_id = p_student_id for update;
  if v_status = 'deleted' then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;

  if v_user_id is null then
    begin
      -- No revision bump: linking an account is not an edit anyone could be racing against.
      update app.students set user_id = p_user_id where id = p_student_id;
    exception when unique_violation then
      -- Defensive: the account lock makes this unreachable, but the unique index decides if it ever is.
      perform app.raise_error('CONFLICT', 'op_key_reused');
    end;
  end if;
  insert into app.memberships (institution_id, user_id, role)
  values (v_institution_id, p_user_id, 'student')
  on conflict (institution_id, user_id, role) where revoked_at is null do nothing;

  -- A sandbox row stays not_applicable: no real account is provisioned there.
  if v_status in ('pending', 'failed') then
    update app.account_provisioning
       set status = 'active', auth_user_id = p_user_id, error_code = null, revision = revision + 1
     where student_id = p_student_id;
  end if;
  return jsonb_build_object('id', p_student_id);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- W2-1, W2-2, W2-6: create_student.
-- The op_key is looked up under the (institution, op_key) advisory lock and answered only if its
-- stored identity (group and username of the creation, hashed) is the one of this call. The answer
-- is the original one: the student created, the provisioning row (null in a sandbox) and revision
-- 1, whatever happened to the student since. A sandbox stores the row too, as 'not_applicable'.
-- ---------------------------------------------------------------------------------------------

create or replace function api.create_student(p_group_id uuid, p_display_name text, p_username text, p_op_key uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_name text := btrim(p_display_name);
  v_username text := lower(btrim(p_username));
  v_identity text;
  v_archived_at timestamptz;
  v_sandbox boolean;
  v_prov app.account_provisioning;
  v_student app.students;
  v_provisioning_id uuid;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.group_gate(p_group_id, 'manage');
  v_sandbox := app.institution_kind(v_institution_id) = 'sandbox';
  if v_name is null or char_length(v_name) not between 1 and 120 then
    perform app.raise_error('INVALID', 'invalid_name');
  end if;
  if v_username is null or v_username !~ '^[a-z0-9][a-z0-9._-]{1,39}$' then
    perform app.raise_error('INVALID', 'invalid_username');
  end if;
  if p_op_key is null then
    perform app.raise_error('INVALID', 'invalid_op_key');
  end if;
  v_identity := encode(sha256(convert_to(p_group_id::text || ':' || v_username, 'utf8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended('tiza.create_student:' || v_institution_id::text || ':' || p_op_key::text, 0));
  select g.archived_at into v_archived_at from app.groups g where g.id = p_group_id for share;

  select * into v_prov from app.account_provisioning ap
   where ap.institution_id = v_institution_id and ap.op_key = p_op_key;
  if found then
    if v_prov.op_identity is not distinct from v_identity and v_prov.student_id is not null then
      return jsonb_build_object('id', v_prov.student_id, 'revision', 1,
        'provisioningId', case when v_prov.status = 'not_applicable' then null else v_prov.id end);
    end if;
    perform app.raise_error('CONFLICT', 'op_key_reused');
  end if;

  if v_archived_at is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;
  insert into app.students (institution_id, display_name, username)
  values (v_institution_id, v_name, v_username)
  on conflict (institution_id, username) do nothing
  returning * into v_student;
  if v_student.id is null then
    perform app.raise_error('CONFLICT', 'username_taken');
  end if;
  insert into app.enrollments (institution_id, group_id, student_id) values (v_institution_id, p_group_id, v_student.id);
  insert into app.student_pseudonyms (institution_id, student_id) values (v_institution_id, v_student.id);
  insert into app.account_provisioning (institution_id, student_id, op_key, op_identity, status)
  values (v_institution_id, v_student.id, p_op_key, v_identity, case when v_sandbox then 'not_applicable' else 'pending' end)
  returning id into v_provisioning_id;
  return jsonb_build_object('id', v_student.id, 'revision', v_student.revision,
    'provisioningId', case when v_sandbox then null else v_provisioning_id end);
end
$$;

-- W2-6: a null name or username is INVALID, not a silent no-op.
create or replace function api.update_student(p_student_id uuid, p_revision integer, p_display_name text, p_username text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := btrim(p_display_name);
  v_username text := lower(btrim(p_username));
  v_student app.students;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  perform app.student_gate(p_student_id);
  if v_name is null or char_length(v_name) not between 1 and 120 then
    perform app.raise_error('INVALID', 'invalid_name');
  end if;
  if v_username is null or v_username !~ '^[a-z0-9][a-z0-9._-]{1,39}$' then
    perform app.raise_error('INVALID', 'invalid_username');
  end if;
  select * into v_student from app.students s where s.id = p_student_id for update;
  perform app.assert_revision(p_revision, v_student.revision);
  if v_student.archived_at is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;
  if v_student.display_name <> v_name or v_student.username <> v_username then
    begin
      update app.students set display_name = v_name, username = v_username, revision = revision + 1
       where id = p_student_id returning revision into v_student.revision;
    exception when unique_violation then
      perform app.raise_error('CONFLICT', 'username_taken');
    end;
  end if;
  return jsonb_build_object('id', p_student_id, 'revision', v_student.revision);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- W2-3: enroll and unenroll of the same (group, student) pair share one advisory lock, taken
-- before anything is read. Order: pair lock, group row (share), student row (share) or enrollment.
-- ---------------------------------------------------------------------------------------------

create or replace function api.enroll_student(p_group_id uuid, p_student_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_group_archived_at timestamptz;
  v_student_archived_at timestamptz;
  v_id uuid;
begin
  perform app.rpc_begin();
  perform app.require_actor();
  v_institution_id := app.group_gate(p_group_id, 'manage');
  perform pg_advisory_xact_lock(hashtextextended('tiza.enrollment:' || p_group_id::text || ':' || coalesce(p_student_id::text, ''), 0));
  select g.archived_at into v_group_archived_at from app.groups g where g.id = p_group_id for share;
  select s.archived_at into v_student_archived_at
    from app.students s where s.id = p_student_id and s.institution_id = v_institution_id for share;
  if not found then
    perform app.raise_error('NOT_FOUND', 'not_found');
  end if;
  select e.id into v_id from app.enrollments e
   where e.group_id = p_group_id and e.student_id = p_student_id and e.ended_at is null;
  if v_id is not null then
    return jsonb_build_object('id', v_id);
  end if;
  if v_group_archived_at is not null or v_student_archived_at is not null then
    perform app.raise_error('INVALID', 'archived');
  end if;
  insert into app.enrollments (institution_id, group_id, student_id)
  values (v_institution_id, p_group_id, p_student_id)
  on conflict (group_id, student_id) where ended_at is null do nothing
  returning id into v_id;
  if v_id is null then
    -- Under the pair lock nobody can end the enrollment between the conflict and this read.
    select e.id into v_id from app.enrollments e
     where e.group_id = p_group_id and e.student_id = p_student_id and e.ended_at is null;
    if v_id is null then
      raise exception 'enroll_student: no active enrollment after the conflict' using errcode = 'P0004';
    end if;
  end if;
  return jsonb_build_object('id', v_id);
end
$$;

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
    update app.enrollments set ended_at = now(), revision = revision + 1 where id = v_id;
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

grant execute on function api.internal_link_student_user(uuid, uuid) to service_role;
grant execute on function api.create_student(uuid, text, text, uuid) to authenticated;
grant execute on function api.update_student(uuid, integer, text, text) to authenticated;
grant execute on function api.enroll_student(uuid, uuid) to authenticated;
grant execute on function api.unenroll_student(uuid, uuid) to authenticated;
