import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import { SupabaseClient } from '@supabase/supabase-js'
export async function teacherProvisioning(db: SupabaseClient, campusId: string, departmentId: string) {
  if (!campusId || !departmentId) throw new BadRequestException('A teacher requires a home campus and department')
  const { data, error } = await db.from('departments').select('id').eq('id', departmentId).eq('campus_id', campusId).maybeSingle()
  if (error) throw new ServiceUnavailableException('Could not verify teacher affiliation')
  if (!data) throw new BadRequestException('Home department does not belong to the selected campus')
  return { role: 'teacher' as const, department_id: departmentId, campus_id: campusId, must_change_password: true }
}
