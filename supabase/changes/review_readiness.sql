-- Owner-run LAST, after review_scheduling.sql. Compatibility receipt is conditional on actual capabilities.
BEGIN;
SET LOCAL lock_timeout='10s';
CREATE FUNCTION public.audit_business_change() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE row_data jsonb; actor uuid; headers jsonb; resource uuid;
BEGIN
 row_data:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
 actor:=coalesce(nullif(current_setting('fyimp.actor_id',true),''),headers->>'x-fyimp-actor')::uuid;
 resource:=coalesce(row_data->>'id',row_data->>'timetable_slot_id')::uuid;
 INSERT INTO public.system_logs(log_type,event_type,user_id,action,resource_type,resource_id,status,metadata)
 VALUES('audit_event','database_'||lower(TG_OP),actor,lower(TG_OP)||' '||TG_TABLE_NAME,TG_TABLE_NAME,resource,'success',
 jsonb_build_object('source','transaction_trigger','operation',TG_OP,'actorVerifiedBy','backend_service_role',
 'attribution',CASE WHEN actor IS NULL THEN 'database_operation' ELSE 'verified_request' END));
 RETURN coalesce(NEW,OLD);
END $$;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['campuses','departments','courses','semester_blueprints','faculty','students','campus_settings',
 'student_registrations','registration_preferences','period_attendance_sessions','campus_sign_ins'] LOOP
 EXECUTE format('CREATE TRIGGER review_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_business_change()',tab);
 END LOOP;
END $$;

CREATE TABLE public.review_lock_samples(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sampled_at timestamptz NOT NULL DEFAULT now(),
 operation text NOT NULL,wait_ms double precision NOT NULL,transaction_elapsed_ms double precision NOT NULL);
ALTER TABLE public.review_lock_samples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.review_lock_samples FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.review_lock_samples TO service_role;
CREATE FUNCTION public.review_global_lock(p_operation text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE started timestamptz:=clock_timestamp(); waited double precision;
BEGIN
 PERFORM pg_advisory_xact_lock(76102622134917::bigint);
 waited:=extract(epoch FROM clock_timestamp()-started)*1000;
 IF waited>=5 OR random()<0.01 THEN
 INSERT INTO public.review_lock_samples(operation,wait_ms,transaction_elapsed_ms)
 VALUES(p_operation,waited,extract(epoch FROM clock_timestamp()-transaction_timestamp())*1000);
 END IF;
END $$;
-- Instrument the owning functions without replaying their historical releases.
DO $$ DECLARE f record; definition text; BEGIN
 FOR f IN SELECT oid,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f' AND proname<>'review_global_lock' LOOP
 definition:=pg_get_functiondef(f.oid);
 IF position('PERFORM pg_advisory_xact_lock(76102622134917::bigint);' IN definition)>0 THEN
 definition:=replace(definition,'PERFORM pg_advisory_xact_lock(76102622134917::bigint);',format('PERFORM public.review_global_lock(%L);',f.proname));
 EXECUTE definition;
 END IF;
 END LOOP;
END $$;

DO $$ BEGIN
 IF to_regprocedure('public.production_readiness_lifecycle()') IS NULL THEN ALTER FUNCTION public.production_readiness() RENAME TO production_readiness_lifecycle; END IF;
END $$;
CREATE FUNCTION public.application_schema_compatibility() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
 WITH signatures(name) AS (VALUES
 ('public.timetable_manual_context(uuid,text,integer,uuid,integer)'),
 ('public.commit_manual_timetable(uuid,text,integer,uuid,integer,text,jsonb,boolean)'),
 ('public.display_enrollment_counts(jsonb)'),('public.display_period_status(jsonb,date)'),
 ('public.atomic_submit_period_attendance(uuid,date,uuid,uuid[],uuid[],uuid,integer)'),
 ('public.atomic_copy_practical_attendance(uuid,uuid,date,uuid,integer)'),
 ('public.attendance_delivery_roster(uuid)'),('public.assert_attendance_actor(uuid,uuid)'),
 ('public.enqueue_review_job(text,uuid,uuid,integer,text,integer,jsonb)'),('public.claim_review_job()'),
 ('public.renew_review_job(uuid,uuid)'),('public.finish_review_job(uuid,uuid,text)'),('public.cancel_review_job(uuid,uuid)'),
 ('public.claim_auth_cleanup()'),('public.finish_auth_cleanup(uuid,uuid,text)'),('public.retry_auth_cleanup(uuid,uuid)'),
 ('public.review_delete_accounts(text,uuid,uuid)'),
 ('public.finalize_research_cohort(uuid,text,integer,uuid,integer,uuid,uuid)'),
 ('public.manual_dependency_vector(uuid,text,integer,integer)'),('public.review_worker_health()')),
 missing AS(SELECT coalesce(jsonb_agg(name),'[]'::jsonb) names FROM signatures WHERE to_regprocedure(name) IS NULL)
 SELECT jsonb_build_object('version',1,'release','2026-11-review','missing',names,'compatible',names='[]'::jsonb
 AND to_regclass('public.review_jobs') IS NOT NULL AND to_regclass('public.auth_cleanup_tasks') IS NOT NULL
 AND to_regclass('public.cohort_schedule_outcomes') IS NOT NULL AND to_regclass('public.schedule_dependency_revisions') IS NOT NULL
 AND to_regclass('public.review_worker_state') IS NOT NULL
 AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.student_registrations'::regclass AND tgname='enrollment_after_allocation')
 AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.period_attendance_sessions'::regclass AND conname='review_attendance_totals')
 AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.period_attendance_sessions'::regclass AND tgname='review_audit')) FROM missing;
$$;
CREATE FUNCTION public.production_readiness() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('ready',(public.production_readiness_lifecycle()->>'ready')::boolean
  AND (public.application_schema_compatibility()->>'compatible')::boolean,'schema',public.application_schema_compatibility());
$$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure name FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.name);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.name);
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
