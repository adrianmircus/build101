-- T2.3: the invitation RPCs and the reads of the panel of the institution (docs/contratos/fase-2.md, «Invitaciones e
-- institución»), with the common rules of phase 1: the happy path, every role that is denied, another institution, a stale
-- revision, a repeated op_key and the audit rows. The accounts of the staff are plain accounts (any email, with a password
-- in Auth in real life; here a row of auth.users). Placeholder data only. The whole file is rolled back.
begin;
-- Links ordinary accounts to students like phase 1; the shape guard of phase 2 (T2.5a) is off here. 040_f2_contract covers it.
alter table app.account_provisioning disable trigger student_auth_link_guard;
select plan(207);

-- Calls an RPC the way PostgREST would: claims for p_user (null = no session) and p_role switched with SET LOCAL ROLE.
create function pg_temp.rpc(p_user uuid, p_role text, p_sql text) returns jsonb
language plpgsql as $f$
declare
  v_res jsonb; v_state text; v_message text; v_detail text;
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else jsonb_build_object('sub', p_user, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  execute p_sql into v_res;
  reset role;
  return v_res;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  reset role;
  return jsonb_build_object('error', v_state || ' ' || v_message || ' ' || coalesce(v_detail, ''));
end
$f$;
-- The error as «CODE reason» for an expected one, or the SQLSTATE; null when there was none.
create function pg_temp.err(p_res jsonb) returns text language sql as $$
  select case when p_res ? 'error'
              then case when p_res ->> 'error' like 'P0001 %' then btrim(substr(p_res ->> 'error', 7)) else left(p_res ->> 'error', 5) end end
$$;
-- The SQLSTATE of a statement run as postgres, or 'ok'.
create function pg_temp.st(p_sql text) returns text
language plpgsql as $f$
declare
  v_state text;
begin
  execute p_sql;
  return 'ok';
exception
  when assert_failure then return 'P0004';
  when others then
    get stacked diagnostics v_state = returned_sqlstate;
    return v_state;
end
$f$;

create temp table ids (k text primary key, id uuid not null);
create function pg_temp.id(p_key text) returns uuid language sql as $$ select id from ids where k = p_key $$;
create function pg_temp.u(p_user text, p_sql text) returns jsonb language sql
  as $$ select pg_temp.rpc(pg_temp.id(p_user), 'authenticated', p_sql) $$;
create function pg_temp.s(p_sql text) returns jsonb language sql as $$ select pg_temp.rpc(null, 'service_role', p_sql) $$;
create function pg_temp.a(p_sql text) returns jsonb language sql as $$ select pg_temp.rpc(null, 'anon', p_sql) $$;
create function pg_temp.keys(p_obj jsonb) returns text language sql
  as $$ select string_agg(k, ',' order by k) from jsonb_object_keys(p_obj) k $$;
-- A 32-byte hash made of a seed: the same seed, the same hash.
create function pg_temp.h(p_seed text) returns bytea language sql as $$ select sha256(convert_to('t2-3:' || p_seed, 'utf8')) $$;
-- The row of an invitation as a text to compare: status, revision and whether the email went out.
create function pg_temp.row_of(p_key text) returns text language sql as $$
  select i.status || ':' || i.revision || ':' || (i.sent_at is not null)::text from app.invitations i where i.id = pg_temp.id(p_key) $$;

create function pg_temp.create_inv(p_user text, p_inst text, p_email text, p_role text, p_seed text, p_op text default null) returns jsonb
language sql as $$
  select pg_temp.u(p_user, format('select api.create_invitation(%L, %L, %L, %L, %L)', pg_temp.id(p_inst), p_email, p_role, pg_temp.h(p_seed),
                                  coalesce(pg_temp.id(p_op), gen_random_uuid()))) $$;
-- Makes an invitation as the admin of A and remembers its id under p_key.
create function pg_temp.mk(p_key text, p_email text, p_role text, p_seed text) returns void language plpgsql as $$
begin
  insert into ids (k, id) values (p_key, (pg_temp.create_inv('adm', 'a', p_email, p_role, p_seed) ->> 'id')::uuid);
end $$;
create function pg_temp.resend(p_user text, p_key text, p_rev integer, p_seed text) returns jsonb language sql as $$
  select pg_temp.u(p_user, format('select api.resend_invitation(%L, %s, %L)', pg_temp.id(p_key), p_rev, pg_temp.h(p_seed))) $$;
create function pg_temp.revoke_inv(p_user text, p_key text, p_rev integer) returns jsonb language sql as $$
  select pg_temp.u(p_user, format('select api.revoke_invitation(%L, %s)', pg_temp.id(p_key), p_rev)) $$;
create function pg_temp.mark(p_user text, p_key text, p_rev integer) returns jsonb language sql as $$
  select pg_temp.u(p_user, format('select api.mark_invitation_sent(%L, %s)', pg_temp.id(p_key), p_rev)) $$;
create function pg_temp.accept(p_user text, p_seed text) returns jsonb language sql as $$
  select pg_temp.u(p_user, format('select api.accept_invitation(%L)', pg_temp.h(p_seed))) $$;
create function pg_temp.finish(p_seed text, p_user text, p_name text default 'Docente Nueva') returns jsonb language sql as $$
  select pg_temp.s(format('select api.internal_finish_invitation_signup(%L, %L, %L)', pg_temp.h(p_seed), pg_temp.id(p_user), p_name)) $$;
create function pg_temp.audits(p_action text) returns bigint language sql as $$
  select count(*) from app.audit_log a where a.institution_id = pg_temp.id('a') and a.action = p_action and cardinality(a.student_ids) = 0 $$;

-- People. Auth rows first (the real ones are made by Auth: here confirmed, with a plain email), app_users through the RPC.
insert into ids (k, id) select k, gen_random_uuid() from unnest(array[
  'adm', 'adm2', 'teach', 'incl', 'stud', 'vis', 'guest', 'guest2', 'guest3', 'guest4', 'guest5', 'guest6', 'newbie', 'late', 'ghost', 'unconfirmed'
]) as k;
insert into auth.users (id, email, email_confirmed_at) select id, k || '@t2-3.invalid', now() from ids where k <> 'ghost';
update auth.users set email_confirmed_at = null where id = pg_temp.id('unconfirmed');
update auth.users set last_sign_in_at = now() where id = pg_temp.id('adm');
update auth.users set raw_user_meta_data = '{"display_name": "Invitada Uno"}' where id = pg_temp.id('guest');
select pg_temp.s(format('select api.internal_upsert_app_user(%L, %L)', pg_temp.id(k), 'Persona ' || k))
  from (values ('adm'), ('adm2'), ('teach'), ('incl'), ('stud'), ('vis')) as p(k);

-- Institution A (school), B (another school) and a sandbox.
insert into ids (k, id) select 'a', (pg_temp.s($$ select api.internal_create_institution('Liceo A', 't2-3-a', 'school') $$) ->> 'id')::uuid;
insert into ids (k, id) select 'b', (pg_temp.s($$ select api.internal_create_institution('Liceo B', 't2-3-b', 'school') $$) ->> 'id')::uuid;
insert into ids (k, id) select 'sb', (pg_temp.s(format('select api.internal_create_institution(%L, %L, ''sandbox'', now() + interval ''1 day'', %L)',
  'Demo', 't2-3-sb', pg_temp.id('vis'))) ->> 'id')::uuid;
select pg_temp.s(format('select api.internal_add_membership(%L, %L, %L)', pg_temp.id(m.inst), pg_temp.id(m.who), m.role))
  from (values ('a', 'adm', 'admin'), ('a', 'teach', 'teacher'), ('a', 'incl', 'inclusion'), ('b', 'adm2', 'admin'), ('sb', 'vis', 'teacher')) as m(inst, who, role);
insert into ids (k, id) select 'g', (pg_temp.u('teach', format('select api.create_group(%L, ''3.º A'', ''math'', 2026, gen_random_uuid())', pg_temp.id('a'))) ->> 'id')::uuid;
insert into ids (k, id) select 's1', (pg_temp.u('teach', format('select api.create_student(%L, ''Estudiante 1'', ''est.1'', gen_random_uuid())', pg_temp.id('g'))) ->> 'id')::uuid;
select pg_temp.s(format('select api.internal_link_student_user(%L, %L)', pg_temp.id('s1'), pg_temp.id('stud')));

-- ---------------------------------------------------------------------------------------------
-- create_invitation: the happy path
-- ---------------------------------------------------------------------------------------------
insert into ids (k, id) values ('op1', gen_random_uuid());
insert into ids (k, id) select 'i1', (pg_temp.create_inv('adm', 'a', '  Profe.Uno@Colegio.EDU ', 'teacher', 'i1', 'op1') ->> 'id')::uuid;
select is(pg_temp.keys(pg_temp.create_inv('adm', 'a', 'dos@colegio.edu', 'teacher', 'i2')), 'expiresAt,id,replayed,revision,sentAt',
  'create_invitation answers exactly id, expiresAt, sentAt, revision and replayed');
select is((select i.email || ':' || i.role || ':' || i.status || ':' || i.revision || ':' || (i.sent_at is null)::text || ':' || (i.invited_by = pg_temp.id('adm'))::text
             || ':' || (i.op_key = pg_temp.id('op1'))::text || ':' || (i.token_hash = pg_temp.h('i1'))::text
             from app.invitations i where i.id = pg_temp.id('i1')),
  'profe.uno@colegio.edu:teacher:pending:1:true:true:true:true',
  'the invitation is stored with the email trimmed and in lower case, pending, revision 1, not sent, by the admin, with its op_key and hash');
select ok((select i.expires_at > now() + interval '6 days 23 hours' and i.expires_at <= now() + interval '7 days' from app.invitations i where i.id = pg_temp.id('i1')),
  'it expires in 7 days');
select is((select (pg_temp.create_inv('adm', 'a', 'tres@colegio.edu', 'admin', 'i3') ->> 'replayed')), 'false', 'a new one is not a replay');
select is(pg_temp.audits('invitation.created'), 3::bigint, 'each creation wrote an audit row with no student in it');
select is((select a.actor_user_id = pg_temp.id('adm') and a.entity = 'invitation' and a.entity_id = pg_temp.id('i1')
             from app.audit_log a where a.entity_id = pg_temp.id('i1') and a.action = 'invitation.created'),
  true, 'and the row says who did it and which invitation');
select is((select count(*) from app.invitation_tokens t where t.token_hash = pg_temp.h('i1') and t.invitation_id = pg_temp.id('i1')), 1::bigint,
  'the hash is in the registry of hashes');

-- Another role for the same email is another invitation.
select is(pg_temp.err(pg_temp.create_inv('adm', 'a', 'profe.uno@colegio.edu', 'inclusion', 'i4')), null, 'the same email with another role is allowed');

-- ---------------------------------------------------------------------------------------------
-- create_invitation: who is refused
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from app.invitations where institution_id = pg_temp.id('a')), 4::bigint, 'four invitations so far');
select is(pg_temp.err(pg_temp.create_inv('teach', 'a', 'x1@colegio.edu', 'teacher', 'x1')), 'FORBIDDEN forbidden', 'a teacher is FORBIDDEN');
select is(pg_temp.err(pg_temp.create_inv('incl', 'a', 'x2@colegio.edu', 'teacher', 'x2')), 'FORBIDDEN forbidden', 'inclusion is FORBIDDEN');
select is(pg_temp.err(pg_temp.create_inv('stud', 'a', 'x3@colegio.edu', 'teacher', 'x3')), 'FORBIDDEN forbidden', 'a student is FORBIDDEN');
select is(pg_temp.err(pg_temp.create_inv('adm2', 'a', 'x4@colegio.edu', 'teacher', 'x4')), 'NOT_FOUND not_found', 'the admin of another institution is NOT_FOUND');
select is(pg_temp.err(pg_temp.create_inv('ghost', 'a', 'x5@colegio.edu', 'teacher', 'x5')), 'FORBIDDEN no_session', 'an account with no app_user has no session for this');
select is(pg_temp.err(pg_temp.create_inv('vis', 'sb', 'x6@colegio.edu', 'teacher', 'x6')), 'FORBIDDEN forbidden', 'the visitor of a sandbox is not an admin: FORBIDDEN');
select is(pg_temp.err(pg_temp.a(format('select api.create_invitation(%L, ''x7@colegio.edu'', ''teacher'', %L, gen_random_uuid())', pg_temp.id('a'), pg_temp.h('x7')))),
  '42501', 'with no session at all (anon) the API refuses before the RPC');
