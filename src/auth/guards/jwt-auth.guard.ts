import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Standardized JWT Authentication Guard.
 * Enforces valid Bearer JWT presence on protected endpoints.
 * Source of truth: TECH_STACK.md §4.1, §8.1.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw (
        err ||
        new UnauthorizedException(
          info?.message || 'Authentication required to access this resource.',
        )
      );
    }
    return user;
  }
}
