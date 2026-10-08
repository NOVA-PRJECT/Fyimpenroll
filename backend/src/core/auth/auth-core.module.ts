import { Module } from '@nestjs/common'
import { AuthGuard } from './guards/auth.guard'
import { RolesGuard } from './guards/roles.guard'

@Module({
  providers: [AuthGuard, RolesGuard],
  exports: [AuthGuard, RolesGuard],
})
export class AuthCoreModule {}