select is(pg_temp.err(pg_temp.s(format('select api.create_invitation(%L, ''x8@colegio.edu'', ''teacher'', %L, gen_random_uuid())', pg_temp.id('a'), pg_temp.h('x8')))),
  '42501', 'service_role does not execute it either');
select is((select count(*) from app.invitations where institution_id = pg_temp.id('a')), 4::bigint, 'and none of the refusals created anything');
-- A sandbox is closed to inviting even for an admin: written as the owner, because a sandbox cannot have one.
insert into app.memberships (institution_id, user_id, role) values (pg_temp.id('sb'), pg_temp.id('adm'), 'admin');
select is(pg_temp.err(pg_temp.create_inv('adm', 'sb', 'x9@colegio.edu', 'teacher', 'x9')), 'FORBIDDEN sandbox_restricted', 'an admin inside a sandbox cannot invite: it is a real effect');
delete from app.memberships where institution_id = pg_temp.id('sb') and user_id = pg_temp.id('adm');

-- ---------------------------------------------------------------------------------------------
-- create_invitation: the idempotence
-- ---------------------------------------------------------------------------------------------
select is((select (r ->> 'replayed') || ':' || (r ->> 'id')
             from (select pg_temp.create_inv('adm', 'a', 'PROFE.UNO@colegio.edu ', 'teacher', 'otro-hash', 'op1') as r) q),
  'true:' || pg_temp.id('i1'), 'the same op_key with the same email and role is the same invitation, replayed');
