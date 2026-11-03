-- Owner-run additive release. Apply after all four existing changes files.
-- Run review_preflight.sql first. Never replay semester_lifecycle.sql on an existing project.
BEGIN;
SET LOCAL lock_timeout = '10s';
DO $$ DECLARE missing text; BEGIN
 SELECT string_agg(signature||' ['||owner_sql||']', '; ' ORDER BY owner_sql,signature) INTO missing
 FROM (VALUES
  ('public.timetable_manual_context(uuid,text,integer,uuid,integer)','changes/manual_timetable.sql'),
  ('public.display_enrollment_counts(jsonb)','changes/data_read_optimization.sql'),
  ('public.display_period_status(jsonb,date)','changes/data_read_optimization.sql'),
  ('public.guard_enrollment_allocation_completion()','changes/preferences_before_allocation.sql')
 ) AS prerequisites(signature,owner_sql) WHERE to_regprocedure(signature) IS NULL;
 IF missing IS NOT NULL THEN
  RAISE EXCEPTION 'Missing prerequisite feature SQL: %', missing
   USING HINT='Run changes/review_prerequisites.sql and review_preflight.sql. Apply only missing feature releases after checking their prerequisites; do not replay semester_lifecycle.sql.';
 END IF;
END $$;
-- Every authority and scheduling dependency writer participates in the same lock order.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['teacher_course_assignments','faculty','courses','departments','timetable_entries','semester_blueprints','time_slots'] LOOP
 EXECUTE format('CREATE TRIGGER review_authority_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.lock_campus_lifecycle_writes()',tab);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.attendance_delivery_roster(p_slot_id uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(array_agg(DISTINCT s.id ORDER BY s.id),ARRAY[]::uuid[])
 FROM public.current_timetable_entries e
 JOIN public.departments d ON d.id=e.department_id
 JOIN public.current_student_registrations r ON r.campus_id=coalesce(e.campus_id,d.campus_id)
  AND r.academic_year=e.academic_year AND r.semester=e.semester
 JOIN public.students s ON s.id=r.student_id AND s.campus_id=r.campus_id AND s.current_semester=r.semester
 WHERE e.id=p_slot_id AND e.course_id=ANY(ARRAY[r.slot_1_course_id,r.slot_2_course_id,r.slot_3_course_id,
  r.slot_4_course_id,r.slot_5_course_id,r.slot_6_course_id,r.slot_7_course_id,r.slot_8_course_id]);
$$;
CREATE OR REPLACE FUNCTION public.assert_attendance_actor(p_actor uuid,p_slot uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e record; f record;
BEGIN
 SELECT te.*,coalesce(te.campus_id,d.campus_id) host INTO e FROM public.current_timetable_entries te
  JOIN public.departments d ON d.id=te.department_id WHERE te.id=p_slot;
 IF NOT FOUND THEN RAISE EXCEPTION 'Delivery not found' USING ERRCODE='P4030'; END IF;
 IF EXISTS(SELECT 1 FROM public.admins WHERE id=p_actor) THEN RETURN; END IF;
 SELECT * INTO f FROM public.faculty WHERE id=p_actor;
 IF f.role='hod' AND f.department_id=e.department_id AND f.campus_id=e.host THEN RETURN; END IF;
 IF f.role='teacher' AND EXISTS(SELECT 1 FROM public.current_teacher_course_assignments a
  WHERE a.teacher_id=p_actor AND a.course_id=e.course_id AND a.campus_id=e.host
   AND a.academic_year=e.academic_year AND a.semester=e.semester AND a.term_version=e.term_version) THEN RETURN; END IF;
 RAISE EXCEPTION 'Actor is no longer authorized for this delivery' USING ERRCODE='P4030';
END $$;
CREATE OR REPLACE FUNCTION public.atomic_submit_period_attendance(p_slot_id uuid, p_attendance_date date, p_user_id uuid, p_absent_student_ids uuid[], p_all_roster_ids uuid[], p_course_id uuid, p_expected_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_entry RECORD;
    v_host_campus_id UUID;
    v_existing_session RECORD;
    v_current_rev INTEGER := 0;
    v_new_rev INTEGER := 1;
    v_rev_token TEXT;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
    v_total_students INTEGER := cardinality(p_all_roster_ids);
    v_absent_count INTEGER := cardinality(p_absent_student_ids);
    v_present_count INTEGER;
    v_stu_id UUID;
    v_stu_status TEXT;
    v_lock_key BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
    IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
      RAISE EXCEPTION 'A nonnegative integer revision is required' USING ERRCODE='22023'; END IF;
    IF p_absent_student_ids IS NULL OR cardinality(p_absent_student_ids)>10000 OR
      EXISTS(SELECT 1 FROM unnest(p_absent_student_ids) x GROUP BY x HAVING count(*)>1) OR
      array_position(p_absent_student_ids,NULL) IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid or duplicate absentee IDs' USING ERRCODE='22023'; END IF;
    PERFORM public.assert_attendance_actor(p_user_id,p_slot_id);
    IF ARRAY(SELECT DISTINCT unnest(coalesce(p_all_roster_ids,ARRAY[]::uuid[])) ORDER BY 1)
       IS DISTINCT FROM public.attendance_delivery_roster(p_slot_id) THEN
      RAISE EXCEPTION 'ATTENDANCE_CONFLICT: roster changed; reload before submitting' USING ERRCODE='P4090'; END IF;
    p_all_roster_ids:=public.attendance_delivery_roster(p_slot_id);
    IF cardinality(p_all_roster_ids)=0 OR NOT p_absent_student_ids <@ p_all_roster_ids THEN
      RAISE EXCEPTION 'Absentee is not in the authoritative enrolled roster' USING ERRCODE='22023'; END IF;
    v_total_students:=cardinality(p_all_roster_ids);
    v_absent_count:=cardinality(p_absent_student_ids);
    -- A. Transactional advisory lock on (slot_id, attendance_date)
    v_lock_key := ('x' || substr(md5(p_slot_id::text || '_' || p_attendance_date::text), 1, 15))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- B. Verify published timetable entry exists
    SELECT te.id, te.course_id, te.status, te.academic_year, te.semester, te.campus_id, d.campus_id AS dept_campus_id
    INTO v_entry
    FROM public.current_timetable_entries te
    LEFT JOIN departments d ON d.id = te.department_id
    WHERE te.id = p_slot_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Timetable entry % not found', p_slot_id;
    END IF;

    IF v_entry.status != 'published' THEN
        RAISE EXCEPTION 'Attendance requires a published schedule (status: %) (F43)', v_entry.status;
    END IF;

    IF v_entry.course_id IS DISTINCT FROM p_course_id THEN RAISE EXCEPTION 'Course does not match delivery'; END IF;
    v_host_campus_id := COALESCE(v_entry.campus_id, v_entry.dept_campus_id);

    -- C. R28: Verify cohort is active (not retired)
    IF NOT EXISTS (SELECT 1 FROM public.campus_settings WHERE campus_id = v_host_campus_id) THEN RAISE EXCEPTION 'Campus term unavailable'; END IF;

    PERFORM public.assert_attendance_term(p_slot_id,p_attendance_date);
    -- D. R29: Query existing dated-session with FOR UPDATE
    SELECT * INTO v_existing_session
    FROM period_attendance_sessions
    WHERE timetable_slot_id = p_slot_id
      AND attendance_date = p_attendance_date
    FOR UPDATE;

    IF FOUND THEN
        v_current_rev := v_existing_session.revision;
        -- If client provided an expected revision, strictly require match
        IF p_expected_revision IS NOT NULL AND p_expected_revision > 0 THEN
            IF p_expected_revision != v_current_rev THEN
                RAISE EXCEPTION 'ATTENDANCE_CONFLICT: Session revision mismatch. Current revision is %, expected % (R29)',
                    v_current_rev, p_expected_revision;
            END IF;
        ELSIF p_expected_revision = 0 THEN
            -- Client expected first submission, but session already exists
            RAISE EXCEPTION 'ATTENDANCE_CONFLICT: Session already marked at revision % (R29)', v_current_rev;
        END IF;

        v_new_rev := v_current_rev + 1;
    ELSE
        -- No session exists: if client expected an existing revision, conflict
        IF p_expected_revision IS NOT NULL AND p_expected_revision > 0 THEN
            RAISE EXCEPTION 'ATTENDANCE_CONFLICT: Expected revision % but session is unmarked (R29)', p_expected_revision;
        END IF;
        v_new_rev := 1;
    END IF;

    v_present_count := v_total_students - v_absent_count;
    v_rev_token := md5(p_slot_id::text || '_' || p_attendance_date::text || '_' || v_new_rev::text);

    -- E. Upsert student marks atomically
    FOREACH v_stu_id IN ARRAY p_all_roster_ids
    LOOP
        IF v_stu_id = ANY(p_absent_student_ids) THEN
            v_stu_status := 'absent';
        ELSE
            v_stu_status := 'present';
        END IF;

        INSERT INTO period_attendance (
            timetable_slot_id,
            student_id,
            course_id,
            marked_by,
            status,
            marked_at,
            attendance_date,
            is_late_entry
        )
        VALUES (
            p_slot_id,
            v_stu_id,
            p_course_id,
            p_user_id,
            v_stu_status,
            v_now,
            p_attendance_date,
            false
        )
        ON CONFLICT (timetable_slot_id, student_id, attendance_date)
        DO UPDATE SET
            status = EXCLUDED.status,
            marked_by = EXCLUDED.marked_by,
            marked_at = EXCLUDED.marked_at;
    END LOOP;

    IF EXISTS(SELECT 1 FROM public.period_attendance WHERE timetable_slot_id=p_slot_id AND attendance_date=p_attendance_date
      AND NOT student_id=ANY(p_all_roster_ids)) THEN
      RAISE EXCEPTION 'ATTENDANCE_CONFLICT: saved marks contain students outside the current roster; review required'; END IF;
    SELECT count(*),count(*) FILTER(WHERE status='absent'),count(*) FILTER(WHERE status='present')
      INTO v_total_students,v_absent_count,v_present_count FROM public.period_attendance
      WHERE timetable_slot_id=p_slot_id AND attendance_date=p_attendance_date;
    INSERT INTO public.system_logs(log_type,event_type,user_id,action,resource_type,resource_id,status,metadata)
      VALUES('audit_event','period_attendance_marked',p_user_id,'submitted dated attendance','period_attendance',p_slot_id,'success',
      jsonb_build_object('attendance_date',p_attendance_date,'revision',v_new_rev));
    -- F. Upsert session revision
    INSERT INTO period_attendance_sessions (
        timetable_slot_id,
        attendance_date,
        revision,
        revision_token,
        marked_by,
        last_marked_at,
        total_students,
        present_count,
        absent_count,
        updated_at
    )
    VALUES (
        p_slot_id,
        p_attendance_date,
        v_new_rev,
        v_rev_token,
        p_user_id,
        v_now,
        v_total_students,
        v_present_count,
        v_absent_count,
        v_now
    )
    ON CONFLICT (timetable_slot_id, attendance_date)
    DO UPDATE SET
        revision = v_new_rev,
        revision_token = v_rev_token,
        marked_by = EXCLUDED.marked_by,
        last_marked_at = EXCLUDED.last_marked_at,
        total_students = EXCLUDED.total_students,
        present_count = EXCLUDED.present_count,
        absent_count = EXCLUDED.absent_count,
        updated_at = v_now;

    RETURN jsonb_build_object(
        'success', true,
        'revision', v_new_rev,
        'revision_token', v_rev_token,
        'attendance_date', p_attendance_date,
        'marked_at', v_now,
        'total_students', v_total_students,
        'present_count', v_present_count,
        'absent_count', v_absent_count
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.atomic_copy_practical_attendance(p_source_slot_id uuid, p_target_slot_id uuid, p_attendance_date date, p_user_id uuid, p_expected_target_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_src RECORD;
    v_tgt RECORD;
    v_src_campus_id UUID;
    v_tgt_campus_id UUID;
    v_src_period INTEGER;
    v_tgt_period INTEGER;
    v_tgt_session RECORD;
    v_current_tgt_rev INTEGER := 0;
    v_new_tgt_rev INTEGER := 1;
    v_tgt_rev_token TEXT;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
    v_copied_count INTEGER := 0;
    v_present_count INTEGER := 0;
    v_absent_count INTEGER := 0;
    v_lock_key BIGINT;
    v_mark RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
    IF p_expected_target_revision IS NULL OR p_expected_target_revision < 0 THEN
      RAISE EXCEPTION 'A nonnegative integer target revision is required' USING ERRCODE='22023'; END IF;
    PERFORM public.assert_attendance_actor(p_user_id,p_source_slot_id);
    PERFORM public.assert_attendance_actor(p_user_id,p_target_slot_id);
    IF public.attendance_delivery_roster(p_source_slot_id) IS DISTINCT FROM public.attendance_delivery_roster(p_target_slot_id)
      OR public.attendance_delivery_roster(p_source_slot_id) IS DISTINCT FROM
        ARRAY(SELECT student_id FROM public.period_attendance WHERE timetable_slot_id=p_source_slot_id
          AND attendance_date=p_attendance_date ORDER BY student_id) THEN
      RAISE EXCEPTION 'ATTENDANCE_CONFLICT: source marks do not cover the complete current roster'; END IF;
    -- A. Transactional advisory lock on target session
    v_lock_key := ('x' || substr(md5(p_target_slot_id::text || '_' || p_attendance_date::text), 1, 15))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- B. Query source timetable entry
    SELECT
        te.id, te.course_id, te.department_id, te.campus_id, te.academic_year,
        te.semester, te.status, te.session_type, te.is_lab_block,
        ts.day_of_week, ts.period_number,
        d.campus_id AS dept_campus_id
    INTO v_src
    FROM public.current_timetable_entries te
    JOIN time_slots ts ON ts.id = te.time_slot_id
    LEFT JOIN departments d ON d.id = te.department_id
    WHERE te.id = p_source_slot_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Source timetable entry % not found', p_source_slot_id;
    END IF;

    -- C. Query target timetable entry
    SELECT
        te.id, te.course_id, te.department_id, te.campus_id, te.academic_year,
        te.semester, te.status, te.session_type, te.is_lab_block,
        ts.day_of_week, ts.period_number,
        d.campus_id AS dept_campus_id
    INTO v_tgt
    FROM public.current_timetable_entries te
    JOIN time_slots ts ON ts.id = te.time_slot_id
    LEFT JOIN departments d ON d.id = te.department_id
    WHERE te.id = p_target_slot_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target timetable entry % not found', p_target_slot_id;
    END IF;

    -- D. R03: Validate publication status
    IF v_src.status != 'published' OR v_tgt.status != 'published' THEN
        RAISE EXCEPTION 'Both practical periods must be published (R03/F43)';
    END IF;

    -- E. R03: Validate matching course and cohort identity
    IF v_src.course_id != v_tgt.course_id THEN
        RAISE EXCEPTION 'Cannot copy practical attendance between different courses (R03)';
    END IF;

    IF v_src.department_id != v_tgt.department_id THEN
        RAISE EXCEPTION 'Cannot copy practical attendance between different departments (R03)';
    END IF;

    v_src_campus_id := COALESCE(v_src.campus_id, v_src.dept_campus_id);
    v_tgt_campus_id := COALESCE(v_tgt.campus_id, v_tgt.dept_campus_id);

    IF v_src_campus_id != v_tgt_campus_id THEN
        RAISE EXCEPTION 'Cannot copy practical attendance between different campuses (R03)';
    END IF;

    IF v_src.academic_year != v_tgt.academic_year OR v_src.semester != v_tgt.semester THEN
        RAISE EXCEPTION 'Cannot copy practical attendance between different academic years or semesters (R03)';
    END IF;

    -- F. R28: Verify cohort is not retired
    IF NOT EXISTS (SELECT 1 FROM public.campus_settings WHERE campus_id = v_src_campus_id) THEN RAISE EXCEPTION 'Campus term unavailable'; END IF;

    -- G. R03: Validate both are practical sessions
    IF NOT (v_src.is_lab_block = true OR v_src.session_type = 'practical') OR
       NOT (v_tgt.is_lab_block = true OR v_tgt.session_type = 'practical') THEN
        RAISE EXCEPTION 'Practical attendance copying is only allowed between practical / lab sessions (R03)';
    END IF;

    -- H. R03: Validate matching day of week and consecutive practical pair
    IF v_src.day_of_week != v_tgt.day_of_week THEN
        RAISE EXCEPTION 'Cannot copy practical attendance between different days of the week (R03)';
    END IF;

    PERFORM public.assert_attendance_term(p_source_slot_id,p_attendance_date);
    PERFORM public.assert_attendance_term(p_target_slot_id,p_attendance_date);
    v_src_period := v_src.period_number;
    v_tgt_period := v_tgt.period_number;

    -- Strictly forbid lunch-crossing pair (Period 3 to Period 4)
    IF v_src_period = 3 AND v_tgt_period = 4 THEN
        RAISE EXCEPTION 'Cannot copy practical attendance across lunch boundary (Period 3 to Period 4 is forbidden) (R03)';
    END IF;

    -- Validate adjacent consecutive lab pair in domain: (1, 2), (2, 3), (4, 5), (5, 6)
    IF NOT (
        (v_src_period = 1 AND v_tgt_period = 2) OR
        (v_src_period = 2 AND v_tgt_period = 3) OR
        (v_src_period = 4 AND v_tgt_period = 5) OR
        (v_src_period = 5 AND v_tgt_period = 6)
    ) THEN
        RAISE EXCEPTION 'Invalid practical period pair (Period % to %). Practical copying requires an adjacent consecutive lab pair (R03)',
            v_src_period, v_tgt_period;
    END IF;

    -- I. Fetch source marks
    IF NOT EXISTS (
        SELECT 1 FROM period_attendance
        WHERE timetable_slot_id = p_source_slot_id
          AND attendance_date = p_attendance_date
    ) THEN
        RAISE EXCEPTION 'Source practical period has no attendance recorded for % (R03)', p_attendance_date;
    END IF;

    -- J. R29: Query target session revision
    SELECT * INTO v_tgt_session
    FROM period_attendance_sessions
    WHERE timetable_slot_id = p_target_slot_id
      AND attendance_date = p_attendance_date
    FOR UPDATE;

    IF FOUND THEN
        v_current_tgt_rev := v_tgt_session.revision;
        IF p_expected_target_revision IS NOT NULL AND p_expected_target_revision > 0 THEN
            IF p_expected_target_revision != v_current_tgt_rev THEN
                RAISE EXCEPTION 'ATTENDANCE_CONFLICT: Target session revision mismatch. Current revision is %, expected % (R29)',
                    v_current_tgt_rev, p_expected_target_revision;
            END IF;
        ELSIF p_expected_target_revision = 0 THEN
            RAISE EXCEPTION 'ATTENDANCE_CONFLICT: Target period already marked at revision %. Provide expected revision to overwrite (R29)',
                v_current_tgt_rev;
        END IF;

        v_new_tgt_rev := v_current_tgt_rev + 1;
    ELSE
        IF p_expected_target_revision IS NOT NULL AND p_expected_target_revision > 0 THEN
            RAISE EXCEPTION 'ATTENDANCE_CONFLICT: Expected target revision % but target session is unmarked (R29)',
                p_expected_target_revision;
        END IF;
        v_new_tgt_rev := 1;
    END IF;

    v_tgt_rev_token := md5(p_target_slot_id::text || '_' || p_attendance_date::text || '_' || v_new_tgt_rev::text);

    -- K. Atomically duplicate marks into target period
    FOR v_mark IN (
        SELECT student_id, course_id, status
        FROM period_attendance
        WHERE timetable_slot_id = p_source_slot_id
          AND attendance_date = p_attendance_date
    ) LOOP
        INSERT INTO period_attendance (
            timetable_slot_id,
            student_id,
            course_id,
            marked_by,
            status,
            marked_at,
            attendance_date,
            is_late_entry
        )
        VALUES (
            p_target_slot_id,
            v_mark.student_id,
            v_mark.course_id,
            p_user_id,
            v_mark.status,
            v_now,
            p_attendance_date,
            false
        )
        ON CONFLICT (timetable_slot_id, student_id, attendance_date)
        DO UPDATE SET
            status = EXCLUDED.status,
            marked_by = EXCLUDED.marked_by,
            marked_at = EXCLUDED.marked_at;

        v_copied_count := v_copied_count + 1;
        IF v_mark.status = 'present' THEN
            v_present_count := v_present_count + 1;
        ELSE
            v_absent_count := v_absent_count + 1;
        END IF;
    END LOOP;

    IF EXISTS(SELECT 1 FROM public.period_attendance WHERE timetable_slot_id=p_target_slot_id AND attendance_date=p_attendance_date
      AND NOT student_id=ANY(public.attendance_delivery_roster(p_target_slot_id))) THEN
      RAISE EXCEPTION 'ATTENDANCE_CONFLICT: saved target roster changed; review required'; END IF;
    INSERT INTO public.system_logs(log_type,event_type,user_id,action,resource_type,resource_id,status,metadata)
      VALUES('audit_event','period_attendance_copied',p_user_id,'copied dated practical attendance','period_attendance',p_target_slot_id,'success',
      jsonb_build_object('source_slot_id',p_source_slot_id,'attendance_date',p_attendance_date,'revision',v_new_tgt_rev));
    -- L. Upsert target session revision
    INSERT INTO period_attendance_sessions (
        timetable_slot_id,
        attendance_date,
        revision,
        revision_token,
        marked_by,
        last_marked_at,
        total_students,
        present_count,
        absent_count,
        updated_at
    )
    VALUES (
        p_target_slot_id,
        p_attendance_date,
        v_new_tgt_rev,
        v_tgt_rev_token,
        p_user_id,
        v_now,
        v_copied_count,
        v_present_count,
        v_absent_count,
        v_now
    )
    ON CONFLICT (timetable_slot_id, attendance_date)
    DO UPDATE SET
        revision = v_new_tgt_rev,
        revision_token = v_tgt_rev_token,
        marked_by = EXCLUDED.marked_by,
        last_marked_at = EXCLUDED.last_marked_at,
        total_students = EXCLUDED.total_students,
        present_count = EXCLUDED.present_count,
        absent_count = EXCLUDED.absent_count,
        updated_at = v_now;

    RETURN jsonb_build_object(
        'success', true,
        'copied_count', v_copied_count,
        'present_count', v_present_count,
        'absent_count', v_absent_count,
        'target_revision', v_new_tgt_rev,
        'target_revision_token', v_tgt_rev_token,
        'attendance_date', p_attendance_date,
        'marked_at', v_now
    );
END;
$function$;

-- NOT VALID preserves existing records for owner review, while protecting every new/updated summary.
ALTER TABLE public.period_attendance_sessions ADD CONSTRAINT review_attendance_totals
 CHECK(total_students>=0 AND present_count>=0 AND absent_count>=0 AND present_count+absent_count=total_students) NOT VALID;
ALTER TABLE public.campus_settings ADD CONSTRAINT review_credit_range CHECK(min_credits>=0 AND max_credits>=min_credits) NOT VALID;
ALTER TABLE public.faculty ADD CONSTRAINT review_teacher_department CHECK(role<>'teacher' OR department_id IS NOT NULL) NOT VALID;
DO $$ DECLARE f regprocedure; BEGIN
 FOREACH f IN ARRAY ARRAY['public.attendance_delivery_roster(uuid)'::regprocedure,'public.assert_attendance_actor(uuid,uuid)'::regprocedure,
 'public.atomic_submit_period_attendance(uuid,date,uuid,uuid[],uuid[],uuid,integer)'::regprocedure,
 'public.atomic_copy_practical_attendance(uuid,uuid,date,uuid,integer)'::regprocedure] LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f);
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
