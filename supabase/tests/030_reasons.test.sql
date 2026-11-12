-- T1.F8 (F1-5): the reasons SQL raises and the texts of lib/domain/errors/reasons.ts do not drift apart. Before, `forbidden` was
-- raised with no text while two texts (not_implemented, already_enrolled) were raised by nothing, and no check noticed.
-- The list below is literal on purpose: a new reason is added here, in the migration that raises it and in reasons.ts, in the
-- same ticket. reasons.test.ts (unit) compares this very list with the keys of REASON_MESSAGES.
--
-- The raised reasons are read from the bodies of every function of api and app: app.raise_error('<CODE>', '<reason>').
begin;
select plan(5);

create temp table expected (reason text primary key);
-- BEGIN REASONS
insert into expected (reason) values
  ('already_revoked'), ('already_submitted'), ('archived'), ('assessment_archived'),
  ('attempt_closed'), ('attempt_not_started'), ('content_incomplete'), ('correct_option_removed'),
  ('draft_outdated'), ('exercises_mismatch'), ('forbidden'), ('invalid_answer_key'),
  ('invalid_answer_mode'), ('invalid_answers'), ('invalid_base_version'), ('invalid_body'),
  ('invalid_choices'), ('invalid_code'), ('invalid_config'), ('invalid_error_code'),
  ('invalid_feedback'), ('invalid_file'), ('invalid_generation'), ('invalid_institution_kind'),
  ('invalid_institution_shape'), ('invalid_instructions'), ('invalid_interests'), ('invalid_interface'),
  ('invalid_keep'), ('invalid_kind'), ('invalid_label'), ('invalid_name'),
  ('invalid_needs'), ('invalid_note'), ('invalid_op_key'), ('invalid_option'),
  ('invalid_option_graph'), ('invalid_options'), ('invalid_output'), ('invalid_page'),
  ('invalid_purpose'), ('invalid_reasons'), ('invalid_results'), ('invalid_role'),
  ('invalid_school_year'), ('invalid_score'), ('invalid_status'), ('invalid_stem'),
  ('invalid_students'), ('invalid_target'), ('invalid_text_version'), ('invalid_topic'),
  ('invalid_username'), ('invalid_valid_until'), ('keep_changed'), ('key_incomplete'),
  ('missing_consent'), ('missing_questions'), ('no_answer_key'), ('no_exercises'),
  ('no_session'), ('not_a_member'), ('not_a_student'), ('not_approved'),
  ('not_author'), ('not_enrolled'), ('not_found'), ('not_published'),
  ('not_implemented'), -- temporary: phase 2 stubs; the last ticket to replace one removes it here and in reasons.ts
  ('not_submitted'), ('op_key_reused'), ('options_repeated'), ('recipient_in_other_version'),
  ('revision_mismatch'), ('revision_required'), ('role_conflict'), ('sandbox_restricted'),
  ('stale_answer_key'), ('too_many_exercises'), ('unknown_choice'), ('unknown_exercise'),
  ('unknown_option'), ('unknown_profile'), ('unknown_result_exercise'), ('unknown_support'),
  ('unknown_topic'), ('username_taken'), ('version_archived');
-- END REASONS

create temp table raised as
  select distinct m[1] as reason
    from pg_proc p, regexp_matches(p.prosrc, 'raise_error\(\s*''[A-Z_]+''\s*,\s*''([a-z][a-z0-9_]*)''', 'g') as m
   where p.pronamespace in ('api'::regnamespace, 'app'::regnamespace) and p.proname <> 'raise_error';

select is_empty($$ select reason from raised except select reason from expected $$,
  'every reason a function of api or app raises is in the list (and so has to have its text in reasons.ts)');
select is_empty($$ select reason from expected except select reason from raised $$,
  'every reason in the list is raised by some function: no text is kept for a reason nothing raises');

-- A call whose reason is not a literal cannot be read from the body. The one that exists takes it from
-- app.answer_key_content_problem, whose reasons are checked below. A new one fails here until it is justified.
select is((select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) from pg_proc p
            where p.pronamespace in ('api'::regnamespace, 'app'::regnamespace) and p.proname <> 'raise_error'
              and (select count(*) from regexp_matches(p.prosrc, 'raise_error\(', 'g'))
                  > (select count(*) from regexp_matches(p.prosrc, 'raise_error\(\s*''[A-Z_]+''\s*,\s*''[a-z][a-z0-9_]*''', 'g'))),
  array['api.edit_answer_key(uuid,jsonb,uuid)'], 'the only call with a reason that is not a literal is edit_answer_key');
select is_empty($$
  select m[1] from pg_proc p, regexp_matches(p.prosrc, 'then ''([a-z][a-z0-9_]*)''', 'g') as m
   where p.pronamespace = 'app'::regnamespace and p.proname = 'answer_key_content_problem'
  except select reason from expected $$,
  'and every reason app.answer_key_content_problem can return is in the list');
select isnt((select count(*) from raised), 0::bigint, 'control: the reader finds reasons (a body that changed shape would not make the checks above pass for free)');

select * from finish();
rollback;
