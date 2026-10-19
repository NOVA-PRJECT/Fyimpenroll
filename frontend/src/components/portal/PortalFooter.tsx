'use client'

import Link from 'next/link'
import UniversityLogo from '@/components/UniversityLogo'
import React from 'react'

export interface PortalFooterProps {
  className?: string
  currentYear?: number
}

export default function PortalFooter({ className = '', currentYear = 2024 }: PortalFooterProps) {
  return (
    <footer
      className={`w-full border-t border-[color:var(--portal-strong-border,#e2e8f0)]/60 bg-[color:var(--portal-surface,white)] py-5 sm:py-6 px-6 md:px-8 flex flex-col sm:flex-row items-center justify-between text-xs text-[color:var(--portal-muted,#64748B)] gap-4 ${className}`}
    >
      <div className="flex items-center gap-2.5">
        <UniversityLogo
          alt="Kannur University"
          width={20}
          height={22}
          style={{ width: 'auto', height: '22px' }}
          className="object-contain"
        />
        <span>© {currentYear} Kannur University. All rights reserved.</span>
      </div>
      <div className="flex items-center gap-6">
        <Link className="hover:text-[color:var(--portal-brand-text,#0f172a)] transition-colors" href="/privacy-policy">
          Privacy Policy
        </Link>
        <Link className="hover:text-[color:var(--portal-brand-text,#0f172a)] transition-colors" href="/terms-of-use">
          Terms of Use
        </Link>
      </div>
    </footer>
  )
}
