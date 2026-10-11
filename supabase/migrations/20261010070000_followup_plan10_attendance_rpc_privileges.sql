-- The attendance RPCs accept trusted actor/roster IDs. Resource authorization is
-- performed by the backend; browser-authenticated callers must not bypass it.
BEGIN;
REVOKE ALL ON FUNCTION public.atomic_replace_timetable_draft(uuid,text,integer,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_replace_timetable_draft(uuid,text,integer,jsonb,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.atomic_submit_period_attendance(uuid,date,uuid,uuid[],uuid[],uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.atomic_copy_practical_attendance(uuid,uuid,date,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_submit_period_attendance(uuid,date,uuid,uuid[],uuid[],uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.atomic_copy_practical_attendance(uuid,uuid,date,uuid,integer) TO service_role;
INSERT INTO schema_migrations(version,name) VALUES ('20261010070000_followup_plan10_attendance_rpc_privileges','Restrict trusted attendance RPCs to backend callers') ON CONFLICT DO NOTHING;
COMMIT;
