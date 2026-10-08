import { Module } from '@nestjs/common';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { DatabaseModule } from '../../core/database/database.module';
import { LoggingModule } from '../../core/logging/logging.module';

@Module({
  imports: [DatabaseModule, LoggingModule],
  controllers: [AssignmentsController],
  providers: [AssignmentsService],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
