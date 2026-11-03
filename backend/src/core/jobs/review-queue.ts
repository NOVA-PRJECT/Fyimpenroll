import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common'
import { AcademicYear } from '@fyimp/contracts'
import { SupabaseClient } from '@supabase/supabase-js'
import { AuthUser } from '../auth/types'

export async function enqueueReviewJob(db: SupabaseClient, kind: 'allocation' | 'timetable', user: AuthUser,
  academicYear: string, semester: number, payload: Record<string, unknown>) {
  if (user.role !== 'campus_director' || !user.campus_id) throw new ForbiddenException('Campus director required')
  if (!AcademicYear.safeParse(academicYear).success || !Number.isInteger(semester) || semester < 1 || semester > 10) throw new BadRequestException('Invalid academic year or semester')
  const { data, error } = await db.rpc('enqueue_review_job', { p_kind: kind, p_campus: user.campus_id,
    p_actor: user.userId, p_term: user.term_version, p_year: academicYear, p_semester: semester, p_payload: payload })
  if (error?.code === 'P4030') throw new ForbiddenException(error.message)
  if (error?.code === 'P4090' || error?.code === '23505') throw new ConflictException(error.message)
  if (error) throw new ServiceUnavailableException(`Could not enqueue work: ${error.message}`)
  return data
}
