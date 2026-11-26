import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { OrderActorRole } from '../../orders/order-status.enum';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function createMockContext(user: any): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  it('allows access when no roles are required on route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createMockContext({ role: OrderActorRole.CUSTOMER });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access if user has ADMIN role even if not explicitly in required list', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([OrderActorRole.OPERATIONS]);
    const context = createMockContext({ role: OrderActorRole.ADMIN });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access when user matches one of the required roles', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([OrderActorRole.OPERATIONS, OrderActorRole.FACILITY_STAFF]);
    const context = createMockContext({ role: OrderActorRole.OPERATIONS });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException when user does not have required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([OrderActorRole.OPERATIONS]);
    const context = createMockContext({ role: OrderActorRole.CUSTOMER });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws UnauthorizedException when user object is missing on request', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([OrderActorRole.OPERATIONS]);
    const context = createMockContext(null);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
