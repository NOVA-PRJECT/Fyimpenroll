-- Preserve existing records. Derive each new record's IST date from its timestamp,
-- including installs where the original generated column was replaced by a plain date.
BEGIN;
CREATE OR REPLACE FUNCTION public.set_campus_sign_in_date()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.signed_in_date := (NEW.signed_in_at AT TIME ZONE 'Asia/Kolkata')::date;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_campus_sign_in_date() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'campus_sign_ins'
      AND column_name = 'signed_in_date' AND is_generated = 'NEVER') THEN
    ALTER TABLE public.campus_sign_ins ALTER COLUMN signed_in_date
      SET DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date);
    DROP TRIGGER IF EXISTS campus_sign_in_date_from_timestamp ON public.campus_sign_ins;
    CREATE TRIGGER campus_sign_in_date_from_timestamp BEFORE INSERT OR UPDATE OF signed_in_at, signed_in_date
      ON public.campus_sign_ins FOR EACH ROW EXECUTE FUNCTION public.set_campus_sign_in_date();
  END IF;
END;
$$;
COMMIT;
