'use client'

import { useEffect, useRef, useState } from 'react'
import styles from '../student-dashboard.module.css'

export interface Course {
  id: string
  course_code: string
  title: string
  credits: number
  department_name?: string
  remaining_seats?: number
  seat_limit?: number
}

export default function CustomSelect({
  options,
  value,
  onChange,
  disabled,
  placeholder = '— Select a paper —',
}: {
  options: Course[]
  value: string
  onChange: (val: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const selectedCourse = options.find((c) => c.id === value)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  return (
    <div ref={containerRef} className={styles.customSelectWrapper}>
      <button
        type="button"
        className={styles.customSelectTrigger}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
      >
        {selectedCourse ? (
          <div className={styles.triggerContent}>
            <span className={styles.triggerTitle}>{selectedCourse.title}</span>
            <span className={styles.triggerMeta}>
              {selectedCourse.course_code ? `${selectedCourse.course_code} • ` : ''}
              {selectedCourse.department_name || 'General'} • {selectedCourse.credits} cr
              {selectedCourse.remaining_seats !== undefined && (
                <> • <strong style={{ color: selectedCourse.remaining_seats > 5 ? "var(--portal-success-text,#059669)" : "var(--portal-warning-text,#d97706)" }}>{selectedCourse.remaining_seats} seats left</strong></>
              )}
            </span>
          </div>
        ) : (
          <span className={styles.placeholderText}>{placeholder}</span>
        )}
        <span className={styles.triggerArrow} />
      </button>

      {isOpen && (
        <div className={styles.customSelectDropdown}>
          {options.length === 0 ? (
            <div className={styles.customOptionNoData}>No options available</div>
          ) : (
            <>
              {placeholder && (
                <div
                  className={`${styles.customOption} ${!value ? styles.selected : ''}`}
                  onClick={() => {
                    onChange('')
                    setIsOpen(false)
                  }}
                >
                  <span className={styles.placeholderOption}>{placeholder}</span>
                </div>
              )}
              {options.map((course) => (
                <div
                  key={course.id}
                  className={`${styles.customOption} ${value === course.id ? styles.selected : ''}`}
                  onClick={() => {
                    onChange(course.id)
                    setIsOpen(false)
                  }}
                >
                  <div className={styles.optionUpper}>{course.title}</div>
                  <div className={styles.optionLower} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className={styles.optionDept}>
                      {course.course_code ? `${course.course_code} • ` : ''}
                      {course.department_name || 'General'}
                    </span>
                    <span className={styles.optionCredits} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {course.credits} cr
                      {course.remaining_seats !== undefined && (
                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '0.1rem 0.4rem',
                            borderRadius: '4px',
                            background: course.remaining_seats > 5 ? "var(--portal-success-bg,#ecfdf5)" : "var(--portal-warning-bg,#fffbeb)",
                            color: course.remaining_seats > 5 ? "var(--portal-success-text,#059669)" : "var(--portal-warning-text,#d97706)",
                            border: `1px solid ${course.remaining_seats > 5 ? "var(--portal-success-border,#a7f3d0)" : "var(--portal-warning-border,#fde68a)"}`,
                          }}
                        >
                          {course.remaining_seats} seat{course.remaining_seats === 1 ? '' : 's'} left
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
