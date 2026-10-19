-- Keep IDs, campus ownership and all existing foreign keys unchanged.
LOCK TABLE public.departments IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.departments GROUP BY lower(btrim(name)) HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM public.departments GROUP BY upper(btrim(code)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Department names or codes collide after normalization. Resolve these explicitly before retrying.';
  END IF;
  -- Codes are also stored in blueprint/prerequisite rule targets. Never silently rename one.
  IF EXISTS (SELECT 1 FROM public.departments WHERE code IS DISTINCT FROM upper(btrim(code))) THEN
    RAISE EXCEPTION 'Noncanonical department codes need a reviewed reference migration before continuing.';
  END IF;
END $$;

CREATE FUNCTION public.normalize_department_metadata()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.name := btrim(NEW.name);
  NEW.code := upper(btrim(NEW.code));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.normalize_department_metadata() FROM PUBLIC;

CREATE TRIGGER normalize_department_metadata
BEFORE INSERT OR UPDATE ON public.departments
FOR EACH ROW EXECUTE FUNCTION public.normalize_department_metadata();

UPDATE public.departments SET name = btrim(name) WHERE name IS DISTINCT FROM btrim(name);

CREATE UNIQUE INDEX departments_name_normalized_key ON public.departments (lower(btrim(name)));
CREATE UNIQUE INDEX departments_code_normalized_key ON public.departments (upper(btrim(code)));

ALTER TABLE public.departments ADD CONSTRAINT departments_metadata_nonempty
CHECK (length(btrim(name)) > 0 AND length(btrim(code)) > 0);
