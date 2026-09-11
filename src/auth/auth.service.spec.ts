import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FakeRefreshTokenRepository,
  FakeUserRepository,
} from '../../test/helpers/fake-repositories.js';
import { buildTestConfig } from '../../test/helpers/test-config.js';
import { UsersService, type VerifiedGoogleIdentity } from '../users/users.service.js';
import { AuthService, type OAuthTransaction } from './auth.service.js';
import { AuthError } from './domain/auth-error.js';
import type { GoogleOidcClient } from './google/google-oidc.client.js';
import { TokenService } from './tokens/token.service.js';

const IDENTITY: VerifiedGoogleIdentity = {
  sub: 'google-sub-1',
  email: 'estudiante@escuelaing.edu.co',
  fullName: 'Estudiante Uno',
  emailVerified: true,
};

describe('AuthService', () => {
  let google: GoogleOidcClient;
  let users: UsersService;
  let userRepository: FakeUserRepository;
  let tokens: TokenService;
  let service: AuthService;

  beforeEach(async () => {
    const config = buildTestConfig();
    userRepository = new FakeUserRepository();
    users = new UsersService(userRepository, config);
    tokens = new TokenService(config, new FakeRefreshTokenRepository());
    await tokens.onModuleInit();

    google = {
      createPkcePair: () => ({ codeVerifier: 'verifier', codeChallenge: 'challenge' }),
      createStateValue: () => 'state-generado',
      buildAuthorizationUrl: vi.fn(
        () => 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test',
      ),
      exchangeCode: vi.fn(async () => IDENTITY),
    } as unknown as GoogleOidcClient;

    service = new AuthService(google, users, tokens);
  });

  describe('startLogin', () => {
    it('produce state, nonce y verifier distintos en cada intento', () => {
      const first = service.startLogin();
      const second = service.startLogin();

      expect(first.transaction.state).toBeTruthy();
      expect(first.transaction.nonce).toBeTruthy();
      expect(first.transaction.nonce).not.toBe(second.transaction.nonce);
      expect(first.authorizationUrl).toContain('accounts.google.com');
    });
  });

  describe('completeLogin', () => {
    const transaction: OAuthTransaction = {
      state: 'state-valido',
      nonce: 'nonce-valido',
      codeVerifier: 'verifier',
    };

    it('crea la sesion con un callback correcto', async () => {
      const result = await service.completeLogin({
        code: 'codigo-de-google',
        state: transaction.state,
        transaction,
      });

      expect(result.refreshToken).toBeTruthy();
      expect(userRepository.rows.size).toBe(1);
      // El nonce de la transaccion debe llegar intacto al verificador del id_token.
      expect(google.exchangeCode).toHaveBeenCalledWith({
        code: 'codigo-de-google',
        codeVerifier: 'verifier',
        expectedNonce: 'nonce-valido',
      });
    });

    it('rechaza cuando no hay transaccion en curso', async () => {
      await expect(
        service.completeLogin({ code: 'c', state: 's', transaction: undefined }),
      ).rejects.toMatchObject({ code: 'invalid_request' });
    });

    it('rechaza un state que no coincide, sin canjear el codigo', async () => {
      await expect(
        service.completeLogin({ code: 'c', state: 'state-de-atacante', transaction }),
      ).rejects.toMatchObject({ code: 'invalid_request' });

      expect(google.exchangeCode).not.toHaveBeenCalled();
    });

    it('rechaza un callback sin codigo', async () => {
      await expect(
        service.completeLogin({ code: undefined, state: transaction.state, transaction }),
      ).rejects.toBeInstanceOf(AuthError);
    });

    it('admite una cuenta de Google de cualquier dominio', async () => {
      vi.mocked(google.exchangeCode).mockResolvedValueOnce({
        ...IDENTITY,
        email: 'persona@gmail.com',
      });

      const result = await service.completeLogin({
        code: 'c',
        state: transaction.state,
        transaction,
      });

      expect(result.refreshToken).toBeTruthy();
      expect(userRepository.rows.size).toBe(1);
    });

    it('propaga el rechazo de un correo sin verificar', async () => {
      vi.mocked(google.exchangeCode).mockResolvedValueOnce({
        ...IDENTITY,
        emailVerified: false,
      });

      await expect(
        service.completeLogin({ code: 'c', state: transaction.state, transaction }),
      ).rejects.toMatchObject({ code: 'email_not_verified' });

      expect(userRepository.rows.size).toBe(0);
    });
  });

  describe('refreshSession', () => {
    it('entrega un access token y rota el refresh', async () => {
      const { refreshToken } = await service.completeLogin({
        code: 'c',
        state: 'state-valido',
        transaction: {
          state: 'state-valido',
          nonce: 'nonce-valido',
          codeVerifier: 'verifier',
        },
      });

      const session = await service.refreshSession(refreshToken);

      expect(session.role).toBe('STUDENT');
      expect(session.expiresIn).toBe(900);
      expect(session.refreshToken).not.toBe(refreshToken);
      await expect(tokens.verifyAccessToken(session.accessToken)).resolves.toMatchObject({
        role: 'STUDENT',
      });
    });

    it('rechaza una peticion sin refresh token', async () => {
      await expect(service.refreshSession(undefined)).rejects.toMatchObject({
        code: 'invalid_request',
      });
    });

    it('rechaza el refresco de un usuario suspendido despues de iniciar sesion', async () => {
      const { refreshToken } = await service.completeLogin({
        code: 'c',
        state: 'state-valido',
        transaction: {
          state: 'state-valido',
          nonce: 'nonce-valido',
          codeVerifier: 'verifier',
        },
      });

      const [user] = [...userRepository.rows.values()];
      userRepository.rows.set(user.id, { ...user, status: 'SUSPENDED' });

      await expect(service.refreshSession(refreshToken)).rejects.toMatchObject({
        code: 'account_suspended',
      });
    });
  });

  describe('logout', () => {
    it('deja el refresh token inservible', async () => {
      const { refreshToken } = await service.completeLogin({
        code: 'c',
        state: 'state-valido',
        transaction: {
          state: 'state-valido',
          nonce: 'nonce-valido',
          codeVerifier: 'verifier',
        },
      });

      await service.logout(refreshToken);

      await expect(service.refreshSession(refreshToken)).rejects.toBeInstanceOf(AuthError);
    });

    it('no falla cuando no hay sesion que cerrar', async () => {
      await expect(service.logout(undefined)).resolves.toBeUndefined();
    });
  });
});
