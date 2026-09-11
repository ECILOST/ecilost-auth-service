import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { AuthConfig } from '../config/auth.config.js';
import { AuthService, type OAuthTransaction } from './auth.service.js';
import { AUTH_ERROR_MESSAGES, AuthError, type AuthErrorCode } from './domain/auth-error.js';
import type { Principal } from './domain/principal.js';
import { GoogleCallbackDto } from './dto/google-callback.dto.js';

const TRANSACTION_COOKIE = 'oauth_tx';
const REFRESH_COOKIE = 'ecilost_rt';
const TRANSACTION_TTL_MS = 10 * 60 * 1000;

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly config: AuthConfig,
  ) {}

  /** Criterio 1, paso 1: lleva al estudiante a Google. */
  @Get('google')
  start(@Res() response: Response): void {
    const { authorizationUrl, transaction } = this.auth.startLogin();

    response.cookie(TRANSACTION_COOKIE, JSON.stringify(transaction), {
      ...this.cookieOptions(),
      maxAge: TRANSACTION_TTL_MS,
    });
    response.redirect(authorizationUrl);
  }

  /**
   * Criterio 1, paso 2 y Criterio 2.
   * Siempre responde con una redireccion: quien llega aqui es un navegador, no una API.
   */
  @Get('google/callback')
  async callback(
    @Query() query: GoogleCallbackDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    // La transaccion es de un solo uso, se consuma bien o mal.
    const transaction = this.readTransaction(request);
    response.clearCookie(TRANSACTION_COOKIE, this.cookieOptions());

    if (query.error) {
      // El usuario nego el consentimiento en la pantalla de Google.
      return this.redirectWithError(response, 'access_denied', query.error);
    }

    try {
      const { refreshToken } = await this.auth.completeLogin({
        code: query.code,
        state: query.state,
        transaction,
      });

      response.cookie(REFRESH_COOKIE, refreshToken, {
        ...this.cookieOptions(),
        maxAge: this.config.refreshTokenTtlSeconds * 1000,
      });
      response.redirect(this.config.postLoginRedirectUrl);
    } catch (error) {
      const code = error instanceof AuthError ? error.code : 'server_error';
      const detail = error instanceof AuthError ? error.detail : String(error);
      this.redirectWithError(response, code, detail);
    }
  }

  /** Criterio 1, paso 3: la cookie de sesion se canjea por un access token de vida corta. */
  @Post('token')
  async token(@Req() request: Request, @Res() response: Response): Promise<void> {
    try {
      const session = await this.auth.refreshSession(this.readRefreshToken(request));

      response.cookie(REFRESH_COOKIE, session.refreshToken, {
        ...this.cookieOptions(),
        maxAge: this.config.refreshTokenTtlSeconds * 1000,
      });
      response.status(HttpStatus.OK).json({
        access_token: session.accessToken,
        token_type: 'Bearer',
        expires_in: session.expiresIn,
        role: session.role,
      });
    } catch (error) {
      const code = error instanceof AuthError ? error.code : 'server_error';
      const detail = error instanceof AuthError ? error.detail : String(error);
      this.logger.warn(`Refresco rechazado (${code}): ${detail}`);

      response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      response.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      response
        .status(HttpStatus.UNAUTHORIZED)
        .json({ error: code, message: AUTH_ERROR_MESSAGES[code] });
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.auth.logout(this.readRefreshToken(request));
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    response.status(HttpStatus.NO_CONTENT).send();
  }

  /**
   * Criterio 3: recurso protegido de referencia. Sin token valido responde 401.
   * Los demas servicios protegeran los suyos con este mismo guard.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() principal: Principal): {
    userId: string;
    role: string;
    canManageCatalog: boolean;
    canScheduleRooms: boolean;
  } {
    return {
      userId: principal.userId,
      role: principal.role,
      canManageCatalog: principal.canManageCatalog(),
      canScheduleRooms: principal.canScheduleRooms(),
    };
  }

  // --- Cookies ------------------------------------------------------------

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      signed: true,
      path: '/auth',
    };
  }

  private readTransaction(request: Request): OAuthTransaction | undefined {
    const raw = request.signedCookies?.[TRANSACTION_COOKIE];
    if (typeof raw !== 'string') return undefined;
    try {
      return JSON.parse(raw) as OAuthTransaction;
    } catch {
      return undefined;
    }
  }

  private readRefreshToken(request: Request): string | undefined {
    const raw = request.signedCookies?.[REFRESH_COOKIE];
    return typeof raw === 'string' ? raw : undefined;
  }

  /** Criterio 2: se comunica el motivo, sin filtrar el detalle tecnico. */
  private redirectWithError(
    response: Response,
    code: AuthErrorCode,
    detail?: string,
  ): void {
    this.logger.warn(`Inicio de sesion rechazado (${code}): ${detail ?? 'sin detalle'}`);

    const target = new URL(this.config.postLoginErrorUrl);
    target.searchParams.set('error', code);
    target.searchParams.set('error_description', AUTH_ERROR_MESSAGES[code]);
    response.redirect(target.toString());
  }
}
