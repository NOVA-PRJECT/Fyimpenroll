BEGIN;
-- This corrects one existing department. It creates, merges and deletes no data.
LOCK TABLE public.departments, public.faculty, public.courses, public.semester_blueprints,
  public.students, public.department_notices, public.student_registrations,
  public.registration_preferences, public.teacher_course_assignments, public.timetable_entries,
  public.timetable_conflicts, public.period_attendance, public.course_prerequisite_rules IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE
  history_id constant uuid := 'e814d190-e1c2-4731-b2ec-d97d5dc897e0';
  destination constant uuid := '5b5289d5-17eb-43ba-832e-19883e9eaada';
  hod_id constant uuid := 'd16aa6e6-bbdb-4156-81f1-31df5815a7db';
  expected_courses constant uuid[] := ARRAY['e8140001-e1c2-4731-b2ec-d97d5dc89701','e8140002-e1c2-4731-b2ec-d97d5dc89702',
    'e8140003-e1c2-4731-b2ec-d97d5dc89703','e8140004-e1c2-4731-b2ec-d97d5dc89704']::uuid[];
  expected_blueprints constant uuid[] := ARRAY['ba0cd4e4-c95f-4056-bd2f-1b49e86d481f','d90d5cf3-fd22-47bb-9401-894f0565feb1']::uuid[];
  before_courses jsonb; before_blueprints jsonb; before_faculty jsonb; before_auth jsonb;
  found_usage boolean; t text; old_department jsonb;
BEGIN
  SELECT to_jsonb(d) INTO old_department FROM public.departments d WHERE id=history_id;
  IF old_department IS NULL OR old_department->>'code'<>'HIS' OR old_department->>'name'<>'History'
    OR (old_department->>'campus_id')::uuid NOT IN ('feed55c6-deea-46b7-9fa1-a97cfabf0838'::uuid,destination) THEN
    RAISE EXCEPTION 'History correction stopped: unexpected department ownership';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.campuses WHERE id=destination AND code='MANGAT') OR
    EXISTS(SELECT 1 FROM public.departments WHERE campus_id=destination AND code='HIS' AND id<>history_id) THEN
    RAISE EXCEPTION 'History correction stopped: destination changed';
  END IF;
  IF (SELECT array_agg(id ORDER BY id) FROM public.courses WHERE department_id=history_id) IS DISTINCT FROM expected_courses OR
    (SELECT array_agg(id ORDER BY id) FROM public.semester_blueprints WHERE department_id=history_id) IS DISTINCT FROM expected_blueprints OR
    (SELECT array_agg(id ORDER BY id) FROM public.faculty WHERE department_id=history_id) IS DISTINCT FROM ARRAY[hod_id] OR
    NOT EXISTS(SELECT 1 FROM public.faculty WHERE id=hod_id AND role='hod' AND campus_id=destination AND department_id=history_id) THEN
    RAISE EXCEPTION 'History correction stopped: unexpected courses, blueprints or faculty';
  END IF;
  IF EXISTS(SELECT 1 FROM public.students WHERE department_id=history_id) OR
    EXISTS(SELECT 1 FROM public.department_notices WHERE department_id=history_id) OR
    EXISTS(SELECT 1 FROM public.timetable_entries WHERE department_id=history_id) THEN
    RAISE EXCEPTION 'History correction stopped: new department usage';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid='public.departments'::regclass AND
    conrelid NOT IN ('public.faculty'::regclass,'public.students'::regclass,'public.courses'::regclass,
      'public.semester_blueprints'::regclass,'public.department_notices'::regclass,'public.timetable_entries'::regclass)) THEN
    RAISE EXCEPTION 'History correction stopped: new department dependency';
  END IF;
  FOREACH t IN ARRAY ARRAY['student_registrations','registration_preferences','teacher_course_assignments',
    'timetable_entries','timetable_conflicts','period_attendance','courses','course_prerequisite_rules'] LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I r WHERE public.course_row_references($1,to_jsonb(r)) && $2)',t)
      INTO found_usage USING t,expected_courses;
    IF found_usage THEN RAISE EXCEPTION 'History correction stopped: new usage in %',t; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.semester_blueprints b WHERE department_id<>history_id AND
    public.course_row_references('semester_blueprints',to_jsonb(b)) && expected_courses) THEN
    RAISE EXCEPTION 'History correction stopped: new external blueprint usage';
  END IF;
  SELECT raw_app_meta_data INTO before_auth FROM auth.users WHERE id=hod_id FOR SHARE;
  IF before_auth->>'campus_id' IS DISTINCT FROM destination::text OR before_auth->>'department_id' IS DISTINCT FROM history_id::text THEN
    RAISE EXCEPTION 'History correction stopped: HOD Auth metadata changed';
  END IF;
  SELECT jsonb_agg(to_jsonb(c) ORDER BY id) INTO before_courses FROM public.courses c WHERE department_id=history_id;
  SELECT jsonb_agg(to_jsonb(b) ORDER BY id) INTO before_blueprints FROM public.semester_blueprints b WHERE department_id=history_id;
  SELECT to_jsonb(f) INTO before_faculty FROM public.faculty f WHERE id=hod_id;
  UPDATE public.departments SET campus_id=destination WHERE id=history_id;
  IF (SELECT to_jsonb(d)-'campus_id' FROM public.departments d WHERE id=history_id) IS DISTINCT FROM old_department-'campus_id' OR
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.courses c WHERE department_id=history_id) IS DISTINCT FROM before_courses OR
    (SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.semester_blueprints b WHERE department_id=history_id) IS DISTINCT FROM before_blueprints OR
    (SELECT to_jsonb(f) FROM public.faculty f WHERE id=hod_id) IS DISTINCT FROM before_faculty OR
    (SELECT raw_app_meta_data FROM auth.users WHERE id=hod_id) IS DISTINCT FROM before_auth THEN
    RAISE EXCEPTION 'History correction verification failed; rolling back';
  END IF;
END $$;
-- Composite FK also protects campus/department consistency under concurrent writes.
ALTER TABLE public.departments ADD CONSTRAINT departments_id_campus_unique UNIQUE(id,campus_id);
ALTER TABLE public.faculty ADD CONSTRAINT faculty_department_campus_fk
  FOREIGN KEY(department_id,campus_id) REFERENCES public.departments(id,campus_id);
COMMIT;
