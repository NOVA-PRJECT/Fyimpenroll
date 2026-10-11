BEGIN;
SET LOCAL lock_timeout = '5s';
-- Prevent concurrent workers from racing schema changes. No timetable rows are
-- changed by this migration; legacy drafts are replaced only on the next run.
LOCK TABLE public.timetable_entries, public.system_logs IN SHARE ROW EXCLUSIVE MODE;
DO $repair$
DECLARE
    candidate record;
    owner_constraint text;
    new_index record;
BEGIN
    IF current_setting('server_version_num')::int < 150000 THEN
        RAISE EXCEPTION 'This repair requires PostgreSQL 15 or newer';
    END IF;
    IF EXISTS (SELECT 1 FROM public.system_logs WHERE log_type = 'timetable_job'
        AND status IN ('queued', 'running')) THEN
        RAISE EXCEPTION 'Timetable generation is active. Wait for it to finish before applying this repair.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.timetable_entries
        GROUP BY campus_id, academic_year, semester, course_id, time_slot_id, department_id
        HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'Duplicate course delivery rows already exist. Review them before applying this repair; no rows were deleted.';
    END IF;

    -- Replace only the two known historical keys. Preserve unrelated constraints.
    FOR candidate IN
        SELECT i.indexrelid, x.relname AS index_name,
            string_agg(a.attname, ',' ORDER BY a.attname) AS columns
        FROM pg_index i JOIN pg_class x ON x.oid = i.indexrelid
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = 'public.timetable_entries'::regclass AND i.indisunique
          AND NOT i.indisprimary AND i.indpred IS NULL AND i.indexprs IS NULL
        GROUP BY i.indexrelid, x.relname
        HAVING string_agg(a.attname, ',' ORDER BY a.attname) IN (
            'academic_year,course_id,department_id,semester,time_slot_id',
            'academic_year,department_id,semester,time_slot_id')
    LOOP
        SELECT conname INTO owner_constraint FROM pg_constraint WHERE conindid = candidate.indexrelid;
        IF owner_constraint IS NOT NULL THEN
            EXECUTE format('ALTER TABLE public.timetable_entries DROP CONSTRAINT %I', owner_constraint);
        ELSE
            EXECUTE format('DROP INDEX public.%I', candidate.index_name);
        END IF;
    END LOOP;
    IF to_regclass('public.timetable_entries_unique') IS NOT NULL THEN
        RAISE EXCEPTION 'Unexpected timetable_entries_unique definition. Inspect it before applying this repair.';
    END IF;

    IF to_regclass('public.timetable_entries_delivery_unique') IS NOT NULL THEN
        SELECT i.indisunique, i.indnullsnotdistinct, i.indpred IS NULL AS unconditional,
            i.indexprs IS NULL AS plain_columns, string_agg(a.attname, ',' ORDER BY a.attname) AS columns
        INTO new_index FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
        WHERE i.indexrelid='public.timetable_entries_delivery_unique'::regclass
          AND i.indrelid='public.timetable_entries'::regclass
        GROUP BY i.indisunique, i.indnullsnotdistinct, (i.indpred IS NULL), (i.indexprs IS NULL);
        IF NOT FOUND THEN RAISE EXCEPTION 'Unexpected timetable_entries_delivery_unique relation'; END IF;
        IF NOT new_index.indisunique OR NOT new_index.indnullsnotdistinct OR NOT new_index.unconditional
            OR NOT new_index.plain_columns OR new_index.columns IS DISTINCT FROM
                'academic_year,campus_id,course_id,department_id,semester,time_slot_id' THEN
            RAISE EXCEPTION 'Unexpected timetable_entries_delivery_unique definition';
        END IF;
    END IF;
END;
$repair$;
CREATE UNIQUE INDEX IF NOT EXISTS timetable_entries_delivery_unique
    ON public.timetable_entries (campus_id, academic_year, semester, course_id, time_slot_id, department_id)
    NULLS NOT DISTINCT;

CREATE OR REPLACE FUNCTION atomic_replace_timetable_draft(
    p_campus_id UUID,
    p_academic_year TEXT,
    p_semester INT,
    p_entries JSONB,
    p_job_id UUID,
    p_fencing_token UUID
)
RETURNS JSONB AS $$
DECLARE
    v_published_count INT;
    v_inserted_count INT := 0;
    v_entry JSONB;
BEGIN
    IF p_campus_id IS NULL THEN RAISE EXCEPTION 'An explicit campus is required'; END IF;
    -- Acquire transaction-level advisory lock on this cohort
    PERFORM pg_advisory_xact_lock(hashtext('timetable:' || COALESCE(p_campus_id::text, 'all') || ':' || p_academic_year || ':' || p_semester::text));

    -- Check if cohort is already published
    SELECT COUNT(*)
    INTO v_published_count
    FROM timetable_entries
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
        SELECT 1 FROM system_logs WHERE id = p_job_id AND log_type = 'timetable_job'
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
    DELETE FROM timetable_entries
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
            SELECT md5(string_agg(e::text, ',' ORDER BY e.id)) FROM timetable_entries e
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.atomic_replace_timetable_draft(uuid,text,int,jsonb,uuid,uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_replace_timetable_draft(uuid,text,int,jsonb,uuid,uuid) TO service_role;
INSERT INTO public.schema_migrations(version,name)
VALUES ('20261011010000_timetable_draft_delivery_repair', 'Host-campus timetable uniqueness and legacy draft replacement')
ON CONFLICT (version) DO NOTHING;
COMMIT;

-- Verification: the replacement index should include campus_id and course_id.
SELECT indexname,indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='timetable_entries' AND indexname='timetable_entries_delivery_unique';
