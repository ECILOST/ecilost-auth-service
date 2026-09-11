import { Controller, Get, INestApplication, UseGuards, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuthModule } from '../src/auth/auth.module.js';
import { TokenService } from '../src/auth/tokens/token.service.js';
import { Roles } from '../src/common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/common/guards/roles.guard.js';
import { AuthConfig } from '../src/config/auth.config.js';

const STAFF_ID = '11111111-1111-4111-8111-111111111111';
const STUDENT_ID = '22222222-2222-4222-8222-222222222222';

/**
 * Controlador que existe SOLO en esta suite.
 *
 * Los endpoints que el criterio 2 y el 3 describen, programar una sala y pujar, viven en
 * ecilost-auction-core, que todavia no existe. Aqui se ejercita el mecanismo de
 * autorizacion con la misma forma que tendran alli, sin publicar en produccion un endpoint
 * que este servicio no deberia tener.
 */
@Controller('pruebas-de-rol')
class TestRolesController {
  /** Como sera el endpoint de programacion de salas. */
  @Get('solo-funcionario')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('STAFF')
  soloFuncionario() {
    return { ok: true };
  }

  /** Como sera el endpoint de puja. */
  @Get('solo-estudiante')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('STUDENT')
  soloEstudiante() {
    return { ok: true };
  }

  /** Autenticado, sin restriccion de rol. */
  @Get('cualquier-sesion')
  @UseGuards(JwtAuthGuard, RolesGuard)
  cualquierSesion() {
    return { ok: true };
  }

  /** Mal cableado a proposito: RolesGuard sin JwtAuthGuard delante. */
  @Get('sin-guard-de-sesion')
  @UseGuards(RolesGuard)
  @Roles('STAFF')
  sinGuardDeSesion() {
    return { ok: true };
  }
}

describe('Autorizacion por rol (e2e)', () => {
  let app: INestApplication;
  let staffToken: string;
  let studentToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      // AppModule importa AuthModule pero no lo reexporta, asi que sus guards no llegarian
      // al controlador de prueba. Importarlo tambien aqui los hace inyectables.
      imports: [AppModule, AuthModule],
      controllers: [TestRolesController],
    }).compile();

    app = moduleFixture.createNestApplication();
    const config = app.get(AuthConfig);
    app.use(cookieParser(config.cookieSecret));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    // Se firman tokens directamente: el flujo de Google ya esta cubierto en auth.e2e-spec.
    const tokens = app.get(TokenService);
    staffToken = (await tokens.signAccessToken(STAFF_ID, 'STAFF')).accessToken;
    studentToken = (await tokens.signAccessToken(STUDENT_ID, 'STUDENT')).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  describe('Criterio 1: el funcionario ve las opciones de gestion', () => {
    it('al funcionario le habilita registrar objetos, crear lotes y programar salas', async () => {
      const response = await request(server())
        .get('/auth/me')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        userId: STAFF_ID,
        role: 'STAFF',
        canManageCatalog: true,
        canScheduleRooms: true,
        canBid: false,
      });
    });

    it('al estudiante no le habilita ninguna de las tres', async () => {
      const response = await request(server())
        .get('/auth/me')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        role: 'STUDENT',
        canManageCatalog: false,
        canScheduleRooms: false,
        canBid: true,
      });
    });
  });

  describe('Criterio 2: el estudiante no programa salas', () => {
    it('responde 403 a un estudiante en un endpoint de funcionario', async () => {
      const response = await request(server())
        .get('/pruebas-de-rol/solo-funcionario')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(403);

      expect(response.body.message).toContain('rol');
    });

    it('deja pasar al funcionario', async () => {
      await request(server())
        .get('/pruebas-de-rol/solo-funcionario')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200, { ok: true });
    });

    it('responde 401, no 403, cuando no hay sesion', async () => {
      const response = await request(server())
        .get('/pruebas-de-rol/solo-funcionario')
        .expect(401);

      expect(response.headers['www-authenticate']).toContain('Bearer');
    });

    it('responde 401 con un token invalido, sin llegar a mirar el rol', async () => {
      await request(server())
        .get('/pruebas-de-rol/solo-funcionario')
        .set('Authorization', 'Bearer no-es-un-token')
        .expect(401);
    });
  });

  describe('Criterio 3: el funcionario no puja', () => {
    it('responde 403 a un funcionario en un endpoint de puja', async () => {
      await request(server())
        .get('/pruebas-de-rol/solo-estudiante')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);
    });

    it('deja pujar al estudiante', async () => {
      await request(server())
        .get('/pruebas-de-rol/solo-estudiante')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200, { ok: true });
    });
  });

  describe('Contrato del guard', () => {
    it('un endpoint sin @Roles admite cualquier rol con sesion', async () => {
      for (const token of [staffToken, studentToken]) {
        await request(server())
          .get('/pruebas-de-rol/cualquier-sesion')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      }
    });

    it('un endpoint sin @Roles sigue exigiendo sesion', async () => {
      await request(server()).get('/pruebas-de-rol/cualquier-sesion').expect(401);
    });

    it('RolesGuard sin JwtAuthGuard delante responde 401, no 403', async () => {
      // Es un error de cableado, no de permisos. Un 403 lo escondería.
      await request(server())
        .get('/pruebas-de-rol/sin-guard-de-sesion')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(401);
    });
  });
});
