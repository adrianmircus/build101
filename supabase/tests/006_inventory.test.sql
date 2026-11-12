-- The tables of schema app are the ones docs/PRIVACIDAD-DATOS.md inventories (T1.9). The literal
-- list is the one lib/domain/permissions/inventory.test.ts compares with APP_TABLES and with the
-- doc; a table added without its inventory entry fails here and there.
begin;
select plan(4);

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
    ('sandbox_sessions'),
    ('student_rpc_windows')
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

-- Every column of every table of app, as table.column. docs/PRIVACIDAD-DATOS.md must list exactly
-- these (inventory.test.ts compares them), so a column added by any later migration, CREATE TABLE
-- or ALTER TABLE, fails here until it is inventoried.
select set_eq(
  $$
    select c.table_name::text || '.' || c.column_name::text
      from information_schema.columns c
     where c.table_schema = 'app'
       and c.table_name in (select t.tablename from pg_tables t where t.schemaname = 'app')
  $$,
  $$
    values
    -- columns:begin
    ('account_provisioning.attempts'), ('account_provisioning.auth_user_id'), ('account_provisioning.created_at'), ('account_provisioning.error_code'), ('account_provisioning.id'), ('account_provisioning.institution_id'), ('account_provisioning.op_identity'), ('account_provisioning.op_key'), ('account_provisioning.revision'), ('account_provisioning.status'), ('account_provisioning.student_id'), ('account_provisioning.updated_at'),
    ('answer_key_revisions.answer_key_id'), ('answer_key_revisions.author_user_id'), ('answer_key_revisions.content'), ('answer_key_revisions.created_at'), ('answer_key_revisions.exercise_revisions'), ('answer_key_revisions.generation_id'), ('answer_key_revisions.id'), ('answer_key_revisions.institution_id'), ('answer_key_revisions.instructions_revision'), ('answer_key_revisions.number'), ('answer_key_revisions.question_revisions'), ('answer_key_revisions.source'), ('answer_key_revisions.version_id'), ('answer_key_revisions.version_revision'),
    ('answer_keys.approved_revision_id'), ('answer_keys.created_at'), ('answer_keys.current_generation_id'), ('answer_keys.current_revision_id'), ('answer_keys.error_code'), ('answer_keys.id'), ('answer_keys.institution_id'), ('answer_keys.revision'), ('answer_keys.stale'), ('answer_keys.status'), ('answer_keys.updated_at'), ('answer_keys.version_id'),
    ('app_users.created_at'), ('app_users.display_name'), ('app_users.id'), ('app_users.revision'), ('app_users.updated_at'),
    ('assessment_exercises.assessment_id'), ('assessment_exercises.body'), ('assessment_exercises.created_at'), ('assessment_exercises.id'), ('assessment_exercises.institution_id'), ('assessment_exercises.label'), ('assessment_exercises.position'), ('assessment_exercises.removed_at'), ('assessment_exercises.revision'), ('assessment_exercises.topic_id'), ('assessment_exercises.updated_at'),
    ('assessments.created_at'), ('assessments.created_by'), ('assessments.due_at'), ('assessments.general_instructions'), ('assessments.group_id'), ('assessments.id'), ('assessments.institution_id'), ('assessments.kind'), ('assessments.publish_at'), ('assessments.revision'), ('assessments.source_file_id'), ('assessments.status'), ('assessments.subject_id'), ('assessments.topic'), ('assessments.updated_at'),
    ('assignment_attempts.answer_key_revision_id'), ('assignment_attempts.assessment_id'), ('assignment_attempts.assignment_id'), ('assignment_attempts.created_at'), ('assignment_attempts.first_viewed_at'), ('assignment_attempts.id'), ('assignment_attempts.institution_id'), ('assignment_attempts.late'), ('assignment_attempts.number'), ('assignment_attempts.publication_id'), ('assignment_attempts.revision'), ('assignment_attempts.started_at'), ('assignment_attempts.status'), ('assignment_attempts.submitted_at'), ('assignment_attempts.superseded_at'), ('assignment_attempts.updated_at'), ('assignment_attempts.version_id'),
    ('assignments.assessment_id'), ('assignments.created_at'), ('assignments.id'), ('assignments.institution_id'), ('assignments.revision'), ('assignments.status'), ('assignments.student_id'), ('assignments.updated_at'),
    ('audit_log.action'), ('audit_log.actor_user_id'), ('audit_log.created_at'), ('audit_log.entity'), ('audit_log.entity_id'), ('audit_log.id'), ('audit_log.institution_id'), ('audit_log.request_id'), ('audit_log.student_ids'),
    ('consents.created_at'), ('consents.file_id'), ('consents.id'), ('consents.institution_id'), ('consents.purpose'), ('consents.recorded_by'), ('consents.revision'), ('consents.revoked_at'), ('consents.revoked_by'), ('consents.status'), ('consents.student_id'), ('consents.text_version'), ('consents.updated_at'), ('consents.valid_from'), ('consents.valid_until'),
    ('enrollments.created_at'), ('enrollments.ended_at'), ('enrollments.group_id'), ('enrollments.id'), ('enrollments.institution_id'), ('enrollments.revision'), ('enrollments.started_at'), ('enrollments.student_id'), ('enrollments.updated_at'),
    ('erasures.completed_at'), ('erasures.created_at'), ('erasures.external_copied_at'), ('erasures.id'), ('erasures.institution_id'), ('erasures.kind'), ('erasures.marked_at'), ('erasures.pseudonym_id'), ('erasures.status'), ('erasures.updated_at'),
    ('feedback_events.created_at'), ('feedback_events.data'), ('feedback_events.exercise_id'), ('feedback_events.id'), ('feedback_events.institution_id'), ('feedback_events.kind'), ('feedback_events.occurred_at'), ('feedback_events.pseudonym_id'), ('feedback_events.publication_id'),
    ('files.bucket'), ('files.confirmed_at'), ('files.created_at'), ('files.group_id'), ('files.id'), ('files.institution_id'), ('files.max_bytes'), ('files.mime_type'), ('files.path'), ('files.purpose'), ('files.reserved_by'), ('files.revision'), ('files.size_bytes'), ('files.status'), ('files.student_id'), ('files.updated_at'),
    ('generation_outputs.created_at'), ('generation_outputs.expected_revision'), ('generation_outputs.generation_id'), ('generation_outputs.id'), ('generation_outputs.institution_id'), ('generation_outputs.kind'), ('generation_outputs.outcome'), ('generation_outputs.output'), ('generation_outputs.version_exercise_id'), ('generation_outputs.version_id'),
    ('generations.created_at'), ('generations.error_code'), ('generations.finished_at'), ('generations.id'), ('generations.inputs'), ('generations.institution_id'), ('generations.kind'), ('generations.op_key'), ('generations.profiles_hash'), ('generations.profiles_revision'), ('generations.prompt_version'), ('generations.requested_by'), ('generations.required_jobs'), ('generations.status'), ('generations.subject_id'), ('generations.target_exercise_id'), ('generations.target_revision'), ('generations.updated_at'), ('generations.version_id'),
    ('grades.attempt_id'), ('grades.created_at'), ('grades.exercise_results'), ('grades.feedback'), ('grades.graded_at'), ('grades.graded_by'), ('grades.id'), ('grades.institution_id'), ('grades.revision'), ('grades.score'), ('grades.updated_at'),
    ('group_analyses.analyzer_version'), ('group_analyses.assessment_id'), ('group_analyses.created_at'), ('group_analyses.group_id'), ('group_analyses.id'), ('group_analyses.inputs_hash'), ('group_analyses.institution_id'), ('group_analyses.operation_id'), ('group_analyses.pseudonym_map'), ('group_analyses.result'), ('group_analyses.updated_at'),
    ('group_staff.created_at'), ('group_staff.group_id'), ('group_staff.id'), ('group_staff.institution_id'), ('group_staff.removed_at'), ('group_staff.revision'), ('group_staff.role'), ('group_staff.updated_at'), ('group_staff.user_id'),
    ('groups.archived_at'), ('groups.created_at'), ('groups.created_by'), ('groups.id'), ('groups.institution_id'), ('groups.name'), ('groups.revision'), ('groups.school_year'), ('groups.subject_id'), ('groups.updated_at'),
    ('import_runs.created_at'), ('import_runs.error_code'), ('import_runs.format_version'), ('import_runs.id'), ('import_runs.id_map'), ('import_runs.institution_id'), ('import_runs.op_key'), ('import_runs.parts_done'), ('import_runs.parts_total'), ('import_runs.revision'), ('import_runs.status'), ('import_runs.updated_at'), ('import_runs.user_id'),
    ('institutions.code'), ('institutions.created_at'), ('institutions.expires_at'), ('institutions.id'), ('institutions.kind'), ('institutions.name'), ('institutions.owner_user_id'), ('institutions.revision'), ('institutions.updated_at'),
    ('invitations.accepted_at'), ('invitations.accepted_by'), ('invitations.created_at'), ('invitations.email'), ('invitations.expires_at'), ('invitations.id'), ('invitations.institution_id'), ('invitations.invited_by'), ('invitations.revision'), ('invitations.role'), ('invitations.status'), ('invitations.token_hash'), ('invitations.updated_at'),
    ('memberships.created_at'), ('memberships.id'), ('memberships.institution_id'), ('memberships.revision'), ('memberships.revoked_at'), ('memberships.role'), ('memberships.updated_at'), ('memberships.user_id'),
    ('notifications.created_at'), ('notifications.data'), ('notifications.entity'), ('notifications.entity_id'), ('notifications.id'), ('notifications.institution_id'), ('notifications.kind'), ('notifications.read_at'), ('notifications.revision'), ('notifications.updated_at'), ('notifications.user_id'),
    ('operations.assessment_id'), ('operations.created_at'), ('operations.error_code'), ('operations.file_id'), ('operations.finished_at'), ('operations.group_id'), ('operations.id'), ('operations.institution_id'), ('operations.kind'), ('operations.merge_result'), ('operations.op_key'), ('operations.requested_by'), ('operations.required_parts'), ('operations.status'), ('operations.updated_at'),
    ('presets.archived_at'), ('presets.config'), ('presets.created_at'), ('presets.id'), ('presets.institution_id'), ('presets.name'), ('presets.owner_user_id'), ('presets.revision'), ('presets.updated_at'),
    ('publications.aids'), ('publications.answer_key_revision_id'), ('publications.answer_mode'), ('publications.assessment_id'), ('publications.content'), ('publications.created_at'), ('publications.id'), ('publications.institution_id'), ('publications.published_at'), ('publications.published_by'), ('publications.version_id'), ('publications.version_revision'), ('publications.withdrawn_at'),
    ('question_keys.correct_option_id'), ('question_keys.created_at'), ('question_keys.id'), ('question_keys.institution_id'), ('question_keys.question_id'), ('question_keys.revision'), ('question_keys.updated_at'), ('question_keys.version_id'),
    ('rate_limits.count'), ('rate_limits.created_at'), ('rate_limits.id'), ('rate_limits.key'), ('rate_limits.updated_at'), ('rate_limits.window_seconds'), ('rate_limits.window_start'),
    ('sandbox_sessions.claim_token'), ('sandbox_sessions.claimed_at'), ('sandbox_sessions.consumed_at'), ('sandbox_sessions.created_at'), ('sandbox_sessions.expires_at'), ('sandbox_sessions.id'), ('sandbox_sessions.institution_id'), ('sandbox_sessions.owner_user_id'), ('sandbox_sessions.refresh_token_ciphertext'), ('sandbox_sessions.updated_at'),
    ('student_need_events.actor_user_id'), ('student_need_events.after'), ('student_need_events.before'), ('student_need_events.created_at'), ('student_need_events.id'), ('student_need_events.institution_id'), ('student_need_events.kind'), ('student_need_events.need_revision'), ('student_need_events.op_id'), ('student_need_events.student_id'),
    ('student_needs.created_at'), ('student_needs.id'), ('student_needs.institution_id'), ('student_needs.interests'), ('student_needs.profiles'), ('student_needs.review_due_on'), ('student_needs.revision'), ('student_needs.student_id'), ('student_needs.supports'), ('student_needs.updated_at'),
    ('student_notes.archived_at'), ('student_notes.author_user_id'), ('student_notes.body'), ('student_notes.created_at'), ('student_notes.id'), ('student_notes.institution_id'), ('student_notes.revision'), ('student_notes.student_id'), ('student_notes.updated_at'),
    ('student_pseudonyms.created_at'), ('student_pseudonyms.id'), ('student_pseudonyms.institution_id'), ('student_pseudonyms.student_id'), ('student_pseudonyms.unlinked_at'),
    ('student_rpc_windows.created_at'), ('student_rpc_windows.id'), ('student_rpc_windows.txid'),
    ('students.archived_at'), ('students.created_at'), ('students.display_name'), ('students.id'), ('students.institution_id'), ('students.interface'), ('students.revision'), ('students.updated_at'), ('students.user_id'), ('students.username'),
    ('subjects.created_at'), ('subjects.enabled'), ('subjects.id'),
    ('submissions.answers'), ('submissions.attempt_id'), ('submissions.choices'), ('submissions.created_at'), ('submissions.id'), ('submissions.institution_id'), ('submissions.revision'), ('submissions.submitted_at'), ('submissions.updated_at'),
    ('syllabi.created_at'), ('syllabi.file_id'), ('syllabi.group_id'), ('syllabi.id'), ('syllabi.institution_id'), ('syllabi.revision'), ('syllabi.units'), ('syllabi.updated_at'),
    ('version_events.actor_user_id'), ('version_events.created_at'), ('version_events.data'), ('version_events.exercise_revision'), ('version_events.generation_id'), ('version_events.id'), ('version_events.institution_id'), ('version_events.kind'), ('version_events.op_id'), ('version_events.operation'), ('version_events.result'), ('version_events.target_id'), ('version_events.version_exercise_id'), ('version_events.version_id'), ('version_events.version_revision'),
    ('version_exercises.assessment_id'), ('version_exercises.body'), ('version_exercises.changes'), ('version_exercises.created_at'), ('version_exercises.current_generation_id'), ('version_exercises.error_code'), ('version_exercises.exercise_id'), ('version_exercises.id'), ('version_exercises.institution_id'), ('version_exercises.revision'), ('version_exercises.source_revision'), ('version_exercises.status'), ('version_exercises.updated_at'), ('version_exercises.version_id'), ('version_exercises.written_by_generation_id'),
    ('version_questions.created_at'), ('version_questions.id'), ('version_questions.institution_id'), ('version_questions.options'), ('version_questions.position'), ('version_questions.revision'), ('version_questions.stem'), ('version_questions.updated_at'), ('version_questions.version_exercise_id'), ('version_questions.version_id'),
    ('version_recipients.assessment_id'), ('version_recipients.created_at'), ('version_recipients.id'), ('version_recipients.institution_id'), ('version_recipients.student_id'), ('version_recipients.valid_from'), ('version_recipients.valid_to'), ('version_recipients.version_id'),
    ('versions.answer_mode'), ('versions.approved_revision'), ('versions.archived_at'), ('versions.assessment_id'), ('versions.base_version_id'), ('versions.config'), ('versions.created_at'), ('versions.created_by'), ('versions.current_generation_id'), ('versions.error_code'), ('versions.general_instructions'), ('versions.id'), ('versions.institution_id'), ('versions.instructions_revision'), ('versions.instructions_written_by'), ('versions.position'), ('versions.revision'), ('versions.stale'), ('versions.status'), ('versions.updated_at')
    -- columns:end
  $$,
  'the columns of app are exactly the inventoried ones');

select * from finish();
rollback;
