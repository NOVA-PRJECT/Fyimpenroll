-- Owner-run fix. Do not rerun semester_lifecycle.sql. Existing rows are not changed here.
BEGIN;
CREATE OR REPLACE FUNCTION public.submit_student_registration(
 p_student_id uuid,p_campus_id uuid,p_semester smallint,p_academic_year text,p_pathway_id text,
 p_preferences jsonb,p_allocation_metadata jsonb,p_fixed_assignments jsonb,p_total_credits numeric,
 p_submitted_at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE settings public.campus_settings%ROWTYPE; existing public.student_registrations%ROWTYPE;
 first_submission timestamptz; pending_metadata jsonb; had_prior_submission boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(76102622134917::bigint);
 SELECT * INTO settings FROM public.campus_settings WHERE campus_id=p_campus_id FOR UPDATE;
 IF NOT FOUND OR settings.deadline IS NULL OR now()>=settings.deadline THEN
  RAISE EXCEPTION 'Registration window is closed for this campus'; END IF;
 IF settings.academic_year IS DISTINCT FROM p_academic_year THEN
  RAISE EXCEPTION 'Academic year changed; reload the portal' USING ERRCODE='P4090'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.students WHERE id=p_student_id AND campus_id=p_campus_id
   AND current_semester=p_semester AND current_semester BETWEEN 1 AND 10) THEN
  RAISE EXCEPTION 'Registration requires the student active semester' USING ERRCODE='P4090'; END IF;
 IF p_preferences IS NULL OR jsonb_typeof(p_preferences) NOT IN ('array','object') THEN
  RAISE EXCEPTION 'Invalid registration preferences'; END IF;
 IF EXISTS(SELECT 1 FROM public.current_system_logs WHERE campus_id=p_campus_id AND academic_year=p_academic_year
   AND semester=p_semester AND log_type='allocation_run' AND status IN ('queued','running','completed')) THEN
  RAISE EXCEPTION 'Course allocation has started or completed; preference submission is locked' USING ERRCODE='P4090'; END IF;
 IF EXISTS(SELECT 1 FROM public.current_timetable_entries WHERE campus_id=p_campus_id AND academic_year=p_academic_year
   AND semester=p_semester AND status='published') THEN
  RAISE EXCEPTION 'Timetable has already been published for this cohort. Registrations are locked.'; END IF;
 SELECT * INTO existing FROM public.current_student_registrations WHERE student_id=p_student_id
  AND campus_id=p_campus_id AND semester=p_semester AND academic_year=p_academic_year FOR UPDATE;
 IF existing.id IS NOT NULL AND EXISTS(SELECT 1 FROM unnest(ARRAY[existing.slot_1_course_id,existing.slot_2_course_id,
  existing.slot_3_course_id,existing.slot_4_course_id,existing.slot_5_course_id,existing.slot_6_course_id,
  existing.slot_7_course_id,existing.slot_8_course_id]) cid WHERE cid IS NOT NULL) THEN
  RAISE EXCEPTION 'Existing enrollment before allocation requires the scoped pending-registration repair; no records changed'
    USING ERRCODE='P4090'; END IF;
 SELECT submitted_at INTO first_submission FROM public.registration_preferences WHERE student_id=p_student_id
  AND semester=p_semester AND academic_year=p_academic_year;
 had_prior_submission:=first_submission IS NOT NULL OR existing.submitted_at IS NOT NULL;
 first_submission:=coalesce(first_submission,existing.submitted_at,p_submitted_at,now());
 pending_metadata:=jsonb_build_object('registration_state','pending_allocation','preference_credit_breakdown',
  coalesce(p_allocation_metadata->'preference_credit_breakdown',p_allocation_metadata->'credit_breakdown',
    jsonb_build_object('total_credits',p_total_credits)));
 INSERT INTO public.registration_preferences(student_id,campus_id,semester,academic_year,pathway_id,preferences,submitted_at,updated_at)
 VALUES(p_student_id,p_campus_id,p_semester,p_academic_year,p_pathway_id,p_preferences,first_submission,now())
 ON CONFLICT(student_id,semester,academic_year) DO UPDATE SET campus_id=EXCLUDED.campus_id,pathway_id=EXCLUDED.pathway_id,
  preferences=EXCLUDED.preferences,updated_at=now();
 -- An empty cohort anchor supports the existing allocation RPC. No paper is enrolled here.
 INSERT INTO public.student_registrations(student_id,campus_id,semester,academic_year,pathway_id,total_credits,
  allocation_metadata,submitted_at,slot_1_course_id,slot_2_course_id,slot_3_course_id,slot_4_course_id,
  slot_5_course_id,slot_6_course_id,slot_7_course_id,slot_8_course_id)
 VALUES(p_student_id,p_campus_id,p_semester,p_academic_year,p_pathway_id,0,pending_metadata,first_submission,
  NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)
 ON CONFLICT(student_id,semester,academic_year,term_version) DO UPDATE SET pathway_id=EXCLUDED.pathway_id,
  total_credits=0,allocation_metadata=pending_metadata;
 RETURN jsonb_build_object('success',true,'submitted_at',first_submission,'preserved_first_submission',
  had_prior_submission,'registration_state','pending_allocation');
