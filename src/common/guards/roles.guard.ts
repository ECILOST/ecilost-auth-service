import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '../../generated/prisma/enums.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { RequestWithPrincipal } from './jwt-auth.guard.js';

/**
 * Autorizacion por rol. Se aplica siempre DESPUES de JwtAuthGuard, que es quien deja el
 * Principal en la peticion. Existe para que HU-02 no tenga que inventar el mecanismo:
 * aqui solo se verifica la pertenencia al rol, sin ninguna regla de negocio propia.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { principal } = context.switchToHttp().getRequest<RequestWithPrincipal>();
    if (!principal || !required.includes(principal.role)) {
      throw new ForbiddenException('Tu rol no permite esta operacion.');
    }
    return true;
  }
}
