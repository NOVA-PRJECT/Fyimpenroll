-- Apply only with the matching application release and a verified recovery backup.
-- Owner-run migration: run this complete file once in the Supabase SQL Editor as postgres.
-- No Supabase CLI installation is required. Follow SEMESTER_LIFECYCLE_ROLLOUT.md.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(76102622134917::bigint);

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.system_logs WHERE log_type IN ('allocation_run','timetable_job') AND status IN ('queued','running')) THEN
   RAISE EXCEPTION 'Drain allocation and timetable workers before lifecycle migration';
 END IF;
 IF EXISTS(SELECT 1 FROM public.graduation_candidates WHERE stage <> 'completed') THEN
   RAISE EXCEPTION 'Resolve unfinished staged graduation accounts before dropping recovery records';
 END IF;
END $$;

ALTER TABLE public.students DROP CONSTRAINT students_current_semester_check;
ALTER TABLE public.students ADD CONSTRAINT students_current_semester_check CHECK(current_semester BETWEEN 1 AND 11);
ALTER TABLE public.campus_settings ADD COLUMN term_version integer NOT NULL DEFAULT 0 CHECK(term_version>=0);
ALTER TABLE public.campus_settings ADD COLUMN term_started_at timestamptz;
UPDATE public.campus_settings SET term_started_at=last_promoted_at;
ALTER TABLE public.student_registrations ADD COLUMN term_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.timetable_entries ADD COLUMN term_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.teacher_course_assignments ADD COLUMN term_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.system_logs ADD COLUMN term_version integer NOT NULL DEFAULT 0;

CREATE FUNCTION public.campus_term_version(p_campus uuid) RETURNS integer LANGUAGE sql STABLE
SET search_path=pg_catalog,public,pg_temp AS $$ SELECT term_version FROM public.campus_settings WHERE campus_id=p_campus $$;

CREATE VIEW public.current_student_registrations WITH (security_invoker=true) AS
 SELECT r.* FROM public.student_registrations r WHERE r.term_version=public.campus_term_version(r.campus_id)
 AND r.academic_year=(SELECT s.academic_year FROM public.campus_settings s WHERE s.campus_id=r.campus_id);
CREATE VIEW public.current_timetable_entries WITH (security_invoker=true) AS
 SELECT r.* FROM public.timetable_entries r WHERE r.term_version=public.campus_term_version(coalesce(r.campus_id,(SELECT d.campus_id FROM public.departments d WHERE d.id=r.department_id)))
 AND r.academic_year=(SELECT s.academic_year FROM public.campus_settings s WHERE s.campus_id=coalesce(r.campus_id,(SELECT d.campus_id FROM public.departments d WHERE d.id=r.department_id)));
CREATE VIEW public.current_teacher_course_assignments WITH (security_invoker=true) AS
 SELECT r.* FROM public.teacher_course_assignments r WHERE r.term_version=public.campus_term_version(r.campus_id)
 AND r.academic_year=(SELECT s.academic_year FROM public.campus_settings s WHERE s.campus_id=r.campus_id);
CREATE VIEW public.current_system_logs WITH (security_invoker=true) AS
 SELECT r.* FROM public.system_logs r WHERE r.term_version=public.campus_term_version(r.campus_id)
 AND r.academic_year=(SELECT s.academic_year FROM public.campus_settings s WHERE s.campus_id=r.campus_id);
REVOKE ALL ON public.current_student_registrations,public.current_timetable_entries,public.current_teacher_course_assignments,public.current_system_logs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.current_student_registrations,public.current_timetable_entries,public.current_teacher_course_assignments,public.current_system_logs TO service_role;
GRANT DELETE ON public.current_timetable_entries,public.current_teacher_course_assignments TO service_role;
GRANT UPDATE,DELETE ON public.current_system_logs TO service_role;
GRANT UPDATE ON public.current_teacher_course_assignments TO service_role;

ALTER TABLE public.student_registrations DROP CONSTRAINT student_registrations_student_id_semester_academic_year_key;
ALTER TABLE public.student_registrations ADD UNIQUE(student_id,semester,academic_year,term_version);
ALTER TABLE public.teacher_course_assignments DROP CONSTRAINT uq_teacher_course_assignments_term;
ALTER TABLE public.teacher_course_assignments ADD UNIQUE(teacher_id,course_id,campus_id,academic_year,semester,term_version);
DROP INDEX public.timetable_entries_delivery_unique;
CREATE UNIQUE INDEX timetable_entries_delivery_unique ON public.timetable_entries(campus_id,academic_year,semester,course_id,time_slot_id,department_id,term_version) NULLS NOT DISTINCT;
CREATE INDEX lifecycle_registration_term ON public.student_registrations(campus_id,term_version,academic_year,semester);
CREATE INDEX lifecycle_timetable_term ON public.timetable_entries(campus_id,term_version,academic_year,semester);
CREATE INDEX lifecycle_assignment_term ON public.teacher_course_assignments(campus_id,term_version,academic_year,semester);
CREATE INDEX lifecycle_worker_term ON public.system_logs(campus_id,term_version,log_type,status);

-- A single lock order covers lifecycle transitions, direct writes and RPCs.
CREATE FUNCTION public.lock_campus_lifecycle_writes() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(76102622134917::bigint); RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['students','campus_settings','student_registrations','registration_preferences','period_attendance','period_attendance_sessions','campus_sign_ins','system_logs'] LOOP
  EXECUTE format('CREATE TRIGGER lifecycle_write_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.lock_campus_lifecycle_writes()',t);
 END LOOP;
END $$;

CREATE FUNCTION public.guard_term_record() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE host uuid; version integer; kind text;
BEGIN
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 host:=NEW.campus_id;
 IF TG_TABLE_NAME='timetable_entries' AND host IS NULL THEN
  SELECT campus_id INTO host FROM public.departments WHERE id=NEW.department_id;
 END IF;
 SELECT term_version INTO version FROM public.campus_settings WHERE campus_id=host;
 IF TG_TABLE_NAME='system_logs' THEN
  kind:=NEW.log_type;
  IF kind NOT IN ('allocation_run','timetable_job') THEN RETURN NEW; END IF;
 END IF;
 IF version IS NULL THEN RAISE EXCEPTION 'Campus term is unavailable' USING ERRCODE='P4090'; END IF;
 IF NEW.academic_year IS DISTINCT FROM (SELECT academic_year FROM public.campus_settings WHERE campus_id=host) THEN
  RAISE EXCEPTION 'Academic year changed; reload the portal' USING ERRCODE='P4090';
 END IF;
 IF TG_OP='INSERT' THEN NEW.term_version:=version;
 ELSIF OLD.term_version IS DISTINCT FROM version THEN
  RAISE EXCEPTION 'Concluded-term records cannot be changed' USING ERRCODE='P4090';
 ELSIF NEW.term_version IS DISTINCT FROM OLD.term_version THEN
  RAISE EXCEPTION 'Term identity is immutable' USING ERRCODE='P4090';
 END IF;
 IF TG_TABLE_NAME='student_registrations' THEN
  IF NOT EXISTS(SELECT 1 FROM public.students WHERE id=NEW.student_id AND campus_id=NEW.campus_id AND current_semester=NEW.semester AND current_semester BETWEEN 1 AND 10) THEN
   RAISE EXCEPTION 'Registration requires the student active semester' USING ERRCODE='P4090';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_stamp_registration_term BEFORE INSERT OR UPDATE ON public.student_registrations FOR EACH ROW EXECUTE FUNCTION public.guard_term_record();
CREATE TRIGGER a_stamp_timetable_term BEFORE INSERT OR UPDATE ON public.timetable_entries FOR EACH ROW EXECUTE FUNCTION public.guard_term_record();
CREATE TRIGGER a_stamp_assignment_term BEFORE INSERT OR UPDATE ON public.teacher_course_assignments FOR EACH ROW EXECUTE FUNCTION public.guard_term_record();
CREATE TRIGGER a_stamp_worker_term BEFORE INSERT OR UPDATE ON public.system_logs FOR EACH ROW EXECUTE FUNCTION public.guard_term_record();

