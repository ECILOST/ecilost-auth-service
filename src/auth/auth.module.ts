import { Module } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { GoogleOidcClient } from './google/google-oidc.client.js';
import { JwksController } from './jwks.controller.js';
import { PrismaRefreshTokenRepository } from './tokens/prisma-refresh-token.repository.js';
import { REFRESH_TOKEN_REPOSITORY } from './tokens/refresh-token.repository.js';
import { TokenService } from './tokens/token.service.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController, JwksController],
  providers: [
    AuthService,
    GoogleOidcClient,
    TokenService,
    JwtAuthGuard,
    RolesGuard,
    { provide: REFRESH_TOKEN_REPOSITORY, useClass: PrismaRefreshTokenRepository },
  ],
  // Lo que consumiran los demas modulos cuando protejan sus propios recursos.
  exports: [TokenService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
