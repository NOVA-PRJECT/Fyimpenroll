import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common'
import { SupabaseClient } from '@supabase/supabase-js'
import { AuthUser } from './types'
export interface DeliveryIdentity { course_id: string; campus_id: string; academic_year: string; semester: number; term_version?: number }
export function sameDelivery(a: DeliveryIdentity, b: DeliveryIdentity): boolean {
  return !!a.campus_id && !!b.campus_id && a.course_id === b.course_id && a.campus_id === b.campus_id &&
    a.academic_year === b.academic_year && a.semester === b.semester && a.term_version === b.term_version
}
export async function assertDeliveryAuthority(db: SupabaseClient, user: AuthUser, delivery: DeliveryIdentity & { department_id?: string }) {
  if (user.role === 'superadmin') return
  if (!delivery.campus_id || !delivery.course_id || !delivery.academic_year || !Number.isInteger(delivery.semester)) throw new ForbiddenException('Delivery identity is incomplete')
  if (user.role === 'hod' && user.campus_id === delivery.campus_id && user.department_id && user.department_id === delivery.department_id) return
  if (user.role !== 'teacher') throw new ForbiddenException('Role cannot access this class delivery')
  let query = db.from('current_teacher_course_assignments').select('id')
    .eq('teacher_id', user.userId).eq('course_id', delivery.course_id).eq('campus_id', delivery.campus_id)
    .eq('academic_year', delivery.academic_year).eq('semester', delivery.semester)
  if (delivery.term_version !== undefined) query = query.eq('term_version', delivery.term_version)
  const { data, error } = await query.limit(1)
  if (error) throw new ServiceUnavailableException('Could not verify teaching authority')
  if (!data?.length) throw new ForbiddenException('You are not assigned to this class delivery')
}
