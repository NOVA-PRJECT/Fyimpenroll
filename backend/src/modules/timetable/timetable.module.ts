import { Module } from '@nestjs/common'
import { TimetableService } from './timetable.service'
import { TimetableController } from './timetable.controller'
import { AuthCoreModule } from '../../core/auth/auth-core.module'
import { ManualTimetableService } from './manual-timetable.service'

@Module({
  imports: [AuthCoreModule],
  controllers: [TimetableController],
  providers: [TimetableService, ManualTimetableService],
  exports: [TimetableService],
})
export class TimetableModule {}
