'use client'

import { useEffect, useId, useState } from 'react'
import styles from './document-layout.module.css'

interface DocumentIndexProps {
  title: string
  sections: readonly { id: string; title: string }[]
}

export default function DocumentIndex({ title, sections }: DocumentIndexProps) {
  const navigationId = useId()
  const [expanded, setExpanded] = useState(false)
  const [activeSection, setActiveSection] = useState(sections[0]?.id)

  useEffect(() => {
    const updateActiveSection = () => {
      let current = sections[0]?.id
      for (const section of sections) {
        const element = document.getElementById(section.id)
        if (element && element.getBoundingClientRect().top <= 112) current = section.id
      }
      setActiveSection(current)
    }

    updateActiveSection()
    window.addEventListener('scroll', updateActiveSection, { passive: true })
    window.addEventListener('resize', updateActiveSection)
    return () => {
      window.removeEventListener('scroll', updateActiveSection)
      window.removeEventListener('resize', updateActiveSection)
    }
  }, [sections])

  return (
    <aside className={styles.sidebar} aria-label={title}>
      <div className={styles.indexHeader}>
        <div>
          <h2 className={styles.indexTitle}>{title}</h2>
          <p className={styles.sectionCount}>{sections.length} sections</p>
        </div>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          aria-controls={navigationId}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Hide sections' : 'Show sections'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d={expanded ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
          </svg>
        </button>
      </div>
      <nav id={navigationId} className={styles.navigation} data-open={expanded} aria-label={`${title} sections`}>
        {sections.map(section => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className={styles.sectionLink}
            aria-current={activeSection === section.id ? 'location' : undefined}
            onClick={() => {
              setActiveSection(section.id)
              setExpanded(false)
            }}
          >
            {section.title}
          </a>
        ))}
      </nav>
    </aside>
  )
}
