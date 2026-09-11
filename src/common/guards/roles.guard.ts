import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '../../generated/prisma/enums.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { RequestWithPrincipal } from './jwt-auth.guard.js';

/**
 * Autorizacion por rol (HU-02). Se aplica siempre DESPUES de JwtAuthGuard, que es quien
 * deja el Principal en la peticion. Aqui solo se verifica la pertenencia al rol, sin
 * ninguna regla de negocio propia.
 *
 * Es el mecanismo que aplicaran los demas servicios: `@Roles(Role.STAFF)` sobre la
 * programacion de salas y el registro de objetos, `@Roles(Role.STUDENT)` sobre la puja.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Un endpoint sin @Roles no restringe por rol: la autenticacion ya la hizo el guard
    // anterior, si es que lo hay.
    if (!required || required.length === 0) return true;

    const { principal } = context.switchToHttp().getRequest<RequestWithPrincipal>();

    // Sin principal no hubo autenticacion, normalmente porque falta JwtAuthGuard delante.
    // Responder 403 aqui escondería ese error de cableado y mandaria al cliente a
    // reintentar un login que en realidad ya hizo bien.
    if (!principal) {
      throw new UnauthorizedException('Esta operacion requiere iniciar sesion.');
    }

    if (!required.includes(principal.role)) {
      throw new ForbiddenException('Tu rol no permite esta operacion.');
    }
    return true;
  }
}
