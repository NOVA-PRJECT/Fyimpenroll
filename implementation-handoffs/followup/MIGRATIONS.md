# Migration inventory

Generated from the actual directory by `node scripts/migration-manifest.cjs`.

This is an ordered inventory, not permission to replay destructive historical migrations. Existing deployments apply only unapplied files after schema/backup review. Fresh staging must first establish the base tables and Supabase auth schema; the repository does not contain a certified empty-database bootstrap. See RELEASE_RUNBOOK.md.

1. `supabase/migrations/20260903_security_and_schema_fixes.sql`
2. `supabase/migrations/20260908_assignments_and_period_marking.sql`
3. `supabase/migrations/20260908_campus_attendance.sql`
4. `supabase/migrations/20260908_consent_records.sql`
5. `supabase/migrations/20260908_course_allocation_system.sql`
6. `supabase/migrations/20260908_drop_duplicate_registration_windows.sql`
7. `supabase/migrations/20260908_merge_logging_and_job_tables.sql`
8. `supabase/migrations/20260908_student_registrations_selected_courses_compat.sql`
9. `supabase/migrations/20260909_add_teacher_role_constraint.sql`
10. `supabase/migrations/20260909_course_allocation_v2_rules_and_preferences.sql`
11. `supabase/migrations/20260909_patch_e2e_views_and_columns.sql`
12. `supabase/migrations/20260911_drop_allowed_department_ids.sql`
13. `supabase/migrations/20260911_fix_period_attendance_schema.sql`
14. `supabase/migrations/20260911_update_course_category_and_semester_checks.sql`
15. `supabase/migrations/20260922_enable_rls_and_core_policies.sql`
16. `supabase/migrations/20260923_fix_security_findings.sql`
17. `supabase/migrations/20260924_fix_consent_rls_policy.sql`
18. `supabase/migrations/20260925_harden_rls_and_rpc_permissions.sql`
19. `supabase/migrations/20260929_fix_total_credits_constraint_and_audit_logs.sql`
20. `supabase/migrations/20261001_add_slot_7_and_8_to_student_registrations.sql`
21. `supabase/migrations/20261002_harden_direct_rls_authorization.sql`
22. `supabase/migrations/20261007000000_plan03_schema_alignment.sql`
23. `supabase/migrations/20261007010000_plan04_enrollment_capacity_transactions.sql`
24. `supabase/migrations/20261007020000_plan05_deterministic_allocation_atomic_jobs.sql`
25. `supabase/migrations/20261007030000_plan06_timetable_constraints_and_guards.sql`
26. `supabase/migrations/20261007040000_plan07_period_attendance_refinements.sql`
27. `supabase/migrations/20261007050000_plan08_campus_onboarding_and_atomic_promotion.sql`
28. `supabase/migrations/20261007060000_plan09_credit_ledger_and_scoped_exports.sql`
29. `supabase/migrations/20261009010000_followup_plan01_harden_rpc_privileges.sql`
30. `supabase/migrations/20261009020000_followup_plan03_host_campus_delivery_identity.sql`
31. `supabase/migrations/20261009030000_followup_plan04_atomic_enrollment_and_global_seats.sql`
32. `supabase/migrations/20261010010000_followup_plan05_scoped_jobs_and_cohort_accounting.sql`
33. `supabase/migrations/20261010020000_followup_plan06_file_constraints_and_cohort_guards.sql`
34. `supabase/migrations/20261010030000_followup_plan07_attendance_concurrency_and_pairing.sql`
35. `supabase/migrations/20261010040000_followup_plan08_recoverable_graduation_and_retention.sql`
36. `supabase/migrations/20261010050000_followup_plan08_durable_graduation_recovery.sql`
37. `supabase/migrations/20261010060000_followup_plan09_registration_snapshots.sql`
38. `supabase/migrations/20261010070000_followup_plan10_attendance_rpc_privileges.sql`
39. `supabase/migrations/20261010080000_production_timetable_transactions.sql`
40. `supabase/migrations/20261010090000_production_attendance_summary.sql`
41. `supabase/migrations/20261010100000_production_allocation_fencing_and_clocks.sql`
