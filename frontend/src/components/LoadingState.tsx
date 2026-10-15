import type { CSSProperties } from 'react'
import styles from './loading-state.module.css'

export type LoadingLayout = 'dashboard' | 'cards' | 'table' | 'form' | 'timetable' | 'list'

export function Skeleton({ width, height, className = '' }: {
  width?: CSSProperties['width']
  height?: CSSProperties['height']
  className?: string
}) {
  return <span aria-hidden="true" className={`${styles.skeleton} ${className}`} style={{ width, height }} />
}

export function LoadingIndicator({ message = 'Loading…' }: { message?: string }) {
  return <span role="status" className={styles.indicator}>
    <span className={styles.spinner} aria-hidden="true" />
    <span>{message}</span>
  </span>
}

export function ProfilePlaceholder({ message = 'Loading profile…' }: { message?: string }) {
  return <div role="status" aria-label={message} className={styles.profile}>
    <Skeleton width="85%" height=".85rem" />
    <Skeleton width="60%" height=".55rem" />
  </div>
}

function Cards({ count }: { count: number }) {
  return <div className={styles.cards}>
    {Array.from({ length: count }, (_, index) => <div key={index} className={styles.card}>
      <Skeleton width="35%" height=".65rem" />
      <Skeleton width="70%" height="1.2rem" />
      <Skeleton width="90%" />
      <Skeleton width="55%" />
    </div>)}
  </div>
}

function Rows({ count, table = false }: { count: number; table?: boolean }) {
  return <div className={styles.rows}>
    {table && <div className={`${styles.row} ${styles.tableHeader}`}>
      {[0, 1, 2, 3].map(index => <Skeleton key={index} width="65%" height=".65rem" />)}
    </div>}
    {Array.from({ length: count }, (_, index) => <div key={index} className={table ? styles.row : styles.listRow}>
      {table ? [0, 1, 2, 3].map(column => <Skeleton key={column} width={column === 1 ? '85%' : '60%'} />) : <>
        <Skeleton className={styles.avatar} />
        <div className={styles.rowText}><Skeleton width="65%" /><Skeleton width="40%" height=".6rem" /></div>
      </>}
    </div>)}
  </div>
}

export default function LoadingState({ message = 'Loading content…', layout = 'cards', rows = 4, compact = false }: {
  message?: string
  layout?: LoadingLayout
  rows?: number
  compact?: boolean
}) {
  return <div className={`${styles.root} ${compact ? styles.compact : ''}`} aria-busy="true">
    <LoadingIndicator message={message} />
    <div aria-hidden="true" className={styles.preview}>
      {layout === 'dashboard' && <>
        <div className={styles.heading}><Skeleton width="45%" height="1.35rem" /><Skeleton width="65%" /></div>
        <Cards count={3} />
        <Rows count={rows} table />
      </>}
      {layout === 'cards' && <Cards count={rows} />}
      {layout === 'table' && <Rows count={rows} table />}
      {layout === 'list' && <Rows count={rows} />}
      {layout === 'form' && <div className={styles.form}>
        {Array.from({ length: rows }, (_, index) => <div key={index} className={styles.field}>
          <Skeleton width="45%" height=".65rem" /><Skeleton height="2.65rem" />
        </div>)}
        <Skeleton width="min(100%, 12rem)" height="2.65rem" />
      </div>}
      {layout === 'timetable' && <div className={styles.schedule}>
        {Array.from({ length: 24 }, (_, index) => <div key={index} className={styles.period}>
          <Skeleton width="70%" height=".6rem" /><Skeleton width="45%" height=".5rem" />
        </div>)}
      </div>}
    </div>
  </div>
}
