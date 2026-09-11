import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRefreshTokenRepository } from '../../../test/helpers/fake-repositories.js';
import { buildTestConfig } from '../../../test/helpers/test-config.js';
import { TokenService } from '../../auth/tokens/token.service.js';
import { JwtAuthGuard, type RequestWithPrincipal } from './jwt-auth.guard.js';

const USER_ID = '22222222-2222-4222-8222-222222222222';

function contextFor(request: Partial<RequestWithPrincipal>) {
  const response = { setHeader: vi.fn() };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, request, response };
}

describe('JwtAuthGuard', () => {
  let tokens: TokenService;
  let guard: JwtAuthGuard;

  beforeEach(async () => {
    tokens = new TokenService(buildTestConfig(), new FakeRefreshTokenRepository());
    await tokens.onModuleInit();
    guard = new JwtAuthGuard(tokens);
  });

  it('deja pasar un token valido e inyecta el Principal', async () => {
    const { accessToken } = await tokens.signAccessToken(USER_ID, 'STAFF');
    const { context, request } = contextFor({
      headers: { authorization: `Bearer ${accessToken}` },
    } as Partial<RequestWithPrincipal>);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((request as RequestWithPrincipal).principal?.userId).toBe(USER_ID);
    expect((request as RequestWithPrincipal).principal?.role).toBe('STAFF');
  });

  it('responde 401 cuando no hay cabecera Authorization', async () => {
    const { context, response } = contextFor({ headers: {} } as Partial<RequestWithPrincipal>);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(response.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringContaining('Bearer'),
    );
  });

  it.each([
    ['esquema equivocado', 'Basic abc'],
    ['sin valor', 'Bearer'],
    ['con partes de mas', 'Bearer a b'],
  ])('responde 401 con una cabecera mal formada: %s', async (_caso, authorization) => {
    const { context } = contextFor({
      headers: { authorization },
    } as Partial<RequestWithPrincipal>);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('responde 401 con un token que no verifica', async () => {
    const { context, response } = contextFor({
      headers: { authorization: 'Bearer token.invalido.aqui' },
    } as Partial<RequestWithPrincipal>);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(response.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Bearer error="invalid_token"',
    );
  });
});
