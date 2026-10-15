'use client'

import { Menu, X } from 'lucide-react'
import { useRef, useState } from 'react'
import styles from './director-dashboard.module.css'

const sections = [
  { id: 'registration', label: 'Registration Window' },
  { id: 'timetable', label: 'Timetable Generator' },
  { id: 'promotion', label: 'Semester Promotion' },
  { id: 'allocation', label: 'Course Allocation' },
  { id: 'campus-signin', label: 'Campus Sign-In' },
] as const

export type DirectorSection = typeof sections[number]['id']

export default function DirectorNavigation({ activeTab, onSelect }: {
  activeTab: DirectorSection
  onSelect: (section: DirectorSection) => void
}) {
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const activeLabel = sections.find(section => section.id === activeTab)?.label

  return (
    <div className={styles.dashboardNavigation} onKeyDown={event => {
      if (event.key === 'Escape' && open) {
        setOpen(false)
        toggleRef.current?.focus()
      }
    }}>
      <button
        ref={toggleRef}
        type="button"
        className={styles.navigationToggle}
        aria-label={open ? 'Close dashboard menu' : 'Open dashboard menu'}
        aria-expanded={open}
        aria-controls="director-dashboard-navigation"
        onClick={() => setOpen(value => !value)}
      >
        {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        <span>{activeLabel}</span>
      </button>
      <nav
        id="director-dashboard-navigation"
        aria-label="Director dashboard"
        className={`${styles.tabBar} ${open ? styles.navigationOpen : ''}`}
      >
        {sections.map(section => (
          <button
            key={section.id}
            type="button"
            className={`${styles.tabBtn} ${activeTab === section.id ? styles.tabActive : ''}`}
            aria-current={activeTab === section.id ? 'page' : undefined}
            onClick={() => {
              onSelect(section.id)
              setOpen(false)
              if (toggleRef.current?.getClientRects().length) toggleRef.current.focus()
            }}
          >
            {section.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
