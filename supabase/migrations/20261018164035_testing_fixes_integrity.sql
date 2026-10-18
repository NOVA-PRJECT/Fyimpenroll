BEGIN;

-- Partial unique indexes arbitrate concurrent account creation and role transfers.
CREATE UNIQUE INDEX faculty_one_hod_per_department ON public.faculty(department_id) WHERE role = 'hod';
CREATE UNIQUE INDEX faculty_one_director_per_campus ON public.faculty(campus_id) WHERE role = 'campus_director';
CREATE UNIQUE INDEX faculty_one_teaching_staff_per_campus ON public.faculty(campus_id) WHERE role = 'teaching_staff';
ALTER TABLE public.faculty ADD CONSTRAINT faculty_administrative_assignment CHECK (
  (role <> 'hod' OR (department_id IS NOT NULL AND campus_id IS NOT NULL)) AND
  (role NOT IN ('campus_director', 'teaching_staff') OR (department_id IS NULL AND campus_id IS NOT NULL))
);

CREATE OR REPLACE FUNCTION public.check_faculty_campus() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.role = 'hod' AND NOT EXISTS (SELECT 1 FROM public.departments WHERE id = NEW.department_id AND campus_id = NEW.campus_id) THEN
    RAISE EXCEPTION 'Department must belong to the selected campus' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER faculty_campus_guard BEFORE INSERT OR UPDATE OF role, department_id, campus_id ON public.faculty
FOR EACH ROW EXECUTE FUNCTION public.check_faculty_campus();

-- Pure token extraction covers both current and legacy ranked preference formats.
CREATE OR REPLACE FUNCTION public.course_reference_tokens(value jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT token #>> '{}'), ARRAY[]::text[])
  FROM jsonb_path_query(coalesce(value, 'null'::jsonb), 'strict $.** ? (@.type() == "string")') AS token;
$$;

CREATE OR REPLACE FUNCTION public.course_row_references(table_name text, row_data jsonb) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE tokens text[] := ARRAY[]::text[]; slot jsonb; pathway jsonb; i int;
BEGIN
  CASE table_name
  WHEN 'semester_blueprints' THEN
    FOR i IN 1..6 LOOP
      IF row_data->>('slot_'||i||'_rule') IN ('FIXED','CAMPUS_FIXED','AEC_ELECT') THEN
        tokens := array_append(tokens, row_data->>('slot_'||i||'_target'));
      END IF;
    END LOOP;
    FOR pathway IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(row_data->'pathways')='array' THEN row_data->'pathways' ELSE '[]'::jsonb END) LOOP
      FOR slot IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(pathway->'slots')='array' THEN pathway->'slots' ELSE '[]'::jsonb END) LOOP
        IF slot->>'rule' IN ('FIXED','CAMPUS_FIXED','AEC_ELECT') THEN tokens := array_append(tokens, slot->>'target'); END IF;
      END LOOP;
    END LOOP;
  WHEN 'courses' THEN tokens := public.course_reference_tokens(row_data->'prerequisite_course_ids');
  WHEN 'course_prerequisite_rules' THEN
    IF row_data->>'rule' = 'COMPLETED_COURSE' THEN tokens := regexp_split_to_array(upper(row_data->>'target'), '\s*,\s*'); END IF;
  WHEN 'student_registrations' THEN
    FOR i IN 1..8 LOOP tokens := array_append(tokens, row_data->>('slot_'||i||'_course_id')); END LOOP;
    tokens := tokens || public.course_reference_tokens(jsonb_build_array(row_data->'preferences', row_data->'selections', row_data->'selected_courses'));
  WHEN 'registration_preferences' THEN tokens := public.course_reference_tokens(row_data->'preferences');
  ELSE tokens := ARRAY[row_data->>'course_id', row_data->>'blocking_course_id'];
  END CASE;
  RETURN ARRAY(SELECT c.id FROM public.courses c WHERE c.id::text = ANY(tokens) OR c.course_code = ANY(tokens) ORDER BY c.id);
END $$;

CREATE OR REPLACE FUNCTION public.course_usage_types(course_id uuid) RETURNS text[]
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE used text[] := ARRAY[]::text[]; item record; item_found boolean;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('student_registrations','registrations'), ('registration_preferences','ranked preferences'),
    ('semester_blueprints','explicit blueprint references'), ('teacher_course_assignments','teacher assignments'),
    ('timetable_entries','timetable records'), ('timetable_conflicts','timetable conflicts'),
    ('period_attendance','attendance records'), ('courses','prerequisite dependencies'),
    ('course_prerequisite_rules','prerequisite dependencies')
  ) AS types(table_name, label) LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=item.table_name) THEN
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I r WHERE $1 = ANY(public.course_row_references($2, to_jsonb(r))))', item.table_name)
      INTO item_found USING course_id, item.table_name;
      IF item_found AND NOT item.label = ANY(used) THEN used := array_append(used, item.label); END IF;
    END IF;
  END LOOP;
  RETURN used;
END $$;

