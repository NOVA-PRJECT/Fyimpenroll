-- Approved test foundation only: one campus, eight departments, one settings row.
-- Run once against project lhnjlwtdphugjaluzrsp. No Auth/course/blueprint writes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

DO $foundation$
DECLARE
  target_campus CONSTANT uuid := 'b72074e2-468e-4218-afb6-0f08f14cfe8f';
  settings_count integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.campuses
    WHERE id = target_campus OR code = 'MANGATTT' OR name = 'Test KUC Mangattuparamba TT'
  ) THEN
    RAISE EXCEPTION 'Planned campus already exists or collides; do not overwrite it.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.departments
    WHERE code IN ('ECOTT','EVSTT','ITTT','MATTT','PESTT','SBSTT','STATT','SWTTT')
       OR id IN (
         'bf97ec6d-3b5f-4956-a885-69f153b6875e'::uuid,
         '5751ee44-a424-4076-963c-de7f24d76d2c'::uuid,
         '77eacd1e-1577-4e39-84f2-d8e45da4f095'::uuid,
         'a3dd0c91-e402-40aa-84df-ef4ad9906964'::uuid,
         '57b1e81f-6b20-4900-87fb-82d49cd4a6ec'::uuid,
         '9d3e0366-5b7c-4fc4-8f7e-680967378927'::uuid,
         '255df1ce-3c98-4cdb-8c6f-148806517d29'::uuid,
         '59877e9e-81f1-4f5d-9633-7a6ae3457c39'::uuid
       )
  ) THEN
    RAISE EXCEPTION 'Planned test department ID/code collision; no rows inserted.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE lower(email) IN (
      'director.mangattt.20261018@example.test',
      'teaching-staff.mangattt.20261018@example.test',
      'hod.ecott.mangattt.20261018@example.test',
      'hod.evstt.mangattt.20261018@example.test',
      'hod.ittt.mangattt.20261018@example.test',
      'hod.mattt.mangattt.20261018@example.test',
      'hod.pestt.mangattt.20261018@example.test',
      'hod.sbstt.mangattt.20261018@example.test',
      'hod.statt.mangattt.20261018@example.test',
      'hod.swttt.mangattt.20261018@example.test'
    )
  ) THEN
    RAISE EXCEPTION 'A planned Auth email already exists; review before creating the foundation.';
  END IF;

  INSERT INTO public.campuses (
    id, name, code, center_latitude, center_longitude, radius_meters,
    morning_cutoff_time, midday_split_time, evening_cutoff_time, day_end_time
  ) VALUES (
    target_campus, 'Test KUC Mangattuparamba TT', 'MANGATTT', 11.9388, 75.3687, 500,
    '09:30:00', '13:30:00', '15:30:00', '17:00:00'
  );

  INSERT INTO public.departments (id, name, code, campus_id) VALUES
    ('bf97ec6d-3b5f-4956-a885-69f153b6875e', 'Test Department of Economics TT', 'ECOTT', target_campus),
    ('5751ee44-a424-4076-963c-de7f24d76d2c', 'Test Environmental Studies TT', 'EVSTT', target_campus),
    ('77eacd1e-1577-4e39-84f2-d8e45da4f095', 'Test Information Technology TT', 'ITTT', target_campus),
    ('a3dd0c91-e402-40aa-84df-ef4ad9906964', 'Test Mathematical Science TT', 'MATTT', target_campus),
    ('57b1e81f-6b20-4900-87fb-82d49cd4a6ec', 'Test Physical Education & Sports TT', 'PESTT', target_campus),
    ('9d3e0366-5b7c-4fc4-8f7e-680967378927', 'Test School Of Behavioural Sciences TT', 'SBSTT', target_campus),
    ('255df1ce-3c98-4cdb-8c6f-148806517d29', 'Test Statistical Sciences TT', 'STATT', target_campus),
    ('59877e9e-81f1-4f5d-9633-7a6ae3457c39', 'Test Department of Wood Science & Technology TT', 'SWTTT', target_campus);

  -- The campus insert trigger creates this row; preserve its generated ID.
  UPDATE public.campus_settings
  SET academic_year = '2026-27', min_credits = 18, max_credits = 26,
      deadline = NULL, last_promoted_at = NULL, timetable_constraints = NULL
  WHERE campus_id = target_campus;
  GET DIAGNOSTICS settings_count = ROW_COUNT;
  IF settings_count <> 1 THEN
    RAISE EXCEPTION 'Expected one trigger-created settings row; rolling back foundation.';
  END IF;

  IF (SELECT count(*) FROM public.departments WHERE campus_id = target_campus) <> 8 THEN
    RAISE EXCEPTION 'Expected eight departments; rolling back foundation.';
  END IF;
END;
$foundation$;
COMMIT;

SELECT jsonb_build_object(
  'status', 'FOUNDATION_CREATED',
  'campus', (SELECT to_jsonb(c) FROM public.campuses c WHERE id = 'b72074e2-468e-4218-afb6-0f08f14cfe8f'),
  'departments', (SELECT jsonb_agg(to_jsonb(d) ORDER BY code) FROM public.departments d WHERE campus_id = 'b72074e2-468e-4218-afb6-0f08f14cfe8f'),
  'settings', (SELECT to_jsonb(s) FROM public.campus_settings s WHERE campus_id = 'b72074e2-468e-4218-afb6-0f08f14cfe8f')
);
