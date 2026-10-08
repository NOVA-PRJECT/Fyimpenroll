import { Module } from '@nestjs/common'
import { FacultyService } from './faculty.service'
import { FacultyController } from './faculty.controller'
import { AuthCoreModule } from '../../core/auth/auth-core.module'

@Module({
  imports: [AuthCoreModule],
  controllers: [FacultyController],
  providers: [FacultyService],
  exports: [FacultyService],
})
export class FacultyModule {}
