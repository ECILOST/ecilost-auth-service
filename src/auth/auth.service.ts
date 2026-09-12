import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { UsersService } from '../users/users.service.js';
import { AuthError } from './domain/auth-error.js';
import { GoogleOidcClient } from './google/google-oidc.client.js';
import { TokenService, type IssuedAccessToken } from './tokens/token.service.js';

/** Estado efimero del flujo, custodiado en una cookie firmada entre los dos saltos. */
export interface OAuthTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface StartedLogin {
  authorizationUrl: string;
  transaction: OAuthTransaction;
}

export interface Session extends IssuedAccessToken {
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly google: GoogleOidcClient,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  /** Paso 1: arma la URL de autorizacion y el estado que habra que devolver intacto. */
  startLogin(): StartedLogin {
    const { codeVerifier, codeChallenge } = this.google.createPkcePair();
    const transaction: OAuthTransaction = {
      state: this.google.createStateValue(),
      nonce: randomBytes(16).toString('base64url'),
      codeVerifier,
    };

    return {
      authorizationUrl: this.google.buildAuthorizationUrl({
        state: transaction.state,
        nonce: transaction.nonce,
        codeChallenge,
      }),
      transaction,
    };
  }

  /**
   * Paso 2: valida el retorno, canjea el codigo y crea la sesion.
   * Devuelve solo el refresh token: el access token se pide despues, por `POST /auth/token`,
   * para que nunca viaje en una URL de redireccion ni quede en el historial del navegador.
   */
  async completeLogin(params: {
    code?: string;
    state?: string;
    issuer?: string;
    transaction?: OAuthTransaction;
  }): Promise<{ refreshToken: string }> {
    const { code, state, issuer, transaction } = params;

    if (!transaction) {
      throw new AuthError('invalid_request', 'no hay transaccion OAuth en curso');
    }
    if (!state || !equalsConstantTime(state, transaction.state)) {
      throw new AuthError('invalid_request', 'state no coincide (posible CSRF)');
    }
    this.google.assertExpectedIssuer(issuer);
    if (!code) {
      throw new AuthError('invalid_request', 'callback sin code');
    }

    const identity = await this.google.exchangeCode({
      code,
      codeVerifier: transaction.codeVerifier,
      expectedNonce: transaction.nonce,
    });

    const user = await this.users.resolveOrProvision(identity);
    this.logger.log(`Sesion iniciada para el usuario ${user.id}`);

    return { refreshToken: await this.tokens.issueRefreshToken(user.id) };
  }

  /** Paso 3: canjea el refresh token por un access token y rota la cadena. */
  async refreshSession(rawRefreshToken?: string): Promise<Session> {
    if (!rawRefreshToken) {
      throw new AuthError('invalid_request', 'peticion sin refresh token');
    }

    const rotated = await this.tokens.rotateRefreshToken(rawRefreshToken);
    const user = await this.users.requireActiveById(rotated.userId);
    const issued = await this.tokens.signAccessToken(user.id, user.role);

    return { ...issued, refreshToken: rotated.rawToken };
  }

  /** Logout: revoca la cadena completa, no solo el token presentado. */
  async logout(rawRefreshToken?: string): Promise<void> {
    if (!rawRefreshToken) return;
    await this.tokens.revokeRefreshToken(rawRefreshToken);
  }
}

/** Comparacion sin fugas por tiempo: el state es un secreto de un solo uso. */
function equalsConstantTime(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
