import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Principal } from '../../auth/domain/principal.js';
import type { RequestWithPrincipal } from '../guards/jwt-auth.guard.js';

/** Inyecta el Principal que dejo JwtAuthGuard. Solo tiene sentido tras ese guard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    return request.principal;
  },
);
