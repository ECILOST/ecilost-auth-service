import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Principal } from '../../auth/domain/principal.js';
import type { Role } from '../../generated/prisma/enums.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { RequestWithPrincipal } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';

const STAFF = new Principal('11111111-1111-4111-8111-111111111111', 'STAFF');
const STUDENT = new Principal('22222222-2222-4222-8222-222222222222', 'STUDENT');

function contextFor(principal?: Principal): ExecutionContext {
  const request = { principal } as RequestWithPrincipal;
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  /** Simula lo que dejaria el decorador @Roles sobre el endpoint. */
  function requireRoles(roles: Role[] | undefined): void {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);
  }

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  describe('endpoint sin restriccion de rol', () => {
    it.each([
      ['sin metadatos', undefined],
      ['con una lista vacia', [] as Role[]],
    ])('deja pasar %s', (_caso, roles) => {
      requireRoles(roles);

      expect(guard.canActivate(contextFor(STUDENT))).toBe(true);
      expect(guard.canActivate(contextFor(STAFF))).toBe(true);
    });
  });

  describe('endpoint de funcionario', () => {
    beforeEach(() => requireRoles(['STAFF']));

    it('deja pasar al funcionario', () => {
      expect(guard.canActivate(contextFor(STAFF))).toBe(true);
    });

    it('responde 403 al estudiante', () => {
      expect(() => guard.canActivate(contextFor(STUDENT))).toThrow(ForbiddenException);
    });
  });

  describe('endpoint de puja', () => {
    beforeEach(() => requireRoles(['STUDENT']));

    it('deja pasar al estudiante', () => {
      expect(guard.canActivate(contextFor(STUDENT))).toBe(true);
    });

    it('responde 403 al funcionario, que no participa en subastas', () => {
      expect(() => guard.canActivate(contextFor(STAFF))).toThrow(ForbiddenException);
    });
  });

  it('admite varios roles a la vez', () => {
    requireRoles(['STAFF', 'STUDENT']);

    expect(guard.canActivate(contextFor(STAFF))).toBe(true);
    expect(guard.canActivate(contextFor(STUDENT))).toBe(true);
  });

  it('responde 401, no 403, cuando la peticion no trae principal', () => {
    // Ocurre si alguien aplica RolesGuard sin JwtAuthGuard delante. Un 403 escondería
    // ese error de cableado detras de un mensaje de permisos.
    requireRoles(['STAFF']);

    expect(() => guard.canActivate(contextFor(undefined))).toThrow(UnauthorizedException);
  });

  it('lee los metadatos del handler y de la clase', () => {
    const spy = vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['STAFF']);

    guard.canActivate(contextFor(STAFF));

    expect(spy).toHaveBeenCalledWith(ROLES_KEY, [expect.anything(), expect.anything()]);
  });
});