select is((select i.token_hash = pg_temp.h('i1') from app.invitations i where i.id = pg_temp.id('i1')), true, 'and the replay does not touch the hash');
select is((select count(*) from app.invitation_tokens t where t.token_hash = pg_temp.h('otro-hash')), 0::bigint, 'nor registers the hash it sent');
select is(pg_temp.err(pg_temp.create_inv('adm', 'a', 'otro@colegio.edu', 'teacher', 'z1', 'op1')), 'CONFLICT op_key_reused', 'the same op_key for another email is op_key_reused');
select is(pg_temp.err(pg_temp.create_inv('adm', 'a', 'profe.uno@colegio.edu', 'admin', 'z2', 'op1')), 'CONFLICT op_key_reused', 'and for another role');
select is((select count(*) from app.invitations where institution_id = pg_temp.id('a')), 4::bigint, 'nothing was created twice');
-- The identity is the one of the creation: it still answers after the invitation changed.
select pg_temp.resend('adm', 'i1', 1, 'i1b');
select is((select (r ->> 'revision') || ':' || (r ->> 'replayed') from (select pg_temp.create_inv('adm', 'a', 'profe.uno@colegio.edu', 'teacher', 'i1c', 'op1') as r) q),
  '2:true', 'a replay after the token was rotated answers the current revision');
select is((select r ->> 'sentAt' is null from (select pg_temp.create_inv('adm', 'a', 'profe.uno@colegio.edu', 'teacher', 'i1d', 'op1') as r) q), true,
  'and says that the email of that token did not go out (the service sends it again)');

-- ---------------------------------------------------------------------------------------------
-- create_invitation: the rules of what can be invited
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err(pg_temp.create_inv('adm', 'a', ' PROFE.uno@colegio.edu', 'teacher', 'p1')), 'CONFLICT invitation_pending',
  'a pending one for the same email (any case) and role is CONFLICT invitation_pending');
select is(pg_temp.err(pg_temp.create_inv('adm', 'a', 'teach@t2-3.invalid', 'teacher', 'm1')), 'INVALID already_member', 'an active member with that role is INVALID already_member');
select is(pg_temp.err(pg_temp.create_inv('adm', 'a', 'teach@t2-3.invalid', 'inclusion', 'm2')), null, 'a member with another role can be invited to it');
select is(pg_temp.err(pg_temp.create_inv('adm', 'a', 'sin-arroba', 'teacher', 'e1')), 'INVALID invalid_email', 'an email with no @ is invalid_email');
select is(pg_temp.err(pg_temp.create_inv('adm', 'a', 'a b@c.d', 'teacher', 'e2')), 'INVALID invalid_email', 'with a space inside too');
select is(pg_temp.err(pg_temp.create_inv('adm', 'a', 'x@' || repeat('d', 260) || '.edu', 'teacher', 'e3')), 'INVALID invalid_email', 'more than 254 characters too');
select is(pg_temp.err(pg_temp.create_inv('adm', 'a', 'a1b2@estudiantes.usetiza.app', 'teacher', 'e4')), 'INVALID invalid_email', 'the synthetic domain of the students never gets an invitation');
select is(pg_temp.err(pg_temp.create_inv('adm', 'a', 'A1B2@Estudiantes.UseTiza.App', 'teacher', 'e5')), 'INVALID invalid_email', 'whatever the case');
select is(pg_temp.err(pg_temp.u('adm', format('select api.create_invitation(%L, null, ''teacher'', %L, gen_random_uuid())', pg_temp.id('a'), pg_temp.h('e6')))),
  'INVALID invalid_email', 'a null email too');
select is(pg_temp.err(pg_temp.create_inv('adm', 'a', 'r1@colegio.edu', 'student', 'r1')), 'INVALID invalid_role', 'a student is not invited: invalid_role');
select is(pg_temp.err(pg_temp.u('adm', format('select api.create_invitation(%L, ''r2@colegio.edu'', null, %L, gen_random_uuid())', pg_temp.id('a'), pg_temp.h('r2')))),
  'INVALID invalid_role', 'a null role too');
select is(pg_temp.err(pg_temp.u('adm', format('select api.create_invitation(%L, ''t1@colegio.edu'', ''teacher'', %L, gen_random_uuid())', pg_temp.id('a'), '\x0102'::bytea))),
  'INVALID invalid_token', 'a hash that is not 32 bytes is invalid_token');
select is(pg_temp.err(pg_temp.u('adm', format('select api.create_invitation(%L, ''t2@colegio.edu'', ''teacher'', null, gen_random_uuid())', pg_temp.id('a')))),
  'INVALID invalid_token', 'a null hash too');
select is(pg_temp.err(pg_temp.create_inv('adm', 'a', 't3@colegio.edu', 'teacher', 'i1')), 'INVALID invalid_token', 'a hash that an invitation had once (rotated away) is not used again');
select is(pg_temp.err(pg_temp.create_inv('adm', 'a', 't4@colegio.edu', 'teacher', 'i1b')), 'INVALID invalid_token', 'nor one that an invitation has now');
select is(pg_temp.err(pg_temp.u('adm', format('select api.create_invitation(%L, ''o1@colegio.edu'', ''teacher'', %L, null)', pg_temp.id('a'), pg_temp.h('o1')))),
  'INVALID invalid_op_key', 'a null op_key is invalid_op_key');

-- A pending one past its expiry no longer blocks: it becomes expired and the new one is born.
select pg_temp.mk('i5', 'vieja@colegio.edu', 'teacher', 'i5');
update app.invitations set expires_at = now() - interval '1 hour' where id = pg_temp.id('i5');
insert into ids (k, id) select 'i6', (pg_temp.create_inv('adm', 'a', 'vieja@colegio.edu', 'teacher', 'i6') ->> 'id')::uuid;
select is(pg_temp.row_of('i5'), 'expired:1:false', 'the old pending one past its expiry became expired');
select is(pg_temp.row_of('i6'), 'pending:1:false', 'and the new one is pending');

-- ---------------------------------------------------------------------------------------------
-- mark_invitation_sent
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.keys(pg_temp.mark('adm', 'i6', 1)), 'id', 'mark_invitation_sent answers exactly the id');
select is(pg_temp.row_of('i6'), 'pending:1:true', 'and sent_at is set');
select is(pg_temp.err(pg_temp.mark('adm', 'i6', 1)), null, 'marking again with the same revision is allowed and changes nothing');
select is(pg_temp.err(pg_temp.mark('adm', 'i6', 7)), 'CONFLICT revision_mismatch', 'a revision that is not the current one is revision_mismatch');
select is(pg_temp.err(pg_temp.mark('teach', 'i6', 1)), 'FORBIDDEN forbidden', 'a teacher is FORBIDDEN');
select is(pg_temp.err(pg_temp.mark('incl', 'i6', 1)), 'FORBIDDEN forbidden', 'inclusion is FORBIDDEN');
select is(pg_temp.err(pg_temp.mark('stud', 'i6', 1)), 'FORBIDDEN forbidden', 'a student is FORBIDDEN');
select is(pg_temp.err(pg_temp.mark('adm2', 'i6', 1)), 'NOT_FOUND not_found', 'the admin of another institution is NOT_FOUND');
select is(pg_temp.err(pg_temp.mark('vis', 'i6', 1)), 'NOT_FOUND not_found', 'the visitor of a sandbox is NOT_FOUND');
select is(pg_temp.err(pg_temp.u('adm', format('select api.mark_invitation_sent(%L, 1)', gen_random_uuid()))), 'NOT_FOUND not_found', 'an invitation that does not exist is NOT_FOUND');
select is(pg_temp.err(pg_temp.a(format('select api.mark_invitation_sent(%L, 1)', pg_temp.id('i6')))), '42501', 'anon is refused by the API');
select is(pg_temp.err(pg_temp.mark('adm', 'i5', 1)), 'INVALID invitation_closed', 'an expired one is not marked');

