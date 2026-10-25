-- Compatible first stage: add plain-English guidance without retiring old rules or changing course-update RPCs.
-- The legacy engine is retired separately with the coordinated application release.
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.courses IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.courses ADD COLUMN prerequisites jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE FUNCTION public.valid_course_prerequisites(points jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
  SELECT CASE WHEN jsonb_typeof(points) IS DISTINCT FROM 'array' THEN false ELSE
    jsonb_array_length(points) <= 20 AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(points) AS item(value)
      WHERE jsonb_typeof(value) <> 'string'
        OR length(value #>> '{}') NOT BETWEEN 1 AND 500
        OR (value #>> '{}') <> btrim(value #>> '{}', E' \t\n\r\v\f')
    ) END;
$$;
REVOKE ALL ON FUNCTION public.valid_course_prerequisites(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.valid_course_prerequisites(jsonb) TO service_role;
ALTER TABLE public.courses ADD CONSTRAINT courses_prerequisites_valid CHECK (public.valid_course_prerequisites(prerequisites));
COMMENT ON COLUMN public.courses.prerequisites IS 'Ordered knowledge/skill guidance; student answers are browser-only and never influence allocation.';


NOTIFY pgrst, 'reload schema';
COMMIT;
