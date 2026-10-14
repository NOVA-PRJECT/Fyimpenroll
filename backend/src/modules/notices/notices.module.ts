import { Module } from '@nestjs/common'
import { AuthCoreModule } from '../../core/auth/auth-core.module'
import { NoticesController } from './notices.controller'
import { NoticesService } from './notices.service'

@Module({ imports: [AuthCoreModule], controllers: [NoticesController], providers: [NoticesService], exports: [NoticesService] })
export class NoticesModule {}