-- ---------------------------------------------------------------------------------------------
-- resend_invitation
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('i7', 'reenviar@colegio.edu', 'teacher', 'i7');
select pg_temp.mark('adm', 'i7', 1);
select is(pg_temp.keys(pg_temp.resend('adm', 'i7', 1, 'i7b')), 'expiresAt,id,revision', 'resend_invitation answers exactly id, expiresAt and revision');
select is(pg_temp.row_of('i7'), 'pending:2:false', 'a new revision and no sent_at');
select is((select i.token_hash = pg_temp.h('i7b') from app.invitations i where i.id = pg_temp.id('i7')), true, 'with the new hash');
select is((select count(*) from app.invitation_tokens t where t.invitation_id = pg_temp.id('i7') and t.token_hash in (pg_temp.h('i7'), pg_temp.h('i7b'))), 2::bigint,
  'both hashes are in the registry');
select is(pg_temp.err(pg_temp.s(format('select api.internal_get_invitation(%L)', pg_temp.h('i7')))), 'NOT_FOUND not_found', 'the old link no longer opens');
select is(pg_temp.err(pg_temp.s(format('select api.internal_get_invitation(%L)', pg_temp.h('i7b')))), null, 'and the new one does');
select is(pg_temp.err(pg_temp.resend('adm', 'i7', 1, 'i7c')), 'CONFLICT revision_mismatch', 'a stale revision is revision_mismatch');
select is(pg_temp.err(pg_temp.mark('adm', 'i7', 1)), 'CONFLICT revision_mismatch', 'and a mark of the token that went out before is revision_mismatch too');
select is(pg_temp.err(pg_temp.resend('adm', 'i7', 2, 'i7b')), 'INVALID invalid_token', 'a hash that is in use is invalid_token');
select is(pg_temp.err(pg_temp.resend('adm', 'i7', 2, 'i7')), 'INVALID invalid_token', 'and one that was spent too');
select is(pg_temp.err(pg_temp.resend('teach', 'i7', 2, 'i7d')), 'FORBIDDEN forbidden', 'a teacher is FORBIDDEN');
select is(pg_temp.err(pg_temp.resend('incl', 'i7', 2, 'i7d')), 'FORBIDDEN forbidden', 'inclusion is FORBIDDEN');
select is(pg_temp.err(pg_temp.resend('stud', 'i7', 2, 'i7d')), 'FORBIDDEN forbidden', 'a student is FORBIDDEN');
select is(pg_temp.err(pg_temp.resend('adm2', 'i7', 2, 'i7d')), 'NOT_FOUND not_found', 'the admin of another institution is NOT_FOUND');
select is(pg_temp.err(pg_temp.resend('vis', 'i7', 2, 'i7d')), 'NOT_FOUND not_found', 'the visitor of a sandbox is NOT_FOUND');
select is(pg_temp.err(pg_temp.a(format('select api.resend_invitation(%L, 2, %L)', pg_temp.id('i7'), pg_temp.h('i7d')))), '42501', 'anon is refused by the API');
select is(pg_temp.row_of('i7'), 'pending:2:false', 'and nothing changed with all the refusals');
select is(pg_temp.audits('invitation.resent'), 2::bigint, 'one audit row for each of the two resends');
-- An expired one comes back to pending with a new hash, unless a newer pending one took its place.
select is(pg_temp.err(pg_temp.resend('adm', 'i5', 1, 'i5b')), 'CONFLICT invitation_pending', 'with invitation_pending');
select pg_temp.revoke_inv('adm', 'i6', 1);
select is(pg_temp.err(pg_temp.resend('adm', 'i5', 1, 'i5b')), null, 'once the newer one is revoked, the expired one comes back');
select is(pg_temp.row_of('i5'), 'pending:2:false', 'as pending, with a new revision');
select is(pg_temp.err(pg_temp.resend('adm', 'i6', 2, 'i6b')), 'INVALID invitation_closed', 'a revoked one is invitation_closed');

-- ---------------------------------------------------------------------------------------------
-- revoke_invitation
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('i8', 'revocar@colegio.edu', 'inclusion', 'i8');
select is(pg_temp.err(pg_temp.revoke_inv('adm', 'i8', 5)), 'CONFLICT revision_mismatch', 'a stale revision is revision_mismatch');
select is(pg_temp.err(pg_temp.revoke_inv('teach', 'i8', 1)), 'FORBIDDEN forbidden', 'a teacher is FORBIDDEN');
select is(pg_temp.err(pg_temp.revoke_inv('incl', 'i8', 1)), 'FORBIDDEN forbidden', 'inclusion is FORBIDDEN');
select is(pg_temp.err(pg_temp.revoke_inv('stud', 'i8', 1)), 'FORBIDDEN forbidden', 'a student is FORBIDDEN');
select is(pg_temp.err(pg_temp.revoke_inv('adm2', 'i8', 1)), 'NOT_FOUND not_found', 'the admin of another institution is NOT_FOUND');
select is(pg_temp.err(pg_temp.revoke_inv('vis', 'i8', 1)), 'NOT_FOUND not_found', 'the visitor of a sandbox is NOT_FOUND');
select is(pg_temp.err(pg_temp.a(format('select api.revoke_invitation(%L, 1)', pg_temp.id('i8')))), '42501', 'anon is refused by the API');
select is(pg_temp.row_of('i8'), 'pending:1:false', 'and nothing changed with all the refusals');
select is(pg_temp.keys(pg_temp.revoke_inv('adm', 'i8', 1)), 'id', 'revoke_invitation answers exactly the id');
select is(pg_temp.row_of('i8'), 'revoked:2:false', 'and the invitation is revoked');
select is(pg_temp.err(pg_temp.revoke_inv('adm', 'i8', 2)), 'INVALID invitation_closed', 'revoking it again is invitation_closed');
select is(pg_temp.audits('invitation.revoked'), 2::bigint, 'each revocation wrote an audit row');
select is(pg_temp.err(pg_temp.s(format('select api.internal_get_invitation(%L)', pg_temp.h('i8')))), null, 'the link of a revoked one still opens, and says it is revoked');
select is(pg_temp.s(format('select api.internal_get_invitation(%L)', pg_temp.h('i8'))) ->> 'status', 'revoked', 'with the status revoked');
select pg_temp.mk('i9', 'vencida@colegio.edu', 'teacher', 'i9');
update app.invitations set expires_at = now() - interval '1 hour' where id = pg_temp.id('i9');
select is(pg_temp.err(pg_temp.revoke_inv('adm', 'i9', 1)), null, 'an expired one can be revoked');

