-- Contract, phase 1: RPC signatures for publishing, attempts, grading and the student DTOs.
-- Stubs; see 20261111131000_rpc_identity_groups.sql for the conventions and who grants what.

-- T1.5a · minimal publication (no dates; phase 8 completes it). Checks the approved revision, the
-- parts its answer mode needs, the key correspondence and each recipient's consent; copies to
-- publications and creates assignments and attempts. In phase 1 so the attempt, DTO and leak
-- tests run on publications made by the real path.
create function api.publish_version(p_version_id uuid, p_revision integer, p_op_key uuid, p_answer_key_revision_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- T1.5b · the student's side of an attempt (docs/contratos/fase-1.md, «Intentos y entrega»).
-- start, save and submit all lock through app.lock_attempt_tree: assignment -> attempt -> draft.
-- open: the current attempt of an assignment, stamping first_viewed_at once.
create function api.open_attempt(p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- start: opened -> started; the assignment is the same lock publish takes.
create function api.start_attempt(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- save: CAS on the draft revision; ids must belong to the attempt's publication.
create function api.save_draft(p_attempt_id uuid, p_revision integer, p_answers jsonb, p_choices jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- submit: with the draft revision the student saw saved. Freezes; a second call changes nothing.
create function api.submit_attempt(p_attempt_id uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- T1.5c · grading, from the moment there is a submission.
-- Status per student without saying which version each one got.
create function api.list_assessment_attempts(p_assessment_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- Audited: the adapted content the student solved, their answers, the key revision and the grade.
create function api.get_attempt_for_grading(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- p_revision is the grade row's revision, null for the first grade. A grade can be feedback only.
create function api.grade_attempt(
  p_attempt_id uuid, p_feedback text, p_exercise_results jsonb, p_score integer default null, p_revision integer default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

-- T1.5d · what a student reads. Outputs are exactly the allowlists in lib/domain/delivery/student-dto.ts:
-- no profile, need, support, key, change reason, version id or other student.
create function api.student_home()
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.student_task_list()
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.student_task(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;

create function api.student_grades()
returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform app.raise_error('UNAVAILABLE', 'not_implemented'); end $$;