CREATE FUNCTION public.assert_attendance_term(p_entry uuid,p_date date) RETURNS void LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE boundary timestamptz;
BEGIN
 SELECT s.term_started_at INTO boundary FROM public.current_timetable_entries e
 JOIN public.campus_settings s ON s.campus_id=coalesce(e.campus_id,(SELECT campus_id FROM public.departments WHERE id=e.department_id))
 WHERE e.id=p_entry AND e.status='published';
 IF NOT FOUND OR p_date IS NULL OR p_date>(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
 OR (boundary IS NOT NULL AND p_date<(boundary AT TIME ZONE 'Asia/Kolkata')::date) THEN
  RAISE EXCEPTION 'Attendance belongs to a concluded or invalid term' USING ERRCODE='P4090';
 END IF;
END $$;

CREATE FUNCTION public.guard_active_attendance() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 PERFORM public.assert_attendance_term(NEW.timetable_slot_id,NEW.attendance_date);
 IF TG_TABLE_NAME='period_attendance' THEN
  IF NOT EXISTS(SELECT 1 FROM public.students s JOIN public.current_student_registrations r ON r.student_id=s.id
    JOIN public.current_timetable_entries e ON e.id=NEW.timetable_slot_id AND e.course_id=NEW.course_id
     AND e.semester=r.semester AND e.academic_year=r.academic_year
    WHERE s.id=NEW.student_id AND s.current_semester=e.semester AND s.current_semester BETWEEN 1 AND 10
     AND e.course_id=ANY(ARRAY[r.slot_1_course_id,r.slot_2_course_id,r.slot_3_course_id,r.slot_4_course_id,r.slot_5_course_id,r.slot_6_course_id,r.slot_7_course_id,r.slot_8_course_id])) THEN
   RAISE EXCEPTION 'Student is no longer enrolled in this active class; reload the roster' USING ERRCODE='P4090';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_attendance_term BEFORE INSERT OR UPDATE ON public.period_attendance FOR EACH ROW EXECUTE FUNCTION public.guard_active_attendance();
CREATE TRIGGER a_attendance_session_term BEFORE INSERT OR UPDATE ON public.period_attendance_sessions FOR EACH ROW EXECUTE FUNCTION public.guard_active_attendance();

CREATE FUNCTION public.guard_active_student_write() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$ DECLARE st public.students; boundary timestamptz; BEGIN
 SELECT * INTO st FROM public.students WHERE id=NEW.student_id;
 IF NOT FOUND OR st.current_semester NOT BETWEEN 1 AND 10 THEN
  RAISE EXCEPTION 'Completed students cannot register or sign in' USING ERRCODE='P4090';
 END IF;
 IF TG_TABLE_NAME='registration_preferences' THEN
  IF NEW.semester<>st.current_semester OR NEW.campus_id<>st.campus_id THEN
   RAISE EXCEPTION 'Student term changed; reload the portal' USING ERRCODE='P4090';
  END IF;
 END IF;
 IF TG_TABLE_NAME='campus_sign_ins' THEN
  SELECT term_started_at INTO boundary FROM public.campus_settings WHERE campus_id=st.campus_id;
  IF NEW.campus_id<>st.campus_id OR NEW.signed_in_at<boundary THEN RAISE EXCEPTION 'Sign-in belongs to a concluded term' USING ERRCODE='P4090'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_preference_student_term BEFORE INSERT OR UPDATE ON public.registration_preferences FOR EACH ROW EXECUTE FUNCTION public.guard_active_student_write();
CREATE TRIGGER a_signin_student_term BEFORE INSERT OR UPDATE ON public.campus_sign_ins FOR EACH ROW EXECUTE FUNCTION public.guard_active_student_write();

CREATE FUNCTION public.guard_completed_student() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF OLD.current_semester=11 AND NEW.current_semester<>11 THEN
  RAISE EXCEPTION 'A completed student cannot be returned to active study through ordinary edits' USING ERRCODE='23514';
 END IF;
 IF NEW.current_semester=11 AND OLD.current_semester<>11
 AND current_setting('app.promoting_campus',true) IS DISTINCT FROM NEW.campus_id::text THEN
  RAISE EXCEPTION 'Only semester promotion can move an active student to semester 11' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_completed_student BEFORE UPDATE OF current_semester ON public.students FOR EACH ROW EXECUTE FUNCTION public.guard_completed_student();

-- Transactional routine replacements are appended below by the authoring script.
-- Active-term variants of existing transactional routines. Historical tables stay intact.
CREATE OR REPLACE FUNCTION public.apply_course_allocation(p_run_id uuid, p_campus_id uuid, p_academic_year text, p_semester smallint, p_allocations jsonb, p_unallocated jsonb DEFAULT '[]'::jsonb, p_summary jsonb DEFAULT '{}'::jsonb, p_fencing_token uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    item RECORD;
    v_run_rec RECORD;
    v_published_count INT;
    v_student_id UUID;
    v_reg_id UUID;
    v_slot_key TEXT;
    v_course_id UUID;
    v_meta JSONB;
    v_sql TEXT;
    v_course_rec RECORD;
    v_existing_count INT;
    v_active_token UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
    PERFORM pg_advisory_xact_lock(hashtext('timetable:' || p_campus_id::text || ':' || p_academic_year || ':' || p_semester::text));
    PERFORM pg_advisory_xact_lock(hashtext('allocation_claim_' || p_campus_id::text || '_' || p_academic_year || '_' || p_semester::text));
    IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' OR p_unallocated IS NULL OR jsonb_typeof(p_unallocated) <> 'array'
      OR p_summary IS NULL OR jsonb_typeof(p_summary) <> 'object' THEN RAISE EXCEPTION 'Invalid allocation payload'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_allocations) a GROUP BY a->>'student_id',a->>'slot_key' HAVING count(*)>1) THEN
      RAISE EXCEPTION 'Duplicate allocation for a student slot'; END IF;
    -- 1. Validate run exists, matches cohort, and is running
    SELECT * INTO v_run_rec
    FROM public.current_system_logs
    WHERE id = p_run_id
      AND log_type = 'allocation_run'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Allocation run record % not found', p_run_id;
    END IF;

    IF v_run_rec.campus_id IS DISTINCT FROM p_campus_id OR
       v_run_rec.academic_year IS DISTINCT FROM p_academic_year OR
       v_run_rec.semester IS DISTINCT FROM p_semester THEN
        RAISE EXCEPTION 'Allocation run % does not match cohort (% / % / %)',
            p_run_id, p_campus_id, p_academic_year, p_semester;
    END IF;

    IF v_run_rec.status <> 'running' THEN
        RAISE EXCEPTION 'Allocation run % is not currently running (status: %)', p_run_id, v_run_rec.status;
    END IF;

    v_active_token := (v_run_rec.metadata->>'fencing_token')::uuid;
    IF p_fencing_token IS NULL OR v_active_token IS DISTINCT FROM p_fencing_token
       OR v_run_rec.started_at IS NULL OR v_run_rec.started_at <= now() - (COALESCE((v_run_rec.metadata->>'lease_seconds')::int,300) * interval '1 second') THEN
      RAISE EXCEPTION 'Missing, stale or expired allocation worker claim';
    END IF;

    -- 2. Verify cohort timetable is unpublished for THIS host campus (R15)
    SELECT count(*) INTO v_published_count
    FROM public.current_timetable_entries
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND campus_id = p_campus_id
      AND status = 'published';

    IF v_published_count > 0 THEN
        RAISE EXCEPTION 'Timetable has already been published for this cohort. Allocation commit is locked.';
    END IF;

    -- 3. Validate slot keys and student campus membership
    FOR item IN SELECT value FROM jsonb_array_elements(p_allocations)
    LOOP
        v_slot_key := item.value->>'slot_key';
        IF v_slot_key IS NULL OR v_slot_key NOT IN ('slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5', 'slot_6', 'slot_7', 'slot_8') THEN
            RAISE EXCEPTION 'Invalid slot_key: % in allocations', v_slot_key;
        END IF;

        v_course_id := (item.value->>'course_id')::UUID;
        IF v_course_id IS NULL OR NOT EXISTS (SELECT 1 FROM courses WHERE id = v_course_id) THEN
            RAISE EXCEPTION 'Allocation must reference an existing course';
        END IF;

        v_student_id := (item.value->>'student_id')::UUID;
        IF NOT EXISTS (
            SELECT 1 FROM public.current_student_registrations
            WHERE student_id = v_student_id AND campus_id = p_campus_id AND academic_year = p_academic_year AND semester = p_semester
        ) THEN
            RAISE EXCEPTION 'Student % does not belong to campus %', v_student_id, p_campus_id;
        END IF;
    END LOOP;

    -- 4. Deterministically lock all courses involved in this allocation
    PERFORM id FROM courses
    WHERE id IN (
        SELECT DISTINCT (value->>'course_id')::UUID
        FROM jsonb_array_elements(p_allocations)
        WHERE (value->>'course_id') IS NOT NULL
    )
    ORDER BY id
    FOR UPDATE;

    -- 5. Enforce global capacity across ALL campuses
    FOR v_course_rec IN (
        SELECT
            c.id,
            c.course_code,
            c.title,
            COALESCE(c.seat_limit, 60) AS seat_limit,
            count(a.value) AS newly_allocated_count
        FROM jsonb_array_elements(p_allocations) a
        JOIN courses c ON c.id = (a.value->>'course_id')::UUID
        GROUP BY c.id, c.course_code, c.title, c.seat_limit
    )
    LOOP
        -- Count the resulting distinct enrollments, including fixed slots of students
        -- receiving other allocations; excluding all affected students undercounts seats.
        SELECT count(DISTINCT r.student_id) INTO v_existing_count FROM public.current_student_registrations r
        CROSS JOIN LATERAL (VALUES ('slot_1',r.slot_1_course_id),('slot_2',r.slot_2_course_id),('slot_3',r.slot_3_course_id),
          ('slot_4',r.slot_4_course_id),('slot_5',r.slot_5_course_id),('slot_6',r.slot_6_course_id),('slot_7',r.slot_7_course_id),('slot_8',r.slot_8_course_id)) old(slot_key,course_id)
        LEFT JOIN LATERAL (SELECT (a->>'course_id')::uuid course_id FROM jsonb_array_elements(p_allocations) a
          WHERE (a->>'student_id')::uuid=r.student_id AND a->>'slot_key'=old.slot_key) incoming ON true
        WHERE r.academic_year=p_academic_year AND r.semester=p_semester AND COALESCE(incoming.course_id,old.course_id)=v_course_rec.id;
        IF v_existing_count > v_course_rec.seat_limit THEN
          RAISE EXCEPTION 'Course % (%) exceeds global capacity: % resulting students > % limit',
            v_course_rec.course_code,v_course_rec.title,v_existing_count,v_course_rec.seat_limit;
        END IF;
    END LOOP;

    -- 6. Apply individual allocations atomically to student_registrations
    FOR item IN SELECT value FROM jsonb_array_elements(p_allocations)
    LOOP
        v_student_id := (item.value->>'student_id')::UUID;
        v_slot_key   := item.value->>'slot_key';
        v_course_id  := (item.value->>'course_id')::UUID;

        SELECT id, allocation_metadata INTO v_reg_id, v_meta
        FROM public.current_student_registrations
        WHERE student_id = v_student_id
          AND campus_id = p_campus_id
          AND academic_year = p_academic_year
          AND semester = p_semester;

        IF v_reg_id IS NOT NULL THEN
            v_meta := COALESCE(v_meta, '{}'::jsonb);
            v_meta := jsonb_set(
                v_meta,
                ARRAY[v_slot_key],
                jsonb_build_object(
                    'course_id', v_course_id,
                    'allocated_by', COALESCE(item.value->>'allocated_by', 'elective_run'),
                    'run_id', p_run_id,
                    'allocated_at', now()
                ),
                true
            );

            v_sql := format(
                'UPDATE student_registrations SET %I = $1, allocation_metadata = $2 WHERE id = $3',
                v_slot_key || '_course_id'
            );
            EXECUTE v_sql USING v_course_id, v_meta, v_reg_id;
        END IF;
    END LOOP;

    -- Update the credit total from the resulting snapshot-backed enrollment.
    UPDATE student_registrations r SET total_credits=(
      SELECT COALESCE(sum(COALESCE((snapshot.value->>'credits')::numeric,c.credits)),0)
      FROM unnest(ARRAY[r.slot_1_course_id,r.slot_2_course_id,r.slot_3_course_id,r.slot_4_course_id,r.slot_5_course_id,r.slot_6_course_id,r.slot_7_course_id,r.slot_8_course_id]) selected(course_id)
      JOIN courses c ON c.id=selected.course_id LEFT JOIN LATERAL (
        SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.selections)='array' THEN r.selections ELSE '[]'::jsonb END)
        WHERE value->>'course_id'=c.id::text LIMIT 1) snapshot ON true)
      WHERE r.term_version=public.campus_term_version(r.campus_id) AND r.campus_id=p_campus_id AND r.academic_year=p_academic_year AND r.semester=p_semester
        AND r.student_id IN (SELECT (a->>'student_id')::uuid FROM jsonb_array_elements(p_allocations) a);
    -- 7. Mark allocation run completed in system_logs
    UPDATE system_logs
    SET status = 'completed',
        completed_at = now(),
        metadata = jsonb_build_object(
            'allocated_count', jsonb_array_length(p_allocations),
            'unallocated_count', jsonb_array_length(p_unallocated),
            'unallocated_students', p_unallocated,
            'summary', p_summary,
            'fencing_token', v_run_rec.metadata->>'fencing_token'
        ) || p_summary,
        updated_at = now()
    WHERE id = p_run_id;

    RETURN jsonb_build_object(
        'success', true,
        'run_id', p_run_id,
        'allocated_count', jsonb_array_length(p_allocations),
        'unallocated_count', jsonb_array_length(p_unallocated),
        'completed_at', now()
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.atomic_copy_practical_attendance(p_source_slot_id uuid, p_target_slot_id uuid, p_attendance_date date, p_user_id uuid, p_expected_target_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
$function$
;

CREATE OR REPLACE FUNCTION public.atomic_replace_timetable_draft(p_campus_id uuid, p_academic_year text, p_semester integer, p_entries jsonb, p_job_id uuid, p_fencing_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_published_count INT;
    v_inserted_count INT := 0;
    v_entry JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
    IF p_campus_id IS NULL THEN RAISE EXCEPTION 'An explicit campus is required'; END IF;
    -- Acquire transaction-level advisory lock on this cohort
    PERFORM pg_advisory_xact_lock(hashtext('timetable:' || COALESCE(p_campus_id::text, 'all') || ':' || p_academic_year || ':' || p_semester::text));

    -- Check if cohort is already published
    SELECT COUNT(*)
    INTO v_published_count
    FROM public.current_timetable_entries
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND status = 'published'
      AND (
          campus_id = p_campus_id
          OR (campus_id IS NULL AND department_id IN (
              SELECT d.id FROM public.departments d WHERE d.campus_id = p_campus_id
          ))
      );

    IF v_published_count > 0 THEN
        RAISE EXCEPTION 'Cannot replace draft: cohort % Sem % for campus % is already published (R22)',
            p_academic_year, p_semester, COALESCE(p_campus_id::text, 'all');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.current_system_logs WHERE id = p_job_id AND log_type = 'timetable_job'
        AND status = 'running' AND campus_id = p_campus_id
        AND academic_year = p_academic_year AND semester = p_semester
        AND metadata->>'fencing_token' = p_fencing_token::text
        AND updated_at > now() - (COALESCE((metadata->>'lease_seconds')::int,600) * interval '1 second')
        FOR UPDATE
    ) THEN RAISE EXCEPTION 'Missing, stale or expired worker claim'; END IF;
    IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 THEN
        RAISE EXCEPTION 'A complete nonempty draft is required';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_entries) e
        WHERE (e->>'campus_id')::uuid IS DISTINCT FROM p_campus_id
        OR e->>'academic_year' IS DISTINCT FROM p_academic_year
        OR (e->>'semester')::int IS DISTINCT FROM p_semester) THEN
        RAISE EXCEPTION 'Draft entries do not match the claimed cohort';
    END IF;

    -- Atomically delete all existing draft entries for this cohort
    DELETE FROM public.current_timetable_entries
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND status = 'draft'
      AND (
          campus_id = p_campus_id
          OR (campus_id IS NULL AND department_id IN (
              SELECT d.id FROM public.departments d WHERE d.campus_id = p_campus_id
          ))
      );

    -- Insert all new staged draft entries from JSONB array
    IF p_entries IS NOT NULL AND jsonb_array_length(p_entries) > 0 THEN
        INSERT INTO timetable_entries (
            academic_year,
            semester,
            course_id,
            department_id,
            campus_id,
            time_slot_id,
            session_type,
            is_lab_block,
            teacher_id,
            status
        )
        SELECT
            (e->>'academic_year')::text,
            (e->>'semester')::int,
            (e->>'course_id')::uuid,
            (e->>'department_id')::uuid,
            (CASE WHEN e->>'campus_id' IS NOT NULL THEN (e->>'campus_id')::uuid ELSE NULL END),
            (e->>'time_slot_id')::uuid,
            (e->>'session_type')::text,
            COALESCE((e->>'is_lab_block')::boolean, false),
            (CASE WHEN e->>'teacher_id' IS NOT NULL THEN (e->>'teacher_id')::uuid ELSE NULL END),
            'draft'
        FROM jsonb_array_elements(p_entries) AS e;

        GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    END IF;

    UPDATE system_logs SET status = 'completed', progress = 100, completed_at = now(), updated_at = now(),
        metadata = metadata || jsonb_build_object('draft_hash', (
            SELECT md5(string_agg(e::text, ',' ORDER BY e.id)) FROM public.current_timetable_entries e
            WHERE e.campus_id = p_campus_id AND e.academic_year = p_academic_year
            AND e.semester = p_semester AND e.status = 'draft'
        )) WHERE id = p_job_id;
    RETURN jsonb_build_object(
        'success', true,
        'inserted_count', v_inserted_count,
        'academic_year', p_academic_year,
        'semester', p_semester,
        'campus_id', p_campus_id
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.atomic_submit_period_attendance(p_slot_id uuid, p_attendance_date date, p_user_id uuid, p_absent_student_ids uuid[], p_all_roster_ids uuid[], p_course_id uuid, p_expected_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
    -- A. Transactional advisory lock on (slot_id, attendance_date)
    v_lock_key := ('x' || substr(md5(p_slot_id::text || '_' || p_attendance_date::text), 1, 15))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- B. Verify published timetable entry exists
    SELECT te.id, te.status, te.academic_year, te.semester, te.campus_id, d.campus_id AS dept_campus_id
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
$function$
;

CREATE OR REPLACE FUNCTION public.claim_allocation_run(p_campus_id uuid, p_academic_year text, p_semester smallint, p_user_id uuid, p_lease_seconds integer DEFAULT 300, p_fencing_token uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_deadline TIMESTAMPTZ;
    v_published_count INT;
    v_completed_run_id UUID;
    v_active_run RECORD;
    v_run_id UUID;
    v_fencing_token UUID;
    v_meta JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
    IF p_campus_id IS NULL OR p_academic_year IS NULL OR btrim(p_academic_year) = '' OR p_semester IS NULL OR p_semester NOT BETWEEN 1 AND 10
       OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 60 AND 1800 THEN RAISE EXCEPTION 'Invalid allocation cohort or lease'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('timetable:' || p_campus_id::text || ':' || p_academic_year || ':' || p_semester::text));
    -- R16: Acquire transactional advisory lock for this campus cohort
    PERFORM pg_advisory_xact_lock(
        hashtext('allocation_claim_' || p_campus_id::text || '_' || p_academic_year || '_' || p_semester::text)
    );

    -- A. Verify registration window is closed for this campus
    SELECT deadline INTO v_deadline
    FROM campus_settings
    WHERE campus_id = p_campus_id;

    IF v_deadline IS NULL OR now() < v_deadline THEN
        RAISE EXCEPTION 'Registration window is still open for this campus. Allocation can only be run after registration closes.';
    END IF;

    -- B. Verify cohort timetable is unpublished for THIS host campus (R15)
    SELECT count(*) INTO v_published_count
    FROM public.current_timetable_entries
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND campus_id = p_campus_id
      AND status = 'published';

    IF v_published_count > 0 THEN
        RAISE EXCEPTION 'Timetable has already been published for this cohort. Allocation is locked.';
    END IF;

    -- C. Verify allocation has not already been completed for this cohort
    SELECT id INTO v_completed_run_id
    FROM public.current_system_logs
    WHERE log_type = 'allocation_run'
      AND campus_id = p_campus_id
      AND academic_year = p_academic_year
      AND semester = p_semester
      AND status = 'completed'
    LIMIT 1;

    IF v_completed_run_id IS NOT NULL THEN
        RAISE EXCEPTION 'Allocation has already been completed for Semester % (%). In production, allocation can only be executed once per semester per academic year.',
            p_semester, p_academic_year;
    END IF;

    -- D. Cleanup expired running claims beyond lease window (R16 recovery)
    UPDATE system_logs
    SET status = 'failed',
        error_message = 'Allocation run abandoned or lease expired',
        updated_at = now()
    WHERE log_type = 'allocation_run'
      AND campus_id = p_campus_id
      AND academic_year = p_academic_year
      AND semester = p_semester
      AND status = 'running'
      AND started_at <= now() - (COALESCE((metadata->>'lease_seconds')::int, 300) || ' seconds')::interval;

    -- E. Check active running claim within lease window (R16)
    SELECT id, metadata INTO v_active_run
    FROM public.current_system_logs
    WHERE log_type = 'allocation_run'
      AND campus_id = p_campus_id
      AND academic_year = p_academic_year
      AND semester = p_semester
      AND status = 'running'
    LIMIT 1;

    IF v_active_run.id IS NOT NULL THEN
        -- If caller supplies identical fencing token, return existing claim idempotently
        IF p_fencing_token IS NOT NULL AND (v_active_run.metadata->>'fencing_token')::UUID = p_fencing_token THEN
            RETURN v_active_run.id;
        END IF;
        RAISE EXCEPTION 'An allocation run is already in progress for this academic year and semester.';
    END IF;

    -- F. Generate fencing token and insert new running claim atomically
    v_run_id := gen_random_uuid();
    v_fencing_token := COALESCE(p_fencing_token, gen_random_uuid());
    v_meta := jsonb_build_object(
        'fencing_token', v_fencing_token,
        'lease_seconds', COALESCE(p_lease_seconds, 300)
    );

    INSERT INTO system_logs (
        id,
        log_type,
        campus_id,
        academic_year,
        semester,
        status,
        user_id,
        metadata,
        started_at,
        created_at,
        updated_at
    )
    VALUES (
        v_run_id,
        'allocation_run',
        p_campus_id,
        p_academic_year,
        p_semester,
        'running',
        p_user_id,
        v_meta,
        now(),
        now(),
        now()
    );

    RETURN v_run_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_timetable_generation_job(p_campus_id uuid, p_academic_year text, p_semester smallint, p_user_id uuid, p_lease_seconds integer DEFAULT 600, p_fencing_token uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_deadline TIMESTAMPTZ;
    v_published_count INT;
    v_active_job RECORD;
    v_job_id UUID;
    v_fencing_token UUID;
    v_meta JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
    IF p_campus_id IS NULL THEN RAISE EXCEPTION 'An explicit campus is required'; END IF;
    IF p_semester NOT BETWEEN 1 AND 10 OR p_academic_year IS NULL OR btrim(p_academic_year) = ''
      OR p_lease_seconds NOT BETWEEN 60 AND 1800 THEN RAISE EXCEPTION 'Invalid cohort or worker lease'; END IF;
    -- R16: Acquire transactional advisory lock for timetable generation on this campus cohort
    PERFORM pg_advisory_xact_lock(
        hashtext('timetable:' || COALESCE(p_campus_id::text, 'all') || ':' || p_academic_year || ':' || p_semester::text)
    );

    -- A. Verify registration window is closed
    IF p_campus_id IS NOT NULL THEN
        SELECT deadline INTO v_deadline
        FROM campus_settings
        WHERE campus_id = p_campus_id;

        IF v_deadline IS NULL OR now() < v_deadline THEN
            RAISE EXCEPTION 'Registration window is still open. Timetable generation requires closed registration.';
        END IF;
    END IF;

    -- B. Verify published schedule does not already exist for THIS campus (R15)
    SELECT count(*) INTO v_published_count
    FROM public.current_timetable_entries
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND campus_id IS NOT DISTINCT FROM p_campus_id
      AND status = 'published';

    IF v_published_count > 0 THEN
        RAISE EXCEPTION 'A published timetable already exists for % Semester %. Published timetables are strictly immutable.',
            p_academic_year, p_semester;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.current_system_logs WHERE log_type = 'allocation_run' AND status = 'completed'
      AND campus_id = p_campus_id AND academic_year = p_academic_year AND semester = p_semester) THEN
      RAISE EXCEPTION 'A completed allocation is required before scheduling';
    END IF;

    -- C. Cleanup expired running jobs beyond lease window (R16 recovery)
    UPDATE system_logs
    SET status = 'failed',
        error_message = 'Previous worker lease expired due to inactivity or restart (F42/R16 recovery).',
        completed_at = now(),
        updated_at = now()
    WHERE log_type = 'timetable_job'
      AND campus_id IS NOT DISTINCT FROM p_campus_id
      AND academic_year = p_academic_year
      AND semester = p_semester
      AND status IN ('queued', 'running')
      AND updated_at <= now() - (COALESCE((metadata->>'lease_seconds')::int, 600) * interval '1 second');

    -- D. Check active running/queued job within lease window
    SELECT id, metadata, status INTO v_active_job
    FROM public.current_system_logs
    WHERE log_type = 'timetable_job'
      AND campus_id IS NOT DISTINCT FROM p_campus_id
      AND academic_year = p_academic_year
      AND semester = p_semester
      AND status IN ('queued', 'running')
    LIMIT 1;

    IF v_active_job.id IS NOT NULL THEN
        -- If caller supplies identical fencing token, return existing claim idempotently
        IF p_fencing_token IS NOT NULL AND (v_active_job.metadata->>'fencing_token')::UUID = p_fencing_token THEN
            RETURN jsonb_build_object(
                'success', true,
                'job_id', v_active_job.id,
                'fencing_token', p_fencing_token,
                'idempotent_replay', true
            );
        END IF;
        RAISE EXCEPTION 'A timetable generation job is currently running for this semester.';
    END IF;

    -- E. Generate fencing token and insert new running job claim atomically
    v_job_id := gen_random_uuid();
    v_fencing_token := COALESCE(p_fencing_token, gen_random_uuid());
    v_meta := jsonb_build_object(
        'fencing_token', v_fencing_token,
        'lease_seconds', COALESCE(p_lease_seconds, 600)
    );

    INSERT INTO system_logs (
        id,
        log_type,
        campus_id,
        academic_year,
        semester,
        status,
        user_id,
        metadata,
        started_at,
        created_at,
        updated_at
    )
    VALUES (
        v_job_id,
        'timetable_job',
        p_campus_id,
        p_academic_year,
        p_semester,
        'queued',
        p_user_id,
        v_meta,
        now(),
        now(),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'job_id', v_job_id,
        'fencing_token', v_fencing_token
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.course_enrollment_counts(p_course_ids uuid[], p_academic_year text, p_semester integer)
 RETURNS TABLE(course_id uuid, enrolled bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT c.id, count(r.id)
  FROM public.courses c LEFT JOIN public.current_student_registrations r
    ON r.academic_year = p_academic_year AND r.semester = p_semester
    AND c.id = ANY(ARRAY[r.slot_1_course_id,r.slot_2_course_id,r.slot_3_course_id,r.slot_4_course_id,
      r.slot_5_course_id,r.slot_6_course_id,r.slot_7_course_id,r.slot_8_course_id])
  WHERE c.id = ANY(p_course_ids) GROUP BY c.id;
$function$
;

CREATE OR REPLACE FUNCTION public.execute_manual_course_allocation(p_student_id uuid, p_campus_id uuid, p_semester smallint, p_academic_year text, p_slot_key text, p_course_id uuid, p_actor_id uuid, p_actor_role text, p_allocated_by text DEFAULT 'hod_override'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_student RECORD;
    v_target_course RECORD;
    v_reg public.student_registrations%ROWTYPE;
    v_prev_course_id UUID;
    v_meta JSONB;
    v_enrolled_count INT;
    v_core_credits NUMERIC := 0;
    v_add_credits NUMERIC := 0;
    v_total_credits NUMERIC := 0;
    v_slot_num INT;
    v_c_id UUID;
    v_c_credits NUMERIC;
    v_alloc_meta JSONB;
    v_reg_exists BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
    -- 1. Validate slot_key
    IF p_slot_key NOT IN ('slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5', 'slot_6', 'slot_7', 'slot_8') THEN
        RAISE EXCEPTION 'Invalid slot_key: %', p_slot_key;
    END IF;

    -- 2. Validate student exists and active semester matches (R12)
    SELECT id, campus_id, department_id, current_semester INTO v_student
    FROM students
    WHERE id = p_student_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student not found';
    END IF;

    IF v_student.current_semester <> p_semester THEN
        RAISE EXCEPTION 'Target semester % does not match student active semester %', p_semester, v_student.current_semester;
    END IF;

    -- 3. Fetch target course and verify semester match
    SELECT id, course_code, title, credits, department_id, semester, seat_limit, category, prerequisites INTO v_target_course
    FROM courses
    WHERE id = p_course_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target course not found';
    END IF;

    IF v_target_course.semester <> p_semester THEN
        RAISE EXCEPTION 'Course % is for semester %, but student is active in semester %',
            v_target_course.course_code, v_target_course.semester, p_semester;
    END IF;

    -- 4. Lock existing registration row if present
    SELECT * INTO v_reg
    FROM public.current_student_registrations
    WHERE student_id = p_student_id
      AND semester = p_semester
      AND academic_year = p_academic_year
    FOR UPDATE;

    v_reg_exists := FOUND;

    IF v_reg_exists THEN
        v_meta := COALESCE(v_reg.allocation_metadata, '{}'::jsonb);
        IF (v_meta->p_slot_key->>'allocated_by') = 'fixed' THEN
            RAISE EXCEPTION 'Cannot manually override a fixed core course slot';
        END IF;

        EXECUTE format('SELECT ($1).%I', p_slot_key || '_course_id') USING v_reg INTO v_prev_course_id;

        -- Duplicate check across other slots
        IF (p_slot_key <> 'slot_1' AND v_reg.slot_1_course_id = p_course_id) OR
           (p_slot_key <> 'slot_2' AND v_reg.slot_2_course_id = p_course_id) OR
           (p_slot_key <> 'slot_3' AND v_reg.slot_3_course_id = p_course_id) OR
           (p_slot_key <> 'slot_4' AND v_reg.slot_4_course_id = p_course_id) OR
           (p_slot_key <> 'slot_5' AND v_reg.slot_5_course_id = p_course_id) OR
           (p_slot_key <> 'slot_6' AND v_reg.slot_6_course_id = p_course_id) OR
           (p_slot_key <> 'slot_7' AND v_reg.slot_7_course_id = p_course_id) OR
           (p_slot_key <> 'slot_8' AND v_reg.slot_8_course_id = p_course_id) THEN
            RAISE EXCEPTION 'Course % is already assigned to student in another slot', v_target_course.course_code;
        END IF;
    ELSE
        v_meta := '{}'::jsonb;
        v_prev_course_id := NULL;
    END IF;

    -- 5. Deterministically lock courses (R10)
    PERFORM id FROM courses
    WHERE id IN (v_prev_course_id, p_course_id)
    ORDER BY id
    FOR UPDATE;

    -- 6. Enforce global capacity across all campuses (R10)
    SELECT count(*) INTO v_enrolled_count
    FROM public.current_student_registrations
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND student_id <> p_student_id
      AND (
          slot_1_course_id = p_course_id OR
          slot_2_course_id = p_course_id OR
          slot_3_course_id = p_course_id OR
          slot_4_course_id = p_course_id OR
          slot_5_course_id = p_course_id OR
          slot_6_course_id = p_course_id OR
          slot_7_course_id = p_course_id OR
          slot_8_course_id = p_course_id
      );

    IF v_enrolled_count >= COALESCE(v_target_course.seat_limit, 60) THEN
        RAISE EXCEPTION 'Course % has reached maximum capacity (%/% seats)',
            v_target_course.course_code, COALESCE(v_target_course.seat_limit, 60), COALESCE(v_target_course.seat_limit, 60);
    END IF;

    -- 7. Calculate credits across all slots 1..8 with the new course
    FOR v_slot_num IN 1..8
    LOOP
        IF ('slot_' || v_slot_num) = p_slot_key THEN
            v_c_id := p_course_id;
        ELSIF v_reg_exists THEN
            EXECUTE format('SELECT ($1).%I', 'slot_' || v_slot_num || '_course_id') USING v_reg INTO v_c_id;
        ELSE
            v_c_id := NULL;
        END IF;

        IF v_c_id IS NOT NULL THEN
            SELECT COALESCE(credits, 0) INTO v_c_credits FROM courses WHERE id = v_c_id;
            IF v_slot_num <= 6 THEN
                v_core_credits := v_core_credits + v_c_credits;
            ELSE
                v_add_credits := v_add_credits + v_c_credits;
            END IF;
        END IF;
    END LOOP;
    v_total_credits := v_core_credits + v_add_credits;

    -- 8. Prepare updated metadata (credit_breakdown in metadata, NOT table columns - R09)
    v_alloc_meta := jsonb_build_object(
        'allocated_by', p_allocated_by,
        'allocated_by_user_id', p_actor_id,
        'allocated_by_role', p_actor_role,
        'updated_at', now(),
        'course_id', p_course_id,
        'previous_course_id', v_prev_course_id
    );

    v_meta := jsonb_set(v_meta, ARRAY[p_slot_key], v_alloc_meta, true);
    v_meta := jsonb_set(v_meta, ARRAY['credit_breakdown'], jsonb_build_object(
        'core_credits', v_core_credits,
        'additional_credits', v_add_credits,
        'total_credits', v_total_credits
    ), true);

    -- 9. Upsert student_registrations without core_credits/additional_credits columns (R09)
    IF NOT v_reg_exists THEN
        INSERT INTO student_registrations (
            student_id, campus_id, semester, academic_year,
            total_credits, allocation_metadata, submitted_at,
            slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id,
            slot_5_course_id, slot_6_course_id, slot_7_course_id, slot_8_course_id
        )
        VALUES (
            p_student_id, p_campus_id, p_semester, p_academic_year,
            v_total_credits, v_meta, now(),
            CASE WHEN p_slot_key = 'slot_1' THEN p_course_id ELSE NULL END,
            CASE WHEN p_slot_key = 'slot_2' THEN p_course_id ELSE NULL END,
            CASE WHEN p_slot_key = 'slot_3' THEN p_course_id ELSE NULL END,
            CASE WHEN p_slot_key = 'slot_4' THEN p_course_id ELSE NULL END,
            CASE WHEN p_slot_key = 'slot_5' THEN p_course_id ELSE NULL END,
            CASE WHEN p_slot_key = 'slot_6' THEN p_course_id ELSE NULL END,
            CASE WHEN p_slot_key = 'slot_7' THEN p_course_id ELSE NULL END,
            CASE WHEN p_slot_key = 'slot_8' THEN p_course_id ELSE NULL END
        );
    ELSE
        EXECUTE format(
            'UPDATE student_registrations SET %I = $1, allocation_metadata = $2, total_credits = $3 WHERE id = $4',
            p_slot_key || '_course_id'
        ) USING p_course_id, v_meta, v_total_credits, v_reg.id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', format('Manually allocated %s (%s) to %s', v_target_course.course_code, v_target_course.title, p_slot_key),
        'slot_key', p_slot_key,
        'course_id', p_course_id,
        'core_credits', v_core_credits,
        'additional_credits', v_add_credits,
        'total_credits', v_total_credits,
        'course', jsonb_build_object(
            'id', v_target_course.id,
            'prerequisites', v_target_course.prerequisites,
            'course_code', v_target_course.course_code,
            'title', v_target_course.title,
            'credits', v_target_course.credits
        )
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.execute_student_course_change(p_student_id uuid, p_campus_id uuid, p_semester smallint, p_academic_year text, p_slot_key text, p_new_course_id uuid, p_client_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_deadline TIMESTAMPTZ;
    v_published_count INT;
    v_reg student_registrations%ROWTYPE;
    v_target_course RECORD;
    v_prev_course_id UUID;
    v_enrolled_count INT;
    v_meta JSONB;
    v_history JSONB;
    v_now_ms BIGINT;
    v_recent_count INT;
    v_window_ms BIGINT := 27 * 60 * 60 * 1000;
    v_new_history_entry JSONB;
    v_updated_credits NUMERIC;
    elem RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
    -- 1. Validate slot_key
    IF p_slot_key NOT IN ('slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5', 'slot_6', 'slot_7', 'slot_8') THEN
        RAISE EXCEPTION 'Invalid slot_key: %', p_slot_key;
    END IF;

    -- 2. Verify registration window is open
    SELECT deadline INTO v_deadline
    FROM campus_settings
    WHERE campus_id = p_campus_id;

    IF v_deadline IS NULL OR now() >= v_deadline THEN
        RAISE EXCEPTION 'Registration window is closed for this campus';
    END IF;

    -- 3. Verify cohort timetable is unpublished
    SELECT count(*) INTO v_published_count
    FROM public.current_timetable_entries
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND campus_id = p_campus_id
      AND status = 'published';

    IF v_published_count > 0 THEN
        RAISE EXCEPTION 'Timetable has already been published for this cohort. Course changes are locked.';
    END IF;

    -- 4. Fetch existing registration
    SELECT * INTO v_reg
    FROM public.current_student_registrations
    WHERE student_id = p_student_id AND campus_id = p_campus_id
      AND semester = p_semester
      AND academic_year = p_academic_year
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student registration record not found';
    END IF;

    -- Ensure slot is not fixed
    v_meta := COALESCE(v_reg.allocation_metadata, '{}'::jsonb);
    IF (v_meta->p_slot_key->>'allocated_by') = 'fixed' THEN
        RAISE EXCEPTION 'Cannot modify a fixed core course slot';
    END IF;

    -- 5. Check idempotency key replay vs conflict (R11)
    v_history := COALESCE(v_meta->'slot_change_history', '[]'::jsonb);
    IF p_client_idempotency_key IS NOT NULL AND trim(p_client_idempotency_key) <> '' THEN
        FOR elem IN SELECT * FROM jsonb_array_elements(v_history)
        LOOP
            IF elem.value->>'idempotency_key' = p_client_idempotency_key THEN
                IF elem.value->>'slot_key' = p_slot_key AND (elem.value->>'new_course_id')::UUID = p_new_course_id THEN
                    -- Idempotent return of prior committed result
                    RETURN jsonb_build_object(
                        'success', true,
                        'message', format('Successfully updated %s to %s (idempotent replay)', p_slot_key, elem.value->>'course_code'),
                        'slot_key', p_slot_key,
                        'course_id', p_new_course_id,
                        'total_credits', v_reg.total_credits,
                        'idempotent_replay', true
                    );
                ELSE
                    RAISE EXCEPTION 'Idempotency key % already used for a different request payload', p_client_idempotency_key;
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- Check if course is already assigned to this slot
    EXECUTE format('SELECT ($1).%I', p_slot_key || '_course_id') USING v_reg INTO v_prev_course_id;
    IF v_prev_course_id = p_new_course_id THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Course is already assigned to this slot',
            'course_id', p_new_course_id,
            'slot_key', p_slot_key,
            'total_credits', v_reg.total_credits
        );
    END IF;

    -- 6. Lock candidate courses in deterministic order
    PERFORM id FROM courses
    WHERE id IN (v_prev_course_id, p_new_course_id)
    ORDER BY id
    FOR UPDATE;

    -- 7. Fetch target course and verify semester
    SELECT id, course_code, title, credits, semester, seat_limit, prerequisites INTO v_target_course
    FROM courses
    WHERE id = p_new_course_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target course not found';
    END IF;

    IF v_target_course.semester <> p_semester THEN
        RAISE EXCEPTION 'Course belongs to semester %, but student is in semester %', v_target_course.semester, p_semester;
    END IF;

    -- 8. Check distinct slot assignment for the student
    IF (p_slot_key <> 'slot_1' AND v_reg.slot_1_course_id = p_new_course_id) OR
       (p_slot_key <> 'slot_2' AND v_reg.slot_2_course_id = p_new_course_id) OR
       (p_slot_key <> 'slot_3' AND v_reg.slot_3_course_id = p_new_course_id) OR
       (p_slot_key <> 'slot_4' AND v_reg.slot_4_course_id = p_new_course_id) OR
       (p_slot_key <> 'slot_5' AND v_reg.slot_5_course_id = p_new_course_id) OR
       (p_slot_key <> 'slot_6' AND v_reg.slot_6_course_id = p_new_course_id) OR
       (p_slot_key <> 'slot_7' AND v_reg.slot_7_course_id = p_new_course_id) OR
       (p_slot_key <> 'slot_8' AND v_reg.slot_8_course_id = p_new_course_id) THEN
        RAISE EXCEPTION 'Course is already assigned in another paper for this student';
    END IF;

    -- 9. Enforce 3-per-27-hour rolling change quota
    v_now_ms := (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT;
    v_recent_count := 0;

    SELECT count(*) INTO v_recent_count
    FROM jsonb_array_elements(v_history) AS h_elem
    WHERE (h_elem->>'at') IS NOT NULL
      AND (v_now_ms - (EXTRACT(EPOCH FROM (h_elem->>'at')::TIMESTAMPTZ) * 1000)::BIGINT) < v_window_ms;

    IF v_recent_count >= 3 THEN
        RAISE EXCEPTION 'Rate limit exceeded: maximum 3 course changes allowed per 27 hours';
    END IF;

    -- 10. Check global capacity across all campuses (R10)
    SELECT count(*) INTO v_enrolled_count
    FROM public.current_student_registrations
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND student_id <> p_student_id
      AND (
          slot_1_course_id = p_new_course_id OR
          slot_2_course_id = p_new_course_id OR
          slot_3_course_id = p_new_course_id OR
          slot_4_course_id = p_new_course_id OR
          slot_5_course_id = p_new_course_id OR
          slot_6_course_id = p_new_course_id OR
          slot_7_course_id = p_new_course_id OR
          slot_8_course_id = p_new_course_id
      );

    IF v_enrolled_count >= COALESCE(v_target_course.seat_limit, 60) THEN
        RAISE EXCEPTION 'Course % has reached maximum capacity (%/% seats)',
            v_target_course.course_code, COALESCE(v_target_course.seat_limit, 60), COALESCE(v_target_course.seat_limit, 60);
    END IF;

    -- 11. Record change in metadata history
    v_new_history_entry := jsonb_build_object(
        'slot_key', p_slot_key,
        'previous_course_id', v_prev_course_id,
        'new_course_id', p_new_course_id,
        'course_code', v_target_course.course_code,
        'at', now(),
        'idempotency_key', p_client_idempotency_key
    );

    v_meta := jsonb_set(
        v_meta,
        ARRAY[p_slot_key],
        jsonb_build_object(
            'allocated_by', 'student_direct',
            'updated_at', now(),
            'previous_course_id', v_prev_course_id,
            'course_id', p_new_course_id
        ),
        true
    );
    v_meta := jsonb_set(v_meta, ARRAY['slot_change_history'], v_history || jsonb_build_array(v_new_history_entry), true);

    -- 12. Update registration slot and recalculate credits
    EXECUTE format(
        'UPDATE student_registrations SET %I = $1, allocation_metadata = $2 WHERE id = $3',
        p_slot_key || '_course_id'
    ) USING p_new_course_id, v_meta, v_reg.id;

    SELECT COALESCE(sum(COALESCE((snapshot.value->>'credits')::numeric,c.credits)),0) INTO v_updated_credits
    FROM public.current_student_registrations r CROSS JOIN LATERAL
      unnest(ARRAY[r.slot_1_course_id,r.slot_2_course_id,r.slot_3_course_id,r.slot_4_course_id,r.slot_5_course_id,r.slot_6_course_id,r.slot_7_course_id,r.slot_8_course_id]) selected(course_id)
    JOIN courses c ON c.id=selected.course_id LEFT JOIN LATERAL (
      SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.selections)='array' THEN r.selections ELSE '[]'::jsonb END)
      WHERE value->>'course_id'=c.id::text LIMIT 1) snapshot ON true WHERE r.id=v_reg.id;

    UPDATE student_registrations
    SET total_credits = v_updated_credits
    WHERE id = v_reg.id;

    RETURN jsonb_build_object(
        'success', true,
        'message', format('Successfully updated %s to %s - %s', p_slot_key, v_target_course.course_code, v_target_course.title),
        'slot_key', p_slot_key,
        'course_id', p_new_course_id,
        'total_credits', v_updated_credits,
        'slot_changes_remaining', GREATEST(0, 3 - (v_recent_count + 1)),
        'course', jsonb_build_object(
            'id', v_target_course.id,
            'prerequisites', v_target_course.prerequisites,
            'course_code', v_target_course.course_code,
            'title', v_target_course.title,
            'credits', v_target_course.credits
        )
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mutate_teacher_assignments(p_actor_id uuid, p_operation text, p_items jsonb DEFAULT '[]'::jsonb, p_assignment_id uuid DEFAULT NULL::uuid, p_entry_id uuid DEFAULT NULL::uuid, p_teacher_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  actor_role text; actor_department uuid; actor_campus uuid;
  old_assignment public.teacher_course_assignments;
  saved public.teacher_course_assignments;
  entry public.timetable_entries;
  item jsonb; items jsonb := p_items; results jsonb := '[]'::jsonb;
  course public.courses; target_teacher uuid; host_campus uuid; term text; term_semester integer;
  old_teacher uuid; target_role text;
BEGIN
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
  IF EXISTS (SELECT 1 FROM public.admins WHERE id=p_actor_id) THEN actor_role := 'superadmin';
  ELSE
    SELECT role,department_id,campus_id INTO actor_role,actor_department,actor_campus
    FROM public.faculty WHERE id=p_actor_id FOR SHARE;
  END IF;
  IF actor_role IS NULL OR actor_role NOT IN ('superadmin','hod','campus_director') THEN
    RAISE EXCEPTION 'Teacher administration is not permitted for this account' USING ERRCODE='P4030';
  END IF;
  IF actor_role='hod' AND (actor_department IS NULL OR actor_campus IS NULL) THEN
    RAISE EXCEPTION 'HOD affiliation is required' USING ERRCODE='P4030';
  END IF;
  IF p_operation NOT IN ('assign','batch','reassign','remove','substitute') OR p_operation IS NULL THEN
    RAISE EXCEPTION 'Invalid teacher operation' USING ERRCODE='22023';
  END IF;
  IF p_operation <> 'substitute' AND actor_role='campus_director' THEN
    RAISE EXCEPTION 'Only HODs and superadmins manage course assignments' USING ERRCODE='P4030';
  END IF;

  IF p_operation='substitute' THEN
    SELECT * INTO entry FROM public.current_timetable_entries WHERE id=p_entry_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Timetable entry not found' USING ERRCODE='P4040'; END IF;
    host_campus := COALESCE(entry.campus_id,(SELECT campus_id FROM public.departments WHERE id=entry.department_id));
    IF actor_role='campus_director' AND (actor_campus IS NULL OR host_campus IS DISTINCT FROM actor_campus) THEN
      RAISE EXCEPTION 'Entry is outside your campus' USING ERRCODE='P4030';
    END IF;
    IF actor_role='hod' AND entry.department_id IS DISTINCT FROM actor_department THEN
      RAISE EXCEPTION 'Entry is outside your department' USING ERRCODE='P4030';
    END IF;
    IF host_campus IS NULL THEN RAISE EXCEPTION 'Entry has no host campus' USING ERRCODE='23514'; END IF;
    old_teacher := entry.teacher_id;
    -- The row trigger validates the target role and clashes in this transaction.
    UPDATE public.timetable_entries SET teacher_id=p_teacher_id WHERE id=entry.id;
    IF p_teacher_id IS NOT NULL THEN
      INSERT INTO public.teacher_course_assignments (teacher_id,course_id,campus_id,academic_year,semester,assigned_by)
      VALUES (p_teacher_id,entry.course_id,host_campus,entry.academic_year,entry.semester,p_actor_id)
      ON CONFLICT (teacher_id,course_id,campus_id,academic_year,semester,term_version)
      DO UPDATE SET assigned_by=EXCLUDED.assigned_by,assigned_at=now();
    END IF;
    IF old_teacher IS NOT NULL AND old_teacher IS DISTINCT FROM p_teacher_id AND NOT EXISTS (
      SELECT 1 FROM public.current_timetable_entries e WHERE e.teacher_id=old_teacher AND e.course_id=entry.course_id
        AND e.campus_id IS NOT DISTINCT FROM entry.campus_id AND e.academic_year=entry.academic_year AND e.semester=entry.semester
    ) THEN
      DELETE FROM public.current_teacher_course_assignments WHERE teacher_id=old_teacher AND course_id=entry.course_id
        AND campus_id=host_campus AND academic_year=entry.academic_year AND semester=entry.semester AND term_version=entry.term_version;
    END IF;
    RETURN jsonb_build_object('success',true,'entryId',entry.id,'teacherId',p_teacher_id);
  END IF;

  IF p_operation IN ('reassign','remove') THEN
    SELECT * INTO old_assignment FROM public.current_teacher_course_assignments WHERE id=p_assignment_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Assignment not found' USING ERRCODE='P4040'; END IF;
    SELECT * INTO course FROM public.courses WHERE id=old_assignment.course_id;
    IF actor_role='hod' AND course.department_id IS DISTINCT FROM actor_department THEN
      RAISE EXCEPTION 'Assignment is outside your department' USING ERRCODE='P4030';
    END IF;
    IF p_operation='remove' THEN
      -- Existing deletion trigger revokes timetable authority in the same transaction.
      DELETE FROM public.current_teacher_course_assignments WHERE id=old_assignment.id;
      RETURN jsonb_build_object('success',true);
    END IF;
    items := jsonb_build_array(jsonb_build_object('teacher_id',p_teacher_id,'course_id',old_assignment.course_id,
      'campus_id',old_assignment.campus_id,'academic_year',old_assignment.academic_year,'semester',old_assignment.semester));
  END IF;
  IF jsonb_typeof(items) IS DISTINCT FROM 'array' OR jsonb_array_length(items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Provide between 1 and 100 assignments' USING ERRCODE='22023';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
    SELECT * INTO course FROM public.courses WHERE id=(item->>'course_id')::uuid FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Course not found' USING ERRCODE='P4040'; END IF;
    IF actor_role='hod' AND course.department_id IS DISTINCT FROM actor_department THEN
      RAISE EXCEPTION 'Course is outside your department' USING ERRCODE='P4030';
    END IF;
    target_teacher := (item->>'teacher_id')::uuid;
    SELECT role INTO target_role FROM public.faculty WHERE id=target_teacher FOR SHARE;
    IF target_role IS DISTINCT FROM 'teacher' THEN
      RAISE EXCEPTION 'Only faculty with the teacher role can instruct courses' USING ERRCODE='23514';
    END IF;
    host_campus := COALESCE((item->>'campus_id')::uuid,actor_campus);
    term := COALESCE(NULLIF(btrim(item->>'academic_year'),''),(SELECT academic_year FROM public.campus_settings WHERE campus_id=host_campus));
    term_semester := COALESCE((item->>'semester')::integer,course.semester);
    IF host_campus IS NULL OR term IS NULL OR term_semester IS DISTINCT FROM course.semester THEN
      RAISE EXCEPTION 'A valid host campus, academic year and course semester are required' USING ERRCODE='23514';
    END IF;
    IF p_operation='reassign' THEN
      UPDATE public.teacher_course_assignments SET teacher_id=target_teacher,assigned_by=p_actor_id,assigned_at=now()
        WHERE id=old_assignment.id RETURNING * INTO saved;
    ELSE
      INSERT INTO public.teacher_course_assignments (teacher_id,course_id,campus_id,academic_year,semester,assigned_by)
      VALUES (target_teacher,course.id,host_campus,term,term_semester,p_actor_id)
      ON CONFLICT (teacher_id,course_id,campus_id,academic_year,semester,term_version)
      DO UPDATE SET assigned_by=EXCLUDED.assigned_by,assigned_at=now() RETURNING * INTO saved;
    END IF;
    UPDATE public.timetable_entries SET teacher_id=target_teacher
      WHERE course_id=course.id AND campus_id=host_campus AND academic_year=term
        AND semester=term_semester AND term_version=public.campus_term_version(campus_id) AND status='published';
    results := results || jsonb_build_array(to_jsonb(saved));
  END LOOP;
  RETURN jsonb_build_object('success',true,'assignment',results->0,'assignments',results,'count',jsonb_array_length(results));
END $function$
;

CREATE OR REPLACE FUNCTION public.publish_timetable_cohort(p_campus_id uuid, p_academic_year text, p_semester integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  draft_hash text;
  expected_hash text;
  expected_count int;
  changed_count int;
  saved_count int;
  generation_id uuid;
  published_time timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
  IF p_campus_id IS NULL OR p_academic_year IS NULL OR btrim(p_academic_year) = ''
      OR p_semester IS NULL OR p_semester NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'An explicit campus, academic year and valid semester are required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('timetable:published-teacher-occupancy'));
  PERFORM pg_advisory_xact_lock(hashtext('timetable:' || p_campus_id::text || ':' || p_academic_year || ':' || p_semester::text));

  IF EXISTS (SELECT 1 FROM public.current_system_logs WHERE log_type = 'timetable_job' AND campus_id = p_campus_id
    AND academic_year = p_academic_year AND semester = p_semester AND status IN ('queued','running')) THEN
    RAISE EXCEPTION 'Cannot publish while timetable generation is active';
  END IF;
  IF EXISTS (SELECT 1 FROM public.current_timetable_entries e LEFT JOIN public.departments d ON d.id = e.department_id
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

  PERFORM id FROM public.current_timetable_entries WHERE campus_id = p_campus_id AND academic_year = p_academic_year
    AND semester = p_semester AND status = 'draft' FOR UPDATE;
  SELECT count(*), md5(string_agg(e::text, ',' ORDER BY e.id)) INTO expected_count, draft_hash
    FROM public.current_timetable_entries e WHERE e.campus_id = p_campus_id AND e.academic_year = p_academic_year
      AND e.semester = p_semester AND e.status = 'draft';
  SELECT id, metadata->>'draft_hash' INTO generation_id, expected_hash FROM public.current_system_logs
    WHERE log_type = 'timetable_job' AND campus_id = p_campus_id AND academic_year = p_academic_year
      AND semester = p_semester AND status = 'completed' ORDER BY completed_at DESC LIMIT 1;
  IF expected_count = 0 OR draft_hash IS NULL OR draft_hash IS DISTINCT FROM expected_hash THEN
    RAISE EXCEPTION 'No verified current draft; generate a complete timetable before publication';
  END IF;
  IF EXISTS (SELECT 1 FROM public.current_timetable_entries draft JOIN public.current_timetable_entries occupied
    ON occupied.teacher_id = draft.teacher_id AND occupied.time_slot_id = draft.time_slot_id
      AND occupied.academic_year = draft.academic_year AND occupied.status = 'published'
    WHERE draft.campus_id = p_campus_id AND draft.academic_year = p_academic_year
      AND draft.semester = p_semester AND draft.status = 'draft' AND draft.teacher_id IS NOT NULL) THEN
    RAISE EXCEPTION 'An assigned teacher is already occupied in a published class';
  END IF;

  UPDATE public.timetable_entries SET status = 'published', published_at = published_time
    WHERE term_version=public.campus_term_version(campus_id) AND campus_id = p_campus_id AND academic_year = p_academic_year AND semester = p_semester AND status = 'draft';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  SELECT count(*) INTO saved_count FROM public.current_timetable_entries
    WHERE campus_id = p_campus_id AND academic_year = p_academic_year AND semester = p_semester
      AND status = 'published' AND published_at = published_time;
  IF changed_count <> expected_count OR saved_count <> expected_count
      OR EXISTS (SELECT 1 FROM public.current_timetable_entries WHERE campus_id = p_campus_id
        AND academic_year = p_academic_year AND semester = p_semester AND status = 'draft') THEN
    RAISE EXCEPTION 'Publication did not persist every verified session; the transaction was rolled back';
  END IF;
  UPDATE public.system_logs SET metadata = metadata || jsonb_build_object('publication',
    jsonb_build_object('published_at', published_time, 'published_count', saved_count)) WHERE id = generation_id;
  RETURN jsonb_build_object('success', true, 'published_count', saved_count, 'published_at', published_time);
END $function$
;

CREATE OR REPLACE FUNCTION public.revoke_deleted_assignment_authority()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
  UPDATE public.timetable_entries e SET teacher_id = NULL
  WHERE e.term_version=OLD.term_version AND e.teacher_id = OLD.teacher_id AND e.course_id = OLD.course_id
    AND (OLD.academic_year IS NULL OR e.academic_year = OLD.academic_year)
    AND (OLD.semester IS NULL OR e.semester = OLD.semester)
    AND (OLD.campus_id IS NULL OR COALESCE(e.campus_id,
      (SELECT d.campus_id FROM public.departments d WHERE d.id = e.department_id)) = OLD.campus_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.current_teacher_course_assignments a
      WHERE a.teacher_id = e.teacher_id AND a.course_id = e.course_id
        AND (a.academic_year IS NULL OR a.academic_year = e.academic_year)
        AND (a.semester IS NULL OR a.semester = e.semester)
        AND (a.campus_id IS NULL OR a.campus_id = COALESCE(e.campus_id,
          (SELECT d.campus_id FROM public.departments d WHERE d.id = e.department_id)))
    );
  RETURN OLD;
END $function$
;

CREATE OR REPLACE FUNCTION public.submit_student_registration(p_student_id uuid, p_campus_id uuid, p_semester smallint, p_academic_year text, p_pathway_id text, p_preferences jsonb, p_allocation_metadata jsonb, p_fixed_assignments jsonb, p_total_credits numeric, p_submitted_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_deadline TIMESTAMPTZ;
    v_published_count INT;
    v_existing_submitted_at TIMESTAMPTZ;
    v_final_submitted_at TIMESTAMPTZ;
    v_existing_reg RECORD;
    v_s1 UUID;
    v_s2 UUID;
    v_s3 UUID;
    v_s4 UUID;
    v_s5 UUID;
    v_s6 UUID;
    v_s7 UUID;
    v_s8 UUID;
    v_res_s1 UUID;
    v_res_s2 UUID;
    v_res_s3 UUID;
    v_res_s4 UUID;
    v_res_s5 UUID;
    v_res_s6 UUID;
    v_res_s7 UUID;
    v_res_s8 UUID;
    v_fixed_ids UUID[];
    v_cid UUID;
    v_enrolled_count INT;
    v_course_rec RECORD;
    v_already_enrolled BOOLEAN;
    v_cleaned_meta JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
    -- 1. Validate registration window
    SELECT deadline INTO v_deadline
    FROM campus_settings
    WHERE campus_id = p_campus_id;

    IF v_deadline IS NOT NULL AND now() >= v_deadline THEN
        RAISE EXCEPTION 'Registration window is closed for this campus';
    END IF;

    -- 2. Verify cohort timetable is unpublished
    SELECT count(*) INTO v_published_count
    FROM public.current_timetable_entries
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND campus_id = p_campus_id
      AND status = 'published';

    IF v_published_count > 0 THEN
        RAISE EXCEPTION 'Timetable has already been published for this cohort. Registrations are locked.';
    END IF;

    -- 3. Check prior submission timestamp to preserve first tiebreaker timestamp
    SELECT submitted_at INTO v_existing_submitted_at
    FROM registration_preferences
    WHERE student_id = p_student_id AND semester = p_semester AND academic_year = p_academic_year;

    IF v_existing_submitted_at IS NULL THEN
        SELECT submitted_at INTO v_existing_submitted_at
        FROM public.current_student_registrations
        WHERE student_id = p_student_id AND semester = p_semester AND academic_year = p_academic_year;
    END IF;

    v_final_submitted_at := COALESCE(v_existing_submitted_at, p_submitted_at);

    -- 4. Lock existing student registration if it exists
    SELECT * INTO v_existing_reg
    FROM public.current_student_registrations
    WHERE student_id = p_student_id AND semester = p_semester AND academic_year = p_academic_year
    FOR UPDATE;

    -- 5. Extract fixed course UUIDs safely
    v_s1 := (p_fixed_assignments->>'slot_1')::UUID;
    v_s2 := (p_fixed_assignments->>'slot_2')::UUID;
    v_s3 := (p_fixed_assignments->>'slot_3')::UUID;
    v_s4 := (p_fixed_assignments->>'slot_4')::UUID;
    v_s5 := (p_fixed_assignments->>'slot_5')::UUID;
    v_s6 := (p_fixed_assignments->>'slot_6')::UUID;
    v_s7 := (p_fixed_assignments->>'slot_7')::UUID;
    v_s8 := (p_fixed_assignments->>'slot_8')::UUID;

    -- 6. Validate distinct fixed courses
    IF NOT check_unique_course_slots(v_s1, v_s2, v_s3, v_s4, v_s5, v_s6, v_s7, v_s8) THEN
        RAISE EXCEPTION 'Duplicate course assigned among fixed slots';
    END IF;

    -- 7. Deterministically lock candidate fixed courses and enforce global capacity (R10)
    v_fixed_ids := ARRAY[]::UUID[];
    IF v_s1 IS NOT NULL THEN v_fixed_ids := array_append(v_fixed_ids, v_s1); END IF;
    IF v_s2 IS NOT NULL THEN v_fixed_ids := array_append(v_fixed_ids, v_s2); END IF;
    IF v_s3 IS NOT NULL THEN v_fixed_ids := array_append(v_fixed_ids, v_s3); END IF;
    IF v_s4 IS NOT NULL THEN v_fixed_ids := array_append(v_fixed_ids, v_s4); END IF;
    IF v_s5 IS NOT NULL THEN v_fixed_ids := array_append(v_fixed_ids, v_s5); END IF;
    IF v_s6 IS NOT NULL THEN v_fixed_ids := array_append(v_fixed_ids, v_s6); END IF;
    IF v_s7 IS NOT NULL THEN v_fixed_ids := array_append(v_fixed_ids, v_s7); END IF;
    IF v_s8 IS NOT NULL THEN v_fixed_ids := array_append(v_fixed_ids, v_s8); END IF;

    IF array_length(v_fixed_ids, 1) > 0 THEN
        PERFORM id FROM courses
        WHERE id = ANY(v_fixed_ids)
        ORDER BY id
        FOR UPDATE;

        FOREACH v_cid IN ARRAY v_fixed_ids
        LOOP
            -- Check if student was already enrolled in this course in their previous registration
            v_already_enrolled := (
                v_existing_reg.id IS NOT NULL AND (
                    v_existing_reg.slot_1_course_id = v_cid OR
                    v_existing_reg.slot_2_course_id = v_cid OR
                    v_existing_reg.slot_3_course_id = v_cid OR
                    v_existing_reg.slot_4_course_id = v_cid OR
                    v_existing_reg.slot_5_course_id = v_cid OR
                    v_existing_reg.slot_6_course_id = v_cid OR
                    v_existing_reg.slot_7_course_id = v_cid OR
                    v_existing_reg.slot_8_course_id = v_cid
                )
            );

            IF v_already_enrolled IS NOT TRUE THEN
                SELECT count(*) INTO v_enrolled_count
                FROM public.current_student_registrations
                WHERE academic_year = p_academic_year
                  AND semester = p_semester
                  AND student_id <> p_student_id
                  AND (
                      slot_1_course_id = v_cid OR
                      slot_2_course_id = v_cid OR
                      slot_3_course_id = v_cid OR
                      slot_4_course_id = v_cid OR
                      slot_5_course_id = v_cid OR
                      slot_6_course_id = v_cid OR
                      slot_7_course_id = v_cid OR
                      slot_8_course_id = v_cid
                  );

                SELECT course_code, title, COALESCE(seat_limit, 60) AS seat_limit INTO v_course_rec
                FROM courses WHERE id = v_cid;

                IF v_enrolled_count >= v_course_rec.seat_limit THEN
                    RAISE EXCEPTION 'Fixed course % (%) has reached maximum global capacity (%/% seats)',
                        v_course_rec.course_code, v_course_rec.title, v_course_rec.seat_limit, v_course_rec.seat_limit;
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- 8. Pathway slot reconciliation: release removed fixed courses on pathway change (R14)
    v_res_s1 := CASE
        WHEN v_s1 IS NOT NULL THEN v_s1
        WHEN (v_existing_reg.allocation_metadata->'slot_1'->>'allocated_by') = 'fixed' THEN NULL
        WHEN v_existing_reg.pathway_id IS NOT NULL AND v_existing_reg.pathway_id <> p_pathway_id THEN NULL
        ELSE v_existing_reg.slot_1_course_id
    END;

    v_res_s2 := CASE
        WHEN v_s2 IS NOT NULL THEN v_s2
        WHEN (v_existing_reg.allocation_metadata->'slot_2'->>'allocated_by') = 'fixed' THEN NULL
        WHEN v_existing_reg.pathway_id IS NOT NULL AND v_existing_reg.pathway_id <> p_pathway_id THEN NULL
        ELSE v_existing_reg.slot_2_course_id
    END;

    v_res_s3 := CASE
        WHEN v_s3 IS NOT NULL THEN v_s3
        WHEN (v_existing_reg.allocation_metadata->'slot_3'->>'allocated_by') = 'fixed' THEN NULL
        WHEN v_existing_reg.pathway_id IS NOT NULL AND v_existing_reg.pathway_id <> p_pathway_id THEN NULL
        ELSE v_existing_reg.slot_3_course_id
    END;

    v_res_s4 := CASE
        WHEN v_s4 IS NOT NULL THEN v_s4
        WHEN (v_existing_reg.allocation_metadata->'slot_4'->>'allocated_by') = 'fixed' THEN NULL
        WHEN v_existing_reg.pathway_id IS NOT NULL AND v_existing_reg.pathway_id <> p_pathway_id THEN NULL
        ELSE v_existing_reg.slot_4_course_id
    END;

    v_res_s5 := CASE
        WHEN v_s5 IS NOT NULL THEN v_s5
        WHEN (v_existing_reg.allocation_metadata->'slot_5'->>'allocated_by') = 'fixed' THEN NULL
        WHEN v_existing_reg.pathway_id IS NOT NULL AND v_existing_reg.pathway_id <> p_pathway_id THEN NULL
        ELSE v_existing_reg.slot_5_course_id
    END;

    v_res_s6 := CASE
        WHEN v_s6 IS NOT NULL THEN v_s6
        WHEN (v_existing_reg.allocation_metadata->'slot_6'->>'allocated_by') = 'fixed' THEN NULL
        WHEN v_existing_reg.pathway_id IS NOT NULL AND v_existing_reg.pathway_id <> p_pathway_id THEN NULL
        ELSE v_existing_reg.slot_6_course_id
    END;

    v_res_s7 := CASE
        WHEN v_s7 IS NOT NULL THEN v_s7
        WHEN (v_existing_reg.allocation_metadata->'slot_7'->>'allocated_by') = 'fixed' THEN NULL
        WHEN v_existing_reg.pathway_id IS NOT NULL AND v_existing_reg.pathway_id <> p_pathway_id THEN NULL
        ELSE v_existing_reg.slot_7_course_id
    END;

    v_res_s8 := CASE
        WHEN v_s8 IS NOT NULL THEN v_s8
        WHEN (v_existing_reg.allocation_metadata->'slot_8'->>'allocated_by') = 'fixed' THEN NULL
        WHEN v_existing_reg.pathway_id IS NOT NULL AND v_existing_reg.pathway_id <> p_pathway_id THEN NULL
        ELSE v_existing_reg.slot_8_course_id
    END;

    -- Clean obsolete fixed metadata from p_allocation_metadata
    v_cleaned_meta := p_allocation_metadata;
    IF v_s1 IS NULL AND (v_cleaned_meta->'slot_1'->>'allocated_by') = 'fixed' THEN
        v_cleaned_meta := v_cleaned_meta - 'slot_1';
    END IF;
    IF v_s2 IS NULL AND (v_cleaned_meta->'slot_2'->>'allocated_by') = 'fixed' THEN
        v_cleaned_meta := v_cleaned_meta - 'slot_2';
    END IF;
    IF v_s3 IS NULL AND (v_cleaned_meta->'slot_3'->>'allocated_by') = 'fixed' THEN
        v_cleaned_meta := v_cleaned_meta - 'slot_3';
    END IF;
    IF v_s4 IS NULL AND (v_cleaned_meta->'slot_4'->>'allocated_by') = 'fixed' THEN
        v_cleaned_meta := v_cleaned_meta - 'slot_4';
    END IF;
    IF v_s5 IS NULL AND (v_cleaned_meta->'slot_5'->>'allocated_by') = 'fixed' THEN
        v_cleaned_meta := v_cleaned_meta - 'slot_5';
    END IF;
    IF v_s6 IS NULL AND (v_cleaned_meta->'slot_6'->>'allocated_by') = 'fixed' THEN
        v_cleaned_meta := v_cleaned_meta - 'slot_6';
    END IF;
    IF v_s7 IS NULL AND (v_cleaned_meta->'slot_7'->>'allocated_by') = 'fixed' THEN
        v_cleaned_meta := v_cleaned_meta - 'slot_7';
    END IF;
    IF v_s8 IS NULL AND (v_cleaned_meta->'slot_8'->>'allocated_by') = 'fixed' THEN
        v_cleaned_meta := v_cleaned_meta - 'slot_8';
    END IF;

    -- 9. Upsert registration_preferences
    INSERT INTO registration_preferences (
        student_id, campus_id, semester, academic_year, pathway_id,
        preferences, submitted_at, updated_at
    )
    VALUES (
        p_student_id, p_campus_id, p_semester, p_academic_year, p_pathway_id,
        p_preferences, v_final_submitted_at, now()
    )
    ON CONFLICT (student_id, semester, academic_year)
    DO UPDATE SET
        campus_id = EXCLUDED.campus_id,
        pathway_id = EXCLUDED.pathway_id,
        preferences = EXCLUDED.preferences,
        updated_at = now();

    -- 10. Upsert student_registrations
    INSERT INTO student_registrations (
        student_id, campus_id, semester, academic_year, pathway_id,
        total_credits, allocation_metadata, submitted_at,
        slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id,
        slot_5_course_id, slot_6_course_id, slot_7_course_id, slot_8_course_id
    )
    VALUES (
        p_student_id, p_campus_id, p_semester, p_academic_year, p_pathway_id,
        p_total_credits, v_cleaned_meta, v_final_submitted_at,
        v_res_s1, v_res_s2, v_res_s3, v_res_s4, v_res_s5, v_res_s6, v_res_s7, v_res_s8
    )
    ON CONFLICT (student_id, semester, academic_year, term_version)
    DO UPDATE SET
        campus_id = EXCLUDED.campus_id,
        pathway_id = EXCLUDED.pathway_id,
        total_credits = EXCLUDED.total_credits,
        allocation_metadata = EXCLUDED.allocation_metadata,
        slot_1_course_id = v_res_s1,
        slot_2_course_id = v_res_s2,
        slot_3_course_id = v_res_s3,
        slot_4_course_id = v_res_s4,
        slot_5_course_id = v_res_s5,
        slot_6_course_id = v_res_s6,
        slot_7_course_id = v_res_s7,
        slot_8_course_id = v_res_s8;

    RETURN jsonb_build_object(
        'success', true,
        'submitted_at', v_final_submitted_at,
        'preserved_first_submission', (v_existing_submitted_at IS NOT NULL)
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_guard_published_timetable_entries()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE host_campus uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
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
    IF EXISTS (SELECT 1 FROM public.current_timetable_entries e
      LEFT JOIN public.departments d ON d.id = e.department_id
      WHERE e.academic_year = NEW.academic_year AND e.semester = NEW.semester
        AND e.status = 'published' AND COALESCE(e.campus_id, d.campus_id) = host_campus) THEN
      RAISE EXCEPTION 'Cannot add sessions to an already published timetable';
    END IF;
  END IF;

  -- A BEFORE UPDATE trigger must return NEW: returning OLD silently discards
  -- the publication while PostgreSQL still reports a matched/updated row.
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.validate_timetable_teacher()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE teacher_role text;
BEGIN
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
  IF NEW.teacher_id IS NULL THEN RETURN NEW; END IF;
  SELECT role INTO teacher_role FROM public.faculty WHERE id = NEW.teacher_id FOR SHARE;
  IF teacher_role IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'Only faculty with the teacher role can instruct courses' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.current_timetable_entries e
    WHERE e.id <> NEW.id AND e.teacher_id = NEW.teacher_id
      AND e.academic_year = NEW.academic_year AND e.time_slot_id = NEW.time_slot_id
      AND ROW(e.course_id,e.campus_id,e.semester) IS DISTINCT FROM ROW(NEW.course_id,NEW.campus_id,NEW.semester)) THEN
    RAISE EXCEPTION 'Teacher already has a class scheduled in this period' USING ERRCODE='23P01';
  END IF;
  RETURN NEW;
END $function$
;

-- Promotion and graduation are independent, atomic operations.
DROP FUNCTION public.promote_campus_students_atomic(uuid,uuid,text) RESTRICT;
DROP FUNCTION public.promote_campus_students_once(uuid,uuid,text) RESTRICT;
DROP FUNCTION public.prepare_graduation(uuid,uuid[],uuid) RESTRICT;
DROP FUNCTION public.graduate_candidate_database(uuid,uuid) RESTRICT;
DROP FUNCTION public.finish_graduation_candidate(uuid,uuid,text) RESTRICT;
DROP FUNCTION public.cleanup_concluded_semester_attendance(uuid,text,smallint) RESTRICT;

CREATE FUNCTION public.promote_campus_students_atomic(p_campus_id uuid,p_director_id uuid,p_expected_term integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE settings public.campus_settings; promoted integer; prefs integer; marks integer; sessions integer; signins integer;
 boundary timestamptz:=clock_timestamp(); old_entries uuid[];
BEGIN
 PERFORM pg_advisory_xact_lock(76102622134917::bigint);
 IF NOT EXISTS(SELECT 1 FROM public.faculty WHERE id=p_director_id AND role='campus_director' AND campus_id=p_campus_id) THEN
  RAISE EXCEPTION 'Campus director required' USING ERRCODE='P4030'; END IF;
 SELECT * INTO STRICT settings FROM public.campus_settings WHERE campus_id=p_campus_id FOR UPDATE;
 IF p_expected_term IS DISTINCT FROM settings.term_version THEN RAISE EXCEPTION 'Campus term changed; reload before promotion' USING ERRCODE='P4090'; END IF;
 IF settings.last_promoted_at>boundary-interval '90 days' THEN RAISE EXCEPTION 'Promotion is locked. A minimum of 90 days must pass before next promotion' USING ERRCODE='P4090'; END IF;
 IF EXISTS(SELECT 1 FROM public.current_system_logs WHERE campus_id=p_campus_id AND log_type IN ('allocation_run','timetable_job') AND status IN ('queued','running')) THEN
  RAISE EXCEPTION 'Finish or cancel active allocation and timetable workers before promotion' USING ERRCODE='P4090'; END IF;
 SELECT coalesce(array_agg(id),ARRAY[]::uuid[]) INTO old_entries FROM public.current_timetable_entries
 WHERE coalesce(campus_id,(SELECT campus_id FROM public.departments WHERE id=department_id))=p_campus_id;
 -- A host campus cannot purge shared attendance while visiting students still use that class.
 IF EXISTS(SELECT 1 FROM public.current_student_registrations r JOIN public.students st ON st.id=r.student_id
   JOIN public.current_timetable_entries e ON e.id=ANY(old_entries) AND e.academic_year=r.academic_year AND e.semester=r.semester
   AND e.course_id=ANY(ARRAY[r.slot_1_course_id,r.slot_2_course_id,r.slot_3_course_id,r.slot_4_course_id,r.slot_5_course_id,r.slot_6_course_id,r.slot_7_course_id,r.slot_8_course_id])
   WHERE r.campus_id<>p_campus_id AND st.current_semester=r.semester) THEN
  RAISE EXCEPTION 'Shared classes still serve another active campus; coordinate term closure first' USING ERRCODE='P4090'; END IF;
 IF EXISTS(SELECT 1 FROM public.current_student_registrations r
   JOIN public.current_timetable_entries e ON e.academic_year=r.academic_year AND e.semester=r.semester
    AND e.course_id=ANY(ARRAY[r.slot_1_course_id,r.slot_2_course_id,r.slot_3_course_id,r.slot_4_course_id,r.slot_5_course_id,r.slot_6_course_id,r.slot_7_course_id,r.slot_8_course_id])
   WHERE r.campus_id=p_campus_id AND coalesce(e.campus_id,(SELECT campus_id FROM public.departments WHERE id=e.department_id))<>p_campus_id) THEN
  RAISE EXCEPTION 'Students still attend another active campus class; coordinate term closure first' USING ERRCODE='P4090'; END IF;
 IF EXISTS(SELECT 1 FROM public.registration_preferences p WHERE p.campus_id=p_campus_id AND NOT EXISTS(
  SELECT 1 FROM public.current_student_registrations r WHERE r.student_id=p.student_id AND r.semester=p.semester AND r.academic_year=p.academic_year)) THEN
  RAISE EXCEPTION 'Resolve preference submissions without a retained registration before promotion' USING ERRCODE='P4090'; END IF;
 DELETE FROM public.period_attendance a WHERE a.timetable_slot_id=ANY(old_entries)
  OR a.student_id IN(SELECT id FROM public.students WHERE campus_id=p_campus_id);
 GET DIAGNOSTICS marks=ROW_COUNT;
 DELETE FROM public.period_attendance_sessions WHERE timetable_slot_id=ANY(old_entries);
 GET DIAGNOSTICS sessions=ROW_COUNT;
 DELETE FROM public.registration_preferences WHERE campus_id=p_campus_id;
 GET DIAGNOSTICS prefs=ROW_COUNT;
 DELETE FROM public.campus_sign_ins WHERE campus_id=p_campus_id AND signed_in_at<=boundary;
 GET DIAGNOSTICS signins=ROW_COUNT;
 -- Conflict diagnostics have no campus identity. Preserve them rather than risk another campus's records.
 PERFORM set_config('app.promoting_campus',p_campus_id::text,true);
 UPDATE public.students SET current_semester=current_semester+1 WHERE campus_id=p_campus_id AND current_semester BETWEEN 1 AND 10;
 GET DIAGNOSTICS promoted=ROW_COUNT;
 PERFORM set_config('app.promoting_campus','',true);
 UPDATE public.campus_settings SET last_promoted_at=boundary,term_started_at=boundary,term_version=term_version+1,deadline=NULL WHERE campus_id=p_campus_id;
 INSERT INTO public.system_logs(log_type,status,campus_id,user_id,event_type,action,resource_type,resource_id,metadata)
 VALUES('audit_event','success',p_campus_id,p_director_id,'student_promoted','Promoted students and cleared temporary term data','campus',p_campus_id,
  jsonb_build_object('promoted_count',promoted,'previous_term',settings.term_version,'term_version',settings.term_version+1,
    'deleted_preferences',prefs,'deleted_attendance',marks,'deleted_sessions',sessions,'deleted_signins',signins));
 RETURN jsonb_build_object('success',true,'promoted_count',promoted,'term_version',settings.term_version+1,'last_promoted_at',boundary,
  'deleted_preferences',prefs,'deleted_attendance',marks,'deleted_sessions',sessions,'deleted_signins',signins,
  'message','Students promoted. Registration, timetable and teaching history preserved.');
END $$;

CREATE FUNCTION public.delete_graduating_students(p_campus_id uuid,p_student_ids uuid[],p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE ids uuid[]; deleted integer; owns_objects boolean:=false;
BEGIN
 PERFORM pg_advisory_xact_lock(76102622134917::bigint);
 IF NOT EXISTS(SELECT 1 FROM public.admins WHERE id=p_actor_id) AND NOT EXISTS(
  SELECT 1 FROM public.faculty WHERE id=p_actor_id AND campus_id=p_campus_id AND role='campus_director') THEN
  RAISE EXCEPTION 'Graduation is outside your campus or role' USING ERRCODE='P4030'; END IF;
 SELECT array_agg(DISTINCT id ORDER BY id) INTO ids FROM unnest(p_student_ids) id;
 IF cardinality(ids) IS NULL OR cardinality(ids) NOT BETWEEN 1 AND 500 OR array_position(ids,NULL) IS NOT NULL THEN
  RAISE EXCEPTION 'Select between 1 and 500 valid students' USING ERRCODE='22023'; END IF;
 PERFORM id FROM public.students WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.students WHERE id=ANY(ids) AND campus_id=p_campus_id AND current_semester=11)<>cardinality(ids)
 OR EXISTS(SELECT 1 FROM public.faculty WHERE id=ANY(ids)) OR EXISTS(SELECT 1 FROM public.admins WHERE id=ANY(ids)) THEN
  RAISE EXCEPTION 'Every selected account must be a semester-11 student in this campus' USING ERRCODE='22023'; END IF;
 -- Storage objects are external to this transaction's file lifecycle; stop before any deletion.
 IF to_regclass('storage.objects') IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='storage' AND table_name='objects' AND column_name='owner_id') THEN
   EXECUTE 'SELECT EXISTS(SELECT 1 FROM storage.objects WHERE owner_id=ANY($1::text[]))' INTO owns_objects USING ids::text[];
  END IF;
  IF NOT owns_objects AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='storage' AND table_name='objects' AND column_name='owner') THEN
   EXECUTE 'SELECT EXISTS(SELECT 1 FROM storage.objects WHERE owner::text=ANY($1::text[]))' INTO owns_objects USING ids::text[];
  END IF;
 END IF;
 IF owns_objects THEN RAISE EXCEPTION 'Selected students own Storage objects; resolve ownership before deletion' USING ERRCODE='P4090'; END IF;
 DELETE FROM auth.users WHERE id=ANY(ids);
 GET DIAGNOSTICS deleted=ROW_COUNT;
 IF deleted<>cardinality(ids) THEN RAISE EXCEPTION 'Incomplete account selection; no accounts deleted' USING ERRCODE='P4090'; END IF;
 INSERT INTO public.system_logs(log_type,status,campus_id,user_id,event_type,action,resource_type,metadata)
 VALUES('audit_event','success',p_campus_id,p_actor_id,'students_graduated','Deleted selected semester-11 student accounts','campus',
  jsonb_build_object('deleted_count',deleted,'student_ids',ids));
 RETURN jsonb_build_object('success',true,'deleted_count',deleted,'message','Selected graduating accounts deleted.');
END $$;

CREATE FUNCTION public.run_current_term_operation(p_campus_id uuid,p_expected_term integer,p_operation text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE version integer; p jsonb:=p_payload; result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(76102622134917::bigint);
 SELECT term_version INTO version FROM public.campus_settings WHERE campus_id=p_campus_id;
 IF version IS NULL OR p_expected_term IS DISTINCT FROM version THEN RAISE EXCEPTION 'Campus term changed; reload the portal' USING ERRCODE='P4090'; END IF;
 IF p ? 'p_campus_id' AND (p->>'p_campus_id')::uuid IS DISTINCT FROM p_campus_id THEN RAISE EXCEPTION 'Campus scope mismatch' USING ERRCODE='P4030'; END IF;
 CASE p_operation
 WHEN 'update_campus_settings' THEN
  IF NOT EXISTS(SELECT 1 FROM public.faculty WHERE id=(p->>'p_actor_id')::uuid AND campus_id=p_campus_id AND role='campus_director') THEN
   RAISE EXCEPTION 'Campus director required' USING ERRCODE='P4030'; END IF;
  UPDATE public.campus_settings SET
   deadline=CASE WHEN p?'deadline' THEN (p->>'deadline')::timestamptz ELSE deadline END,
   min_credits=CASE WHEN p?'min_credits' THEN (p->>'min_credits')::integer ELSE min_credits END,
   max_credits=CASE WHEN p?'max_credits' THEN (p->>'max_credits')::integer ELSE max_credits END,
   academic_year=CASE WHEN p?'academic_year' THEN p->>'academic_year' ELSE academic_year END
   WHERE campus_id=p_campus_id RETURNING to_jsonb(campus_settings) INTO result;
  result:=jsonb_build_array(result);
 WHEN 'insert_student' THEN
  IF NOT EXISTS(SELECT 1 FROM public.faculty WHERE id=(p->>'p_actor_id')::uuid AND campus_id=p_campus_id AND department_id=(p->>'department_id')::uuid AND role='hod')
   OR (p->>'current_semester')::int NOT BETWEEN 1 AND 10 THEN
   RAISE EXCEPTION 'HOD affiliation and an active student semester are required' USING ERRCODE='P4030'; END IF;
  INSERT INTO public.students(id,full_name,cap_application_number,current_semester,academic_year_joined,department_id,campus_id,must_change_password)
   VALUES((p->>'id')::uuid,p->>'full_name',p->>'cap_application_number',(p->>'current_semester')::int,p->>'academic_year_joined',(p->>'department_id')::uuid,p_campus_id,true)
   RETURNING to_jsonb(students) INTO result;
 WHEN 'update_student' THEN
  IF NOT EXISTS(SELECT 1 FROM public.faculty WHERE id=(p->>'p_actor_id')::uuid AND campus_id=p_campus_id AND department_id=(p->>'department_id')::uuid AND role='hod') THEN
   RAISE EXCEPTION 'HOD affiliation required' USING ERRCODE='P4030'; END IF;
  UPDATE public.students SET full_name=p->>'full_name',current_semester=(p->>'current_semester')::int,
    cap_application_number=coalesce(p->>'cap_application_number',cap_application_number)
   WHERE id=(p->>'id')::uuid AND campus_id=p_campus_id AND department_id=(p->>'department_id')::uuid
    AND current_semester=(p->>'expected_semester')::int RETURNING to_jsonb(students) INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student changed; reload the student list' USING ERRCODE='P4090'; END IF;
 WHEN 'submit_student_registration' THEN
  result:=public.submit_student_registration((p->>'p_student_id')::uuid,p_campus_id,(p->>'p_semester')::smallint,p->>'p_academic_year',p->>'p_pathway_id',p->'p_preferences',p->'p_allocation_metadata',p->'p_fixed_assignments',(p->>'p_total_credits')::numeric,coalesce((p->>'p_submitted_at')::timestamptz,now()));
 WHEN 'execute_student_course_change' THEN
  result:=public.execute_student_course_change((p->>'p_student_id')::uuid,p_campus_id,(p->>'p_semester')::smallint,p->>'p_academic_year',p->>'p_slot_key',(p->>'p_new_course_id')::uuid,p->>'p_client_idempotency_key');
 WHEN 'execute_manual_course_allocation' THEN
  result:=public.execute_manual_course_allocation((p->>'p_student_id')::uuid,p_campus_id,(p->>'p_semester')::smallint,p->>'p_academic_year',p->>'p_slot_key',(p->>'p_course_id')::uuid,(p->>'p_actor_id')::uuid,p->>'p_actor_role',coalesce(p->>'p_allocated_by','hod_override'));
 WHEN 'claim_allocation_run' THEN
  result:=to_jsonb(public.claim_allocation_run(p_campus_id,p->>'p_academic_year',(p->>'p_semester')::smallint,(p->>'p_user_id')::uuid,coalesce((p->>'p_lease_seconds')::int,300),(p->>'p_fencing_token')::uuid));
 WHEN 'claim_timetable_generation_job' THEN
  result:=public.claim_timetable_generation_job(p_campus_id,p->>'p_academic_year',(p->>'p_semester')::smallint,(p->>'p_user_id')::uuid,coalesce((p->>'p_lease_seconds')::int,600),(p->>'p_fencing_token')::uuid);
 WHEN 'publish_timetable_cohort' THEN
  result:=public.publish_timetable_cohort(p_campus_id,p->>'p_academic_year',(p->>'p_semester')::int);
 WHEN 'mutate_teacher_assignments' THEN
  result:=public.mutate_teacher_assignments((p->>'p_actor_id')::uuid,p->>'p_operation',coalesce(p->'p_items','[]'::jsonb),(p->>'p_assignment_id')::uuid,(p->>'p_entry_id')::uuid,(p->>'p_teacher_id')::uuid);
 WHEN 'record_campus_sign_in' THEN
  INSERT INTO public.campus_sign_ins(student_id,campus_id,session_type,signed_in_at,location_accuracy_meters,status,source)
   VALUES((p->>'student_id')::uuid,p_campus_id,p->>'session_type',(p->>'signed_in_at')::timestamptz,(p->>'location_accuracy_meters')::numeric,p->>'status',p->>'source') RETURNING to_jsonb(campus_sign_ins) INTO result;
 ELSE RAISE EXCEPTION 'Unsupported term operation' USING ERRCODE='22023';
 END CASE;
 RETURN result;
END $$;

DROP TABLE public.period_unlock_requests RESTRICT;
DROP TABLE public.department_notices RESTRICT;
DROP TABLE public.retired_cohorts RESTRICT;
DROP TABLE public.graduation_candidates RESTRICT;
DROP TABLE public.graduation_operations RESTRICT;
DROP TABLE public.promotion_receipts RESTRICT;

CREATE OR REPLACE FUNCTION public.production_readiness() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('ready',
  to_regclass('public.retired_cohorts') IS NULL AND to_regclass('public.graduation_candidates') IS NULL
  AND to_regclass('public.graduation_operations') IS NULL AND to_regclass('public.promotion_receipts') IS NULL
  AND to_regclass('public.period_unlock_requests') IS NULL AND to_regclass('public.department_notices') IS NULL
  AND to_regprocedure('public.promote_campus_students_atomic(uuid,uuid,integer)') IS NOT NULL
  AND to_regprocedure('public.delete_graduating_students(uuid,uuid[],uuid)') IS NOT NULL
  AND to_regprocedure('public.run_current_term_operation(uuid,integer,text,jsonb)') IS NOT NULL
  AND to_regclass('public.current_student_registrations') IS NOT NULL
  AND to_regclass('public.current_timetable_entries') IS NOT NULL
  AND to_regclass('public.current_teacher_course_assignments') IS NOT NULL
  AND to_regclass('public.current_system_logs') IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p','v')
    AND (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR (c.relkind IN('r','p') AND NOT c.relrowsecurity)))
  AND NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'
    AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))));
$$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS name FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.name);
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