-- A revoked or accepted one is final, also for the owner of the table.
select is(pg_temp.st(format('update app.invitations set status = ''pending'' where id = %L', pg_temp.id('i8'))), 'P0004', 'a revoked invitation cannot go back to pending (guard)');
select is(pg_temp.st(format('delete from app.invitations where id = %L', pg_temp.id('i7'))), 'P0004', 'an invitation is not deleted while its institution exists: a spent hash does not come back');
select is(pg_temp.st(format('update app.invitations set token_hash = %L where id = %L', pg_temp.h('i7'), pg_temp.id('i7'))), 'P0004', 'and a hash that was spent is not set again');

-- ---------------------------------------------------------------------------------------------
-- list_invitations
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.keys(pg_temp.u('adm', format('select api.list_invitations(%L)', pg_temp.id('a')))), 'items', 'list_invitations answers items');
select is((select jsonb_array_length(r -> 'items') from (select pg_temp.u('adm', format('select api.list_invitations(%L)', pg_temp.id('a'))) as r) q),
  (select count(*)::int from app.invitations where institution_id = pg_temp.id('a')), 'all the invitations of the institution');
select is((select string_agg(k, ',' order by k) from (select distinct jsonb_object_keys(i) as k
            from jsonb_array_elements(pg_temp.u('adm', format('select api.list_invitations(%L)', pg_temp.id('a'))) -> 'items') i) q),
  'createdAt,email,expiresAt,id,invitedByName,revision,role,sentAt,status', 'each with the closed keys, and no hash');
select is((select i ->> 'status' from jsonb_array_elements(pg_temp.u('adm', format('select api.list_invitations(%L)', pg_temp.id('a'))) -> 'items') i
            where i ->> 'id' = pg_temp.id('i9')::text), 'revoked', 'the status of a revoked one');
select pg_temp.mk('i10', 'sola@colegio.edu', 'teacher', 'i10');
update app.invitations set expires_at = now() - interval '1 minute' where id = pg_temp.id('i10');
select is((select i ->> 'status' from jsonb_array_elements(pg_temp.u('adm', format('select api.list_invitations(%L)', pg_temp.id('a'))) -> 'items') i
            where i ->> 'id' = pg_temp.id('i10')::text), 'expired', 'a pending one past its expiry reads as expired, though it is stored pending');
select is((select i ->> 'invitedByName' from jsonb_array_elements(pg_temp.u('adm', format('select api.list_invitations(%L)', pg_temp.id('a'))) -> 'items') i
            where i ->> 'id' = pg_temp.id('i1')::text), 'Persona adm', 'invitedByName is the name of who invited');
select is(pg_temp.err(pg_temp.u('teach', format('select api.list_invitations(%L)', pg_temp.id('a')))), 'FORBIDDEN forbidden', 'a teacher is FORBIDDEN');
select is(pg_temp.err(pg_temp.u('incl', format('select api.list_invitations(%L)', pg_temp.id('a')))), 'FORBIDDEN forbidden', 'inclusion is FORBIDDEN');
select is(pg_temp.err(pg_temp.u('stud', format('select api.list_invitations(%L)', pg_temp.id('a')))), 'FORBIDDEN forbidden', 'a student is FORBIDDEN');
select is(pg_temp.err(pg_temp.u('adm2', format('select api.list_invitations(%L)', pg_temp.id('a')))), 'NOT_FOUND not_found', 'the admin of another institution is NOT_FOUND');
select is(pg_temp.err(pg_temp.u('vis', format('select api.list_invitations(%L)', pg_temp.id('a')))), 'NOT_FOUND not_found', 'the visitor of a sandbox is NOT_FOUND');
select is(pg_temp.err(pg_temp.a(format('select api.list_invitations(%L)', pg_temp.id('a')))), '42501', 'anon is refused by the API');
select is(jsonb_array_length(pg_temp.u('adm2', format('select api.list_invitations(%L)', pg_temp.id('b'))) -> 'items'), 0, 'another institution lists only its own: none');

-- ---------------------------------------------------------------------------------------------
-- list_institution_staff and get_institution_summary
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.keys(pg_temp.u('adm', format('select api.list_institution_staff(%L)', pg_temp.id('a')))), 'items', 'list_institution_staff answers items');
select is((select string_agg(distinct k, ',' order by k) from (select jsonb_object_keys(i) as k
            from jsonb_array_elements(pg_temp.u('adm', format('select api.list_institution_staff(%L)', pg_temp.id('a'))) -> 'items') i) q),
  'displayName,email,hasSignedIn,roles,userId', 'each member with the closed keys');
select is((select string_agg((i ->> 'email') || '=' || (i -> 'roles')::text || '=' || (i ->> 'hasSignedIn'), ' ' order by i ->> 'email')
             from jsonb_array_elements(pg_temp.u('adm', format('select api.list_institution_staff(%L)', pg_temp.id('a'))) -> 'items') i),
  'adm@t2-3.invalid=["admin"]=true incl@t2-3.invalid=["inclusion"]=false teach@t2-3.invalid=["teacher"]=false',
  'the staff with roles and whether they ever signed in; the student is not staff');
select pg_temp.s(format('select api.internal_add_membership(%L, %L, ''teacher'')', pg_temp.id('a'), pg_temp.id('adm')));
select is((select i -> 'roles' from jsonb_array_elements(pg_temp.u('adm', format('select api.list_institution_staff(%L)', pg_temp.id('a'))) -> 'items') i
            where i ->> 'email' = 'adm@t2-3.invalid'), '["admin", "teacher"]'::jsonb, 'a person with two roles is one row with both');
select is(pg_temp.err(pg_temp.u('teach', format('select api.list_institution_staff(%L)', pg_temp.id('a')))), 'FORBIDDEN forbidden', 'a teacher is FORBIDDEN');
select is(pg_temp.err(pg_temp.u('incl', format('select api.list_institution_staff(%L)', pg_temp.id('a')))), 'FORBIDDEN forbidden', 'inclusion is FORBIDDEN');
select is(pg_temp.err(pg_temp.u('stud', format('select api.list_institution_staff(%L)', pg_temp.id('a')))), 'FORBIDDEN forbidden', 'a student is FORBIDDEN');
select is(pg_temp.err(pg_temp.u('adm2', format('select api.list_institution_staff(%L)', pg_temp.id('a')))), 'NOT_FOUND not_found', 'the admin of another institution is NOT_FOUND');
select is(pg_temp.err(pg_temp.a(format('select api.list_institution_staff(%L)', pg_temp.id('a')))), '42501', 'anon is refused by the API');

select is(pg_temp.keys(pg_temp.u('adm', format('select api.get_institution_summary(%L)', pg_temp.id('a')))),
  'code,groupCount,id,name,pendingInvitations,staffCount,studentCount', 'get_institution_summary answers exactly its closed keys');
select is((select (r ->> 'staffCount') || ',' || (r ->> 'groupCount') || ',' || (r ->> 'studentCount') || ',' || (r ->> 'code') || ',' || (r ->> 'name')
             from (select pg_temp.u('adm', format('select api.get_institution_summary(%L)', pg_temp.id('a'))) as r) q),
  '3,1,1,t2-3-a,Liceo A', 'the people of the staff, the groups and the students');
