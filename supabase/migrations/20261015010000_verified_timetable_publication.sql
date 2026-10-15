BEGIN;
SET LOCAL lock_timeout = '5s';

-- Some installations retain the original publication trigger alongside the
-- newer guard. Replace only the two known guard implementations, preserving
-- every unrelated trigger and all existing timetable/attendance rows.
DO $$
DECLARE old_guard record;
BEGIN
  FOR old_guard IN
    SELECT t.tgname FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'public.timetable_entries'::regclass AND NOT t.tgisinternal
      AND p.proname IN ('trg_prevent_published_timetable_mutation', 'trg_guard_published_timetable_entries')
  LOOP
    EXECUTE format('DROP TRIGGER %I ON public.timetable_entries', old_guard.tgname);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.trg_guard_published_timetable_entries()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE host_campus uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' THEN RAISE EXCEPTION 'Published timetable entries cannot be deleted'; END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
    IF ROW(NEW.id, NEW.academic_year, NEW.semester, NEW.course_id, NEW.department_id,
           NEW.campus_id, NEW.time_slot_id, NEW.session_type, NEW.is_lab_block, NEW.status, NEW.published_at)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.academic_year, OLD.semester, OLD.course_id, OLD.department_id,
           OLD.campus_id, OLD.time_slot_id, OLD.session_type, OLD.is_lab_block, OLD.status, OLD.published_at) THEN
      RAISE EXCEPTION 'Published timetable structure cannot be changed or unpublished';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(NEW.campus_id, d.campus_id) INTO host_campus
      FROM public.departments d WHERE d.id = NEW.department_id;
    IF EXISTS (SELECT 1 FROM public.timetable_entries e
      LEFT JOIN public.departments d ON d.id = e.department_id
      WHERE e.academic_year = NEW.academic_year AND e.semester = NEW.semester
        AND e.status = 'published' AND COALESCE(e.campus_id, d.campus_id) = host_campus) THEN
      RAISE EXCEPTION 'Cannot add sessions to an already published timetable';
    END IF;
  END IF;

  -- A BEFORE UPDATE trigger must return NEW: returning OLD silently discards
  -- the publication while PostgreSQL still reports a matched/updated row.
  RETURN NEW;
END $$;

CREATE TRIGGER trg_timetable_entries_published_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.timetable_entries
FOR EACH ROW EXECUTE FUNCTION public.trg_guard_published_timetable_entries();

CREATE OR REPLACE FUNCTION public.publish_timetable_cohort(p_campus_id uuid, p_academic_year text, p_semester int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  draft_hash text;
  expected_hash text;
  expected_count int;
  changed_count int;
  saved_count int;
  generation_id uuid;
  published_time timestamptz := clock_timestamp();
BEGIN
  IF p_campus_id IS NULL OR p_academic_year IS NULL OR btrim(p_academic_year) = ''
      OR p_semester IS NULL OR p_semester NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'An explicit campus, academic year and valid semester are required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('timetable:published-teacher-occupancy'));
  PERFORM pg_advisory_xact_lock(hashtext('timetable:' || p_campus_id::text || ':' || p_academic_year || ':' || p_semester::text));

  IF EXISTS (SELECT 1 FROM public.system_logs WHERE log_type = 'timetable_job' AND campus_id = p_campus_id
    AND academic_year = p_academic_year AND semester = p_semester AND status IN ('queued','running')) THEN
    RAISE EXCEPTION 'Cannot publish while timetable generation is active';
  END IF;
  IF EXISTS (SELECT 1 FROM public.timetable_entries e LEFT JOIN public.departments d ON d.id = e.department_id
    WHERE COALESCE(e.campus_id, d.campus_id) = p_campus_id AND e.academic_year = p_academic_year
      AND e.semester = p_semester AND e.status = 'published') THEN
    RAISE EXCEPTION 'This campus timetable is already published for the selected year and semester';
  END IF;
  IF EXISTS (SELECT 1 FROM public.timetable_conflicts c LEFT JOIN public.courses co ON co.id = c.course_id
    LEFT JOIN public.departments d ON d.id = co.department_id
    WHERE c.academic_year = p_academic_year AND c.semester = p_semester AND NOT c.resolved
      AND (d.campus_id = p_campus_id OR d.campus_id IS NULL)) THEN
    RAISE EXCEPTION 'Resolve timetable conflicts before publication';
  END IF;

  PERFORM id FROM public.timetable_entries WHERE campus_id = p_campus_id AND academic_year = p_academic_year
    AND semester = p_semester AND status = 'draft' FOR UPDATE;
  SELECT count(*), md5(string_agg(e::text, ',' ORDER BY e.id)) INTO expected_count, draft_hash
    FROM public.timetable_entries e WHERE e.campus_id = p_campus_id AND e.academic_year = p_academic_year
      AND e.semester = p_semester AND e.status = 'draft';
  SELECT id, metadata->>'draft_hash' INTO generation_id, expected_hash FROM public.system_logs
    WHERE log_type = 'timetable_job' AND campus_id = p_campus_id AND academic_year = p_academic_year
      AND semester = p_semester AND status = 'completed' ORDER BY completed_at DESC LIMIT 1;
  IF expected_count = 0 OR draft_hash IS NULL OR draft_hash IS DISTINCT FROM expected_hash THEN
    RAISE EXCEPTION 'No verified current draft; generate a complete timetable before publication';
  END IF;
  IF EXISTS (SELECT 1 FROM public.timetable_entries draft JOIN public.timetable_entries occupied
    ON occupied.teacher_id = draft.teacher_id AND occupied.time_slot_id = draft.time_slot_id
      AND occupied.academic_year = draft.academic_year AND occupied.status = 'published'
    WHERE draft.campus_id = p_campus_id AND draft.academic_year = p_academic_year
      AND draft.semester = p_semester AND draft.status = 'draft' AND draft.teacher_id IS NOT NULL) THEN
    RAISE EXCEPTION 'An assigned teacher is already occupied in a published class';
  END IF;

  UPDATE public.timetable_entries SET status = 'published', published_at = published_time
    WHERE campus_id = p_campus_id AND academic_year = p_academic_year AND semester = p_semester AND status = 'draft';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  SELECT count(*) INTO saved_count FROM public.timetable_entries
    WHERE campus_id = p_campus_id AND academic_year = p_academic_year AND semester = p_semester
      AND status = 'published' AND published_at = published_time;
  IF changed_count <> expected_count OR saved_count <> expected_count
      OR EXISTS (SELECT 1 FROM public.timetable_entries WHERE campus_id = p_campus_id
        AND academic_year = p_academic_year AND semester = p_semester AND status = 'draft') THEN
    RAISE EXCEPTION 'Publication did not persist every verified session; the transaction was rolled back';
  END IF;
  UPDATE public.system_logs SET metadata = metadata || jsonb_build_object('publication',
    jsonb_build_object('published_at', published_time, 'published_count', saved_count)) WHERE id = generation_id;
  RETURN jsonb_build_object('success', true, 'published_count', saved_count, 'published_at', published_time);
END $$;

REVOKE ALL ON FUNCTION public.publish_timetable_cohort(uuid,text,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_timetable_cohort(uuid,text,int) TO service_role;
INSERT INTO public.schema_migrations(version,name)
VALUES ('20261015010000_verified_timetable_publication', 'Verify saved publication and replace legacy timetable guards')
ON CONFLICT(version) DO NOTHING;
NOTIFY pgrst, 'reload schema';
COMMIT;
