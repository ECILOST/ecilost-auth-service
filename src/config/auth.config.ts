import { plainToInstance } from 'class-transformer';
import {
  IsBooleanString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  validateSync,
} from 'class-validator';

/**
 * Contrato de entorno del servicio. Se valida al arrancar, no en la primera peticion:
 * un GOOGLE_CLIENT_SECRET ausente debe tumbar el proceso, no producir un 500 en el login.
 */
export class EnvironmentVariables {
  @IsOptional() @IsString() NODE_ENV?: string;
  @IsOptional() @IsString() PORT?: string;

  @IsNotEmpty({ message: 'DATABASE_URL es obligatorio' })
  @IsString()
  DATABASE_URL: string;

  @IsNotEmpty() @IsString() GOOGLE_CLIENT_ID: string;
  @IsNotEmpty() @IsString() GOOGLE_CLIENT_SECRET: string;
  @IsUrl({ require_tld: false }) GOOGLE_REDIRECT_URI: string;

  @IsOptional() @IsString() STAFF_EMAILS?: string;

  @IsNotEmpty() @IsString() JWT_ISSUER: string;
  @IsNotEmpty() @IsString() JWT_AUDIENCE: string;

  /** PEM PKCS#8 codificado en base64, para que quepa en una linea de .env */
  @IsNotEmpty({
    message: 'JWT_PRIVATE_KEY es obligatorio (PEM PKCS#8 en base64)',
  })
  @IsString()
  JWT_PRIVATE_KEY: string;

  @IsNotEmpty({ message: 'JWT_PUBLIC_KEY es obligatorio (PEM SPKI en base64)' })
  @IsString()
  JWT_PUBLIC_KEY: string;

  @IsInt() @Min(60) ACCESS_TOKEN_TTL_SECONDS: number;
  @IsInt() @Min(60) REFRESH_TOKEN_TTL_SECONDS: number;

  @IsNotEmpty() @IsString() COOKIE_SECRET: string;
  @IsOptional() @IsBooleanString() COOKIE_SECURE?: string;

  @IsUrl({ require_tld: false }) POST_LOGIN_REDIRECT_URL: string;
  @IsUrl({ require_tld: false }) POST_LOGIN_ERROR_URL: string;

  @IsNotEmpty() @IsString() RABBITMQ_URL: string;
}

export function validateEnv(
  raw: Record<string, unknown>,
): EnvironmentVariables {
  const parsed = plainToInstance(EnvironmentVariables, raw, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(parsed, { skipMissingProperties: false });
  if (errors.length > 0) {
    const detail = errors
      .map(
        (e) =>
          `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('\n');
    throw new Error(`Configuracion de entorno invalida:\n${detail}`);
  }
  return parsed;
}

/** Vista tipada de la configuracion. Evita esparcir strings de env por todo el codigo. */
export class AuthConfig {
  readonly databaseUrl: string;
  readonly databaseSchema: string;
  readonly googleClientId: string;
  readonly googleClientSecret: string;
  readonly googleRedirectUri: string;
  readonly staffEmails: ReadonlySet<string>;
  readonly jwtIssuer: string;
  readonly jwtAudience: string;
  readonly jwtPrivateKeyPem: string;
  readonly jwtPublicKeyPem: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
  readonly cookieSecret: string;
  readonly cookieSecure: boolean;
  readonly postLoginRedirectUrl: string;
  readonly postLoginErrorUrl: string;
  readonly rabbitmqUrl: string;

  constructor(env: EnvironmentVariables) {
    this.databaseUrl = env.DATABASE_URL;
    this.databaseSchema = readSchemaFromUrl(env.DATABASE_URL);
    this.googleClientId = env.GOOGLE_CLIENT_ID;
    this.googleClientSecret = env.GOOGLE_CLIENT_SECRET;
    this.googleRedirectUri = env.GOOGLE_REDIRECT_URI;
    this.staffEmails = new Set(
      (env.STAFF_EMAILS ?? '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    );
    this.jwtIssuer = env.JWT_ISSUER;
    this.jwtAudience = env.JWT_AUDIENCE;
    this.jwtPrivateKeyPem = decodePem(env.JWT_PRIVATE_KEY);
    this.jwtPublicKeyPem = decodePem(env.JWT_PUBLIC_KEY);
    this.accessTokenTtlSeconds = env.ACCESS_TOKEN_TTL_SECONDS;
    this.refreshTokenTtlSeconds = env.REFRESH_TOKEN_TTL_SECONDS;
    this.cookieSecret = env.COOKIE_SECRET;
    this.cookieSecure = env.COOKIE_SECURE === 'true';
    this.postLoginRedirectUrl = env.POST_LOGIN_REDIRECT_URL;
    this.postLoginErrorUrl = env.POST_LOGIN_ERROR_URL;
    this.rabbitmqUrl = env.RABBITMQ_URL;
  }
}

/**
 * Acepta el PEM tal cual o codificado en base64. Un PEM crudo es multilinea y no
 * sobrevive bien a un archivo .env, asi que base64 es la forma recomendada.
 */
function decodePem(value: string): string {
  if (value.includes('-----BEGIN')) return value.replace(/\n/g, '\n');
  return Buffer.from(value, 'base64').toString('utf8');
}

/** El adaptador de driver de Prisma 7 no interpreta `?schema=`; hay que pasarselo aparte. */
function readSchemaFromUrl(url: string): string {
  try {
    return new URL(url).searchParams.get('schema') ?? 'public';
  } catch {
    return 'public';
  }
}