select is((pg_temp.u('adm', format('select api.get_institution_summary(%L)', pg_temp.id('a'))) ->> 'pendingInvitations')::int,
  (select count(*)::int from app.invitations where institution_id = pg_temp.id('a') and status = 'pending' and expires_at > now()),
  'pendingInvitations counts the pending ones that did not expire');
select is(pg_temp.err(pg_temp.u('teach', format('select api.get_institution_summary(%L)', pg_temp.id('a')))), 'FORBIDDEN forbidden', 'a teacher is FORBIDDEN');
select is(pg_temp.err(pg_temp.u('incl', format('select api.get_institution_summary(%L)', pg_temp.id('a')))), 'FORBIDDEN forbidden', 'inclusion is FORBIDDEN');
select is(pg_temp.err(pg_temp.u('stud', format('select api.get_institution_summary(%L)', pg_temp.id('a')))), 'FORBIDDEN forbidden', 'a student is FORBIDDEN');
select is(pg_temp.err(pg_temp.u('adm2', format('select api.get_institution_summary(%L)', pg_temp.id('a')))), 'NOT_FOUND not_found', 'the admin of another institution is NOT_FOUND');
select is(pg_temp.err(pg_temp.u('vis', format('select api.get_institution_summary(%L)', pg_temp.id('a')))), 'NOT_FOUND not_found', 'the visitor of a sandbox is NOT_FOUND');
select is(pg_temp.err(pg_temp.a(format('select api.get_institution_summary(%L)', pg_temp.id('a')))), '42501', 'anon is refused by the API');

-- list_enabled_subjects: who can create a group.
select is(pg_temp.u('adm', 'select api.list_enabled_subjects()'), '{"items": [{"id": "math"}]}'::jsonb, 'an admin sees the enabled subjects');
select is(pg_temp.err(pg_temp.u('teach', 'select api.list_enabled_subjects()')), null, 'a teacher too');
select is(pg_temp.err(pg_temp.u('vis', 'select api.list_enabled_subjects()')), null, 'and the visitor of a sandbox');
select is(pg_temp.err(pg_temp.u('incl', 'select api.list_enabled_subjects()')), 'FORBIDDEN forbidden', 'inclusion does not create groups: FORBIDDEN');
select is(pg_temp.err(pg_temp.u('stud', 'select api.list_enabled_subjects()')), 'FORBIDDEN forbidden', 'a student is FORBIDDEN');
select is(pg_temp.err(pg_temp.a('select api.list_enabled_subjects()')), '42501', 'anon is refused by the API');

-- ---------------------------------------------------------------------------------------------
-- internal_get_invitation and internal_create_invitation
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('i11', 'guest@t2-3.invalid', 'teacher', 'i11');
select is(pg_temp.keys(pg_temp.s(format('select api.internal_get_invitation(%L)', pg_temp.h('i11')))),
  'email,expiresAt,hasAccount,id,institutionName,inviterName,role,status', 'internal_get_invitation answers its closed keys');
select is((select (r ->> 'email') || ':' || (r ->> 'role') || ':' || (r ->> 'institutionName') || ':' || (r ->> 'inviterName') || ':' || (r ->> 'status') || ':' || (r ->> 'hasAccount')
             from (select pg_temp.s(format('select api.internal_get_invitation(%L)', pg_temp.h('i11'))) as r) q),
  'guest@t2-3.invalid:teacher:Liceo A:Persona adm:pending:true', 'with the institution, the inviter and whether an account already has that email');
select is(pg_temp.s(format('select api.internal_get_invitation(%L)', pg_temp.h('i1b'))) ->> 'hasAccount', 'false', 'no account with the email: hasAccount false');
select is(pg_temp.s(format('select api.internal_get_invitation(%L)', pg_temp.h('i10'))) ->> 'status', 'expired', 'a pending one past its expiry says expired');
select is(pg_temp.err(pg_temp.s(format('select api.internal_get_invitation(%L)', pg_temp.h('no-existe')))), 'NOT_FOUND not_found', 'a hash with no invitation is NOT_FOUND');
select is(pg_temp.err(pg_temp.s(format('select api.internal_get_invitation(%L)', '\x01'::bytea))), 'INVALID invalid_token', 'a hash that is not 32 bytes is invalid_token');
select is(pg_temp.err(pg_temp.u('adm', format('select api.internal_get_invitation(%L)', pg_temp.h('i11')))), '42501', 'a user cannot execute it, not even an admin');
select is(pg_temp.err(pg_temp.a(format('select api.internal_get_invitation(%L)', pg_temp.h('i11')))), '42501', 'nor anon');

select is(pg_temp.keys(pg_temp.s(format('select api.internal_create_invitation(%L, ''operador@colegio.edu'', ''admin'', %L)', pg_temp.id('a'), pg_temp.h('op-1')))),
  'expiresAt,id,revision', 'internal_create_invitation answers exactly id, expiresAt and revision');
select is((select i.invited_by is null and i.status = 'pending' and i.op_key is null from app.invitations i where i.token_hash = pg_temp.h('op-1')), true,
  'with no actor: invited_by stays NULL');
select is(pg_temp.err(pg_temp.s(format('select api.internal_create_invitation(%L, ''operador@colegio.edu'', ''admin'', %L)', pg_temp.id('a'), pg_temp.h('op-2')))),
  'CONFLICT invitation_pending', 'a pending one for that email and role is invitation_pending');
select is(pg_temp.err(pg_temp.s(format('select api.internal_create_invitation(%L, ''adm@t2-3.invalid'', ''admin'', %L)', pg_temp.id('a'), pg_temp.h('op-3')))),
  'INVALID already_member', 'an active member is already_member');
select is(pg_temp.err(pg_temp.s(format('select api.internal_create_invitation(%L, ''x@estudiantes.usetiza.app'', ''admin'', %L)', pg_temp.id('a'), pg_temp.h('op-4')))),
  'INVALID invalid_email', 'the synthetic domain is invalid_email');
select is(pg_temp.err(pg_temp.s(format('select api.internal_create_invitation(%L, ''o@colegio.edu'', ''student'', %L)', pg_temp.id('a'), pg_temp.h('op-5')))),
  'INVALID invalid_role', 'a student role is invalid_role');
select is(pg_temp.err(pg_temp.s(format('select api.internal_create_invitation(%L, ''o@colegio.edu'', ''admin'', %L)', gen_random_uuid(), pg_temp.h('op-6')))),
  'NOT_FOUND not_found', 'an institution that does not exist is NOT_FOUND');
select is(pg_temp.err(pg_temp.s(format('select api.internal_create_invitation(%L, ''o@colegio.edu'', ''teacher'', %L)', pg_temp.id('sb'), pg_temp.h('op-7')))),
  'FORBIDDEN sandbox_restricted', 'a sandbox is closed to invitations');
select is(pg_temp.err(pg_temp.u('adm', format('select api.internal_create_invitation(%L, ''o@colegio.edu'', ''teacher'', %L)', pg_temp.id('a'), pg_temp.h('op-8')))),
  '42501', 'a user cannot execute it');
select is(pg_temp.audits('invitation.created') > 3, true, 'the one of the command also wrote its audit row');

