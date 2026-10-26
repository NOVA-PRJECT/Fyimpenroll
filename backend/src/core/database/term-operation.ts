import { ConflictException, InternalServerErrorException } from '@nestjs/common'
import { AuthUser } from '../auth/types'

/** The request's term is captured by AuthGuard, then checked again under the DB lifecycle lock. */
export async function termOperation(db: any, user: AuthUser, operation: string, payload: Record<string, unknown>) {
  let campusId = user.campus_id
  let expectedTerm = user.term_version
  // Superadmins have no home campus; resolve the explicitly targeted delivery.
  if (user.role === 'superadmin' && !campusId) {
    campusId = payload.p_campus_id as string | undefined
    if (!campusId && payload.p_entry_id) {
      const { data } = await db.from('current_timetable_entries').select('campus_id').eq('id', payload.p_entry_id).maybeSingle()
      campusId = data?.campus_id
    }
    if (!campusId && payload.p_assignment_id) {
      const { data } = await db.from('current_teacher_course_assignments').select('campus_id').eq('id', payload.p_assignment_id).maybeSingle()
      campusId = data?.campus_id
    }
    if (!campusId && Array.isArray(payload.p_items)) campusId = payload.p_items[0]?.campus_id
    if (campusId) {
      const { data, error } = await db.from('campus_settings').select('term_version').eq('campus_id', campusId).maybeSingle()
      if (error) throw new InternalServerErrorException('Unable to verify the target campus term.')
      expectedTerm = data?.term_version
    }
  }
  if (!campusId || !Number.isInteger(expectedTerm)) {
    throw new ConflictException('Campus term is unavailable. Reload the portal before trying again.')
  }
  const result = await db.rpc('run_current_term_operation', {
    p_campus_id: campusId, p_expected_term: expectedTerm,
    p_operation: operation, p_payload: payload,
  })
  if (result.error && ['P4090', '40001', '40P01'].includes(result.error.code)) throw new ConflictException(result.error.message)
  return result
}
