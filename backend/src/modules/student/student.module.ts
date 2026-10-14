import { Module } from '@nestjs/common'
import { StudentService } from './student.service'
import { StudentController } from './student.controller'
import { AuthCoreModule } from '../../core/auth/auth-core.module'
import { StudentPortalService } from './student-portal.service'
import { CampusAttendanceModule } from '../campus-attendance/campus-attendance.module'
import { NoticesModule } from '../notices/notices.module'

@Module({
  imports: [AuthCoreModule, CampusAttendanceModule, NoticesModule],
  controllers: [StudentController],
  providers: [StudentService, StudentPortalService],
  exports: [StudentService],
})
export class StudentModule {}
