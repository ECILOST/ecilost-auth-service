import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AuthConfig } from '../../config/auth.config.js';
import type { VerifiedGoogleIdentity } from '../../users/users.service.js';
import { AuthError } from '../domain/auth-error.js';

// Endpoints estables de Google. Se evita el documento de descubrimiento para no anadir
// una llamada de red en el arranque; el JWKS si se descarga y cachea bajo demanda.
const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
const VALID_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

@Injectable()
export class GoogleOidcClient {
  private readonly logger = new Logger(GoogleOidcClient.name);
  private readonly jwks = createRemoteJWKSet(new URL(JWKS_URI));

  constructor(private readonly config: AuthConfig) {}

  /** PKCE S256. El verifier se queda en una cookie firmada; solo el challenge viaja a Google. */
  createPkcePair(): PkcePair {
    const codeVerifier = randomBytes(32).toString('base64url');
    return {
      codeVerifier,
      codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
    };
  }

  createStateValue(): string {
    return randomBytes(16).toString('base64url');
  }

  buildAuthorizationUrl(params: {
    state: string;
    nonce: string;
    codeChallenge: string;
  }): string {
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: this.config.googleClientId,
      redirect_uri: this.config.googleRedirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: params.state,
      nonce: params.nonce,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  /**
   * Canjea el codigo y devuelve la identidad ya verificada.
   * No se pide `offline access`: sin refresh token de Google no hay nada suyo que guardar.
   */
  async exchangeCode(params: {
    code: string;
    codeVerifier: string;
    expectedNonce: string;
  }): Promise<VerifiedGoogleIdentity> {
    const idToken = await this.requestIdToken(params.code, params.codeVerifier);
    return this.verifyIdToken(idToken, params.expectedNonce);
  }

  private async requestIdToken(code: string, codeVerifier: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          code_verifier: codeVerifier,
          client_id: this.config.googleClientId,
          client_secret: this.config.googleClientSecret,
          redirect_uri: this.config.googleRedirectUri,
          grant_type: 'authorization_code',
        }),
      });
    } catch (error) {
      throw new AuthError('server_error', `no se pudo contactar a Google: ${detail(error)}`);
    }

    if (!response.ok) {
      // El cuerpo puede traer el client_secret reflejado en el mensaje: no se propaga.
      this.logger.warn(`Canje de codigo rechazado por Google (HTTP ${response.status})`);
      throw new AuthError('invalid_request', `token endpoint devolvio ${response.status}`);
    }

    const body = (await response.json()) as { id_token?: string };
    if (!body.id_token) {
      throw new AuthError('server_error', 'respuesta de Google sin id_token');
    }
    return body.id_token;
  }

  private async verifyIdToken(
    idToken: string,
    expectedNonce: string,
  ): Promise<VerifiedGoogleIdentity> {
    let claims: Record<string, unknown>;
    try {
      const verified = await jwtVerify(idToken, this.jwks, {
        issuer: VALID_ISSUERS,
        audience: this.config.googleClientId,
      });
      claims = verified.payload as Record<string, unknown>;
    } catch (error) {
      throw new AuthError('invalid_request', `id_token invalido: ${detail(error)}`);
    }

    // Anti-replay: ata este id_token a la peticion que lo origino.
    if (claims.nonce !== expectedNonce) {
      throw new AuthError('invalid_request', 'nonce del id_token no coincide');
    }

    const sub = claims.sub;
    const email = claims.email;
    if (typeof sub !== 'string' || typeof email !== 'string') {
      throw new AuthError('server_error', 'id_token sin sub o email');
    }

    return {
      sub,
      email,
      fullName: typeof claims.name === 'string' ? claims.name : email,
      emailVerified: claims.email_verified === true,
    };
  }
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
