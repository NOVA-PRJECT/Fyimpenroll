import { ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common'
import { SupabaseService } from '../../core/database/supabase.service'
import { AuthUser } from '../../core/auth/types'

@Injectable()
export class NoticesService {
  constructor(private readonly supabase: SupabaseService) {}

  private assertScope(user: AuthUser, departmentId?: string) {
    if (!user.campus_id || !user.department_id || (departmentId && departmentId !== user.department_id)) {
      throw new ForbiddenException('Notices are restricted to your department and campus.')
    }
  }

  async list(user: AuthUser, departmentId?: string) {
    this.assertScope(user, departmentId)
    const { data, error } = await this.supabase.admin.from('department_notices')
      .select('id, title, content, created_at')
      .eq('campus_id', user.campus_id).eq('department_id', user.department_id)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100)
    if (error) throw new InternalServerErrorException('Unable to load department notices.')
    return data || []
  }

  async create(user: AuthUser, body: { title: string; content: string; department_id?: string }) {
    if (user.role !== 'hod') throw new ForbiddenException('Only HODs may publish department notices.')
    this.assertScope(user, body.department_id)
    const { data, error } = await this.supabase.admin.from('department_notices').insert({
      campus_id: user.campus_id, department_id: user.department_id, created_by: user.userId,
      title: body.title, content: body.content,
    }).select('id, title, content, created_at').single()
    if (error || !data) throw new InternalServerErrorException('Unable to publish department notice.')
    return data
  }
}
