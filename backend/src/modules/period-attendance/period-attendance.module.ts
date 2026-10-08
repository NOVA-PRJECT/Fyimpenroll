import { Module } from '@nestjs/common';
import { PeriodAttendanceController } from './period-attendance.controller';
import { AttendanceExportController } from './attendance-export.controller';
import { PeriodAttendanceService } from './period-attendance.service';
import { AttendanceExportService } from './attendance-export.service';
import { DatabaseModule } from '../../core/database/database.module';
import { LoggingModule } from '../../core/logging/logging.module';

@Module({
  imports: [DatabaseModule, LoggingModule],
  controllers: [PeriodAttendanceController, AttendanceExportController],
  providers: [PeriodAttendanceService, AttendanceExportService],
  exports: [PeriodAttendanceService, AttendanceExportService],
})
export class PeriodAttendanceModule {}
