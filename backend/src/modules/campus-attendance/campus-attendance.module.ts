import { Module } from '@nestjs/common';
import { CampusAttendanceController } from './campus-attendance.controller';
import { CampusAttendanceService } from './campus-attendance.service';
import { DatabaseModule } from '../../core/database/database.module';
import { LoggingModule } from '../../core/logging/logging.module';
import { SecurityModule } from '../../core/security/security.module';

@Module({
  imports: [DatabaseModule, LoggingModule, SecurityModule],
  controllers: [CampusAttendanceController],
  providers: [CampusAttendanceService],
  exports: [CampusAttendanceService],
})
export class CampusAttendanceModule {}