END $$;
REVOKE ALL ON FUNCTION public.submit_student_registration(uuid,uuid,smallint,text,text,jsonb,jsonb,jsonb,numeric,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_student_registration(uuid,uuid,smallint,text,text,jsonb,jsonb,jsonb,numeric,timestamptz) TO service_role;

-- Deferred until commit: the worker writes all slots and the completed run in one transaction.
CREATE OR REPLACE FUNCTION public.guard_enrollment_allocation_completion()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.slot_1_course_id,NEW.slot_2_course_id,NEW.slot_3_course_id,NEW.slot_4_course_id,
   NEW.slot_5_course_id,NEW.slot_6_course_id,NEW.slot_7_course_id,NEW.slot_8_course_id) IS NOT DISTINCT FROM
   ROW(OLD.slot_1_course_id,OLD.slot_2_course_id,OLD.slot_3_course_id,OLD.slot_4_course_id,
   OLD.slot_5_course_id,OLD.slot_6_course_id,OLD.slot_7_course_id,OLD.slot_8_course_id) THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY[NEW.slot_1_course_id,NEW.slot_2_course_id,NEW.slot_3_course_id,
   NEW.slot_4_course_id,NEW.slot_5_course_id,NEW.slot_6_course_id,NEW.slot_7_course_id,NEW.slot_8_course_id]) cid WHERE cid IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM public.system_logs WHERE log_type='allocation_run' AND status='completed'
   AND campus_id=NEW.campus_id AND academic_year=NEW.academic_year AND semester=NEW.semester AND term_version=NEW.term_version) THEN
  RAISE EXCEPTION 'Course enrollment requires a completed allocation for this campus, term, year and semester' USING ERRCODE='P4090';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enrollment_after_allocation ON public.student_registrations;
CREATE CONSTRAINT TRIGGER enrollment_after_allocation AFTER INSERT OR UPDATE ON public.student_registrations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_enrollment_allocation_completion();
REVOKE ALL ON FUNCTION public.guard_enrollment_allocation_completion() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_enrollment_allocation_completion() TO service_role;

