import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestConfig } from '../../../test/helpers/test-config.js';
import { AuthError } from '../domain/auth-error.js';
import { GoogleOidcClient, readAvatarUrl } from './google-oidc.client.js';

describe('GoogleOidcClient', () => {
  let config: ReturnType<typeof buildTestConfig>;
  let client: GoogleOidcClient;

  beforeEach(() => {
    config = buildTestConfig();
    client = new GoogleOidcClient(config);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('PKCE', () => {
    it('el challenge es el SHA-256 en base64url del verifier', () => {
      const { codeVerifier, codeChallenge } = client.createPkcePair();

      expect(codeChallenge).toBe(
        createHash('sha256').update(codeVerifier).digest('base64url'),
      );
    });

    it('genera un verifier distinto en cada llamada', () => {
      expect(client.createPkcePair().codeVerifier).not.toBe(
        client.createPkcePair().codeVerifier,
      );
    });

    it('el verifier tiene entropia suficiente y es seguro en una URL', () => {
      const { codeVerifier } = client.createPkcePair();

      expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });
  });

  describe('buildAuthorizationUrl', () => {
    it('arma la URL de Google con todos los parametros exigidos', () => {
      const url = new URL(
        client.buildAuthorizationUrl({
          state: 'un-state',
          nonce: 'un-nonce',
          codeChallenge: 'un-challenge',
        }),
      );

      expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        client_id: config.googleClientId,
        redirect_uri: config.googleRedirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state: 'un-state',
        nonce: 'un-nonce',
        code_challenge: 'un-challenge',
        code_challenge_method: 'S256',
      });
    });

    it('no envia la pista de dominio: la plataforma acepta cualquier cuenta', () => {
      const url = new URL(
        client.buildAuthorizationUrl({ state: 's', nonce: 'n', codeChallenge: 'c' }),
      );

      expect(url.searchParams.has('hd')).toBe(false);
    });

    it('nunca pone el client_secret en la URL de autorizacion', () => {
      const url = client.buildAuthorizationUrl({
        state: 's',
        nonce: 'n',
        codeChallenge: 'c',
      });

      expect(url).not.toContain(config.googleClientSecret);
    });
  });

  describe('readAvatarUrl', () => {
    it.each([
      ['una URL https', 'https://lh3.googleusercontent.com/a/foto'],
      ['una URL https con puerto', 'https://cdn.test:8443/foto.png'],
    ])('acepta %s', (_caso, entrada) => {
      expect(readAvatarUrl(entrada)).toBe(entrada);
    });

    it.each([
      ['http sin cifrar', 'http://inseguro.test/foto'],
      ['un javascript:', 'javascript:alert(1)'],
      ['un data:', 'data:image/png;base64,AAAA'],
      ['texto que no es URL', 'no-soy-una-url'],
      ['ausente', undefined],
      ['nulo', null],
      ['un numero', 42],
    ])('descarta %s', (_caso, entrada) => {
      expect(readAvatarUrl(entrada)).toBeUndefined();
    });
  });

  describe('exchangeCode', () => {
    it('envia el code_verifier y el client_secret al endpoint de token', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id_token: 'un.id.token' }), { status: 200 }),
      );

      // Falla despues, al verificar la firma: aqui solo interesa lo que se envio.
      await expect(
        client.exchangeCode({
          code: 'codigo',
          codeVerifier: 'verifier',
          expectedNonce: 'nonce',
        }),
      ).rejects.toBeInstanceOf(AuthError);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://oauth2.googleapis.com/token');
      const body = Object.fromEntries(new URLSearchParams(init.body as string));
      expect(body).toMatchObject({
        code: 'codigo',
        code_verifier: 'verifier',
        grant_type: 'authorization_code',
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: config.googleRedirectUri,
      });
    });

    it('traduce un rechazo de Google a un error de dominio, sin filtrar el cuerpo', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({ error: 'invalid_grant', client_secret: 'no-deberia-salir' }),
          { status: 400 },
        ),
      );

      const error = await client
        .exchangeCode({ code: 'c', codeVerifier: 'v', expectedNonce: 'n' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('invalid_request');
      expect((error as AuthError).detail).not.toContain('no-deberia-salir');
    });

    it('traduce un fallo de red a server_error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        client.exchangeCode({ code: 'c', codeVerifier: 'v', expectedNonce: 'n' }),
      ).rejects.toMatchObject({ code: 'server_error' });
    });

    it('falla si Google responde sin id_token', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'solo-esto' }), { status: 200 }),
      );

      await expect(
        client.exchangeCode({ code: 'c', codeVerifier: 'v', expectedNonce: 'n' }),
      ).rejects.toMatchObject({ code: 'server_error' });
    });
  });
});
