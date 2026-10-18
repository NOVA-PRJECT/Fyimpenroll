BEGIN;
DO $test_aec$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM departments d JOIN campuses c ON c.id=d.campus_id
    WHERE d.id='bf97ec6d-3b5f-4956-a885-69f153b6875e'::uuid AND d.code='ECOTT'
      AND c.id='b72074e2-468e-4218-afb6-0f08f14cfe8f'::uuid AND c.code='MANGATTT'
  ) THEN RAISE EXCEPTION 'Test campus/department ownership mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM courses WHERE id='3cfa07eb-4bd2-4ec3-be56-1b6ccbd395e9'::uuid OR course_code='KU02AECHIN103TT')
    THEN RAISE EXCEPTION 'Test AEC already exists; inspect instead of overwriting'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM courses s WHERE s.course_code='KU02AECHIN103'
      AND (to_jsonb(s)-'id'-'department_id'-'course_code')=('{"id":"3cfa07eb-4bd2-4ec3-be56-1b6ccbd395e9","tag":"AEC-2","title":"COMMUNICATIVE HINDI","credits":3,"category":"AEC","semester":2,"seat_limit":60,"course_code":"KU02AECHIN103TT","department_id":"bf97ec6d-3b5f-4956-a885-69f153b6875e","academic_level":null,"theory_hours_per_week":3,"prerequisite_course_ids":[],"practical_hours_per_week":0}'::jsonb-'id'-'department_id'-'course_code')
  ) THEN RAISE EXCEPTION 'Source Hindi metadata changed; refresh the reviewed proposal'; END IF;
  IF EXISTS (SELECT 1 FROM course_prerequisite_rules r JOIN courses s ON s.id=r.course_id WHERE s.course_code='KU02AECHIN103')
    THEN RAISE EXCEPTION 'Source Hindi prerequisites changed; review before copying'; END IF;
  INSERT INTO courses(id,course_code,title,department_id,semester,credits,category,tag,theory_hours_per_week,practical_hours_per_week,seat_limit,prerequisite_course_ids,academic_level)
  VALUES ('3cfa07eb-4bd2-4ec3-be56-1b6ccbd395e9'::uuid,'KU02AECHIN103TT','COMMUNICATIVE HINDI','bf97ec6d-3b5f-4956-a885-69f153b6875e'::uuid,2,3,'AEC','AEC-2',3,0,60,'{}'::uuid[],NULL);
END $test_aec$;
COMMIT;
SELECT jsonb_build_object('added',(SELECT to_jsonb(c) FROM courses c WHERE c.id='3cfa07eb-4bd2-4ec3-be56-1b6ccbd395e9'::uuid),'new_course_prerequisite_rules',(SELECT count(*) FROM course_prerequisite_rules WHERE course_id='3cfa07eb-4bd2-4ec3-be56-1b6ccbd395e9'::uuid),'test_courses',(SELECT count(*) FROM courses c JOIN departments d ON d.id=c.department_id WHERE d.campus_id='b72074e2-468e-4218-afb6-0f08f14cfe8f'::uuid),'test_registrations',(SELECT count(*) FROM student_registrations WHERE campus_id='b72074e2-468e-4218-afb6-0f08f14cfe8f'::uuid AND academic_year='2026-27'),'new_course_enrolments',(SELECT count(*) FROM student_registrations r WHERE r.semester=2 AND r.academic_year='2026-27' AND '3cfa07eb-4bd2-4ec3-be56-1b6ccbd395e9'::uuid=ANY(ARRAY[r.slot_1_course_id,r.slot_2_course_id,r.slot_3_course_id,r.slot_4_course_id,r.slot_5_course_id,r.slot_6_course_id,r.slot_7_course_id,r.slot_8_course_id])));
