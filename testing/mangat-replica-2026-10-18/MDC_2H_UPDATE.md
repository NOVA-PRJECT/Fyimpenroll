# Test MDC contact hours changed to 2 hours

Status: **applied and verified**. The user explicitly requested this test-data override after the S2 timetable diagnosis.

All eight MANGATTT S2 MDC papers now total **2 weekly contact hours**:

- Six theory-only papers: **2 theory + 0 practical**.
- IT and Statistics lab papers (`KU2MDCCSE201TT`, `KU02MDCSTA201TT`): **0 theory + 2 practical**, preserving a valid two-hour practical block.
- All eight retain **3 credits**.

The guarded transaction and an independent database readback confirm that other courses (including real-campus courses), registrations, preferences, teacher assignments and blueprints are unchanged. No users or student allocations were modified.

The original 31-period clique in the diagnosis now totals 29 periods because its Statistics MDC changed from four hours to two. All MDC papers now have matching total hours. This resolves those specific input inconsistencies; full-campus feasibility with the director's saved windows has not been established.

A local synthetic CP-SAT check with six theory and two practical MDC courses returned OPTIMAL: all eight courses share two consecutive periods, with no unscheduled sessions. It uses no actual student/registration data.

Full readback evidence: [MDC_2H_UPDATE_VERIFICATION.json](MDC_2H_UPDATE_VERIFICATION.json). Executed SQL: [set-test-mdc-2h.sql](set-test-mdc-2h.sql). The SQL intentionally refuses a rerun because it expects the original course metadata.

## Next step

Generate a fresh **2026-27 / S2 timetable** from the director dashboard. The previous 37-session review draft was created from the old hours and remains historical. Student registration and allocation do not need to be repeated for this change.

The original teacher staffing plan and its Auth plan hash remain immutable historical seed records. Their planned contact-hour totals predate this override; actual teacher assignments are retained, with reduced MDC workloads.
