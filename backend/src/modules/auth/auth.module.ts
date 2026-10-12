import { Module } from '@nestjs/common'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { AuthCoreModule } from '../../core/auth/auth-core.module'
import { StudentModule } from '../student/student.module'
import { DirectorModule } from '../director/director.module'
import { FacultyModule } from '../faculty/faculty.module'
import { DashboardEntryService } from './dashboard-entry.service'

@Module({
  imports: [AuthCoreModule, StudentModule, DirectorModule, FacultyModule],
  controllers: [AuthController],
  providers: [AuthService, DashboardEntryService],
  exports: [AuthService],
})
export class AuthModule {}
