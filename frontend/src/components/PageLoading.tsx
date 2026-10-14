import { Loader2 } from 'lucide-react'

export default function PageLoading({ message = 'Loading dashboard…' }: { message?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[12rem] items-center justify-center gap-3 bg-[color:var(--portal-canvas,#f8f9ff)] p-6 text-[color:var(--portal-brand-text,#002147)]">
      <Loader2 size={20} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      <span>{message}</span>
    </div>
  )
}
