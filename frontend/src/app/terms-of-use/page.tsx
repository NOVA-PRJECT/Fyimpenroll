'use client'

import { useState, useEffect } from 'react'
import PortalHeader from '@/components/portal/PortalHeader'
import PortalFooter from '@/components/portal/PortalFooter'

const SECTIONS = [
  { id: 'acceptance-of-terms', title: '1. Acceptance of these terms' },
  { id: 'what-system-is', title: '2. What this System is — and is not' },
  { id: 'eligibility', title: '3. Eligibility' },
  { id: 'your-account', title: '4. Your account' },
  { id: 'acceptable-use', title: '5. Acceptable use' },
  { id: 'academic-data-accuracy', title: '6. Academic data accuracy' },
  { id: 'availability-warranty', title: '7. Availability and no warranty' },
  { id: 'changes-to-terms', title: '8. Changes to terms' },
  { id: 'contact', title: '9. Contact' },
  { id: 'governing-law', title: '10. Governing law' },
]

export default function TermsOfUsePage() {
  const [activeSection, setActiveSection] = useState('acceptance-of-terms')

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
    <div className="bg-[#F8F9FC] font-sans text-slate-800 flex flex-col min-h-screen antialiased selection:bg-amber-100 selection:text-amber-900">
      {/* Top Institution Navigation Bar */}
      <PortalHeader variant="back" />

      {/* Page Header & Title Banner */}
      <section className="w-full bg-white border-b border-slate-200 py-8 sm:py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
                University Terms • FYIMP
              </span>
              <span className="text-xs text-slate-500 hidden sm:inline">•</span>
              <span className="text-xs font-medium text-slate-500 hidden sm:inline">
                Version: 2026-09-08 • Effective: Sept 8, 2026
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-serif font-semibold text-slate-900 tracking-tight">
              Terms of Use
            </h1>
            <p className="text-sm sm:text-base text-slate-600 max-w-3xl leading-relaxed">
              FYIMP Management System — Department of Information Technology, Kannur University
            </p>
          </div>
        </div>
      </section>

      {/* Main Content Layout with Sticky Sidebar Index */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Sticky Sidebar Index (10 Sections) */}
          <aside className="lg:col-span-4 sticky top-24">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Terms Index</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">
                  10 Sections
                </span>
              </div>
              <nav className="flex flex-col gap-1 text-sm font-medium">
                {SECTIONS.map((sec) => {
                  const isActive = activeSection === sec.id
                  return (
                    <a
                      key={sec.id}
                      href={`#${sec.id}`}
                      className={`px-3 py-2 rounded-lg transition-colors flex items-center justify-between text-xs sm:text-sm ${
                        isActive
                          ? 'bg-slate-100 text-[#082042] font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <span>{sec.title}</span>
                      <span
                        className={`material-symbols-outlined text-[16px] text-slate-400 ${
                          isActive ? 'opacity-100 text-amber-600' : 'opacity-0'
                        }`}
                      >
                        chevron_right
                      </span>
                    </a>
                  )
                })}
              </nav>
            </div>
          </aside>

          {/* Terms Content Article */}
          <article className="lg:col-span-8 flex flex-col gap-6">
            {/* 1. Acceptance of these terms */}
            <section
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-7 scroll-mt-24"
              id="acceptance-of-terms"
            >
              <h2 className="text-xl sm:text-2xl font-serif font-semibold text-slate-900 tracking-tight mb-3">
                1. Acceptance of these terms
              </h2>
              <p className="text-sm sm:text-base text-slate-700 leading-relaxed font-normal">
                By <strong>creating an account or otherwise using the FYIMP Management System (&quot;the System&quot;)</strong>, you <strong>agree to these Terms of Use and the accompanying Privacy Policy</strong>. If you do not agree, please do not use the System.
              </p>
            </section>

            {/* 2. What this System is — and is not */}
            <section
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-7 scroll-mt-24 flex flex-col gap-4"
              id="what-system-is"
            >
              <h2 className="text-xl sm:text-2xl font-serif font-semibold text-slate-900 tracking-tight">
                2. What this System is — and is not
              </h2>
              <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                The System is a coordination and management tool built to reduce manual administrative effort in running the FYIMP programme — course registration, timetabling, attendance tracking, and credit progress summaries.
              </p>
              <div className="p-3.5 bg-[#FFF9EB] border-l-2 border-amber-500 rounded-r-lg">
                <p className="text-xs text-slate-800 leading-normal">
                  <strong>Notice:</strong> The System is not Kannur University&apos;s official academic records system. Official marks, grades, SGPA/CGPA, grade cards, and permanent academic transcripts are maintained solely by the University examination branch.
                </p>
              </div>
            </section>

            {/* 3. Eligibility */}
            <section
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-7 scroll-mt-24"
              id="eligibility"
            >
              <h2 className="text-xl sm:text-2xl font-serif font-semibold text-slate-900 tracking-tight mb-3">
                3. Eligibility
              </h2>
              <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                Access to the System is limited to enrolled FYIMP students, teaching staff, Heads of Department, campus administrators, and other individuals formally associated with the FYIMP programme at Kannur University.
              </p>
            </section>

            {/* 4. Your account */}
            <section
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-7 scroll-mt-24 flex flex-col gap-4"
              id="your-account"
            >
              <h2 className="text-xl sm:text-2xl font-serif font-semibold text-slate-900 tracking-tight">
                4. Your account
              </h2>
              <div className="grid grid-cols-1 gap-3">
                <div className="flex items-start gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="material-symbols-outlined text-[20px] text-slate-700 mt-0.5 flex-shrink-0">
                    key
                  </span>
                  <p className="text-sm text-slate-700 leading-relaxed">
                    You are <strong className="font-semibold text-slate-900">responsible for keeping your login credentials confidential</strong> and for <strong className="font-semibold text-slate-900">all activity under your account</strong>.
                  </p>
                </div>
                <div className="flex items-start gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="material-symbols-outlined text-[20px] text-slate-700 mt-0.5 flex-shrink-0">
                    badge
                  </span>
                  <p className="text-sm text-slate-700 leading-relaxed">
                    Accounts are <strong className="font-semibold text-slate-900">personal and non-transferable</strong> — you may <strong className="font-semibold text-slate-900">not share your login</strong> with another person or use another person’s account.
                  </p>
                </div>
                <div className="flex items-start gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="material-symbols-outlined text-[20px] text-slate-700 mt-0.5 flex-shrink-0">
                    security
                  </span>
                  <p className="text-sm text-slate-700 leading-relaxed">
                    If you <strong className="font-semibold text-slate-900">suspect unauthorized access</strong> to your account, <strong className="font-semibold text-slate-900">notify us immediately</strong> using the contact details provided below.
                  </p>
                </div>
              </div>
            </section>

            {/* 5. Acceptable use */}
            <section
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-7 scroll-mt-24 flex flex-col gap-4"
              id="acceptable-use"
            >
              <h2 className="text-xl sm:text-2xl font-serif font-semibold text-slate-900 tracking-tight">
                5. Acceptable use
              </h2>
              <p className="text-sm sm:text-base text-slate-700 font-medium">
                You agree not to:
              </p>
              <ul className="space-y-2.5">
                <li className="flex items-start gap-3 p-3 rounded-lg bg-red-50/50 border border-red-100 text-sm text-slate-800">
                  <span className="material-symbols-outlined text-[18px] text-red-600 mt-0.5 flex-shrink-0">
                    block
                  </span>
                  <span>Attempt to sign in to campus attendance, or mark period attendance, on behalf of another person.</span>
                </li>
                <li className="flex items-start gap-3 p-3 rounded-lg bg-red-50/50 border border-red-100 text-sm text-slate-800">
                  <span className="material-symbols-outlined text-[18px] text-red-600 mt-0.5 flex-shrink-0">
                    block
                  </span>
                  <span>Attempt to access data, courses, or records outside your assigned role or department.</span>
                </li>
                <li className="flex items-start gap-3 p-3 rounded-lg bg-red-50/50 border border-red-100 text-sm text-slate-800">
                  <span className="material-symbols-outlined text-[18px] text-red-600 mt-0.5 flex-shrink-0">
                    block
                  </span>
                  <span>Attempt to interfere with, disrupt, or gain unauthorized access to the System or its underlying infrastructure.</span>
                </li>
                <li className="flex items-start gap-3 p-3 rounded-lg bg-red-50/50 border border-red-100 text-sm text-slate-800">
                  <span className="material-symbols-outlined text-[18px] text-red-600 mt-0.5 flex-shrink-0">
                    block
                  </span>
                  <span>Submit false or misleading information through the System.</span>
                </li>
                <li className="flex items-start gap-3 p-3 rounded-lg bg-red-50/50 border border-red-100 text-sm text-slate-800">
                  <span className="material-symbols-outlined text-[18px] text-red-600 mt-0.5 flex-shrink-0">
                    block
                  </span>
                  <span>Use the System for any purpose other than legitimate academic coordination within the FYIMP programme.</span>
                </li>
              </ul>
              <div className="mt-2 pt-3 border-t border-slate-100 text-xs sm:text-sm text-slate-600 font-medium leading-relaxed">
                Violation of this section may result in suspension or termination of your access, in addition to any other consequences under University policy or applicable law.
              </div>
            </section>

            {/* 6. Attendance and academic data accuracy */}
            <section
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-7 scroll-mt-24"
              id="academic-data-accuracy"
            >
              <h2 className="text-xl sm:text-2xl font-serif font-semibold text-slate-900 tracking-tight mb-3">
                6. Attendance and academic data accuracy
              </h2>
              <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                Attendance and coordination data recorded in the System reflects submissions made by faculty, students, and administrators through the System’s normal operation. While reasonable care is taken in the System’s design to keep this data accurate, the System is a coordination aid and does not replace the University’s own attendance and academic verification processes where those are required.
              </p>
            </section>

            {/* 7. Availability and no warranty */}
            <section
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-7 scroll-mt-24"
              id="availability-warranty"
            >
              <h2 className="text-xl sm:text-2xl font-serif font-semibold text-slate-900 tracking-tight mb-3">
                7. Availability and no warranty
              </h2>
              <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                The System is provided on an “as available” basis. As a coordination tool rather than the University’s core infrastructure, occasional downtime, maintenance, or feature changes may occur. The System is provided without warranty of any kind, express or implied, to the fullest extent permitted by law.
              </p>
            </section>

            {/* 8. Changes to the System and these Terms */}
            <section
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-7 scroll-mt-24"
              id="changes-to-terms"
            >
              <h2 className="text-xl sm:text-2xl font-serif font-semibold text-slate-900 tracking-tight mb-3">
                8. Changes to the System and these Terms
              </h2>
              <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                We may update, modify, or discontinue features of the System, and may revise these Terms from time to time. Material changes will be communicated to users where reasonably practicable. Continued use of the System after a change constitutes acceptance of the revised Terms.
              </p>
            </section>

            {/* 9. Contact */}
            <section
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-7 scroll-mt-24 flex flex-col gap-4"
              id="contact"
            >
              <h2 className="text-xl sm:text-2xl font-serif font-semibold text-slate-900 tracking-tight">
                9. Contact
              </h2>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Contact Point</span>
                  <span className="font-bold text-slate-900 text-base">System Developer</span>
                  <span className="text-xs text-slate-600">Department of Information Technology, Kannur University</span>
                </div>
                <a
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold shadow-sm transition-colors flex-shrink-0"
                  href="mailto:prjct.nova2025@gmail.com"
                >
                  <span className="material-symbols-outlined text-[18px]">mail</span>
                  <span>prjct.nova2025@gmail.com</span>
                </a>
              </div>
            </section>

            {/* 10. Governing law */}
            <section
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-7 scroll-mt-24"
              id="governing-law"
            >
              <h2 className="text-xl sm:text-2xl font-serif font-semibold text-slate-900 tracking-tight mb-3">
                10. Governing law
              </h2>
              <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                These Terms are governed by the laws of India, and subject to the jurisdiction of competent courts in Kannur, Kerala.
              </p>
            </section>
          </article>
        </div>
      </main>

      {/* Persistent Global Footer */}
      <PortalFooter className="mt-12" />
    </div>
  )
}
