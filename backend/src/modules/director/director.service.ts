import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { SupabaseService } from '../../core/database/supabase.service'
import { AuditLoggerService } from '../../core/logging/audit-logger.service'
import { ServerLoggerService } from '../../core/logging/server-logger.service'
import { AuthUser } from '../../core/auth/types'

@Injectable()
export class DirectorService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly auditLogger: AuditLoggerService,
    private readonly serverLogger: ServerLoggerService,
  ) {}

  async getSettings(user: AuthUser) {
    const { data: faculty, error: facultyError } = await this.supabase.admin
      .from('faculty')
      .select('full_name, campus_id')
      .eq('id', user.userId)
      .single()

    if (facultyError || !faculty) {
      throw new NotFoundException('Director profile not found')
    }

    const { data: campus } = await this.supabase.admin
      .from('campuses')
      .select('name')
      .eq('id', faculty.campus_id)
      .single()

    const { data: settings } = await this.supabase.admin
      .from('campus_settings')
      .select('deadline, min_credits, max_credits, academic_year, last_promoted_at')
      .eq('campus_id', faculty.campus_id)
      .single()

    return {
      directorName: faculty.full_name,
      campusId: faculty.campus_id,
      campusName: campus?.name ?? 'Unknown',
      settings: settings ?? null,
    }
  }

  async updateSettings(
    body: {
      deadline?: string | null
      min_credits?: number
      max_credits?: number
      academic_year?: string
    },
    user: AuthUser,
  ) {
    const campusId = user.campus_id
    if (!campusId) throw new BadRequestException('Campus ID missing')

    const updatePayload: Record<string, any> = {}
    if (body.deadline !== undefined) updatePayload.deadline = body.deadline
    if (body.min_credits !== undefined) updatePayload.min_credits = body.min_credits
    if (body.max_credits !== undefined) updatePayload.max_credits = body.max_credits
    if (body.academic_year !== undefined) updatePayload.academic_year = body.academic_year

    if (Object.keys(updatePayload).length === 0) {
      throw new BadRequestException('No settings provided to update')
    }

    const { error } = await this.supabase.admin
      .from('campus_settings')
      .update(updatePayload)
      .eq('campus_id', campusId)

    if (error) {
      throw new InternalServerErrorException('Failed to update campus settings')
    }

    await this.auditLogger.log({
      eventType: 'settings_modified',
      userId: user.userId,
      userRole: user.role,
      action: 'modified campus settings',
      resourceType: 'campus_settings',
      resourceId: campusId,
      status: 'success',
      metadata: updatePayload,
    })

    return { success: true, message: 'Settings updated successfully' }
  }
}
