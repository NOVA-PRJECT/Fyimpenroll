'use client'

export default function DashboardError({ reset }: { reset: () => void }) {
  return <div role="alert" className="flex min-h-[12rem] flex-col items-center justify-center gap-4 bg-[color:var(--portal-canvas,#f8f9ff)] p-6 text-[color:var(--portal-brand-text,#002147)]">
    <p>This page couldn’t be loaded. Please try again.</p>
    <button className="rounded-lg bg-[color:var(--portal-primary,#002147)] px-5 py-2 text-white" onClick={reset}>Try again</button>
  </div>
}
