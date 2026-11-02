'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useTransition, type ComponentProps } from 'react'

type Props = Omit<ComponentProps<typeof Link>, 'href' | 'onNavigate'> & {
  href: string
  pendingLabel?: string
}

/** Link keeps native keyboard/modifier behavior; only ordinary navigation enters the transition. */
export default function NavigationLink({ href, children, pendingLabel = 'Opening…', replace, scroll, style, ...props }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const navigating = useRef(false)
  // React finishes the transition on success or failure, allowing a retry.
  useEffect(() => { if (!pending) navigating.current = false }, [pending])
  return (
    <Link {...props} style={{ textDecoration: 'none', ...style }} href={href} replace={replace} scroll={scroll}
      aria-busy={pending || undefined}
      onNavigate={(event) => {
        event.preventDefault()
        if (navigating.current) return
        navigating.current = true
        startTransition(() => {
          if (replace) router.replace(href, { scroll })
          else router.push(href, { scroll })
        })
      }}>
      {pending ? <span role="status" className="inline-flex items-center gap-2">
        {pendingLabel}
      </span> : children}
    </Link>
  )
}
