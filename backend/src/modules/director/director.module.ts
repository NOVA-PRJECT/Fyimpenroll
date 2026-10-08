import { Module } from '@nestjs/common'
import { DirectorService } from './director.service'
import { DirectorController } from './director.controller'
import { AuthCoreModule } from '../../core/auth/auth-core.module'

@Module({
  imports: [AuthCoreModule],
  controllers: [DirectorController],
  providers: [DirectorService],
  exports: [DirectorService],
})
export class DirectorModule {}
