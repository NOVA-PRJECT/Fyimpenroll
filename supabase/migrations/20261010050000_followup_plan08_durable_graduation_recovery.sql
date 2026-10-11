-- Forward repair for the initial Plan 08 draft. No live cleanup is performed.
BEGIN;
REVOKE ALL ON FUNCTION public.atomic_graduate_candidates_db(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_concluded_semester_attendance(uuid, text, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_concluded_semester_attendance(uuid, text, smallint) TO service_role;
DROP POLICY IF EXISTS "Directors can read campus graduation operations" ON public.graduation_operations;
CREATE POLICY "Directors can read campus graduation operations" ON public.graduation_operations
FOR SELECT TO authenticated USING (
  auth.jwt()->'app_metadata'->>'role' = 'superadmin' OR
  (auth.jwt()->'app_metadata'->>'role' = 'campus_director' AND
   campus_id::text = auth.jwt()->'app_metadata'->>'campus_id')
);

CREATE TABLE public.graduation_candidates (
  operation_id uuid NOT NULL REFERENCES public.graduation_operations(id) ON DELETE CASCADE,
  student_id uuid PRIMARY KEY, -- deliberately no student/Auth FK: survives cleanup
  campus_id uuid NOT NULL REFERENCES public.campuses(id),
  stage text NOT NULL DEFAULT 'pending' CHECK (stage IN ('pending','database_deleted','completed')),
  last_error_stage text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.graduation_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.graduation_candidates FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.graduation_candidates TO service_role;

CREATE FUNCTION public.prepare_graduation(p_campus_id uuid, p_student_ids uuid[], p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_operation uuid; v_ids uuid[]; v_student record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('graduation:' || p_campus_id::text));
  SELECT array_agg(DISTINCT id ORDER BY id) INTO v_ids FROM unnest(p_student_ids) id;
  IF v_ids IS NULL THEN RETURN '[]'::jsonb; END IF;
  -- Reject the entire mixed/unknown candidate list before any deletion.
  FOR v_student IN SELECT id FROM unnest(v_ids) id LOOP
    IF EXISTS (SELECT 1 FROM graduation_candidates WHERE student_id = v_student.id AND campus_id <> p_campus_id) THEN
      RAISE EXCEPTION 'Invalid graduation candidate or campus' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM graduation_candidates WHERE student_id = v_student.id AND campus_id = p_campus_id)
       AND NOT EXISTS (SELECT 1 FROM students WHERE id = v_student.id AND campus_id = p_campus_id AND current_semester = 10) THEN
      RAISE EXCEPTION 'Invalid graduation candidate or campus' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM unnest(v_ids) id WHERE NOT EXISTS (SELECT 1 FROM graduation_candidates c WHERE c.student_id = id)) THEN
    RETURN (SELECT jsonb_agg(to_jsonb(c) ORDER BY student_id) FROM graduation_candidates c WHERE student_id = ANY(v_ids));
  END IF;
  IF EXISTS (SELECT 1 FROM graduation_candidates WHERE student_id = ANY(v_ids)) THEN
    RAISE EXCEPTION 'Retry recorded candidates separately from new candidates' USING ERRCODE = '22023';
  END IF;
  INSERT INTO graduation_operations (idempotency_key, campus_id, academic_year, initiated_by, candidate_student_ids, total_candidates)
  VALUES ('grad:' || p_campus_id::text || ':' || md5(v_ids::text), p_campus_id,
    COALESCE((SELECT academic_year FROM campus_settings WHERE campus_id = p_campus_id), 'unknown'),
    p_actor_id, v_ids, cardinality(v_ids))
  ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = now() RETURNING id INTO v_operation;
  INSERT INTO graduation_candidates(operation_id, student_id, campus_id)
    SELECT v_operation, id, p_campus_id FROM unnest(v_ids) id ON CONFLICT (student_id) DO NOTHING;
  RETURN (SELECT jsonb_agg(to_jsonb(c) ORDER BY student_id) FROM graduation_candidates c WHERE student_id = ANY(v_ids));
END $$;

CREATE FUNCTION public.graduate_candidate_database(p_campus_id uuid, p_student_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_candidate graduation_candidates;
BEGIN
  SELECT * INTO STRICT v_candidate FROM graduation_candidates
    WHERE student_id = p_student_id AND campus_id = p_campus_id FOR UPDATE;
  IF v_candidate.stage <> 'pending' THEN RETURN; END IF;
  PERFORM 1 FROM students WHERE id = p_student_id AND campus_id = p_campus_id AND current_semester = 10 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Graduation candidate changed'; END IF;
  DELETE FROM students WHERE id = p_student_id;
  UPDATE graduation_candidates SET stage = 'database_deleted', last_error_stage = NULL, updated_at = now()
    WHERE student_id = p_student_id;
END $$;

CREATE FUNCTION public.finish_graduation_candidate(p_campus_id uuid, p_student_id uuid, p_error_stage text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE graduation_candidates SET stage = CASE WHEN p_error_stage IS NULL AND stage = 'database_deleted' THEN 'completed' ELSE stage END,
    last_error_stage = p_error_stage, updated_at = now()
    WHERE student_id = p_student_id AND campus_id = p_campus_id;
  UPDATE graduation_operations o SET
    graduated_count = (SELECT count(*) FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage = 'completed'),
    auth_deleted_count = (SELECT count(*) FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage = 'completed'),
    db_deleted_count = (SELECT count(*) FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage <> 'pending'),
    failed_count = (SELECT count(*) FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage <> 'completed'),
    completed_student_ids = ARRAY(SELECT student_id FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage = 'completed'),
    failed_student_ids = ARRAY(SELECT student_id FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage <> 'completed'),
    status = CASE WHEN EXISTS(SELECT 1 FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage <> 'completed') THEN 'partially_failed' ELSE 'completed' END,
    updated_at = now()
    WHERE o.id = (SELECT operation_id FROM graduation_candidates WHERE student_id = p_student_id);
END $$;
REVOKE ALL ON FUNCTION public.prepare_graduation(uuid, uuid[], uuid),
  public.graduate_candidate_database(uuid, uuid), public.finish_graduation_candidate(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_graduation(uuid, uuid[], uuid),
  public.graduate_candidate_database(uuid, uuid), public.finish_graduation_candidate(uuid, uuid, text) TO service_role;

-- Retain the existing promotion transaction/cooldown, but persist its result for retries.
CREATE TABLE public.promotion_receipts (
  campus_id uuid NOT NULL REFERENCES public.campuses(id), request_key text NOT NULL,
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(campus_id, request_key)
);
ALTER TABLE public.promotion_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.promotion_receipts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.promotion_receipts TO service_role;
ALTER FUNCTION public.promote_campus_students_atomic(uuid,uuid,text) RENAME TO promote_campus_students_once;
REVOKE ALL ON FUNCTION public.promote_campus_students_once(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.promote_campus_students_atomic(p_campus_id uuid, p_director_id uuid, p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF nullif(p_idempotency_key, '') IS NULL THEN RAISE EXCEPTION 'Request key required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('promotion:' || p_campus_id::text));
  SELECT result INTO v_result FROM promotion_receipts WHERE campus_id = p_campus_id AND request_key = p_idempotency_key;
  IF FOUND THEN RETURN v_result; END IF;
  v_result := promote_campus_students_once(p_campus_id, p_director_id, p_idempotency_key);
  INSERT INTO promotion_receipts VALUES (p_campus_id, p_idempotency_key, v_result, now());
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.promote_campus_students_atomic(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_campus_students_atomic(uuid,uuid,text) TO service_role;
INSERT INTO schema_migrations(version,name) VALUES ('20261010050000_followup_plan08_durable_graduation_recovery','Durable graduation and promotion retries') ON CONFLICT DO NOTHING;
COMMIT;
