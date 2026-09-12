import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Query del callback de Google. Con `whitelist` y `forbidNonWhitelisted` activos en el
 * ValidationPipe global, cualquier parametro extra inyectado en la URL se rechaza.
 */
export class GoogleCallbackDto {
  @ApiPropertyOptional({
    description:
      'Single-use authorization code. Present when the user granted consent. It is ' +
      'exchanged server-side together with the PKCE verifier, so a code captured in ' +
      'transit cannot be redeemed by anyone else.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  code?: string;

  @ApiPropertyOptional({
    description:
      'Opaque value this service generated when the flow started. It is compared in ' +
      'constant time against the signed cookie; a mismatch aborts the login before the ' +
      'code is exchanged. This is the CSRF defence of the flow.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  state?: string;

  @ApiPropertyOptional({
    description:
      'Present instead of `code` when the user declined consent or Google refused the ' +
      'request. Mapped to the `access_denied` rejection.',
    example: 'access_denied',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  error?: string;

  @ApiPropertyOptional({ description: "Google's own description of the error." })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  error_description?: string;

  @ApiPropertyOptional({
    description: 'Scopes the user actually granted. Accepted and ignored.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  scope?: string;

  @ApiPropertyOptional({
    description:
      'Index of the account chosen in the Google account picker. Accepted and ignored.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  authuser?: string;

  @ApiPropertyOptional({ description: 'Consent prompt Google displayed. Accepted and ignored.' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  prompt?: string;

  @ApiPropertyOptional({
    description:
      'Google Workspace domain of the account, when it has one. Accepted and ignored: ' +
      'the platform is open to any Google account, so no domain rule is applied.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  hd?: string;

  @ApiPropertyOptional({
    description:
      'Issuer identifier, sent by Google as described in RFC 9207. When present it must ' +
      'match Google, otherwise the callback is rejected before the code is exchanged. ' +
      'It defends against a mix-up attack, where a rogue authorization server tricks a ' +
      'client into redeeming a code at the wrong provider.',
    example: 'https://accounts.google.com',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  iss?: string;
}
