import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { GoogleOidcClient } from '../src/auth/google/google-oidc.client.js';
import { AuthConfig } from '../src/config/auth.config.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { VerifiedGoogleIdentity } from '../src/users/users.service.js';

const ESTUDIANTE: VerifiedGoogleIdentity = {
  sub: 'google-sub-perfil',
  email: 'estudiante@gmail.com',
  fullName: 'Estudiante Uno',
  emailVerified: true,
  avatarUrl: 'https://lh3.googleusercontent.com/a/foto-uno',
};

const OTRO: VerifiedGoogleIdentity = {
  sub: 'google-sub-otro',
  email: 'otro@gmail.com',
  fullName: 'Estudiante Dos',
  emailVerified: true,
};

describe('Perfil de usuario (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let google: GoogleOidcClient;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const config = app.get(AuthConfig);
    app.use(cookieParser(config.cookieSecret));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
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

  const server = () => app.getHttpServer();

  /** Recorre el flujo real de login y devuelve el access token de esa persona. */
  async function iniciarSesion(identidad: VerifiedGoogleIdentity): Promise<string> {
    const agent = request.agent(server());
    const started = await agent.get('/auth/google').expect(302);
    const state = new URL(started.headers.location).searchParams.get('state');
    vi.spyOn(google, 'exchangeCode').mockResolvedValue(identidad);

    await agent.get('/auth/google/callback').query({ code: 'c', state }).expect(302);
    const token = await agent.post('/auth/token').expect(200);
    return token.body.access_token;
  }

  const conToken = (token: string, metodo: 'get' | 'patch' = 'get') =>
    request(server())[metodo]('/auth/profile').set('Authorization', `Bearer ${token}`);

  describe('GET /auth/profile', () => {
    it('responde 401 sin token', async () => {
      const response = await request(server()).get('/auth/profile').expect(401);

      expect(response.headers['www-authenticate']).toContain('Bearer');
    });

    it('devuelve el perfil con el avatar que mando Google', async () => {
      const token = await iniciarSesion(ESTUDIANTE);

      const response = await conToken(token).expect(200);

      expect(response.body).toMatchObject({
        email: 'estudiante@gmail.com',
        fullName: 'Estudiante Uno',
        avatarUrl: 'https://lh3.googleusercontent.com/a/foto-uno',
        institutionalCode: null,
        role: 'STUDENT',
      });
      expect(response.body.userId).toBeTruthy();
    });

    it('deja el avatar vacio cuando Google no lo manda', async () => {
      const token = await iniciarSesion(OTRO);

      const response = await conToken(token).expect(200);

      expect(response.body.avatarUrl).toBeNull();
    });

    it('no expone columnas internas', async () => {
      const token = await iniciarSesion(ESTUDIANTE);

      const response = await conToken(token).expect(200);

      // googleSub identifica la cuenta ante Google: no tiene por que salir de aqui.
      expect(response.body).not.toHaveProperty('googleSub');
      expect(response.body).not.toHaveProperty('status');
    });
  });

  describe('PATCH /auth/profile', () => {
    it('fija el codigo institucional y se ve en la consulta siguiente', async () => {
      const token = await iniciarSesion(ESTUDIANTE);

      const guardado = await conToken(token, 'patch')
        .send({ institutionalCode: 'A00123456' })
        .expect(200);
      expect(guardado.body.institutionalCode).toBe('A00123456');

      const leido = await conToken(token).expect(200);
      expect(leido.body.institutionalCode).toBe('A00123456');
    });

    it('recorta los espacios alrededor', async () => {
      const token = await iniciarSesion(ESTUDIANTE);

      const response = await conToken(token, 'patch')
        .send({ institutionalCode: '  A00123456  ' })
        .expect(200);

      expect(response.body.institutionalCode).toBe('A00123456');
    });

    it('con null borra el codigo', async () => {
      const token = await iniciarSesion(ESTUDIANTE);
      await conToken(token, 'patch').send({ institutionalCode: 'A00123456' }).expect(200);

      const response = await conToken(token, 'patch')
        .send({ institutionalCode: null })
        .expect(200);

      expect(response.body.institutionalCode).toBeNull();
    });

    it('sin el campo no cambia nada', async () => {
      const token = await iniciarSesion(ESTUDIANTE);
      await conToken(token, 'patch').send({ institutionalCode: 'A00123456' }).expect(200);

      const response = await conToken(token, 'patch').send({}).expect(200);

      expect(response.body.institutionalCode).toBe('A00123456');
    });

    it.each([
      ['muy corto', 'A12'],
      ['muy largo', 'A'.repeat(21)],
      ['con caracteres raros', 'A001/234'],
    ])('responde 400 con un codigo %s', async (_caso, valor) => {
      const token = await iniciarSesion(ESTUDIANTE);

      await conToken(token, 'patch').send({ institutionalCode: valor }).expect(400);
    });

    it('rechaza un campo que no existe en el contrato', async () => {
      const token = await iniciarSesion(ESTUDIANTE);

      await conToken(token, 'patch').send({ role: 'STAFF' }).expect(400);
    });

    it('responde 409 si otra persona ya registro ese codigo', async () => {
      const tokenUno = await iniciarSesion(ESTUDIANTE);
      await conToken(tokenUno, 'patch')
        .send({ institutionalCode: 'A00123456' })
        .expect(200);

      const tokenDos = await iniciarSesion(OTRO);
      await conToken(tokenDos, 'patch')
        .send({ institutionalCode: 'A00123456' })
        .expect(409);

      const fila = await prisma.user.findFirst({ where: { email: OTRO.email } });
      expect(fila?.institutionalCode).toBeNull();
    });

    it('deja que dos personas lo tengan vacio a la vez', async () => {
      await iniciarSesion(ESTUDIANTE);
      const tokenDos = await iniciarSesion(OTRO);

      // Un UNIQUE de PostgreSQL admite varios NULL: por eso el campo puede ser opcional.
      await conToken(tokenDos).expect(200);
      expect(await prisma.user.count({ where: { institutionalCode: null } })).toBe(2);
    });

    it('responde 401 sin token', async () => {
      await request(server())
        .patch('/auth/profile')
        .send({ institutionalCode: 'A00123456' })
        .expect(401);
    });
  });
});
