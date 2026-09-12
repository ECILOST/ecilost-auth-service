import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { SignJWT, importPKCS8 } from 'jose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { GoogleOidcClient } from '../src/auth/google/google-oidc.client.js';
import { AuthConfig } from '../src/config/auth.config.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { VerifiedGoogleIdentity } from '../src/users/users.service.js';

const STUDENT: VerifiedGoogleIdentity = {
  sub: 'google-sub-estudiante',
  email: 'estudiante@escuelaing.edu.co',
  fullName: 'Estudiante Uno',
  emailVerified: true,
};

describe('Autenticacion con Google OAuth 2.0 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: AuthConfig;
  let google: GoogleOidcClient;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    config = app.get(AuthConfig);

    // Mismo cableado que main.ts: sin esto las cookies firmadas no se leen.
    app.use(cookieParser(config.cookieSecret));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );

    await app.init();

    prisma = app.get(PrismaService);
    // Se sustituye solo el salto de red a Google; el resto del flujo es el real,
    // incluidos PKCE, la cookie firmada y la comprobacion de state.
    google = app.get(GoogleOidcClient);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const server = () => app.getHttpServer();

  /** Recorre los dos saltos del flujo y devuelve el agente con la cookie de sesion. */
  async function login(identity: VerifiedGoogleIdentity = STUDENT) {
    const agent = request.agent(server());
    const started = await agent.get('/auth/google').expect(302);
    const state = new URL(started.headers.location).searchParams.get('state');

    const exchange = vi
      .spyOn(google, 'exchangeCode')
      .mockResolvedValue(identity);

    const callback = await agent
      .get('/auth/google/callback')
      .query({ code: 'codigo-de-google', state });

    return { agent, callback, state, exchange };
  }

  describe('Criterio 1: autenticacion exitosa', () => {
    it('inicia el flujo con PKCE S256, state y nonce', async () => {
      const response = await request(server()).get('/auth/google').expect(302);
      const url = new URL(response.headers.location);

      expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
      expect(url.searchParams.get('state')).toBeTruthy();
      expect(url.searchParams.get('nonce')).toBeTruthy();
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')).toBe('openid email profile');
      // Sin filtro de dominio no se manda la pista `hd`.
      expect(url.searchParams.has('hd')).toBe(false);

      const cookies = response.headers['set-cookie'] as unknown as string[];
      const transaction = cookies.find((c) => c.startsWith('oauth_tx='));
      expect(transaction).toBeDefined();
      expect(transaction).toContain('HttpOnly');
      // El verifier de PKCE no puede quedar al alcance de JavaScript en el navegador.
      expect(transaction).not.toContain(url.searchParams.get('code_challenge'));
    });

    it('crea la sesion y redirige al listado de salas', async () => {
      const { callback } = await login();

      expect(callback.status).toBe(302);
      expect(callback.headers.location).toBe(config.postLoginRedirectUrl);

      const cookies = callback.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((c) => c.startsWith('ecilost_rt='))).toBe(true);

      // La transaccion es de un solo uso: se vence en el mismo callback.
      const cleared = cookies.find((c) => c.startsWith('oauth_tx='));
      expect(cleared).toContain('Expires=Thu, 01 Jan 1970');
    });

    it('acepta el callback real de Google, con iss y los demas parametros', async () => {
      // Regresion: Google envia `iss` (RFC 9207) y tambien authuser, prompt, scope y hd.
      // Con forbidNonWhitelisted activo, un parametro no declarado tumba el login con un
      // 400 antes de llegar al controlador. Esta prueba recorre el ValidationPipe real.
      const agent = request.agent(server());
      const started = await agent.get('/auth/google').expect(302);
      const state = new URL(started.headers.location).searchParams.get('state');
      vi.spyOn(google, 'exchangeCode').mockResolvedValue(STUDENT);

      const callback = await agent.get('/auth/google/callback').query({
        code: 'codigo-de-google',
        state,
        iss: 'https://accounts.google.com',
        scope: 'email profile openid',
        authuser: '0',
        prompt: 'consent',
      });

      expect(callback.status).toBe(302);
      expect(callback.headers.location).toBe(config.postLoginRedirectUrl);
    });

    it('rechaza un callback cuyo iss no es el de Google', async () => {
      const agent = request.agent(server());
      const started = await agent.get('/auth/google').expect(302);
      const state = new URL(started.headers.location).searchParams.get('state');
      const exchange = vi.spyOn(google, 'exchangeCode').mockResolvedValue(STUDENT);

      const callback = await agent
        .get('/auth/google/callback')
        .query({ code: 'c', state, iss: 'https://emisor-impostor.test' })
        .expect(302);

      expect(new URL(callback.headers.location).searchParams.get('error')).toBe(
        'invalid_request',
      );
      expect(exchange).not.toHaveBeenCalled();
      expect(await prisma.user.count()).toBe(0);
    });

    it('pasa a Google el nonce de la transaccion en curso', async () => {
      const agent = request.agent(server());
      const started = await agent.get('/auth/google').expect(302);
      const url = new URL(started.headers.location);

      const exchange = vi.spyOn(google, 'exchangeCode').mockResolvedValue(STUDENT);
      await agent
        .get('/auth/google/callback')
        .query({ code: 'c', state: url.searchParams.get('state') });

      expect(exchange).toHaveBeenCalledWith(
        expect.objectContaining({ expectedNonce: url.searchParams.get('nonce') }),
      );
    });

    it('canjea la cookie por un access token y accede al recurso protegido', async () => {
      const { agent } = await login();

      const token = await agent.post('/auth/token').expect(200);
      expect(token.body.token_type).toBe('Bearer');
      expect(token.body.expires_in).toBe(900);
      expect(token.body.role).toBe('STUDENT');

      const me = await request(server())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token.body.access_token}`)
        .expect(200);

      expect(me.body.role).toBe('STUDENT');
      expect(me.body.canScheduleRooms).toBe(false);
      expect(me.body.userId).toBeTruthy();
    });

    it('da rol STAFF a un correo de la lista de funcionarios', async () => {
      const { agent } = await login({
        ...STUDENT,
        sub: 'google-sub-funcionario',
        email: 'funcionario@escuelaing.edu.co',
      });

      const token = await agent.post('/auth/token').expect(200);
      expect(token.body.role).toBe('STAFF');

      const me = await request(server())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token.body.access_token}`)
        .expect(200);
      expect(me.body.canScheduleRooms).toBe(true);
    });

    it('admite una cuenta de Google de cualquier dominio', async () => {
      const { agent, callback } = await login({
        ...STUDENT,
        sub: 'google-sub-externo',
        email: 'persona@gmail.com',
      });

      expect(callback.headers.location).toBe(config.postLoginRedirectUrl);

      const token = await agent.post('/auth/token').expect(200);
      expect(token.body.role).toBe('STUDENT');
      expect(await prisma.user.count()).toBe(1);
    });

    it('persiste un solo usuario aunque inicie sesion dos veces', async () => {
      await login();
      await login();

      expect(await prisma.user.count()).toBe(1);
    });

    it('no duplica el usuario cuando dos callbacks concurrentes son del mismo estudiante', async () => {
      vi.spyOn(google, 'exchangeCode').mockResolvedValue(STUDENT);

      const flows = await Promise.all(
        [0, 1, 2].map(async () => {
          const agent = request.agent(server());
          const started = await agent.get('/auth/google');
          const state = new URL(started.headers.location).searchParams.get('state');
          return agent.get('/auth/google/callback').query({ code: 'c', state });
        }),
      );

      expect(flows.every((r) => r.status === 302)).toBe(true);
      expect(await prisma.user.count()).toBe(1);
    });
  });

  describe('Criterio 2: credenciales invalidas', () => {
    it('rechaza un state que no coincide y no crea sesion', async () => {
      const agent = request.agent(server());
      await agent.get('/auth/google').expect(302);
      const exchange = vi.spyOn(google, 'exchangeCode');

      const response = await agent
        .get('/auth/google/callback')
        .query({ code: 'c', state: 'state-de-atacante' })
        .expect(302);

      expect(new URL(response.headers.location).searchParams.get('error')).toBe(
        'invalid_request',
      );
      expect(exchange).not.toHaveBeenCalled();
      expect(await prisma.user.count()).toBe(0);
      expect(sessionCookieFrom(response)).toBeUndefined();
    });

    it('rechaza un callback sin transaccion previa', async () => {
      const response = await request(server())
        .get('/auth/google/callback')
        .query({ code: 'c', state: 'cualquiera' })
        .expect(302);

      expect(new URL(response.headers.location).searchParams.get('error')).toBe(
        'invalid_request',
      );
      expect(sessionCookieFrom(response)).toBeUndefined();
    });

    it('informa el motivo cuando el correo de Google no esta verificado', async () => {
      const { callback } = await login({ ...STUDENT, emailVerified: false });

      const target = new URL(callback.headers.location);
      expect(target.origin + target.pathname).toBe(config.postLoginErrorUrl);
      expect(target.searchParams.get('error')).toBe('email_not_verified');
      expect(target.searchParams.get('error_description')).toContain('verificado');
      expect(await prisma.user.count()).toBe(0);
      expect(sessionCookieFrom(callback)).toBeUndefined();
    });

    it('rechaza a un estudiante suspendido y no le crea sesion', async () => {
      await login();
      await prisma.user.updateMany({ data: { status: 'SUSPENDED' } });

      const { callback } = await login();

      expect(new URL(callback.headers.location).searchParams.get('error')).toBe(
        'account_suspended',
      );
      expect(sessionCookieFrom(callback)).toBeUndefined();
    });

    it('informa cuando el usuario niega el consentimiento en Google', async () => {
      const agent = request.agent(server());
      await agent.get('/auth/google').expect(302);

      const response = await agent
        .get('/auth/google/callback')
        .query({ error: 'access_denied' })
        .expect(302);

      expect(new URL(response.headers.location).searchParams.get('error')).toBe(
        'access_denied',
      );
    });

    it('nunca filtra el detalle tecnico en la redireccion de error', async () => {
      const { callback } = await login({
        ...STUDENT,
        email: 'ajeno@gmail.com',
        emailVerified: false,
      });

      // El log del servidor lleva el sub; la URL que ve el usuario, solo la categoria.
      expect(callback.headers.location).not.toContain('ajeno@gmail.com');
      expect(callback.headers.location).not.toContain(STUDENT.sub);
    });
  });

  describe('Criterio 3: usuario sin sesion', () => {
    it('responde 401 sin cabecera Authorization', async () => {
      const response = await request(server()).get('/auth/me').expect(401);

      expect(response.headers['www-authenticate']).toContain('Bearer');
    });

    it('responde 401 con un token que no es un JWT', async () => {
      await request(server())
        .get('/auth/me')
        .set('Authorization', 'Bearer no-es-un-token')
        .expect(401);
    });

    it('responde 401 con un token expirado', async () => {
      const key = await importPKCS8(config.jwtPrivateKeyPem, 'RS256');
      const expired = await new SignJWT({ role: 'STUDENT' })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject('33333333-3333-4333-8333-333333333333')
        .setIssuer(config.jwtIssuer)
        .setAudience(config.jwtAudience)
        .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
        .sign(key);

      await request(server())
        .get('/auth/me')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);
    });

    it('responde 401 con un token firmado por otra llave', async () => {
      const { generateKeyPairSync } = await import('node:crypto');
      const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const foreignKey = await importPKCS8(
        privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        'RS256',
      );
      const forged = await new SignJWT({ role: 'STAFF' })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject('44444444-4444-4444-8444-444444444444')
        .setIssuer(config.jwtIssuer)
        .setAudience(config.jwtAudience)
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(foreignKey);

      await request(server())
        .get('/auth/me')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });

    it('responde 401 al pedir un access token sin cookie de sesion', async () => {
      const response = await request(server()).post('/auth/token').expect(401);

      expect(response.body.error).toBe('invalid_request');
      expect(response.headers['www-authenticate']).toContain('Bearer');
    });
  });

  describe('Rotacion, logout y llave publica', () => {
    it('rota el refresh token en cada canje', async () => {
      const { agent } = await login();

      const first = await agent.post('/auth/token').expect(200);
      const second = await agent.post('/auth/token').expect(200);

      expect(second.body.access_token).toBeTruthy();
      expect(await prisma.refreshToken.count()).toBe(3);
      expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(1);
      expect(first.body.access_token).not.toBe(second.body.access_token);
    });

    it('reusar un refresh token ya rotado revoca la familia completa', async () => {
      const { agent } = await login();
      const stolen = await readRefreshCookie(agent);

      await agent.post('/auth/token').expect(200);

      // El atacante presenta el token viejo.
      await request(server())
        .post('/auth/token')
        .set('Cookie', stolen)
        .expect(401);

      // Y la sesion legitima tambien queda cerrada.
      await agent.post('/auth/token').expect(401);
      expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
    });

    it('logout cierra la sesion y deja la cookie inservible', async () => {
      const { agent } = await login();

      await agent.post('/auth/logout').expect(204);
      await agent.post('/auth/token').expect(401);
      expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
    });

    it('logout es idempotente sin sesion previa', async () => {
      await request(server()).post('/auth/logout').expect(204);
    });

    it('publica el JWKS sin exponer la llave privada', async () => {
      const response = await request(server()).get('/.well-known/jwks.json').expect(200);

      expect(response.body.keys).toHaveLength(1);
      expect(response.body.keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' });
      expect(response.body.keys[0]).not.toHaveProperty('d');
      expect(response.body.keys[0]).not.toHaveProperty('p');
      expect(response.body.keys[0]).not.toHaveProperty('q');
    });
  });
});

function sessionCookieFrom(response: request.Response): string | undefined {
  const cookies = (response.headers['set-cookie'] as unknown as string[]) ?? [];
  return cookies.find(
    (c) => c.startsWith('ecilost_rt=') && !c.includes('Expires=Thu, 01 Jan 1970'),
  );
}

/**
 * Lee la cookie de sesion vigente del agente para poder reusarla mas tarde.
 * Si devolviera una cadena vacia, la prueba de reuso pasaria por el motivo equivocado
 * (un 401 por falta de cookie), asi que se verifica aqui.
 */
async function readRefreshCookie(agent: request.Agent): Promise<string> {
  const probe = await agent.get('/auth/me');
  const jar = (probe.request as unknown as { cookies?: string }).cookies ?? '';
  expect(jar).toContain('ecilost_rt=');
  return jar;
}
