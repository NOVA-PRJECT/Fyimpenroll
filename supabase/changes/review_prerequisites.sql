-- Read-only diagnostic. Run this in the affected project's SQL editor.
-- No student, attendance or account records are read or changed.
WITH prerequisites(feature, signature, owner_sql) AS (VALUES
 ('Manual timetable', 'public.timetable_manual_context(uuid,text,integer,uuid,integer)', 'changes/manual_timetable.sql'),
 ('Display enrollment counts', 'public.display_enrollment_counts(jsonb)', 'changes/data_read_optimization.sql'),
 ('Display attendance status', 'public.display_period_status(jsonb,date)', 'changes/data_read_optimization.sql'),
 ('Preference-before-allocation', 'public.guard_enrollment_allocation_completion()', 'changes/preferences_before_allocation.sql')
)
SELECT feature, signature, to_regprocedure(signature) IS NOT NULL AS installed, owner_sql,
 CASE WHEN to_regprocedure(signature) IS NULL THEN 'Missing: review this feature release before applying it'
 ELSE 'Installed: do not replay this feature release' END AS next_step,
 to_regprocedure('public.campus_term_version(uuid)') IS NOT NULL AS lifecycle_installed,
 to_regprocedure('public.application_schema_compatibility()') IS NOT NULL AS review_release_installed
FROM prerequisites ORDER BY owner_sql, signature;
