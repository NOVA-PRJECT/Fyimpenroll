import { Module } from '@nestjs/common'
import { StudentService } from './student.service'
import { StudentController } from './student.controller'
import { AuthCoreModule } from '../../core/auth/auth-core.module'

@Module({
  imports: [AuthCoreModule],
  controllers: [StudentController],
  providers: [StudentService],
  exports: [StudentService],
})
export class StudentModule {}