-- Reference writers share this lock; the rare semester move takes it exclusively.
-- Acquire it BEFORE resolving IDs, including blueprints that reference course codes.
-- The second read after waiting uses a fresh READ COMMITTED snapshot.
CREATE OR REPLACE FUNCTION public.guard_course_reference_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE row_data jsonb; ref_ids uuid[]; target_sem int; invalid boolean;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(76102618164035::bigint);
  row_data := to_jsonb(NEW);
  ref_ids := public.course_row_references(TG_TABLE_NAME, row_data);
  IF TG_TABLE_NAME IN ('courses', 'course_prerequisite_rules') THEN
    IF TG_TABLE_NAME = 'courses' THEN
      target_sem := NEW.semester;
      IF cardinality(ref_ids) <> jsonb_array_length(coalesce(nullif(row_data->'prerequisite_course_ids', 'null'::jsonb),'[]'::jsonb)) THEN
        RAISE EXCEPTION 'Unknown prerequisite course' USING ERRCODE='23514';
      END IF;
    ELSE SELECT semester INTO target_sem FROM public.courses WHERE id = NEW.course_id; END IF;
    SELECT EXISTS (SELECT 1 FROM public.courses WHERE id = ANY(ref_ids) AND semester >= target_sem) INTO invalid;
    IF invalid THEN RAISE EXCEPTION 'Prerequisites must be from an earlier semester' USING ERRCODE = '23514'; END IF;
  ELSIF row_data ? 'semester' THEN
    target_sem := (row_data->>'semester')::int;
    SELECT EXISTS (SELECT 1 FROM public.courses WHERE id = ANY(ref_ids) AND semester <> target_sem) INTO invalid;
    IF invalid THEN RAISE EXCEPTION 'A referenced course has changed semester; refresh the catalogue and retry' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.guard_course_semester_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE blockers text[]; rule_row record;
BEGIN
  IF NEW.semester IS DISTINCT FROM OLD.semester THEN
    PERFORM pg_advisory_xact_lock(76102618164035::bigint);
    blockers := public.course_usage_types(OLD.id);
    IF cardinality(blockers) > 0 THEN
      RAISE EXCEPTION 'Course semester cannot change: %', array_to_string(blockers, ', ')
        USING ERRCODE = 'P4090', DETAIL = to_json(blockers)::text;
    END IF;
    FOR rule_row IN SELECT * FROM public.course_prerequisite_rules WHERE course_id = OLD.id AND rule = 'COMPLETED_COURSE' LOOP
      IF EXISTS (SELECT 1 FROM public.courses WHERE id = ANY(public.course_row_references('course_prerequisite_rules',to_jsonb(rule_row))) AND semester >= NEW.semester) THEN
        RAISE EXCEPTION 'Prerequisites must be from an earlier semester' USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER course_semester_guard BEFORE UPDATE OF semester ON public.courses
FOR EACH ROW EXECUTE FUNCTION public.guard_course_semester_change();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['student_registrations','registration_preferences','semester_blueprints',
    'teacher_course_assignments','timetable_entries','timetable_conflicts','period_attendance',
    'course_prerequisite_rules','courses'] LOOP
    EXECUTE format('CREATE TRIGGER course_reference_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_course_reference_write()', t);
  END LOOP;
END $$;

-- Backend supplies the verified HOD department; clients cannot invoke this RPC.
-- Lock precedes the UPDATE row lock, avoiding lock inversion with FK checks.
CREATE OR REPLACE FUNCTION public.update_hod_course_guarded(p_id uuid, p_department_id uuid, p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE saved public.courses; destination int;
BEGIN
  PERFORM pg_advisory_xact_lock(76102618164035::bigint);
  SELECT * INTO saved FROM public.courses WHERE id = p_id AND department_id = p_department_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Course not found in your department' USING ERRCODE = 'P4040'; END IF;
  destination := coalesce((p_patch->>'semester')::int, saved.semester);
  IF destination NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Semester must be between 1 and 10' USING ERRCODE='23514'; END IF;
  UPDATE public.courses SET
    course_code = coalesce(p_patch->>'course_code', saved.course_code), title = coalesce(p_patch->>'title', saved.title),
    credits = coalesce((p_patch->>'credits')::int, saved.credits), category = coalesce(p_patch->>'category', saved.category),
    theory_hours_per_week = coalesce((p_patch->>'theory_hours_per_week')::smallint, saved.theory_hours_per_week),
    practical_hours_per_week = coalesce((p_patch->>'practical_hours_per_week')::smallint, saved.practical_hours_per_week),
    seat_limit = coalesce((p_patch->>'seat_limit')::int, saved.seat_limit), semester = destination,
    prerequisite_course_ids = CASE WHEN p_patch ? 'prerequisite_course_ids' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'prerequisite_course_ids')::uuid) ELSE saved.prerequisite_course_ids END
    WHERE id = p_id AND department_id = p_department_id RETURNING * INTO saved;
  RETURN jsonb_build_object('id',saved.id,'semester',saved.semester);
END $$;

REVOKE ALL ON FUNCTION public.check_faculty_campus(), public.course_reference_tokens(jsonb), public.course_row_references(text,jsonb),
  public.course_usage_types(uuid), public.guard_course_reference_write(), public.guard_course_semester_change(),
  public.update_hod_course_guarded(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.course_reference_tokens(jsonb), public.course_row_references(text,jsonb),
  public.course_usage_types(uuid), public.update_hod_course_guarded(uuid,uuid,jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
