# Missing semester/category scheduling rules

Status: **implemented and verified locally; deployment pending**.

The user reported missing S2/S4 rules and clarified that “AEC 4” was a typo. The prior editor could add only a campus availability rule; category windows were limited to the existing S1/S3 repository presets.

The editor now supports:

- Adding category windows for DSC, MDC, AEC/AECC, SEC and VAC.
- Selecting Semester 1–10 or all semesters, plus allowed days and periods.
- Optionally restricting a category window to specific course codes.
- Copying windows and removing custom rules.
- Displaying rules relevant to the selected semester, with a control to show other semesters.
- Preserving all other semesters and new repository defaults when loading older browser-saved rules.
- Rejecting empty/out-of-range day and period selections before saving.
- A styled, responsive modal with a fixed header/footer, rule cards, selectable day/period tiles and a visible close button.
- Close by the header button, Escape or backdrop; focus returns to the opener. Tab navigation remains inside the modal, and the background cannot scroll while it is open.

Rules remain saved per campus in the director's browser and travel with generation requests, as in the existing design. No universal S2/S4 day/period policy was invented or added to the repository. The director chooses the required windows. Core contact-hour, practical-block and overlap checks remain enforced.

The Python solver and backend validator now consistently filter every rule kind to the requested semester, including campus availability rules. The generation worker already performed this filtering; the added checks also protect direct solver/validator calls.

## Validation

- Frontend TypeScript check passed.
- Backend build passed.
- All 16 timetable rules/publication tests passed, including real CP-SAT runs for S2/S4 with mixed-semester rules and the existing isolated PostgreSQL publication checks.
- The real React editor was tested in a local fixture: create S2 AEC and S4 VAC windows, change category, enter multiple course codes, change days/periods, block an empty day selection, copy/remove a rule, save, reload, and verify semester separation and persistence.
- The updated modal was visually checked on desktop and in a 390px mobile frame. Header/footer remain visible during body scrolling. Close-button dismissal was verified on desktop and mobile; Escape, focus return, forward/reverse Tab wrapping and background scroll locking were verified on desktop. Frontend TypeScript checks passed after these changes.
- The initial restricted Python subprocess checks timed out. Running the same synthetic checks with the permitted local Python runtime completed successfully; no database or credentials are used by these tests.

The UI examples (S2 AEC Tuesday afternoon and S4 VAC Friday afternoon) exist only in the fixture's browser storage. They are not campus policy or production configuration. A screenshot is saved in the ignored [local preview](../../scratch/mangat-replica-2026-10-18/rules-editor-s4-preview.png).

The redesigned modal previews are saved locally: [desktop](../../scratch/mangat-replica-2026-10-18/rules-editor-polished-desktop.png) and [mobile](../../scratch/mangat-replica-2026-10-18/rules-editor-polished-mobile.png).

## After deployment

1. Deploy the frontend and backend changes.
2. As test campus director, select S2 and open **Scheduling Rules → Add category rule**.
3. Select AEC or MDC, choose the intended days/periods and save in this browser. Add further rules as required.
4. Switch to S4 and configure SEC/VAC or other applicable category windows separately.
5. Generate the matching semester's draft, check the chosen windows plus practical/student/teacher constraints, and review publication readiness.

No production rules, deadlines, registrations or timetables were changed by this fix.
