import { Module } from '@nestjs/common'
import { TimetableService } from './timetable.service'
import { TimetableController } from './timetable.controller'
import { AuthCoreModule } from '../../core/auth/auth-core.module'

@Module({
  imports: [AuthCoreModule],
  controllers: [TimetableController],
  providers: [TimetableService],
  exports: [TimetableService],
})
export class TimetableModule {}
