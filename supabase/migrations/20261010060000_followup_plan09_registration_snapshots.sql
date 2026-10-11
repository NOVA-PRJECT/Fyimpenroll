-- All registration writers use flat slots. Preserve snapshots only for the same
-- slot/course; capture catalogue values only on a new enrollment, never backfill history.
BEGIN;
CREATE OR REPLACE FUNCTION public.sync_registration_snapshots() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_slot int; v_course uuid; v_previous uuid; v_snapshot jsonb;
  v_old_selections jsonb := '[]'; v_selections jsonb := '[]';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_selections := CASE WHEN jsonb_typeof(OLD.selections) = 'array' THEN OLD.selections
      WHEN jsonb_typeof(OLD.selections->'courses') = 'array' THEN OLD.selections->'courses' ELSE '[]'::jsonb END;
  END IF;
  FOR v_slot IN 1..8 LOOP
    v_course := (to_jsonb(NEW)->>format('slot_%s_course_id',v_slot))::uuid;
    IF v_course IS NULL THEN CONTINUE; END IF;
    v_previous := CASE WHEN TG_OP = 'UPDATE' THEN (to_jsonb(OLD)->>format('slot_%s_course_id',v_slot))::uuid ELSE NULL END;
    v_snapshot := NULL;
    IF v_previous = v_course THEN
      SELECT item INTO v_snapshot FROM jsonb_array_elements(v_old_selections) item
        WHERE COALESCE(item->>'course_id',item->>'id') = v_course::text
        AND (item->>'slot' = v_slot::text OR item->>'slot' IS NULL) LIMIT 1;
    ELSE
      SELECT jsonb_build_object('credits',credits,'category',category,'academic_level',academic_level,'snapshotted_at',now())
        INTO v_snapshot FROM courses WHERE id = v_course;
    END IF;
    v_selections := v_selections || jsonb_build_array(COALESCE(v_snapshot,'{}'::jsonb) ||
      jsonb_build_object('course_id',v_course,'slot',v_slot));
  END LOOP;
  NEW.selections := v_selections;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS registration_snapshots ON public.student_registrations;
CREATE TRIGGER registration_snapshots BEFORE INSERT OR UPDATE ON public.student_registrations
FOR EACH ROW EXECUTE FUNCTION public.sync_registration_snapshots();
-- Reconcile stale selections; the trigger deliberately does not invent old credits.
UPDATE public.student_registrations SET selections = selections;
INSERT INTO schema_migrations(version,name) VALUES ('20261010060000_followup_plan09_registration_snapshots','Canonical enrollment and registration-time snapshots') ON CONFLICT DO NOTHING;
COMMIT;
