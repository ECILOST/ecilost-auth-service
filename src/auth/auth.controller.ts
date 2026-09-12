import {
  Body,
  ConflictException,
  Controller,
  Get,
  Patch,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiFoundResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { AuthConfig } from '../config/auth.config.js';
import { AuthService, type OAuthTransaction } from './auth.service.js';
import { AUTH_ERROR_MESSAGES, AuthError, type AuthErrorCode } from './domain/auth-error.js';
import type { Principal } from './domain/principal.js';
import { AccessTokenResponseDto } from './dto/access-token-response.dto.js';
import { ErrorResponseDto } from './dto/error-response.dto.js';
import { GoogleCallbackDto } from './dto/google-callback.dto.js';
import { PrincipalResponseDto } from './dto/principal-response.dto.js';
import { ProfileResponseDto } from './dto/profile-response.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { InstitutionalCodeTakenError } from '../users/ports/user.repository.js';
import { UsersService } from '../users/users.service.js';
import type { User } from '../users/entities/user.entity.js';

const TRANSACTION_COOKIE = 'oauth_tx';
const REFRESH_COOKIE = 'ecilost_rt';
const TRANSACTION_TTL_MS = 10 * 60 * 1000;

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: AuthConfig,
  ) {}

  /** Criterio 1, paso 1: lleva al estudiante a Google. */
  @Get('google')
  @ApiOperation({
    summary: 'Start the Google login flow',
    description: [
      'Entry point of the authentication flow. Open it in a browser: it is a redirect, not',
      'a JSON endpoint, so it cannot be called with fetch or XHR.',
      '',
      'The service generates a PKCE code verifier, a `state` and a `nonce`, stores the three',
      'in a signed `httpOnly` cookie valid for 10 minutes, and redirects to Google carrying',
      'only the S256 challenge. The verifier itself never reaches the browser scripts nor',
      'Google, which is what makes an intercepted authorization code useless on its own.',
    ].join('\n'),
  })
  @ApiFoundResponse({
    description:
      "Redirect to Google's authorization endpoint. Sets the single-use `oauth_tx` cookie.",
    headers: {
      Location: {
        description: "Google's authorization URL, including `code_challenge_method=S256`.",
        schema: { type: 'string' },
      },
    },
  })
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
  @ApiOperation({
    summary: 'Finish the Google login flow',
    description: [
      'Google redirects the browser here. Never call it directly.',
      '',
      'The service checks `state` against the cookie in constant time, exchanges the code',
      'together with the PKCE verifier, and verifies the returned `id_token` against',
      "Google's JWKS: signature, issuer, audience, expiry, nonce and `email_verified`.",
      'It then finds or creates the ECILOST user and issues the session.',
      '',
      'The platform accepts **any Google account** with a verified email address. A first',
      'login provisions the user as `STUDENT`, unless the address is on the staff list.',
      '',
      'The response is always a redirect, because the caller is a browser. Success and',
      'failure share the same HTTP status and differ only in the `Location` target, so',
      'branch on the target URL and its `error` query parameter, never on the status code.',
      '',
      'The access token is deliberately **not** part of this redirect: a token in a URL',
      'ends up in the browser history, in proxy logs and in the `Referer` header. Call',
      '`POST /auth/token` afterwards to obtain it.',
    ].join('\n'),
  })
  @ApiFoundResponse({
    description: [
      'Two different outcomes share this status code.',
      '',
      '**Success**: redirect to the post-login URL, with the `ecilost_rt` session cookie set.',
      '',
      '**Rejection**: redirect to the error URL with `?error=<code>&error_description=<text>`.',
      'No session cookie is set and no user row is created. The `error` codes are the ones',
      'listed on the ErrorResponse schema.',
    ].join('\n'),
    headers: {
      Location: {
        description: 'Post-login URL on success, or the error URL carrying `?error=`.',
        schema: { type: 'string' },
      },
      'Set-Cookie': {
        description:
          'On success, `ecilost_rt` as `httpOnly`, signed, `SameSite=Lax`, `Path=/auth`. ' +
          'In both cases the `oauth_tx` cookie is cleared: the transaction is single-use.',
        schema: { type: 'string' },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'The query string carries a parameter that is not part of the OAuth callback. ' +
      'Unknown parameters are rejected rather than ignored, so a crafted link cannot ' +
      'smuggle extra input into the flow.',
  })
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
        issuer: query.iss,
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
  @ApiCookieAuth('session-cookie')
  @ApiOperation({
    summary: 'Exchange the session cookie for an access token',
    description: [
      'Call this right after the login redirect lands, and again whenever the access token',
      'is about to expire. The browser sends the `ecilost_rt` cookie automatically; a',
      'cross-origin caller must opt in with `credentials: "include"`.',
      '',
      'Every call **rotates** the refresh token: the presented one is revoked and a new one',
      'replaces it in the cookie. Presenting a token that was already rotated is treated as',
      'a stolen token and revokes the whole chain, which ends the attacker session and the',
      'legitimate one at once. That is intentional: a forced re-login beats a silent',
      'takeover.',
      '',
      'The access token is returned in the body and should be kept in memory only.',
    ].join('\n'),
  })
  @ApiOkResponse({
    description: 'A new access token, and a rotated session cookie.',
    type: AccessTokenResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: [
      'No session cookie, or a refresh token that is unknown, expired, already rotated or',
      'revoked. Also returned when the account was suspended after signing in: the user is',
      're-checked on every exchange, so suspending an account takes effect within minutes',
      'instead of waiting out the refresh token lifetime.',
      '',
      'The session cookie is cleared and the response carries `WWW-Authenticate`. Send the',
      'user back to `GET /auth/google`.',
    ].join('\n'),
    type: ErrorResponseDto,
  })
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
  @ApiCookieAuth('session-cookie')
  @ApiOperation({
    summary: 'Close the session',
    description: [
      'Revokes the entire rotation chain, not just the token presented, and clears the',
      'session cookie. Access tokens already handed out stay valid until they expire,',
      'which is why their lifetime is short: the other services verify them locally and',
      'never call back here.',
      '',
      'Idempotent by design. Calling it without a session is a normal outcome, not an',
      'error, so a client can always call it on the way out.',
    ].join('\n'),
  })
  @ApiNoContentResponse({
    description: 'Session closed, or there was none to close. The cookie is cleared.',
  })
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
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Read the authenticated principal',
    description: [
      'Returns the identity behind the access token, plus the permission flags a client',
      'needs to decide which menu entries to show.',
      '',
      'This is also the reference protected resource of the platform. It is guarded by the',
      'same `JwtAuthGuard` that catalog-service and auction-core will apply to their own',
      'endpoints, so its behaviour is the contract they follow: the signature is verified',
      'locally against the published JWKS, without a network call back to this service.',
      '',
      'The flags are a convenience for the UI. Authorisation decisions belong to the',
      'service that owns the resource.',
    ].join('\n'),
  })
  @ApiOkResponse({
    description: 'The access token is valid.',
    type: PrincipalResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: [
      'No `Authorization` header, a malformed one, or a token that fails verification',
      'because it expired, was signed with another key, or carries a different issuer or',
      'audience. The response includes `WWW-Authenticate: Bearer error="invalid_token"`,',
      'per RFC 6750. The client is expected to send the user back to the login flow.',
    ].join('\n'),
  })
  me(@CurrentUser() principal: Principal): PrincipalResponseDto {
    return {
      userId: principal.userId,
      role: principal.role,
      canManageCatalog: principal.canManageCatalog(),
      canScheduleRooms: principal.canScheduleRooms(),
      canBid: principal.canBid(),
    };
  }

  /**
   * Datos de perfil. A diferencia de /auth/me, esto SI consulta la base: el nombre, el
   * avatar y el carne viven ahi, no en el token. Se mantienen separados a proposito, para
   * que /auth/me siga siendo el ejemplo de verificacion local que copian los demas
   * servicios.
   */
  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Read the profile of the signed-in user',
    description: [
      'Everything a client needs to render the account: email, display name, avatar, ',
      'university code and role.',
      '',
      'Unlike `GET /auth/me`, this reads the database. `/auth/me` only decodes the token',
      'and is the reference example of how other services verify a session locally; these',
      'fields are not in the token, on purpose, to keep personal data out of a credential',
      'that travels across five services.',
      '',
      'The account is re-checked on every call, so a suspended user stops getting a profile',
      'immediately rather than when their token expires.',
    ].join('\n'),
  })
  @ApiOkResponse({ description: 'The profile of the caller.', type: ProfileResponseDto })
  @ApiUnauthorizedResponse({
    description: 'No valid access token, or the account is no longer active.',
  })
  async profile(@CurrentUser() principal: Principal): Promise<ProfileResponseDto> {
    return toProfile(await this.users.requireActiveById(principal.userId));
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Set or clear the university code',
    description: [
      'The university code is the only profile field the person owns: Google supplies the',
      'name and the avatar, and those are overwritten on every sign-in.',
      '',
      'Send `institutionalCode` to set it, or `null` (or an empty string) to clear it.',
      'Omit the field and nothing changes.',
      '',
      'It is unique across the platform. Uniqueness is enforced by the database rather than',
      'by checking first and writing afterwards, because that check leaves a window where',
      'two simultaneous requests both succeed.',
      '',
      'Note it is **not** the identifier the rest of ECILOST uses to refer to a person.',
      'That one is `userId`, and it never changes.',
    ].join('\n'),
  })
  @ApiOkResponse({ description: 'The profile after the change.', type: ProfileResponseDto })
  @ApiBadRequestResponse({
    description:
      'The code does not match the accepted shape: 4 to 20 letters, digits or hyphens.',
  })
  @ApiUnauthorizedResponse({ description: 'No valid access token.' })
  @ApiConflictResponse({ description: 'Another person already registered that code.' })
  async updateProfile(
    @CurrentUser() principal: Principal,
    @Body() body: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    if (body.institutionalCode === undefined) {
      return toProfile(await this.users.requireActiveById(principal.userId));
    }

    try {
      return toProfile(
        await this.users.setInstitutionalCode(principal.userId, body.institutionalCode),
      );
    } catch (error) {
      if (error instanceof InstitutionalCodeTakenError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
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

/** Proyecta la fila de la base al contrato publico, sin filtrar columnas internas. */
function toProfile(user: User): ProfileResponseDto {
  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    institutionalCode: user.institutionalCode,
    role: user.role,
  };
}