-- ---------------------------------------------------------------------------------------------
-- accept_invitation: with a session
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.keys(pg_temp.accept('guest', 'i11')), 'institutionId,role', 'accept_invitation answers exactly institutionId and role');
select is((select i.status || ':' || (i.accepted_by = pg_temp.id('guest'))::text || ':' || (i.accepted_at is not null)::text from app.invitations i where i.id = pg_temp.id('i11')),
  'accepted:true:true', 'the invitation is accepted by that user');
select is((select count(*) from app.memberships m where m.institution_id = pg_temp.id('a') and m.user_id = pg_temp.id('guest') and m.role = 'teacher' and m.revoked_at is null),
  1::bigint, 'with one active membership');
select is((select u.display_name from app.app_users u where u.id = pg_temp.id('guest')), 'Invitada Uno',
  'the account had no app_user: it was created, with the name of the metadata of the account');
select is(pg_temp.audits('invitation.accepted'), 1::bigint, 'and the acceptance wrote its audit row');
select is(pg_temp.accept('guest', 'i11'), jsonb_build_object('institutionId', pg_temp.id('a'), 'role', 'teacher'), 'accepting again with the same account answers the same');
select is((select count(*) from app.memberships m where m.user_id = pg_temp.id('guest')), 1::bigint, 'and does not add another membership');
select is(pg_temp.err(pg_temp.accept('guest2', 'i11')), 'FORBIDDEN invitation_email_mismatch', 'another account is FORBIDDEN invitation_email_mismatch');
select is(pg_temp.err(pg_temp.accept('guest2', 'no-existe')), 'NOT_FOUND not_found', 'a hash with no invitation is NOT_FOUND');
select is(pg_temp.err(pg_temp.u('guest', format('select api.accept_invitation(%L)', '\x01'::bytea))), 'INVALID invalid_token', 'a hash that is not 32 bytes is invalid_token');
select is(pg_temp.err(pg_temp.u('ghost', format('select api.accept_invitation(%L)', pg_temp.h('i11')))), 'FORBIDDEN no_session', 'a user that no longer exists in Auth has no session');
select is(pg_temp.err(pg_temp.rpc(null, 'authenticated', format('select api.accept_invitation(%L)', pg_temp.h('i11')))), 'FORBIDDEN no_session', 'with no claims it is no_session');
select is(pg_temp.err(pg_temp.a(format('select api.accept_invitation(%L)', pg_temp.h('i11')))), '42501', 'anon is refused by the API');
select is(pg_temp.err(pg_temp.s(format('select api.accept_invitation(%L)', pg_temp.h('i11')))), '42501', 'and service_role does not execute it');

-- The email is read from auth.users now, not from the JWT: a change of email after the JWT was issued does not carry over.
select pg_temp.mk('i12', 'guest2@t2-3.invalid', 'inclusion', 'i12');
update auth.users set email = 'otro-correo@t2-3.invalid' where id = pg_temp.id('guest2');
select is(pg_temp.err(pg_temp.accept('guest2', 'i12')), 'FORBIDDEN invitation_email_mismatch', 'a user whose email changed after the invitation is FORBIDDEN, whatever the old JWT says');
select is((select count(*) from app.memberships m where m.user_id = pg_temp.id('guest2')), 0::bigint, 'and gets no membership');
select is((select count(*) from app.app_users u where u.id = pg_temp.id('guest2')), 0::bigint, 'nor an app_user: it is created only after the email was verified');
select pg_temp.mk('i13', 'unconfirmed@t2-3.invalid', 'teacher', 'i13');
select is(pg_temp.err(pg_temp.accept('unconfirmed', 'i13')), 'FORBIDDEN invitation_email_mismatch', 'an email that was never confirmed is FORBIDDEN too');
update auth.users set email = 'guest2@t2-3.invalid' where id = pg_temp.id('guest2');
select is(pg_temp.err(pg_temp.accept('guest2', 'i12')), null, 'with the right email it works (and creates the app_user)');
select is((select u.display_name is null from app.app_users u where u.id = pg_temp.id('guest2')), true, 'with no name when the account has none');

-- States.
select pg_temp.mk('i14', 'guest3@t2-3.invalid', 'teacher', 'i14');
select pg_temp.revoke_inv('adm', 'i14', 1);
select is(pg_temp.err(pg_temp.accept('guest3', 'i14')), 'INVALID invitation_closed', 'a revoked invitation is invitation_closed');
select pg_temp.mk('i15', 'guest4@t2-3.invalid', 'teacher', 'i15');
update app.invitations set expires_at = now() - interval '1 second' where id = pg_temp.id('i15');
select is(pg_temp.err(pg_temp.accept('guest4', 'i15')), 'INVALID invitation_expired', 'an expired one is invitation_expired');
select is((select count(*) from app.memberships m where m.user_id in (pg_temp.id('guest3'), pg_temp.id('guest4'))), 0::bigint, 'and neither gave a membership');
select pg_temp.mk('i16', 'guest5@t2-3.invalid', 'teacher', 'i16');
update app.invitations set status = 'expired' where id = pg_temp.id('i16');
select is(pg_temp.err(pg_temp.accept('guest5', 'i16')), 'INVALID invitation_expired', 'one stored as expired too');
select is(pg_temp.err(pg_temp.accept('adm', 'i11')), 'FORBIDDEN invitation_email_mismatch', 'accepted by somebody else, seen by a third one: the email decides first');
-- A student cannot be staff in the same institution (the trigger of phase 1).
select pg_temp.mk('i17', 'stud@t2-3.invalid', 'teacher', 'i17');
select is(pg_temp.err(pg_temp.accept('stud', 'i17')), 'CONFLICT role_conflict', 'a student is CONFLICT role_conflict');
select is(pg_temp.row_of('i17'), 'pending:1:false', 'and the invitation stays pending');
-- Two acceptances in a row (the second waits for the first one in a real race): one membership.
select pg_temp.mk('i18', 'guest6@t2-3.invalid', 'admin', 'i18');
select pg_temp.accept('guest6', 'i18');
select is((select count(*) from app.memberships m where m.user_id = pg_temp.id('guest6') and m.role = 'admin'), 1::bigint, 'one membership after the first acceptance');
select pg_temp.accept('guest6', 'i18');
select is((select count(*) from app.memberships m where m.user_id = pg_temp.id('guest6') and m.role = 'admin'), 1::bigint, 'and still one after the second');

-- ---------------------------------------------------------------------------------------------
-- internal_finish_invitation_signup: the step of the signup with no account
-- ---------------------------------------------------------------------------------------------
-- The account the server created with the admin client: confirmed, with the invitation_id in its app_metadata.
create function pg_temp.new_account(p_key text, p_email text, p_invitation text, p_confirmed boolean default true) returns void language plpgsql as $$
begin
  insert into ids (k, id) values (p_key, gen_random_uuid());
  insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data)
  values (pg_temp.id(p_key), p_email, case when p_confirmed then now() end,
          case when p_invitation is null then '{}'::jsonb else jsonb_build_object('invitation_id', pg_temp.id(p_invitation)) end);
