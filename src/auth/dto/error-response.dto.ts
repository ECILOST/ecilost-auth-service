import { ApiProperty } from '@nestjs/swagger';
import { AUTH_ERROR_MESSAGES, type AuthErrorCode } from '../domain/auth-error.js';

/**
 * La enumeracion que publica OpenAPI se deriva del registro de mensajes del dominio,
 * asi que un codigo nuevo aparece en la documentacion sin tocar este archivo.
 */
export const AUTH_ERROR_CODES = Object.keys(AUTH_ERROR_MESSAGES) as AuthErrorCode[];

export class ErrorResponseDto {
  @ApiProperty({
    enum: AUTH_ERROR_CODES,
    description: [
      'Machine-readable rejection reason.',
      '',
      '- `invalid_request`: the attempt is malformed, expired or already used. Covers a',
      '  mismatched `state`, a missing authorization code, a code Google refused, an',
      '  `id_token` that fails verification, and a refresh token that is unknown, expired,',
      '  already rotated or revoked.',
      '- `access_denied`: the user declined consent on the Google screen.',
      '- `email_not_verified`: the Google account has no verified email address.',
      '- `account_suspended`: the account exists in ECILOST but its status is not ACTIVE.',
      '- `server_error`: Google was unreachable or returned an unusable response.',
    ].join('\n'),
    example: 'invalid_request',
  })
  error: AuthErrorCode;

  @ApiProperty({
    description:
      'Human-readable reason, safe to show to the end user. Written in Spanish, the ' +
      'language of the product. The technical detail never leaves the server log.',
    example: 'La solicitud de inicio de sesion no es valida o expiro.',
  })
  message: string;
}
