import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { OrderActorRole } from '../../orders/order-status.enum';

/**
 * RolesGuard enforces role-based access control (RBAC).
 * Superuser bypass granted to OrderActorRole.ADMIN.
 * Source of truth: TECH_STACK.md §4.1; PRD.md §8.2, §12.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<OrderActorRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Authentication required for role verification.');
    }

    // Administrator superuser bypass
    if (user.role === OrderActorRole.ADMIN) {
      return true;
    }

    const hasRole = requiredRoles.includes(user.role);
    if (!hasRole) {
      throw new ForbiddenException(
        `User with role '${user.role}' is not permitted to perform this operation. Required: [${requiredRoles.join(
          ', ',
        )}]`,
      );
    }

    return true;
  }
}
