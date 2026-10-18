BEGIN;
DO $probe$
DECLARE f record; violated text; checked int:=0; original jsonb; rejected boolean:=false;
BEGIN
  FOR f IN SELECT DISTINCT ON(role) role,campus_id,department_id FROM public.faculty
    WHERE role IN ('hod','campus_director','teaching_staff') ORDER BY role,id LOOP
    violated:=NULL;
    BEGIN
      INSERT INTO public.faculty(id,full_name,email,role,campus_id,department_id)
      VALUES(gen_random_uuid(),'Discarded integrity probe',gen_random_uuid()::text||'@example.invalid',f.role,f.campus_id,f.department_id);
      RAISE EXCEPTION 'Probe failed: duplicate role was accepted';
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;
      IF violated IS DISTINCT FROM (CASE f.role WHEN 'hod' THEN 'faculty_one_hod_per_department'
        WHEN 'campus_director' THEN 'faculty_one_director_per_campus' ELSE 'faculty_one_teaching_staff_per_campus' END) THEN
        RAISE EXCEPTION 'Probe hit unexpected constraint: %',violated;
      END IF;
    END;
    checked:=checked+1;
  END LOOP;
  IF checked<>3 THEN RAISE EXCEPTION 'Not all three role limits were tested'; END IF;
  SELECT to_jsonb(c) INTO original FROM public.courses c WHERE id='e8140001-e1c2-4731-b2ec-d97d5dc89701';
  BEGIN
    PERFORM public.update_hod_course_guarded('e8140001-e1c2-4731-b2ec-d97d5dc89701','e814d190-e1c2-4731-b2ec-d97d5dc897e0','{"semester":2}');
  EXCEPTION WHEN SQLSTATE 'P4090' THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Probe failed: referenced course move was accepted'; END IF;
  IF (SELECT to_jsonb(c) FROM public.courses c WHERE id='e8140001-e1c2-4731-b2ec-d97d5dc89701') IS DISTINCT FROM original THEN
    RAISE EXCEPTION 'Probe failed: course changed';
  END IF;
END $probe$;
ROLLBACK;
