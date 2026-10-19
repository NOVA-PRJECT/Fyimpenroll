import type { BulkUploadResult } from '@/core/bulk-upload-result'
import styles from './hod-dashboard.module.css'

export default function BulkUploadResults({ result }: { result: BulkUploadResult }) {
  return (
    <section aria-label="Upload results">
      <p className={styles.sectionTitle}>Upload Results</p>
      <p role="status">{result.results.length} rows processed: {result.inserted_count} created, {result.error_count} errors.</p>
      <div className={styles.uploadCard}>
        <div className={styles.resultsGrid}>
          <div className={`${styles.resultStat} ${styles.success}`}>
            <p className={styles.resultValue}>{result.inserted_count}</p>
            <p className={styles.resultLabel}>Created</p>
          </div>
          <div className={`${styles.resultStat} ${result.error_count > 0 ? styles.danger : styles.success}`}>
            <p className={styles.resultValue}>{result.error_count}</p>
            <p className={styles.resultLabel}>Errors</p>
          </div>
        </div>
        {result.results && result.results.filter(r => r.status === 'error').length > 0 && (
          <div className={styles.errorList}>
            <p className={styles.errorListTitle}>Row Errors</p>
            {result.results.filter(r => r.status === 'error').map((err, i) => (
              <div key={i} className={styles.errorItem}>
                Row {err.row} ({err.email}): {err.issues?.join(', ')}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