-- The allocation function and the scoped repair function follow below.

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

    -- Refuse older workers that omit fixed papers from their final payload.
    -- A requested paper must be committed or explicitly reported unresolved, never silently skipped.
    IF EXISTS (
      WITH wanted AS (
        SELECT p.student_id,'slot_'||coalesce(elements.preference_slot->>'slot',elements.ordinality::text) slot_key
        FROM public.registration_preferences p JOIN public.students s ON s.id=p.student_id
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.preferences)='array' THEN p.preferences ELSE '[]'::jsonb END)
          WITH ORDINALITY elements(preference_slot,ordinality)
        WHERE p.campus_id=p_campus_id AND p.academic_year=p_academic_year AND p.semester=p_semester AND s.current_semester=p_semester
        UNION ALL
        SELECT p.student_id,preference_entry.key FROM public.registration_preferences p JOIN public.students s ON s.id=p.student_id
        CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(p.preferences)='object' THEN p.preferences ELSE '{}'::jsonb END) preference_entry
        WHERE p.campus_id=p_campus_id AND p.academic_year=p_academic_year AND p.semester=p_semester AND s.current_semester=p_semester
          AND preference_entry.key ~ '^slot_[1-8]$'
      ) SELECT 1 FROM wanted w WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_allocations||p_unallocated) a
        WHERE (a->>'student_id')::uuid=w.student_id AND a->>'slot_key'=w.slot_key)
    ) THEN RAISE EXCEPTION 'Allocation payload omits a submitted paper; commit fixed papers with electives'; END IF;

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
            v_meta := COALESCE(v_meta, '{}'::jsonb) || jsonb_build_object('registration_state','allocation_completed');
            v_meta := jsonb_set(
                v_meta,
                ARRAY[v_slot_key],
                COALESCE(item.value->'metadata','{}'::jsonb) || jsonb_build_object(
                    'course_id', v_course_id,
                    'allocated_by', COALESCE(item.value->'metadata'->>'allocated_by', item.value->>'allocated_by', 'elective_run'),
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
REVOKE ALL ON FUNCTION public.apply_course_allocation(uuid,uuid,text,smallint,jsonb,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_course_allocation(uuid,uuid,text,smallint,jsonb,jsonb,jsonb,uuid) TO service_role;

-- Optional repair: this function does nothing until explicitly called for a reviewed row.
CREATE OR REPLACE FUNCTION public.repair_pending_fixed_registration(
 p_registration_id uuid,p_student_id uuid,p_expected_term integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE original public.student_registrations%ROWTYPE; pref public.registration_preferences%ROWTYPE;
 selected record; same_semester boolean; audit_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(76102622134917::bigint);
 SELECT * INTO original FROM public.student_registrations WHERE id=p_registration_id AND student_id=p_student_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'The reviewed registration row was not found'; END IF;
 IF original.term_version IS DISTINCT FROM p_expected_term OR original.term_version IS DISTINCT FROM public.campus_term_version(original.campus_id) THEN
  RAISE EXCEPTION 'Historical or changed-term registrations cannot be repaired with this function' USING ERRCODE='P4090'; END IF;
 SELECT * INTO pref FROM public.registration_preferences WHERE student_id=original.student_id AND campus_id=original.campus_id
  AND semester=original.semester AND academic_year=original.academic_year;
 IF NOT FOUND THEN RAISE EXCEPTION 'A matching pending preference submission is required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM unnest(ARRAY[original.slot_1_course_id,original.slot_2_course_id,original.slot_3_course_id,
  original.slot_4_course_id,original.slot_5_course_id,original.slot_6_course_id,original.slot_7_course_id,original.slot_8_course_id]) cid WHERE cid IS NOT NULL) THEN
  RAISE EXCEPTION 'No premature fixed enrollments to repair'; END IF;
 IF EXISTS(SELECT 1 FROM public.current_system_logs WHERE campus_id=original.campus_id AND academic_year=original.academic_year
   AND semester=original.semester AND log_type='allocation_run' AND status IN ('running','queued','completed')) THEN
  RAISE EXCEPTION 'An active or completed allocation protects this registration'; END IF;
 IF EXISTS(SELECT 1 FROM public.current_timetable_entries WHERE campus_id=original.campus_id AND academic_year=original.academic_year
   AND semester=original.semester) OR EXISTS(SELECT 1 FROM public.period_attendance a WHERE a.student_id=original.student_id
   AND a.course_id=ANY(ARRAY[original.slot_1_course_id,original.slot_2_course_id,original.slot_3_course_id,original.slot_4_course_id,
    original.slot_5_course_id,original.slot_6_course_id,original.slot_7_course_id,original.slot_8_course_id])) THEN
  RAISE EXCEPTION 'Timetable or attendance records require manual review; nothing repaired'; END IF;
 FOR selected IN SELECT * FROM (VALUES(1,original.slot_1_course_id),(2,original.slot_2_course_id),(3,original.slot_3_course_id),
  (4,original.slot_4_course_id),(5,original.slot_5_course_id),(6,original.slot_6_course_id),(7,original.slot_7_course_id),(8,original.slot_8_course_id)) slots(slot,cid)
  WHERE cid IS NOT NULL LOOP
  IF original.allocation_metadata->('slot_'||selected.slot)->>'allocated_by' IS DISTINCT FROM 'fixed'
    OR original.allocation_metadata->('slot_'||selected.slot) ? 'run_id'
    OR original.allocation_metadata->('slot_'||selected.slot) ? 'allocated_at' THEN
   RAISE EXCEPTION 'Only premature fixed-paper enrollments may be repaired'; END IF;
  IF jsonb_typeof(pref.preferences)='array' THEN
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pref.preferences) item CROSS JOIN LATERAL jsonb_array_elements(item->'choices') choice
     WHERE (item->>'slot')::integer=selected.slot AND coalesce((item->>'is_fixed')::boolean,false)
     AND choice->>'course_id'=selected.cid::text) THEN RAISE EXCEPTION 'Fixed enrollment is not backed by the matching preference'; END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(pref.preferences->('slot_'||selected.slot),'[]'::jsonb)) choice
     WHERE choice->>'course_id'=selected.cid::text) THEN RAISE EXCEPTION 'Fixed enrollment is not backed by the matching preference'; END IF;
  END IF;
 END LOOP;
 INSERT INTO public.system_logs(log_type,status,campus_id,academic_year,semester,term_version,event_type,action,resource_type,resource_id,metadata)
 VALUES('audit_event','success',original.campus_id,original.academic_year,original.semester,original.term_version,
  'pending_fixed_registration_repaired','Owner-run repair of premature fixed enrollment','registration',original.id,
  jsonb_build_object('before',to_jsonb(original),'preferences_preserved',true)) RETURNING id INTO audit_id;
 -- Deleting only this reviewed unallocated record also works if the account was moved back a semester.
 -- Existing lifecycle guards remain enabled; no historical record or student semester is modified.
 DELETE FROM public.student_registrations WHERE id=original.id;
 SELECT current_semester=original.semester INTO same_semester FROM public.students WHERE id=original.student_id AND campus_id=original.campus_id;
 IF same_semester THEN
  INSERT INTO public.student_registrations(id,student_id,campus_id,semester,academic_year,pathway_id,total_credits,submitted_at,allocation_metadata)
  VALUES(original.id,original.student_id,original.campus_id,original.semester,original.academic_year,original.pathway_id,0,original.submitted_at,
   jsonb_build_object('registration_state','pending_allocation'));
 END IF;
 RETURN jsonb_build_object('success',true,'registration_id',original.id,'audit_id',audit_id,
  'preferences_preserved',true,'pending_anchor_retained',coalesce(same_semester,false));
END $$;
REVOKE ALL ON FUNCTION public.repair_pending_fixed_registration(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.repair_pending_fixed_registration(uuid,uuid,integer) TO service_role;
COMMIT;
