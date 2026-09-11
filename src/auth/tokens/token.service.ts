import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  calculateJwkThumbprint,
  exportJWK,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type CryptoKey,
  type JSONWebKeySet,
} from 'jose';
import { AuthConfig } from '../../config/auth.config.js';
import type { Role } from '../../generated/prisma/enums.js';
import { AuthError } from '../domain/auth-error.js';
import { Principal } from '../domain/principal.js';
import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
} from './refresh-token.repository.js';

const ALG = 'RS256';

export interface IssuedAccessToken {
  accessToken: string;
  expiresIn: number;
  role: Role;
}

@Injectable()
export class TokenService implements OnModuleInit {
  private readonly logger = new Logger(TokenService.name);
  private privateKey: CryptoKey;
  private publicKey: CryptoKey;
  private kid: string;

  constructor(
    private readonly config: AuthConfig,
    @Inject(REFRESH_TOKEN_REPOSITORY)
    private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    this.privateKey = await importPKCS8(this.config.jwtPrivateKeyPem, ALG);
    this.publicKey = await importSPKI(this.config.jwtPublicKeyPem, ALG);
    // El kid es el thumbprint de la llave publica: estable y sin configuracion extra.
    this.kid = await calculateJwkThumbprint(await exportJWK(this.publicKey));
  }

  // --- Access token -------------------------------------------------------

  async signAccessToken(userId: string, role: Role): Promise<IssuedAccessToken> {
    const expiresIn = this.config.accessTokenTtlSeconds;
    const accessToken = await new SignJWT({ role })
      .setProtectedHeader({ alg: ALG, kid: this.kid, typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(this.config.jwtIssuer)
      .setAudience(this.config.jwtAudience)
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime(`${expiresIn}s`)
      .sign(this.privateKey);

    return { accessToken, expiresIn, role };
  }

  /** Unica puerta de verificacion. La usa el guard de este servicio y la copiaran los demas. */
  async verifyAccessToken(token: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
        algorithms: [ALG],
      });
      if (!payload.sub || typeof payload.role !== 'string') {
        throw new Error('claims incompletos');
      }
      return new Principal(payload.sub, payload.role as Role);
    } catch (error) {
      throw new AuthError('invalid_request', asDetail(error));
    }
  }

  /** Llave publica para que catalog, auction-core y realtime verifiquen sin llamar aqui. */
  async publicJwks(): Promise<JSONWebKeySet> {
    const jwk = await exportJWK(this.publicKey);
    return { keys: [{ ...jwk, kid: this.kid, alg: ALG, use: 'sig' }] };
  }

  // --- Refresh token ------------------------------------------------------

  /** Abre una cadena de rotacion nueva. Se llama una vez por inicio de sesion. */
  async issueRefreshToken(userId: string): Promise<string> {
    return this.persist(userId, randomUUID());
  }

  /**
   * Rota el refresh token y devuelve el nuevo junto con su dueno.
   * Presentar uno ya consumido es la firma de un token robado: se revoca la familia
   * entera, lo que cierra tambien la sesion del atacante.
   */
  async rotateRefreshToken(rawToken: string): Promise<{ userId: string; rawToken: string }> {
    const stored = await this.refreshTokens.findByHash(hash(rawToken));
    if (!stored) {
      throw new AuthError('invalid_request', 'refresh token desconocido');
    }

    if (stored.revokedAt !== null) {
      await this.refreshTokens.revokeFamily(stored.familyId);
      this.logger.warn(
        `Reuso de refresh token detectado. Familia ${stored.familyId} revocada.`,
      );
      throw new AuthError('invalid_request', 'refresh token reusado');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new AuthError('invalid_request', 'refresh token expirado');
    }

    if (!(await this.refreshTokens.consume(stored.id))) {
      // Otra peticion lo consumio entre el SELECT y el UPDATE: mismo caso que un reuso.
      await this.refreshTokens.revokeFamily(stored.familyId);
      throw new AuthError('invalid_request', 'refresh token consumido en paralelo');
    }

    return {
      userId: stored.userId,
      rawToken: await this.persist(stored.userId, stored.familyId),
    };
  }

  /** Logout. Idempotente: cerrar una sesion ya cerrada no es un error. */
  async revokeRefreshToken(rawToken: string): Promise<void> {
    const stored = await this.refreshTokens.findByHash(hash(rawToken));
    if (stored) await this.refreshTokens.revokeFamily(stored.familyId);
  }

  private async persist(userId: string, familyId: string): Promise<string> {
    const rawToken = randomBytes(32).toString('base64url');
    await this.refreshTokens.create({
      tokenHash: hash(rawToken),
      familyId,
      userId,
      expiresAt: new Date(Date.now() + this.config.refreshTokenTtlSeconds * 1000),
    });
    return rawToken;
  }
}

/** Solo el hash llega a la base: una copia de la tabla no permite suplantar a nadie. */
function hash(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function asDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