end $$;
select pg_temp.mk('j1', 'nueva@colegio.edu', 'teacher', 'j1');
select pg_temp.new_account('n1', 'nueva@colegio.edu', 'j1');
select is(pg_temp.keys(pg_temp.finish('j1', 'n1', '  Docente Nueva ')), 'institutionId,role', 'internal_finish_invitation_signup answers exactly institutionId and role');
select is((select u.display_name from app.app_users u where u.id = pg_temp.id('n1')), 'Docente Nueva', 'the app_user is created with the trimmed name');
select is((select count(*) from app.memberships m where m.user_id = pg_temp.id('n1') and m.institution_id = pg_temp.id('a') and m.role = 'teacher' and m.revoked_at is null),
  1::bigint, 'with the membership');
select is(pg_temp.row_of('j1'), 'accepted:1:false', 'and the invitation is accepted');
select is(pg_temp.err(pg_temp.finish('j1', 'n1')), 'INVALID invitation_closed', 'finishing twice is invitation_closed: it does not add another membership');
select is((select count(*) from app.memberships m where m.user_id = pg_temp.id('n1')), 1::bigint, 'one membership');

select pg_temp.mk('j2', 'sin-meta@colegio.edu', 'teacher', 'j2');
select pg_temp.new_account('n2', 'sin-meta@colegio.edu', null);
select is(pg_temp.err(pg_temp.finish('j2', 'n2')), 'FORBIDDEN forbidden', 'an account that does not carry this invitation_id is FORBIDDEN');
select pg_temp.mk('j3', 'otra-meta@colegio.edu', 'teacher', 'j3');
select pg_temp.new_account('n3', 'otra-meta@colegio.edu', 'j2');
select is(pg_temp.err(pg_temp.finish('j3', 'n3')), 'FORBIDDEN forbidden', 'one that carries the id of another invitation too');
select pg_temp.mk('j4', 'otro-mail@colegio.edu', 'teacher', 'j4');
select pg_temp.new_account('n4', 'distinto@colegio.edu', 'j4');
select is(pg_temp.err(pg_temp.finish('j4', 'n4')), 'FORBIDDEN invitation_email_mismatch', 'an account with another email is invitation_email_mismatch');
select pg_temp.mk('j5', 'sin-confirmar@colegio.edu', 'teacher', 'j5');
select pg_temp.new_account('n5', 'sin-confirmar@colegio.edu', 'j5', false);
select is(pg_temp.err(pg_temp.finish('j5', 'n5')), 'FORBIDDEN forbidden', 'an account with the email not confirmed is FORBIDDEN');
select is(pg_temp.err(pg_temp.finish('j5', 'ghost')), 'NOT_FOUND not_found', 'an account that does not exist is NOT_FOUND');
select is(pg_temp.err(pg_temp.finish('no-existe', 'n5')), 'NOT_FOUND not_found', 'a hash with no invitation is NOT_FOUND');
select is(pg_temp.err(pg_temp.finish('j5', 'n5', '   ')), 'INVALID invalid_name', 'an empty name is invalid_name');
select is(pg_temp.err(pg_temp.finish('j5', 'n5', repeat('x', 121))), 'INVALID invalid_name', 'and so is one of more than 120 characters');
select is((select count(*) from app.memberships m where m.user_id in (pg_temp.id('n2'), pg_temp.id('n3'), pg_temp.id('n4'), pg_temp.id('n5'))), 0::bigint,
  'none of the refusals left a membership');
select is((select count(*) from app.app_users u where u.id in (pg_temp.id('n2'), pg_temp.id('n3'), pg_temp.id('n4'), pg_temp.id('n5'))), 0::bigint, 'nor an app_user');

-- Revoked, rotated or expired between the creation of the account and this step: the account stays with nothing.
select pg_temp.mk('j6', 'revocada@colegio.edu', 'teacher', 'j6');
select pg_temp.new_account('n6', 'revocada@colegio.edu', 'j6');
select pg_temp.revoke_inv('adm', 'j6', 1);
select is(pg_temp.err(pg_temp.finish('j6', 'n6')), 'INVALID invitation_closed', 'revoked in between: invitation_closed');
select pg_temp.mk('j7', 'rotada@colegio.edu', 'teacher', 'j7');
select pg_temp.new_account('n7', 'rotada@colegio.edu', 'j7');
select pg_temp.resend('adm', 'j7', 1, 'j7b');
select is(pg_temp.err(pg_temp.finish('j7', 'n7')), 'NOT_FOUND not_found', 'rotated in between: the old hash finds nothing');
select pg_temp.mk('j8', 'vencida2@colegio.edu', 'teacher', 'j8');
select pg_temp.new_account('n8', 'vencida2@colegio.edu', 'j8');
update app.invitations set expires_at = now() - interval '1 second' where id = pg_temp.id('j8');
select is(pg_temp.err(pg_temp.finish('j8', 'n8')), 'INVALID invitation_expired', 'expired in between: invitation_expired');
select is((select count(*) from app.memberships m where m.user_id in (pg_temp.id('n6'), pg_temp.id('n7'), pg_temp.id('n8'))), 0::bigint, 'the three accounts have no membership at all');
-- Invite again, enter with the account and accept: the app_user is created by accept_invitation.
select pg_temp.revoke_inv('adm', 'j8', 1);
select pg_temp.mk('j9', 'vencida2@colegio.edu', 'teacher', 'j9');
select is(pg_temp.err(pg_temp.accept('n8', 'j9')), null, 'invite again and accept with the account that was left with nothing: it works');
select is((select count(*) from app.app_users u where u.id = pg_temp.id('n8')), 1::bigint, 'and creates its app_user');
select is((select count(*) from app.memberships m where m.user_id = pg_temp.id('n8') and m.role = 'teacher'), 1::bigint, 'with the membership');

-- The grants: user RPCs for authenticated only, internal ones for service_role only.
select is((select count(*) from unnest(array[
    'api.create_invitation(uuid,text,text,bytea,uuid)', 'api.resend_invitation(uuid,integer,bytea)', 'api.revoke_invitation(uuid,integer)',
    'api.mark_invitation_sent(uuid,integer)', 'api.list_invitations(uuid)', 'api.list_institution_staff(uuid)',
    'api.get_institution_summary(uuid)', 'api.list_enabled_subjects()', 'api.accept_invitation(bytea)']) f
   where has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('service_role', f, 'execute') and not has_function_privilege('anon', f, 'execute')),
  9::bigint, 'the nine user RPCs are for authenticated only');
select is((select count(*) from unnest(array[
    'api.internal_get_invitation(bytea)', 'api.internal_create_invitation(uuid,text,text,bytea)', 'api.internal_finish_invitation_signup(bytea,uuid,text)']) f
   where has_function_privilege('service_role', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')),
  3::bigint, 'the three internal ones are for service_role only');
select is((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace
              and p.proname in ('invitation_email', 'invitation_lock', 'invitation_status', 'expire_stale_invitations', 'audit_event',
                                'require_institution_admin', 'invitation_input', 'invitation_blockers', 'invitation_insert', 'invitation_accept', 'display_name_or_null')
              and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
  0::bigint, 'the helpers of app are not executable by any API role');

select * from finish();
rollback;
