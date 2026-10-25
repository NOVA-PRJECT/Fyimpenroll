import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { SupabaseService } from './supabase.service'

/** A single database transaction owns validation and every affected record. */
export async function mutateTeacherAssignments(supabase: SupabaseService, args: Record<string, unknown>) {
  const { data, error } = await supabase.admin.rpc('mutate_teacher_assignments', args)
  if (error) {
    if (error.code === 'P4030') throw new ForbiddenException(error.message)
    if (error.code === 'P4040') throw new NotFoundException(error.message)
    if (['23P01', '23505', '40P01', '40001'].includes(error.code)) throw new ConflictException(error.message)
    if (['23514', '23503', '22023', '22P02'].includes(error.code)) throw new BadRequestException(error.message)
    throw new InternalServerErrorException('Teacher change could not be saved. No partial changes were committed.')
  }
  if (data?.success !== true) throw new InternalServerErrorException('Teacher change was not confirmed by the database.')
  return data
}
