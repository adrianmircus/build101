-- T2.7: a closed session stops reading data, and login attempts are counted in Postgres before they are tried
-- (docs/contratos/fase-2.md, "Sesion vigente en la base" and "Limite de intentos").

-- Is the session of the caller still alive? Auth deletes a row of auth.sessions when someone signs out, changes the
-- password or gets a new card, but an access token stays valid until it expires. A real JWT always carries `session_id`;
-- claims without it (the simulated ones of the tests, the secret key) pass.
-- SECURITY DEFINER on purpose: the student RPCs run as tiza_student, which cannot see schema auth. It takes no
-- argument and answers only about the session of the claims: it is the one exception to "no helper lends privileges"
-- (005_student_role lists it). Only tiza_student executes it: staff and internal RPCs run as postgres, its owner.
create function app.session_alive() returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_session text;
begin
  if v_claims is null then
    return true;
  end if;
  v_session := v_claims::jsonb ->> 'session_id';
  if v_session is null then
    return true;
  end if;
  -- Something that is not a uuid cannot be a session that exists.
  if v_session !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (select 1 from auth.sessions s where s.id = v_session::uuid);
end
$$;
revoke all on function app.session_alive() from public;
grant execute on function app.session_alive() to tiza_student;

-- Same as before (no RPC runs inside erasure mode, then the lock markers restart), plus the session check. The check goes
-- before lock_begin: a dead session takes no lock.
create or replace function app.rpc_begin() returns void
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('tiza.erasure', true), '') <> '' then
    raise exception 'app.rpc_begin: no RPC runs inside erasure mode' using errcode = 'P0004';
  end if;
  if not app.session_alive() then
    perform app.raise_error('FORBIDDEN', 'no_session');
  end if;
  perform app.lock_begin();
end
$$;

-- Closes every session of a user: no RPC accepts the access tokens that were open (the refresh tokens go with them, by cascade).
create or replace function api.internal_revoke_user_sessions(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_revoked integer;
begin
  perform app.rpc_begin();
  if p_user_id is null then
    raise exception 'internal_revoke_user_sessions: p_user_id is required' using errcode = 'P0004';
  end if;
  with gone as (delete from auth.sessions s where s.user_id = p_user_id returning 1)
  select count(*) into v_revoked from gone;
  return jsonb_build_object('revoked', v_revoked);
end
$$;

-- Counts one attempt in the current window of every key, in ONE statement (insert ... on conflict ... returning), so a burst
-- of concurrent attempts never tries more than the cap: each one gets its own number. `allowed` is false when any key went
-- over its cap; `retryAt` is the end of the window. The keys go in order, so two calls with the same keys cannot deadlock.
-- A blocked attempt counts too (the window is fixed, so it does not extend the block). It also sweeps old windows.
create or replace function api.internal_rate_limit_hit(p_keys text[], p_limits integer[], p_window_seconds integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_start timestamptz;
  v_allowed boolean;
begin
  perform app.rpc_begin();
  if p_keys is null or p_limits is null or p_window_seconds is null
     or coalesce(cardinality(p_keys), 0) not between 1 and 4
     or cardinality(p_keys) <> cardinality(p_limits)
     or p_window_seconds not between 1 and 86400
     or exists (select 1 from unnest(p_keys) as k(key) where k.key is null or k.key !~ '^[a-z][a-z0-9_]{1,30}:[0-9a-f]{64}$')
     or exists (select 1 from unnest(p_limits) as l(lim) where l.lim is null or l.lim < 1)
     or (select count(distinct k.key) from unnest(p_keys) as k(key)) <> cardinality(p_keys) then
    raise exception 'internal_rate_limit_hit: invalid keys, limits or window' using errcode = 'P0004';
  end if;

  v_start := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);

  with input as (
    select k.key, l.lim
      from unnest(p_keys) with ordinality as k(key, ord)
      join unnest(p_limits) with ordinality as l(lim, ord) using (ord)
  ), hit as (
    insert into app.rate_limits as r (key, window_start, window_seconds, count)
    select i.key, v_start, p_window_seconds, 1 from input i order by i.key
    on conflict (key, window_start) do update set count = r.count + 1
    returning r.key, r.count
  )
  select coalesce(bool_and(h.count <= i.lim), true) into v_allowed from hit h join input i on i.key = h.key;

  -- Windows from more than a day ago: nothing reads them. At most 100 per call, and never the ones another call holds.
  delete from app.rate_limits r
   where r.id in (select o.id from app.rate_limits o where o.window_start < v_now - interval '1 day'
                   order by o.window_start limit 100 for update skip locked);

  return jsonb_build_object('allowed', v_allowed, 'retryAt', v_start + make_interval(secs => p_window_seconds));
end
$$;

-- A success: deletes the current window of those keys.
create or replace function api.internal_rate_limit_clear(p_keys text[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_cleared integer;
begin
  perform app.rpc_begin();
  if p_keys is null or coalesce(cardinality(p_keys), 0) not between 1 and 4
     or exists (select 1 from unnest(p_keys) as k(key) where k.key is null or k.key !~ '^[a-z][a-z0-9_]{1,30}:[0-9a-f]{64}$') then
    raise exception 'internal_rate_limit_clear: invalid keys' using errcode = 'P0004';
  end if;
  -- The current window of each key, whatever its length: the one that contains now.
  with gone as (
    delete from app.rate_limits r
     where r.key = any (p_keys)
       and r.window_start <= v_now
       and r.window_start + make_interval(secs => r.window_seconds) > v_now
    returning 1)
  select count(*) into v_cleared from gone;
  return jsonb_build_object('cleared', v_cleared);
end
$$;

grant execute on function api.internal_revoke_user_sessions(uuid) to service_role;
grant execute on function api.internal_rate_limit_hit(text[], integer[], integer) to service_role;
grant execute on function api.internal_rate_limit_clear(text[]) to service_role;
