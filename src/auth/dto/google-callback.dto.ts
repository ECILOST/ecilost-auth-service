import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Query del callback de Google. Con `whitelist` y `forbidNonWhitelisted` activos en el
 * ValidationPipe global, cualquier parametro extra inyectado en la URL se rechaza.
 */
export class GoogleCallbackDto {
  @IsOptional() @IsString() @MaxLength(2048) code?: string;

  @IsOptional() @IsString() @MaxLength(512) state?: string;

  /** Google lo envia cuando el usuario niega el consentimiento. */
  @IsOptional() @IsString() @MaxLength(256) error?: string;

  @IsOptional() @IsString() @MaxLength(1024) error_description?: string;

  @IsOptional() @IsString() @MaxLength(512) scope?: string;

  @IsOptional() @IsString() @MaxLength(256) authuser?: string;

  @IsOptional() @IsString() @MaxLength(256) prompt?: string;

  @IsOptional() @IsString() @MaxLength(256) hd?: string;
}
