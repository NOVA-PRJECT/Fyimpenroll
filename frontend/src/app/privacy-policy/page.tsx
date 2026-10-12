'use client'

import { useState, useEffect } from 'react'
import PortalHeader from '@/components/portal/PortalHeader'
import PortalFooter from '@/components/portal/PortalFooter'

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
  const [activeSection, setActiveSection] = useState('section-1')

  useEffect(() => {
    const handleScroll = () => {
      const scrollPos = window.scrollY + 140
      for (const section of SECTIONS) {
        const el = document.getElementById(section.id)
        if (el) {
          const top = el.offsetTop
          const height = el.offsetHeight
          if (scrollPos >= top && scrollPos < top + height) {
            setActiveSection(section.id)
            break
          }
        }
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <div className="bg-[#f8f9ff] text-[#0b1c30] font-sans antialiased min-h-screen flex flex-col justify-between selection:bg-[#ffdea4] selection:text-[#261900]">
      {/* Top Institutional Navigation Bar */}
      <PortalHeader variant="back" />

      {/* Main Container: Compact 2-Column Documentation Layout */}
      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-8 flex-1">
        <div className="flex flex-col lg:flex-row gap-8 items-start">
          {/* Left Column: Sticky Compact Sidebar (~260px) */}
          <aside className="w-full lg:w-[260px] shrink-0 lg:sticky lg:top-24">
            <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-slate-100">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Policy Index
                </span>
                <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200/60">
                  13 Sections
                </span>
              </div>
              <nav aria-label="Policy Table of Contents" className="space-y-0.5 max-h-[calc(100vh-14rem)] overflow-y-auto pr-1 text-xs">
                {SECTIONS.map((sec) => {
                  const isActive = activeSection === sec.id
                  return (
                    <a
                      key={sec.id}
                      href={`#${sec.id}`}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md font-medium transition-colors ${
                        isActive
                          ? 'bg-slate-100 text-[#082042] font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          isActive ? 'bg-amber-600' : 'bg-transparent'
                        }`}
                      />
                      <span className="truncate">{sec.title}</span>
                    </a>
                  )
                })}
              </nav>
            </div>
          </aside>

          {/* Right Column: Condensed Main Content Area */}
          <div className="flex-1 max-w-4xl bg-white border border-slate-200/80 rounded-xl p-6 md:p-8 shadow-sm divide-y divide-slate-100">
            {/* Compact Document Header */}
            <div className="pb-6">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/50">
                  University Privacy Notice • FYIMP
                </span>
                <span className="text-xs text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200 font-mono">
                  Version: 2026-09-08 • Effective: Sept 8, 2026
                </span>
              </div>
              <h1 className="font-serif text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
                Privacy Policy
              </h1>
              <p className="text-xs md:text-sm text-slate-600 mt-1">
                FYIMP Management System — Department of Information Technology, Kannur University
              </p>
            </div>

            {/* CLAUSE 1.0 */}
            <section className="py-5 scroll-mt-24" id="section-1">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-slate-900">1. What this document covers</h2>
              </div>
              <p className="text-xs md:text-sm text-slate-600 leading-relaxed">
                This Privacy Policy explains what information the FYIMP portal collects, how we use it to make academic life simpler, and how we protect your privacy. It is written for all members of our university community, including <strong className="font-semibold text-slate-800">students, teachers, Heads of Department (HODs), and campus staff at Kannur University</strong>.
              </p>
              <div className="mt-3 p-3.5 bg-[#FFF9EB] border-l-2 border-amber-500 rounded-r-lg">
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-amber-600 text-[18px] shrink-0 mt-0.5">
                    info
                  </span>
                  <p className="text-xs text-slate-800 leading-normal">
                    <strong>A Friendly Coordination Tool:</strong> This portal is designed to help students and teachers view daily schedules, choose electives, and coordinate attendance easily. Official degree marks, SGPA/CGPA calculations, and permanent academic transcripts are maintained separately by the official Kannur University Examination Branch.
                  </p>
                </div>
              </div>
            </section>

            {/* CLAUSE 2.0 */}
            <section className="py-5 scroll-mt-24" id="section-2">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-slate-900">2. Who this applies to</h2>
              </div>
              <p className="text-xs md:text-sm text-slate-600 leading-relaxed">
                This System is intended for use by enrolled FYIMP students, teaching faculty, Heads of Department, and campus administrators at Kannur University. It is not intended for the general public.
              </p>
            </section>

            {/* CLAUSE 3.0 */}
            <section className="py-5 scroll-mt-24" id="section-3">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-slate-900">3. What data we collect</h2>
              </div>
              <p className="text-xs md:text-sm text-slate-600 leading-relaxed mb-2.5">
                We only collect the essential details needed to organize your classes, courses, and timetable smoothly:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="font-semibold text-slate-900 mb-0.5">Your Basic Profile</div>
                  <div className="text-slate-600 text-[11px]">
                    Your full name, register number, department, and campus location. Used to set up your account and assign your classes.
                  </div>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="font-semibold text-slate-900 mb-0.5">Course & Class Details</div>
                  <div className="text-slate-600 text-[11px]">
                    Registered subjects, elective choices, class timetable slots, and course credits so you know when and where to attend.
                  </div>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="font-semibold text-slate-900 mb-0.5">Attendance Status</div>
                  <div className="text-slate-600 text-[11px]">
                    Class attendance marked by your teacher and your on-time campus arrival confirmations to help you stay above minimum criteria.
                  </div>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="font-semibold text-slate-900 mb-0.5">Sign-in Information</div>
                  <div className="text-slate-600 text-[11px]">
                    Your university email address and secure login session tokens to make sure only you can open your account.
                  </div>
                </div>
              </div>
            </section>

            {/* CLAUSE 4.0 */}
            <section className="py-5 scroll-mt-24" id="section-4">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-slate-900">4. What we deliberately do NOT collect or store</h2>
              </div>
              <div className="p-3 bg-[#FFF9EB] border border-amber-200/80 rounded-lg mb-2.5">
                <div className="flex items-center gap-2 text-amber-800 font-semibold text-xs mb-1">
                  <span className="material-symbols-outlined text-[18px] text-amber-600">location_off</span>
                  <span>No Live Location Tracking</span>
                </div>
                <p className="text-[11px] text-slate-700 leading-normal">
                  When you sign in on campus, your device sends its location coordinates to the server to check the campus boundary. These coordinates are not saved, and we do not continuously track your location. We retain the campus, attendance time, session, result, location accuracy, and audit details including distance from the campus centre.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                  <strong className="text-slate-900 block text-[11px]">No Official Grades or Marksheets</strong>
                  <span className="text-slate-600 text-[11px]">
                    Your final examination marks, grades, and degrees are held strictly in the university&apos;s permanent examination registry.
                  </span>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                  <strong className="text-slate-900 block text-[11px]">No Bank or Biometric Details</strong>
                  <span className="text-slate-600 text-[11px]">
                    We never ask for bank account details, UPI/cards, or facial recognition/fingerprint biometrics.
                  </span>
                </div>
              </div>
            </section>

            {/* CLAUSE 5.0 */}
            <section className="py-5 scroll-mt-24" id="section-5">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-slate-900">5. How your data is used</h2>
              </div>
              <p className="text-xs md:text-sm text-slate-600 leading-relaxed">
                Your details are only used to help you choose electives, build clash-free timetables, track attendance progress, and notify you about class schedule updates. We never sell your personal information or show commercial ads.
              </p>
            </section>

            {/* CLAUSE 6.0 */}
            <section className="py-5 scroll-mt-24" id="section-6">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-slate-900">6. Where your data is stored</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 flex items-start gap-2">
                  <span className="material-symbols-outlined text-slate-600 text-[18px]">cloud_done</span>
                  <div>
                    <span className="font-semibold text-slate-900 block text-[11px]">Secure Cloud Storage</span>
                    <span className="text-[10px] text-slate-500">
                      Stored securely in enterprise-grade data servers located within India (Mumbai).
                    </span>
                  </div>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 flex items-start gap-2">
                  <span className="material-symbols-outlined text-slate-600 text-[18px]">verified_user</span>
                  <div>
                    <span className="font-semibold text-slate-900 block text-[11px]">Protected University Servers</span>
                    <span className="text-[10px] text-slate-500">
                      Protected with modern data encryption so only authorized academic staff can view relevant records.
                    </span>
                  </div>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 flex items-start gap-2">
                  <span className="material-symbols-outlined text-slate-600 text-[18px]">lock_clock</span>
                  <div>
                    <span className="font-semibold text-slate-900 block text-[11px]">Fast Session Memory</span>
                    <span className="text-[10px] text-slate-500">
                      Temporary memory used strictly to keep your login smooth and prevent unauthorized access attempts.
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* CLAUSE 7.0 */}
            <section className="py-5 scroll-mt-24" id="section-7">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-slate-900">7. How long we keep your data</h2>
              </div>
              <p className="text-xs md:text-sm text-slate-600 leading-relaxed">
                Your records are kept only while you are an active student or teacher in the programme. Once you complete your studies, your account is safely closed.
              </p>
            </section>

            {/* CLAUSE 8.0 */}
            <section className="py-5 scroll-mt-24" id="section-8">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-slate-900">8. Students under 18 years of age</h2>
              </div>
              <p className="text-xs md:text-sm text-slate-600 leading-relaxed">
                For students under 18 joining directly after higher secondary schooling, data is handled strictly to organize lectures, courses, and attendance. Parents and legal guardians can easily consult our support desk if they have any questions about their ward&apos;s portal record.
              </p>
            </section>

            {/* CLAUSE 9.0 */}
            <section className="py-5 scroll-mt-24" id="section-9">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-slate-900">9. Your rights</h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="p-2 bg-slate-50 rounded-lg border border-slate-100 text-center">
                  <span className="font-semibold text-slate-900 block text-[11px]">1. View Your Data</span>
                  <span className="text-[10px] text-slate-500">See what information is saved</span>
                </div>
                <div className="p-2 bg-slate-50 rounded-lg border border-slate-100 text-center">
                  <span className="font-semibold text-slate-900 block text-[11px]">2. Correct Mistakes</span>
                  <span className="text-[10px] text-slate-500">Ask to fix incorrect details</span>
                </div>
                <div className="p-2 bg-slate-50 rounded-lg border border-slate-100 text-center">
                  <span className="font-semibold text-slate-900 block text-[11px]">3. Delete Details</span>
                  <span className="text-[10px] text-slate-500">Request removal of old records</span>
                </div>
                <div className="p-2 bg-slate-50 rounded-lg border border-slate-100 text-center">
                  <span className="font-semibold text-slate-900 block text-[11px]">4. Manage Permissions</span>
                  <span className="text-[10px] text-slate-500">Choose optional features</span>
                </div>
              </div>
            </section>

            {/* CLAUSE 10.0 */}
            <section className="py-5 scroll-mt-24" id="section-10">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-slate-900">10. Security</h2>
              </div>
              <p className="text-xs md:text-sm text-slate-600 leading-relaxed">
                Your information is protected with industry-standard encryption. Built-in privacy controls ensure students only see their own classes and teachers only access their assigned batches.
              </p>
            </section>

            {/* CLAUSE 11.0 */}
            <section className="py-5 scroll-mt-24" id="section-11">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-slate-900">11. Privacy Helpdesk & Student Support</h2>
              </div>
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div>
                  <div className="font-semibold text-slate-900">Have questions or need help with your data?</div>
                  <div className="text-[11px] text-slate-600">Contact the system support team</div>
                </div>
                <a
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#082042] bg-white px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 shrink-0 self-start sm:self-center"
                  href="mailto:prjct.nova2025@gmail.com"
                >
                  <span className="material-symbols-outlined text-[16px]">mail</span>
                  <span>prjct.nova2025@gmail.com</span>
                </a>
              </div>
            </section>

            {/* CLAUSE 12.0 */}
            <section className="py-5 scroll-mt-24" id="section-12">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-slate-900">12. Changes to this policy</h2>
              </div>
              <p className="text-xs md:text-sm text-slate-600 leading-relaxed">
                Policy updates will reflect with revision stamps at the top banner. Continued usage constitutes acknowledgment of adjusted procedural workflows.
              </p>
            </section>

            {/* CLAUSE 13.0 */}
            <section className="py-5 scroll-mt-24" id="section-13">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-base font-semibold text-slate-900">13. Governing law</h2>
              </div>
              <p className="text-xs md:text-sm text-slate-600 leading-relaxed">
                This Policy is governed by the laws of India, including the Information Technology Act, 2000, and the Digital Personal Data Protection Act, 2023, as applicable.
              </p>
            </section>
          </div>
        </div>
      </main>

      {/* Statutory Footer */}
      <PortalFooter />
    </div>
  )
}
