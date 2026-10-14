'use client'

import { useRef } from 'react'
import { useServerInsertedHTML } from 'next/navigation'
import { THEME_INIT_SCRIPT } from '@/core/theme/preferences'

export default function ThemeBootstrap() {
  const inserted = useRef(false)

  useServerInsertedHTML(() => {
    if (inserted.current) return null
    inserted.current = true
    // Insert a parser-executed script into the server's head, outside the client React tree.
    return <script id="portal-theme-init" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
  })

  return null
}
