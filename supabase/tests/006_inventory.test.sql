-- The tables of schema app are the ones docs/PRIVACIDAD-DATOS.md inventories (T1.9). The literal
-- list is the one lib/domain/permissions/inventory.test.ts compares with APP_TABLES and with the
-- doc; a table added without its inventory entry fails here and there.
begin;
select plan(3);

select set_eq(
  $$
    select c.relname::text
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'app' and c.relkind in ('r', 'p')
  $$,
  $$
    values
    -- inventory:begin
    ('app_users'),
    ('institutions'),
    ('subjects'),
    ('memberships'),
    ('invitations'),
    ('groups'),
    ('group_staff'),
    ('students'),
    ('enrollments'),
    ('student_pseudonyms'),
    ('account_provisioning'),
    ('student_needs'),
    ('student_need_events'),
    ('student_notes'),
    ('files'),
    ('syllabi'),
    ('consents'),
    ('assessments'),
    ('assessment_exercises'),
    ('versions'),
    ('version_exercises'),
    ('version_questions'),
    ('question_keys'),
    ('version_recipients'),
    ('generations'),
    ('operations'),
    ('generation_outputs'),
    ('version_events'),
    ('answer_keys'),
    ('answer_key_revisions'),
    ('publications'),
    ('assignments'),
    ('assignment_attempts'),
    ('submissions'),
    ('grades'),
    ('group_analyses'),
    ('feedback_events'),
    ('audit_log'),
    ('erasures'),
    ('rate_limits'),
    ('presets'),
    ('notifications'),
    ('import_runs'),
    ('sandbox_sessions')
    -- inventory:end
  $$,
  'the tables of app are exactly the inventoried ones');

-- Columns are checked by the TypeScript test, which reads the migrations. Here, the database itself:
-- nothing lives outside app.
select is_empty($$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
$$, 'there are no tables in public: nothing is left outside the inventory');

select is_empty($$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind in ('v', 'm', 'f')
$$, 'there are no views, materialized views or foreign tables in app that copy inventoried data');

select * from finish();
rollback;
