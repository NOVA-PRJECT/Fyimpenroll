import { Module } from '@nestjs/common'
import { AllocationController } from './allocation.controller'
import { AllocationService } from './allocation.service'

@Module({
  controllers: [AllocationController],
  providers: [AllocationService],
  exports: [AllocationService],
})
export class AllocationModule {}
