import { InternalServerErrorException } from '@nestjs/common'
export interface CountDelivery { key: string; course_id: string; campus_id?: string | null; academic_year: string; semester: number; term_version?: number }
/** JSON aggregation avoids PostgREST result-row caps and counts each registration only once. */
export async function enrollmentCounts(db: any, deliveries: CountDelivery[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (let offset = 0; offset < deliveries.length; offset += 200) {
    const { data, error } = await db.rpc('display_enrollment_counts', { p_deliveries: deliveries.slice(offset, offset + 200) })
    if (error || !data) throw new InternalServerErrorException('Enrollment totals unavailable. Verify that the data-read optimization SQL has been applied.')
    for (const [key, value] of Object.entries(data)) counts[key] = Number(value)
  }
  return counts
}
