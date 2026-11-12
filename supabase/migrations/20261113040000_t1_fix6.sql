-- T1.F6: closes P-1 of Codex's review of T1.5a (docs/revisiones/fase-1-t1-5a-codex.md; still partial in
-- fase-1-t1-f5-codex.md). app.project_graph (T1.F5) rebuilt the keys of GraphSpec but copied each leaf with -> / #>
-- without looking at its type, so {"functions":[{"expr":{"correctOptionId":"B"}}],"points":[]} (stored by an RPC from
-- before T1.F5) kept correctOptionId inside expr, and objects survived in coordinates, labels and window limits.
--
-- Now every leaf is rebuilt with its exact GraphSpec type (a string within its length, a finite number) and a leaf
-- of any other type is NOT copied: it comes out as JSON null, which no GraphSpec accepts. A subtree is never copied.
-- A list that is not a list, or longer than its limit, is not truncated either. app.publication_content validates the
-- projection with app.is_graph_spec and, if an option has a graph that does not pass (old dirty data), publishing fails
-- with CONFLICT invalid_option_graph: the teacher saves that question again. Nothing is published trimmed in silence.
-- No table, no column, no signature of the API changes.

-- A leaf string as is when it is a string within p_max (UTF-16 units), JSON null otherwise.
create function app.leaf_text(p_value jsonb, p_max integer) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_value) = 'string' and app.js_length(p_value #>> '{}') <= p_max then p_value else 'null'::jsonb end
$$;

-- A leaf number as is when it is a finite JS double, JSON null otherwise.
create function app.leaf_number(p_value jsonb) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when app.is_js_number(p_value) then p_value else 'null'::jsonb end
$$;

-- An optional text leaf: absent stays absent (an empty object to concatenate); present, it is leaf_text.
create function app.leaf_optional_text(p_object jsonb, p_key text, p_max integer) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_object) = 'object' and p_object ? p_key
              then jsonb_build_object(p_key, app.leaf_text(p_object -> p_key, p_max)) else '{}'::jsonb end
$$;

create or replace function app.project_graph(p_graph jsonb) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
      'functions', case when jsonb_typeof(p_graph -> 'functions') = 'array' and jsonb_array_length(p_graph -> 'functions') <= 5
        then coalesce((
          select jsonb_agg(case when jsonb_typeof(f.e) = 'object'
                                then jsonb_build_object('expr', app.leaf_text(f.e -> 'expr', 200)) || app.leaf_optional_text(f.e, 'label', 60)
                                else 'null'::jsonb end order by f.n)
            from jsonb_array_elements(p_graph -> 'functions') with ordinality as f(e, n)), '[]'::jsonb)
        else 'null'::jsonb end,
      'points', case when jsonb_typeof(p_graph -> 'points') = 'array' and jsonb_array_length(p_graph -> 'points') <= 20
        then coalesce((
          select jsonb_agg(case when jsonb_typeof(f.e) = 'object'
                                then jsonb_build_object('x', app.leaf_number(f.e -> 'x'), 'y', app.leaf_number(f.e -> 'y')) || app.leaf_optional_text(f.e, 'label', 60)
                                else 'null'::jsonb end order by f.n)
            from jsonb_array_elements(p_graph -> 'points') with ordinality as f(e, n)), '[]'::jsonb)
        else 'null'::jsonb end)
    || case when jsonb_typeof(p_graph) = 'object' and p_graph ? 'window'
            then jsonb_build_object('window', case when jsonb_typeof(p_graph -> 'window') = 'object'
                   then jsonb_build_object('xMin', app.leaf_number(p_graph #> '{window,xMin}'), 'xMax', app.leaf_number(p_graph #> '{window,xMax}'),
                                           'yMin', app.leaf_number(p_graph #> '{window,yMin}'), 'yMax', app.leaf_number(p_graph #> '{window,yMax}'))
                   else 'null'::jsonb end)
            else '{}'::jsonb end
$$;

-- The same content as T1.F5, validated: every graph of every option has to pass GraphSpec after the projection.
create or replace function app.publication_content(p_version_id uuid) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_content jsonb;
  v_question jsonb;
  v_option jsonb;
begin
  select jsonb_build_object(
    'generalInstructions', v.general_instructions,
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object('id', ve.id, 'label', e.label, 'body', ve.body) order by e.position, e.id)
        from app.version_exercises ve join app.assessment_exercises e on e.id = ve.exercise_id
       where ve.version_id = v.id), '[]'::jsonb),
    'questions', case when v.answer_mode = 'gaze' then coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'exerciseId', q.version_exercise_id, 'stem', q.stem, 'options', coalesce((
                         select jsonb_agg(app.project_option(o.e) order by o.n)
                           from jsonb_array_elements(case when jsonb_typeof(q.options) = 'array' then q.options else '[]'::jsonb end) with ordinality as o(e, n)), '[]'::jsonb))
                       order by e.position, e.id, q.position, q.id)
        from app.version_questions q
        join app.version_exercises ve on ve.id = q.version_exercise_id
        join app.assessment_exercises e on e.id = ve.exercise_id
       where q.version_id = v.id), '[]'::jsonb) else '[]'::jsonb end)
    into v_content
    from app.versions v where v.id = p_version_id;

  for v_question in select q from jsonb_array_elements(coalesce(v_content -> 'questions', '[]'::jsonb)) as q loop
    for v_option in select o from jsonb_array_elements(v_question -> 'options') as o loop
      if v_option ? 'graph' and app.is_graph_spec(v_option -> 'graph') is not true then
        perform app.raise_error('CONFLICT', 'invalid_option_graph');
      end if;
    end loop;
  end loop;
  return v_content;
end
$$;
