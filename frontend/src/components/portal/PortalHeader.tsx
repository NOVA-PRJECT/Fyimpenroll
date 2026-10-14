'use client'

import Link from 'next/link'
import Image from 'next/image'
import React from 'react'
import { ArrowLeft, House } from 'lucide-react'

export interface PortalHeaderProps {
  variant?: 'home' | 'login' | 'back' | 'none'
  rightAction?: React.ReactNode
}

export default function PortalHeader({ variant = 'back', rightAction }: PortalHeaderProps) {
  return (
    <header className="w-full min-h-16 shrink-0 border-b border-[color:var(--portal-strong-border,#e2e8f0)] bg-[color:var(--portal-surface,white)] sticky top-0 z-50 px-3 sm:px-6 md:px-8 py-2 flex items-center justify-between gap-2 sm:gap-4">
      {/* Left: Kannur University Institutional Identity */}
      <Link href="/" className="min-w-0 flex items-center gap-2 sm:gap-3 group">
        <Image
          src="/knrunilogo.png"
          alt="Kannur University"
          width={31}
          height={34}
          style={{ width: 'auto', height: '34px' }}
          className="object-contain flex-shrink-0"
          priority
        />
        <div className="min-w-0 flex flex-col">
          <span className="text-[13px] sm:text-sm font-semibold text-[color:var(--portal-brand-text,#0F172A)] tracking-tight leading-tight block group-hover:text-[color:var(--portal-brand-text,#082042)] transition-colors">
            Kannur University
          </span>
          <span className="hidden sm:block text-[10px] font-medium tracking-widest text-[color:var(--portal-muted,#64748B)] uppercase leading-snug mt-0.5">
            FIVE-YEAR INTEGRATED MASTERS PROGRAMME
          </span>
          <span className="sm:hidden text-[10px] font-medium tracking-wider text-[color:var(--portal-muted,#64748B)] uppercase leading-snug mt-0.5">
            FYIMP Portal
          </span>
        </div>
      </Link>

      {/* Right: Actions / Links */}
      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        {rightAction ? (
          rightAction
        ) : variant === 'home' ? (
          <Link
            href="/login"
            className="min-h-11 inline-flex items-center justify-center whitespace-nowrap text-xs font-semibold px-4 py-2 bg-[color:var(--portal-primary,#082042)] hover:bg-[color:var(--portal-primary,#0B192C)] text-white rounded-lg transition-colors shadow-sm"
          >
            Sign In
          </Link>
        ) : variant === 'login' ? (
          <Link
            href="/"
            className="min-h-11 px-2 whitespace-nowrap text-xs font-medium text-[color:var(--portal-info-text,#475569)] hover:text-[color:var(--portal-brand-text,#0f172a)] transition-colors inline-flex items-center gap-1.5"
          >
            <House size={16} className="shrink-0" aria-hidden="true" />
            <span>Home</span>
          </Link>
        ) : variant === 'back' ? (
          <Link
            href="/"
            className="min-h-11 px-2 whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-medium text-[color:var(--portal-info-text,#475569)] hover:text-[color:var(--portal-brand-text,#0f172a)] transition-colors"
          >
            <ArrowLeft size={16} className="shrink-0" aria-hidden="true" />
            <span>Back to Home</span>
          </Link>
        ) : null}
      </div>
    </header>
  )
}
