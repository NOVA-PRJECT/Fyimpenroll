# Data Breach Response Plan (Internal)

**FYIMP Management System — not user-facing, for the development/admin team**  
**Department of Information Technology, Kannur University**  
*Last updated: September 8, 2026*

---

## Purpose

A short, practical plan for what to do if personal data in the System (student/faculty accounts, attendance records, registration data) is exposed, accessed without authorization, or otherwise compromised. This does not need to be elaborate — it needs to exist and be followed if the moment comes.

---

## What counts as a breach here

- Unauthorized access to the Supabase database or Render backend
- A leaked or compromised API key, service role key, or admin credential
- A vulnerability (e.g. found via Strix or otherwise) that was actually exploited against production, not just discovered in testing
- Accidental public exposure of a database backup, export file, or log containing personal data
- Loss or theft of a device containing unencrypted exported data (e.g. an XLSX attendance export)

---

## Immediate steps, in order

### 1. Contain it first, investigate second.
- Rotate any exposed credentials or API keys immediately (Supabase service role key, Render environment secrets, etc.)
- If a specific vulnerability is being actively exploited, take the affected endpoint offline or patch it before continuing investigation
- Do not wait for a full understanding of scope before containing — stop the bleeding first

### 2. Assess scope.
- What data was actually exposed? (Names, registration numbers, attendance records — remember GPS coordinates are never stored, so location exposure is not possible through this System)
- How many students/faculty are affected?
- Was it accessed, or only exposed/potentially accessible? (Both matter, but the response may differ)

### 3. Document what happened.
- Timeline: when it started, when it was discovered, when it was contained
- Root cause, once known
- What data was involved
- Keep this even if informal — a dated note is enough at this stage of the project

### 4. Notify.
- **Internally first** — whoever is acting as the responsible faculty contact or HOD sponsor for the System should be told immediately, not after the fact
- **Affected individuals** — students/faculty whose data was exposed should be told what happened, what data was involved, and what they should do (e.g. change their password if credentials were involved)
- Once the University formally sponsors the System (via the IT Centre process), the University's own incident reporting channels should be looped in as well — this plan will need updating at that point to reflect the university's own escalation path

### 5. Fix and confirm.
- Patch the root cause
- Re-test to confirm the fix actually closes the gap (this is a good candidate for a targeted Strix re-scan)
- Only then consider the incident closed

---

## Who does what

| Role | Responsibility | Contact |
|---|---|---|
| Technical lead | Contain, investigate, patch | Systems & Dev Admin (`itcentre@kannuruniversity.ac.in`) |
| Faculty/HOD sponsor | Institutional notification, decides external communication | Head of Department, Department of IT |
| Communication to affected users | Drafts and sends notification | Programme Coordinator / Administration |

---

## Notes

- This plan is intentionally lightweight given the current team size and project stage. As the System moves toward formal university adoption, this should be revisited alongside whatever incident response process the University's IT Centre already has in place, rather than run as a fully separate parallel process.
- Because GPS coordinates are never persisted, the most sensitive category of data this System could otherwise expose simply does not exist to be breached — worth remembering when assessing severity.
