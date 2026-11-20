import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { AuthConfig } from '../config/auth.config.js';
import { InstitutionalCodeTakenError } from '../users/ports/user.repository.js';
import type { UsersService } from '../users/users.service.js';
import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';
import { AuthError } from './domain/auth-error.js';
import { Principal } from './domain/principal.js';
import { Role } from './domain/role.enum.js';

function setup() {
  const auth = {
    startLogin: vi.fn(),
    completeLogin: vi.fn(),
    refreshSession: vi.fn(),
    logout: vi.fn(),
  };
  const users = {
    requireActiveById: vi.fn(),
    setInstitutionalCode: vi.fn(),
    findByEmail: vi.fn(),
  };
  const config = {
    cookieSecure: true,
    refreshTokenTtlSeconds: 3600,
    postLoginRedirectUrl: 'https://example.test/home',
    postLoginErrorUrl: 'https://example.test/error',
  };
  const response = {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    redirect: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    setHeader: vi.fn(),
    send: vi.fn(),
  };
  const controller = new AuthController(
    auth as unknown as AuthService, users as unknown as UsersService, config as AuthConfig,
  );
  const request = (signedCookies: Record<string, unknown>) => ({ signedCookies }) as Request;
  return { auth, users, controller, response, request, http: response as unknown as Response };
}

const principal = new Principal('student-id', Role.STUDENT);
const user = {
  id: 'student-id', email: 'student@example.test', role: Role.STUDENT, status: 'ACTIVE',
  fullName: 'Test Student', avatarUrl: null, institutionalCode: null, googleSub: 'internal',
};

describe('AuthController', () => {
  it('stores the OAuth transaction in a signed secure cookie before redirecting', () => {
    const { auth, controller, response, http } = setup();
    const transaction = { state: 'test-state', nonce: 'test-nonce', codeVerifier: 'test-verifier' };
    auth.startLogin.mockReturnValue({ transaction, authorizationUrl: 'https://accounts.example.test' });

    controller.start(http);

    expect(response.cookie).toHaveBeenCalledWith('oauth_tx', JSON.stringify(transaction), {
      httpOnly: true, secure: true, sameSite: 'lax', signed: true, path: '/auth', maxAge: 600_000,
    });
    expect(response.redirect).toHaveBeenCalledWith('https://accounts.example.test');
  });

  it('consumes the transaction and redirects with a session cookie on success', async () => {
    const { auth, controller, response, request, http } = setup();
    const transaction = { state: 'test-state' };
    auth.completeLogin.mockResolvedValue({ refreshToken: 'issued-token' });

    await controller.callback({ code: 'example-code', state: 'test-state' },
      request({ oauth_tx: JSON.stringify(transaction) }), http);

    expect(auth.completeLogin).toHaveBeenCalledWith(expect.objectContaining({ transaction }));
    expect(response.clearCookie).toHaveBeenCalledWith('oauth_tx', expect.objectContaining({ path: '/auth' }));
    expect(response.cookie).toHaveBeenCalledWith('ecilost_rt', 'issued-token', expect.objectContaining({ maxAge: 3_600_000 }));
    expect(response.redirect).toHaveBeenCalledWith('https://example.test/home');
  });

  it('redirects a denial without attempting a token exchange', async () => {
    const { auth, controller, response, request, http } = setup();

    await controller.callback({ error: 'access_denied' }, request({}), http);

    expect(auth.completeLogin).not.toHaveBeenCalled();
    expect(response.clearCookie).toHaveBeenCalled();
    expect(new URL(response.redirect.mock.calls[0][0]).searchParams.get('error')).toBe('access_denied');
  });

  it('reports an invalid transaction without exposing implementation details', async () => {
    const { auth, controller, response, request, http } = setup();
    auth.completeLogin.mockRejectedValue(new AuthError('invalid_request', 'private failure'));

    await controller.callback({}, request({ oauth_tx: '{' }), http);

    expect(auth.completeLogin).toHaveBeenCalledWith(expect.objectContaining({ transaction: undefined }));
    expect(response.cookie).not.toHaveBeenCalled();
    const target = new URL(response.redirect.mock.calls[0][0]);
    expect(target.searchParams.get('error')).toBe('invalid_request');
    expect(target.toString()).not.toContain('private');
  });

  it('rotates the cookie and returns an access token', async () => {
    const { auth, controller, response, request, http } = setup();
    auth.refreshSession.mockResolvedValue({
      refreshToken: 'rotated', accessToken: 'access', expiresIn: 300, role: Role.STUDENT,
    });

    await controller.token(request({ ecilost_rt: 'original' }), http);

    expect(auth.refreshSession).toHaveBeenCalledWith('original');
    expect(response.cookie).toHaveBeenCalledWith('ecilost_rt', 'rotated', expect.any(Object));
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      access_token: 'access', token_type: 'Bearer', expires_in: 300, role: Role.STUDENT,
    });
  });

  it('clears a rejected session and returns an authentication challenge', async () => {
    const { auth, controller, response, request, http } = setup();
    auth.refreshSession.mockRejectedValue(new AuthError('account_suspended'));

    await controller.token(request({ ecilost_rt: false }), http);

    expect(auth.refreshSession).toHaveBeenCalledWith(undefined);
    expect(response.clearCookie).toHaveBeenCalledWith('ecilost_rt', expect.any(Object));
    expect(response.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer error="invalid_token"');
    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'account_suspended' }));
  });

  it('revokes the refresh token and ends the browser session on logout', async () => {
    const { auth, controller, response, request, http } = setup();

    await controller.logout(request({ ecilost_rt: 'logout-token' }), http);

    expect(auth.logout).toHaveBeenCalledWith('logout-token');
    expect(response.clearCookie).toHaveBeenCalledWith('ecilost_rt', expect.any(Object));
    expect(response.status).toHaveBeenCalledWith(204);
  });

  it('returns permission flags and projects the profile and directory responses', async () => {
    const { users, controller } = setup();
    users.requireActiveById.mockResolvedValue(user);
    users.findByEmail.mockResolvedValue(user);

    expect(controller.me(principal)).toMatchObject({ userId: user.id, canBid: true, canManageWallets: false });
    const profile = await controller.profile(principal);
    expect(profile).toMatchObject({ userId: user.id, email: user.email, institutionalCode: null });
    expect(profile).not.toHaveProperty('googleSub');
    await expect(controller.updateProfile(principal, {})).resolves.toEqual(profile);
    expect(users.setInstitutionalCode).not.toHaveBeenCalled();
    await expect(controller.findUser({ email: user.email })).resolves.toMatchObject({
      userId: user.id, status: 'ACTIVE',
    });
    users.findByEmail.mockResolvedValue(null);
    await expect(controller.findUser({ email: 'unknown@example.test' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates a profile code and maps duplicate codes to a conflict', async () => {
    const { users, controller } = setup();
    users.setInstitutionalCode.mockResolvedValueOnce({ ...user, institutionalCode: 'ST-1234' });

    await expect(controller.updateProfile(principal, { institutionalCode: 'ST-1234' }))
      .resolves.toMatchObject({ institutionalCode: 'ST-1234' });
    expect(users.setInstitutionalCode).toHaveBeenCalledWith(user.id, 'ST-1234');

    users.setInstitutionalCode.mockRejectedValueOnce(new InstitutionalCodeTakenError());
    await expect(controller.updateProfile(principal, { institutionalCode: 'ST-9999' }))
      .rejects.toBeInstanceOf(ConflictException);
  });
});
