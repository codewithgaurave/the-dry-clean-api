import { SetMetadata } from '@nestjs/common';
import { OrderActorRole } from '../../orders/order-status.enum';

export const ROLES_KEY = 'roles';

/**
 * Roles decorator to attach required OrderActorRole permissions to route handlers or controllers.
 * Source of truth: TECH_STACK.md §4.1; PRD.md §8.2, §12.
 */
export const Roles = (...roles: OrderActorRole[]) => SetMetadata(ROLES_KEY, roles);
