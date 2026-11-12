-- Contract, phase 1: RPC signatures for assessments, versions, generations and answer keys.
-- Stubs; see 20261111131000_rpc_identity_groups.sql for the conventions and who grants what.
-- Everything that touches a version follows app.lock_version_tree (version, generation, exercises).

-- T1.4a · assessments and their original exercises (not sensitive).
create function api.create_assessment(p_group_id uuid, p_kind text, p_topic text, p_general_instructions text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.update_assessment(p_assessment_id uuid, p_revision integer, p_kind text, p_topic text, p_general_instructions text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.archive_assessment(p_assessment_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.list_assessments(p_group_id uuid, p_include_archived boolean default false, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.get_assessment(p_assessment_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.add_exercise(p_assessment_id uuid, p_label text, p_body text, p_topic_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.update_exercise(p_exercise_id uuid, p_revision integer, p_label text, p_body text, p_topic_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.remove_exercise(p_exercise_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- CAS on the assessment's revision: the order is a property of the assessment.
create function api.reorder_exercises(p_assessment_id uuid, p_revision integer, p_exercise_ids uuid[])
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- T1.4b · versions, configuration and recipients. config and recipients are sensitive.
create function api.create_version(p_assessment_id uuid, p_config jsonb, p_answer_mode text, p_base_version_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.update_version_config(p_version_id uuid, p_revision integer, p_config jsonb, p_answer_mode text)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- Its stored event result is { id, revision } of the version: never a student id. Who was added or
-- removed goes only in the event's data, which an erasure can redact.
create function api.set_version_recipients(p_version_id uuid, p_revision integer, p_student_ids uuid[], p_op_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.archive_version(p_version_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- Projection without config, answer mode or recipients: safe for any staff listing.
create function api.list_versions(p_assessment_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- Audited: the teacher's review screen (config, recipients, adapted exercises, questions).
create function api.get_version(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- T1.4c · editing the adapted content and approving one revision. Every content change bumps the
-- version's revision too, so an approval never covers something the teacher did not see.
-- p_revision is the version's instructions_revision.
create function api.update_version_instructions(p_version_id uuid, p_revision integer, p_general_instructions text, p_op_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.update_version_exercise(p_version_exercise_id uuid, p_revision integer, p_body text, p_op_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- A question edit bumps the question, its parent exercise and the version.
create function api.update_version_question(p_question_id uuid, p_revision integer, p_stem text, p_options jsonb, p_op_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- p_revision is the key row's revision, null when the question has no key yet. Changing the correct
-- option bumps the question, its parent exercise and the version, like any other edit.
create function api.set_question_key(p_question_id uuid, p_correct_option_id text, p_revision integer default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.approve_version(p_version_id uuid, p_revision integer, p_op_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.reject_version(p_version_id uuid, p_revision integer, p_reasons text[], p_op_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- T1.4d · generations, internal (service_role). The phase 4 bridge and the phase 5 jobs call them;
-- request_generation (a user RPC, phase 5) authorizes and then calls internal_create_generation.
create function api.internal_create_generation(
  p_version_id uuid, p_kind text, p_op_key uuid, p_inputs jsonb, p_profiles_hash text, p_profiles_revision text,
  p_prompt_version text, p_required_jobs integer, p_target_exercise_id uuid default null, p_requested_by uuid default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- Always stores the output; applies it only if the generation is in force for its resource and the
-- target still has the revision the generation started from, or a later one the same generation
-- wrote (written_by_generation_id). A manual edit in between wins. Returns { outcome }.
create function api.internal_record_generation_output(p_generation_id uuid, p_kind text, p_output jsonb, p_version_exercise_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- Moves a running generation to done, failed or cancelled once; on done, one 'generated' event.
create function api.internal_finish_generation(p_generation_id uuid, p_status text, p_error_code text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- T1.4e · answer keys. Staff only, never a student. Revisions are immutable; edits and
-- confirmations append a new one, with CAS on the revision they started from.
create function api.get_answer_key(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.edit_answer_key(p_version_id uuid, p_content jsonb, p_base_revision_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- "The key is still right": a new revision with the same content, tied to today's exercise revisions.
create function api.confirm_answer_key(p_version_id uuid, p_base_revision_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.approve_answer_key(p_version_id uuid, p_revision_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- Stores the revision with its generation's input snapshot; it becomes current only if the
-- generation is in force and that snapshot still matches the version (else outcome obsolete).
create function api.internal_record_answer_key_revision(p_generation_id uuid, p_content jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.rpc_begin(); perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;
