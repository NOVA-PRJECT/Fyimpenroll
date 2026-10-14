import PortalHeader from '@/components/portal/PortalHeader'
import PortalFooter from '@/components/portal/PortalFooter'
import DocumentIndex from '@/components/portal/DocumentIndex'
import styles from '@/components/portal/document-layout.module.css'
import { CloudCheck, Info, LockKeyhole, Mail, MapPinOff, ShieldCheck } from 'lucide-react'

const SECTIONS = [
  { id: 'section-1', title: 'Scope of Document' },
  { id: 'section-2', title: 'Who this applies to' },
  { id: 'section-3', title: 'What data we collect' },
  { id: 'section-4', title: 'Data not collected' },
  { id: 'section-5', title: 'How data is used' },
  { id: 'section-6', title: 'Data storage & cloud' },
  { id: 'section-7', title: 'Retention period' },
  { id: 'section-8', title: "Children's data (<18)" },
  { id: 'section-9', title: 'Your statutory rights' },
  { id: 'section-10', title: 'Security measures' },
  { id: 'section-11', title: 'Grievance & contact' },
  { id: 'section-12', title: 'Changes to policy' },
  { id: 'section-13', title: 'Governing law' },
]

export default function PrivacyPolicyPage() {
  return (
    <div className="bg-[color:var(--portal-canvas,#f8f9ff)] text-[color:var(--portal-brand-text,#0b1c30)] font-sans antialiased min-h-screen flex flex-col justify-between selection:bg-[color:var(--portal-warning-bg,#ffdea4)] selection:text-[color:var(--portal-warning-text,#261900)]">
      {/* Top Institutional Navigation Bar */}
      <PortalHeader variant="back" />

      {/* Main Container: Compact 2-Column Documentation Layout */}
      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-8 flex-1">
        <div className={styles.layout}>
          <DocumentIndex title="Policy index" sections={SECTIONS} />

          {/* Right Column: Condensed Main Content Area */}
          <article className={`${styles.content} bg-[color:var(--portal-surface,white)] border border-[color:var(--portal-strong-border,#e2e8f0)]/80 rounded-xl p-6 md:p-8 shadow-sm divide-y divide-[color:var(--portal-strong-border,#f1f5f9)]`}>
            {/* Compact Document Header */}
            <div className="pb-6">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase text-[color:var(--portal-warning-text,#b45309)] bg-[color:var(--portal-warning-bg,#fffbeb)] px-2 py-0.5 rounded border border-[color:var(--portal-warning-border,#fde68a)]/50">
                  University Privacy Notice • FYIMP
                </span>
                <span className="text-xs text-[color:var(--portal-muted,#64748b)] bg-[color:var(--portal-info-bg,#f8fafc)] px-2 py-0.5 rounded border border-[color:var(--portal-strong-border,#e2e8f0)] font-mono">
                  Version: 2026-09-08 • Effective: Sept 8, 2026
                </span>
              </div>
              <h1 className="font-serif text-2xl md:text-3xl font-bold text-[color:var(--portal-brand-text,#0f172a)] tracking-tight">
                Privacy Policy
              </h1>
              <p className="text-xs md:text-sm text-[color:var(--portal-info-text,#475569)] mt-1">
                FYIMP Management System — Department of Information Technology, Kannur University
              </p>
            </div>

            {/* CLAUSE 1.0 */}
            <section className="py-5 scroll-mt-24" id="section-1">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-[color:var(--portal-brand-text,#0f172a)]">1. What this document covers</h2>
              </div>
              <p className="text-xs md:text-sm text-[color:var(--portal-info-text,#475569)] leading-relaxed">
                This Privacy Policy explains what information the FYIMP portal collects, how we use it to make academic life simpler, and how we protect your privacy. It is written for all members of our university community, including <strong className="font-semibold text-[color:var(--portal-brand-text,#1e293b)]">students, teachers, Heads of Department (HODs), and campus staff at Kannur University</strong>.
              </p>
              <div className="mt-3 p-3.5 bg-[color:var(--portal-warning-bg,#FFF9EB)] border-l-2 border-[color:var(--portal-warning-border,#f59e0b)] rounded-r-lg">
                <div className="flex items-start gap-2">
                  <Info size={18} className="text-[color:var(--portal-warning-text,#d97706)] shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-xs text-[color:var(--portal-brand-text,#1e293b)] leading-normal">
                    <strong>A Friendly Coordination Tool:</strong> This portal is designed to help students and teachers view daily schedules, choose electives, and coordinate attendance easily. Official degree marks, SGPA/CGPA calculations, and permanent academic transcripts are maintained separately by the official Kannur University Examination Branch.
                  </p>
                </div>
              </div>
            </section>

            {/* CLAUSE 2.0 */}
            <section className="py-5 scroll-mt-24" id="section-2">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-[color:var(--portal-brand-text,#0f172a)]">2. Who this applies to</h2>
              </div>
              <p className="text-xs md:text-sm text-[color:var(--portal-info-text,#475569)] leading-relaxed">
                This System is intended for use by enrolled FYIMP students, teaching faculty, Heads of Department, and campus administrators at Kannur University. It is not intended for the general public.
              </p>
            </section>

            {/* CLAUSE 3.0 */}
            <section className="py-5 scroll-mt-24" id="section-3">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-[color:var(--portal-brand-text,#0f172a)]">3. What data we collect</h2>
              </div>
              <p className="text-xs md:text-sm text-[color:var(--portal-info-text,#475569)] leading-relaxed mb-2.5">
                We only collect the essential details needed to organize your classes, courses, and timetable smoothly:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div className="p-3 bg-[color:var(--portal-info-bg,#f8fafc)] rounded-lg border border-[color:var(--portal-strong-border,#f1f5f9)]">
                  <div className="font-semibold text-[color:var(--portal-brand-text,#0f172a)] mb-0.5">Your Basic Profile</div>
                  <div className="text-[color:var(--portal-info-text,#475569)] text-[11px]">
                    Your full name, register number, department, and campus location. Used to set up your account and assign your classes.
                  </div>
                </div>
                <div className="p-3 bg-[color:var(--portal-info-bg,#f8fafc)] rounded-lg border border-[color:var(--portal-strong-border,#f1f5f9)]">
                  <div className="font-semibold text-[color:var(--portal-brand-text,#0f172a)] mb-0.5">Course & Class Details</div>
                  <div className="text-[color:var(--portal-info-text,#475569)] text-[11px]">
                    Registered subjects, elective choices, class timetable slots, and course credits so you know when and where to attend.
                  </div>
                </div>
                <div className="p-3 bg-[color:var(--portal-info-bg,#f8fafc)] rounded-lg border border-[color:var(--portal-strong-border,#f1f5f9)]">
                  <div className="font-semibold text-[color:var(--portal-brand-text,#0f172a)] mb-0.5">Attendance Status</div>
                  <div className="text-[color:var(--portal-info-text,#475569)] text-[11px]">
                    Class attendance marked by your teacher and your on-time campus arrival confirmations to help you stay above minimum criteria.
                  </div>
                </div>
                <div className="p-3 bg-[color:var(--portal-info-bg,#f8fafc)] rounded-lg border border-[color:var(--portal-strong-border,#f1f5f9)]">
                  <div className="font-semibold text-[color:var(--portal-brand-text,#0f172a)] mb-0.5">Sign-in Information</div>
                  <div className="text-[color:var(--portal-info-text,#475569)] text-[11px]">
                    Your university email address and secure login session tokens to make sure only you can open your account.
                  </div>
                </div>
              </div>
            </section>

            {/* CLAUSE 4.0 */}
            <section className="py-5 scroll-mt-24" id="section-4">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-[color:var(--portal-brand-text,#0f172a)]">4. What we deliberately do NOT collect or store</h2>
              </div>
              <div className="p-3 bg-[color:var(--portal-warning-bg,#FFF9EB)] border border-[color:var(--portal-warning-border,#fde68a)]/80 rounded-lg mb-2.5">
                <div className="flex items-center gap-2 text-[color:var(--portal-warning-text,#92400e)] font-semibold text-xs mb-1">
                  <MapPinOff size={18} className="text-[color:var(--portal-warning-text,#d97706)] shrink-0" aria-hidden="true" />
                  <span>No Live Location Tracking</span>
                </div>
                <p className="text-[11px] text-[color:var(--portal-info-text,#334155)] leading-normal">
                  When you sign in on campus, your device sends its location coordinates to the server to check the campus boundary. These coordinates are not saved, and we do not continuously track your location. We retain the campus, attendance time, session, result, location accuracy, and audit details including distance from the campus centre.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 bg-[color:var(--portal-info-bg,#f8fafc)] rounded-lg border border-[color:var(--portal-strong-border,#f1f5f9)]">
                  <strong className="text-[color:var(--portal-brand-text,#0f172a)] block text-[11px]">No Official Grades or Marksheets</strong>
                  <span className="text-[color:var(--portal-info-text,#475569)] text-[11px]">
                    Your final examination marks, grades, and degrees are held strictly in the university&apos;s permanent examination registry.
                  </span>
                </div>
                <div className="p-2.5 bg-[color:var(--portal-info-bg,#f8fafc)] rounded-lg border border-[color:var(--portal-strong-border,#f1f5f9)]">
                  <strong className="text-[color:var(--portal-brand-text,#0f172a)] block text-[11px]">No Bank or Biometric Details</strong>
                  <span className="text-[color:var(--portal-info-text,#475569)] text-[11px]">
                    We never ask for bank account details, UPI/cards, or facial recognition/fingerprint biometrics.
                  </span>
                </div>
              </div>
            </section>

            {/* CLAUSE 5.0 */}
            <section className="py-5 scroll-mt-24" id="section-5">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-[color:var(--portal-brand-text,#0f172a)]">5. How your data is used</h2>
              </div>
              <p className="text-xs md:text-sm text-[color:var(--portal-info-text,#475569)] leading-relaxed">
                Your details are only used to help you choose electives, build clash-free timetables, track attendance progress, and notify you about class schedule updates. We never sell your personal information or show commercial ads.
              </p>
            </section>

            {/* CLAUSE 6.0 */}
            <section className="py-5 scroll-mt-24" id="section-6">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-[color:var(--portal-brand-text,#0f172a)]">6. Where your data is stored</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div className="p-2.5 bg-[color:var(--portal-info-bg,#f8fafc)] rounded-lg border border-[color:var(--portal-strong-border,#f1f5f9)] flex items-start gap-2">
                  <CloudCheck size={18} className="text-[color:var(--portal-info-text,#475569)] shrink-0" aria-hidden="true" />
                  <div>
                    <span className="font-semibold text-[color:var(--portal-brand-text,#0f172a)] block text-[11px]">Secure Cloud Storage</span>
                    <span className="text-[10px] text-[color:var(--portal-muted,#64748b)]">
                      Stored securely in enterprise-grade data servers located within India (Mumbai).
                    </span>
                  </div>
                </div>
                <div className="p-2.5 bg-[color:var(--portal-info-bg,#f8fafc)] rounded-lg border border-[color:var(--portal-strong-border,#f1f5f9)] flex items-start gap-2">
                  <ShieldCheck size={18} className="text-[color:var(--portal-info-text,#475569)] shrink-0" aria-hidden="true" />
                  <div>
                    <span className="font-semibold text-[color:var(--portal-brand-text,#0f172a)] block text-[11px]">Protected University Servers</span>
                    <span className="text-[10px] text-[color:var(--portal-muted,#64748b)]">
                      Protected with modern data encryption so only authorized academic staff can view relevant records.
                    </span>
                  </div>
                </div>
                <div className="p-2.5 bg-[color:var(--portal-info-bg,#f8fafc)] rounded-lg border border-[color:var(--portal-strong-border,#f1f5f9)] flex items-start gap-2">
                  <LockKeyhole size={18} className="text-[color:var(--portal-info-text,#475569)] shrink-0" aria-hidden="true" />
                  <div>
                    <span className="font-semibold text-[color:var(--portal-brand-text,#0f172a)] block text-[11px]">Fast Session Memory</span>
                    <span className="text-[10px] text-[color:var(--portal-muted,#64748b)]">
                      Temporary memory used strictly to keep your login smooth and prevent unauthorized access attempts.
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* CLAUSE 7.0 */}
            <section className="py-5 scroll-mt-24" id="section-7">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-[color:var(--portal-brand-text,#0f172a)]">7. How long we keep your data</h2>
              </div>
              <p className="text-xs md:text-sm text-[color:var(--portal-info-text,#475569)] leading-relaxed">
                Your records are kept only while you are an active student or teacher in the programme. Once you complete your studies, your account is safely closed.
              </p>
            </section>

            {/* CLAUSE 8.0 */}
            <section className="py-5 scroll-mt-24" id="section-8">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-[color:var(--portal-brand-text,#0f172a)]">8. Students under 18 years of age</h2>
              </div>
              <p className="text-xs md:text-sm text-[color:var(--portal-info-text,#475569)] leading-relaxed">
                For students under 18 joining directly after higher secondary schooling, data is handled strictly to organize lectures, courses, and attendance. Parents and legal guardians can easily consult our support desk if they have any questions about their ward&apos;s portal record.
              </p>
            </section>

            {/* CLAUSE 9.0 */}
            <section className="py-5 scroll-mt-24" id="section-9">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-[color:var(--portal-brand-text,#0f172a)]">9. Your rights</h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="p-2 bg-[color:var(--portal-info-bg,#f8fafc)] rounded-lg border border-[color:var(--portal-strong-border,#f1f5f9)] text-center">
                  <span className="font-semibold text-[color:var(--portal-brand-text,#0f172a)] block text-[11px]">1. View Your Data</span>
                  <span className="text-[10px] text-[color:var(--portal-muted,#64748b)]">See what information is saved</span>
                </div>
                <div className="p-2 bg-[color:var(--portal-info-bg,#f8fafc)] rounded-lg border border-[color:var(--portal-strong-border,#f1f5f9)] text-center">
                  <span className="font-semibold text-[color:var(--portal-brand-text,#0f172a)] block text-[11px]">2. Correct Mistakes</span>
                  <span className="text-[10px] text-[color:var(--portal-muted,#64748b)]">Ask to fix incorrect details</span>
                </div>
                <div className="p-2 bg-[color:var(--portal-info-bg,#f8fafc)] rounded-lg border border-[color:var(--portal-strong-border,#f1f5f9)] text-center">
                  <span className="font-semibold text-[color:var(--portal-brand-text,#0f172a)] block text-[11px]">3. Delete Details</span>
                  <span className="text-[10px] text-[color:var(--portal-muted,#64748b)]">Request removal of old records</span>
                </div>
                <div className="p-2 bg-[color:var(--portal-info-bg,#f8fafc)] rounded-lg border border-[color:var(--portal-strong-border,#f1f5f9)] text-center">
                  <span className="font-semibold text-[color:var(--portal-brand-text,#0f172a)] block text-[11px]">4. Manage Permissions</span>
                  <span className="text-[10px] text-[color:var(--portal-muted,#64748b)]">Choose optional features</span>
                </div>
              </div>
            </section>

            {/* CLAUSE 10.0 */}
            <section className="py-5 scroll-mt-24" id="section-10">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-[color:var(--portal-brand-text,#0f172a)]">10. Security</h2>
              </div>
              <p className="text-xs md:text-sm text-[color:var(--portal-info-text,#475569)] leading-relaxed">
                Your information is protected with industry-standard encryption. Built-in privacy controls ensure students only see their own classes and teachers only access their assigned batches.
              </p>
            </section>

            {/* CLAUSE 11.0 */}
            <section className="py-5 scroll-mt-24" id="section-11">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-[color:var(--portal-brand-text,#0f172a)]">11. Privacy Helpdesk & Student Support</h2>
              </div>
              <div className="p-3.5 bg-[color:var(--portal-info-bg,#f8fafc)] rounded-xl border border-[color:var(--portal-strong-border,#e2e8f0)]/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div>
                  <div className="font-semibold text-[color:var(--portal-brand-text,#0f172a)]">Have questions or need help with your data?</div>
                  <div className="text-[11px] text-[color:var(--portal-info-text,#475569)]">Contact the system support team</div>
                </div>
                <a
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[color:var(--portal-brand-text,#082042)] bg-[color:var(--portal-surface,white)] px-3 py-1.5 rounded-lg border border-[color:var(--portal-strong-border,#e2e8f0)] hover:bg-[color:var(--portal-info-bg,#f8fafc)] shrink-0 self-start sm:self-center"
                  href="mailto:prjct.nova2025@gmail.com"
                >
                  <Mail size={16} className="shrink-0" aria-hidden="true" />
                  <span>prjct.nova2025@gmail.com</span>
                </a>
              </div>
            </section>

            {/* CLAUSE 12.0 */}
            <section className="py-5 scroll-mt-24" id="section-12">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-[color:var(--portal-brand-text,#0f172a)]">12. Changes to this policy</h2>
              </div>
              <p className="text-xs md:text-sm text-[color:var(--portal-info-text,#475569)] leading-relaxed">
                Policy updates will reflect with revision stamps at the top banner. Continued usage constitutes acknowledgment of adjusted procedural workflows.
              </p>
            </section>

            {/* CLAUSE 13.0 */}
            <section className="py-5 scroll-mt-24" id="section-13">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-[color:var(--portal-brand-text,#0f172a)]">13. Governing law</h2>
              </div>
              <p className="text-xs md:text-sm text-[color:var(--portal-info-text,#475569)] leading-relaxed">
                This Policy is governed by the laws of India, including the Information Technology Act, 2000, and the Digital Personal Data Protection Act, 2023, as applicable.
              </p>
            </section>
          </article>
        </div>
      </main>

      {/* Statutory Footer */}
      <PortalFooter />
    </div>
  )
}
