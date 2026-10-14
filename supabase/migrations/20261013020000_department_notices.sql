BEGIN;
CREATE TABLE IF NOT EXISTS public.department_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id uuid NOT NULL REFERENCES public.campuses(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS department_notices_scope_date
  ON public.department_notices(campus_id, department_id, created_at DESC, id DESC);
ALTER TABLE public.department_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.department_notices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.department_notices TO service_role;
INSERT INTO public.schema_migrations(version,name)
VALUES ('20261013020000_department_notices','Scoped department notices for student and faculty portals')
ON CONFLICT(version) DO NOTHING;
NOTIFY pgrst, 'reload schema';
COMMIT;
