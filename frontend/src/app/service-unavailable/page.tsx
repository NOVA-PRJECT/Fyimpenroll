'use client'

export default function ServiceUnavailablePage() {
  return <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[color:var(--portal-canvas,#f8f9ff)] p-6 text-center text-[color:var(--portal-brand-text,#002147)]">
    <h1 className="text-xl font-semibold">The portal is temporarily unavailable</h1>
    <p>We couldn’t verify your session. Please try again.</p>
    <button className="rounded-lg bg-[color:var(--portal-primary,#002147)] px-5 py-2 text-white" onClick={() => window.location.reload()}>Try again</button>
  </main>
}
