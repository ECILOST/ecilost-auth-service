import { SignJWT, importPKCS8 } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeRefreshTokenRepository } from '../../../test/helpers/fake-repositories.js';
import { buildTestConfig, generateTestKeyPair } from '../../../test/helpers/test-config.js';
import { AuthError } from '../domain/auth-error.js';
import { TokenService } from './token.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('TokenService', () => {
  let config: ReturnType<typeof buildTestConfig>;
  let refreshTokens: FakeRefreshTokenRepository;
  let service: TokenService;

  beforeEach(async () => {
    config = buildTestConfig();
    refreshTokens = new FakeRefreshTokenRepository();
    service = new TokenService(config, refreshTokens);
    await service.onModuleInit();
  });

  describe('access token', () => {
    it('firma y verifica un token propio', async () => {
      const issued = await service.signAccessToken(USER_ID, 'STUDENT');
      const principal = await service.verifyAccessToken(issued.accessToken);

      expect(issued.expiresIn).toBe(900);
      expect(principal.userId).toBe(USER_ID);
      expect(principal.role).toBe('STUDENT');
    });

    it('no incluye correo ni nombre en los claims', async () => {
      const { accessToken } = await service.signAccessToken(USER_ID, 'STUDENT');
      const payload = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'),
      );

      expect(payload).toHaveProperty('sub');
      expect(payload).toHaveProperty('role');
      expect(payload).not.toHaveProperty('email');
      expect(payload).not.toHaveProperty('name');
    });

    it('rechaza un token con formato invalido', async () => {
      await expect(service.verifyAccessToken('esto-no-es-un-jwt')).rejects.toBeInstanceOf(
        AuthError,
      );
    });

    it('rechaza un token expirado', async () => {
      const key = await importPKCS8(config.jwtPrivateKeyPem, 'RS256');
      const expired = await new SignJWT({ role: 'STUDENT' })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject(USER_ID)
        .setIssuer(config.jwtIssuer)
        .setAudience(config.jwtAudience)
        .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
        .sign(key);

      await expect(service.verifyAccessToken(expired)).rejects.toBeInstanceOf(AuthError);
    });

    it('rechaza un token firmado con otra llave', async () => {
      const otherConfig = buildTestConfig(generateOtherKeys());
      const otherService = new TokenService(otherConfig, new FakeRefreshTokenRepository());
      await otherService.onModuleInit();

      const { accessToken } = await otherService.signAccessToken(USER_ID, 'STAFF');

      await expect(service.verifyAccessToken(accessToken)).rejects.toBeInstanceOf(AuthError);
    });

    it('rechaza un token con otro emisor', async () => {
      const key = await importPKCS8(config.jwtPrivateKeyPem, 'RS256');
      const foreign = await new SignJWT({ role: 'STUDENT' })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject(USER_ID)
        .setIssuer('https://emisor-falso.test')
        .setAudience(config.jwtAudience)
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(key);

      await expect(service.verifyAccessToken(foreign)).rejects.toBeInstanceOf(AuthError);
    });
  });

  describe('jwks', () => {
    it('publica la llave publica y nunca la privada', async () => {
      const jwks = await service.publicJwks();

      expect(jwks.keys).toHaveLength(1);
      expect(jwks.keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' });
      expect(jwks.keys[0]).not.toHaveProperty('d');
      expect(jwks.keys[0].kid).toBeTruthy();
    });
  });

  describe('refresh token', () => {
    it('guarda solo el hash, nunca el valor en claro', async () => {
      const raw = await service.issueRefreshToken(USER_ID);

      expect(refreshTokens.rows).toHaveLength(1);
      expect(refreshTokens.rows[0].tokenHash).not.toBe(raw);
      expect(refreshTokens.rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rota y deja revocado el anterior', async () => {
      const first = await service.issueRefreshToken(USER_ID);
      const rotated = await service.rotateRefreshToken(first);

      expect(rotated.userId).toBe(USER_ID);
      expect(rotated.rawToken).not.toBe(first);
      expect(refreshTokens.rows[0].revokedAt).not.toBeNull();
      expect(refreshTokens.rows[1].revokedAt).toBeNull();
      // La rotacion conserva la familia: es la misma sesion.
      expect(refreshTokens.rows[1].familyId).toBe(refreshTokens.rows[0].familyId);
    });

    it('reusar un token ya rotado revoca la familia completa', async () => {
      const first = await service.issueRefreshToken(USER_ID);
      const second = await service.rotateRefreshToken(first);

      await expect(service.rotateRefreshToken(first)).rejects.toBeInstanceOf(AuthError);

      // El token legitimo del atacado tambien queda inutilizado: la sesion se cierra.
      await expect(service.rotateRefreshToken(second.rawToken)).rejects.toBeInstanceOf(
        AuthError,
      );
      expect(refreshTokens.rows.every((r) => r.revokedAt !== null)).toBe(true);
    });

    it('rechaza un token desconocido', async () => {
      await expect(service.rotateRefreshToken('token-inventado')).rejects.toBeInstanceOf(
        AuthError,
      );
    });

    it('rechaza un token expirado', async () => {
      const raw = await service.issueRefreshToken(USER_ID);
      refreshTokens.rows[0].expiresAt = new Date(Date.now() - 1000);

      await expect(service.rotateRefreshToken(raw)).rejects.toBeInstanceOf(AuthError);
    });

    it('logout revoca la cadena y deja el token inservible', async () => {
      const raw = await service.issueRefreshToken(USER_ID);

      await service.revokeRefreshToken(raw);

      await expect(service.rotateRefreshToken(raw)).rejects.toBeInstanceOf(AuthError);
    });

    it('logout es idempotente con un token desconocido', async () => {
      await expect(service.revokeRefreshToken('no-existe')).resolves.toBeUndefined();
    });
  });
});

function generateOtherKeys() {
  const keys = generateTestKeyPair();
  return { JWT_PRIVATE_KEY: keys.privateKey, JWT_PUBLIC_KEY: keys.publicKey };
}
