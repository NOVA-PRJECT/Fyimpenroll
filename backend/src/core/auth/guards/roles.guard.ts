import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '../decorators/roles.decorator'
import { Role } from '../types'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (!requiredRoles || requiredRoles.length === 0) {
      return true
    }

    const request = context.switchToHttp().getRequest()
    const user = request.user

    if (!user || !user.role) {
      throw new ForbiddenException('Access denied: user role not determined')
    }

    const hasRole = requiredRoles.includes(user.role)
    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied: required role ${requiredRoles.join(' or ')} but user is ${user.role}`,
      )
    }

    return true
  }
}
