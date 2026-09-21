import { generateKeyPairSync } from 'node:crypto';
import {
  AuthConfig,
  type EnvironmentVariables,
} from '../../src/config/auth.config.js';

/** Par RS256 efimero: ninguna llave real entra al repositorio ni a las pruebas. */
export function generateTestKeyPair(): {
  privateKey: string;
  publicKey: string;
} {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  return {
    privateKey: Buffer.from(
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
    ).toString('base64'),
    publicKey: Buffer.from(
      publicKey.export({ type: 'spki', format: 'pem' }),
    ).toString('base64'),
  };
}

export function buildTestConfig(
  overrides: Partial<EnvironmentVariables> = {},
): AuthConfig {
  const keys = generateTestKeyPair();
  return new AuthConfig({
    DATABASE_URL: 'postgresql://u:p@localhost:5433/db?schema=auth_test',
    GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
    STAFF_EMAILS: 'funcionario@escuelaing.edu.co',
    JWT_ISSUER: 'https://auth.ecilost.test',
    JWT_AUDIENCE: 'ecilost-services',
    JWT_PRIVATE_KEY: keys.privateKey,
    JWT_PUBLIC_KEY: keys.publicKey,
    ACCESS_TOKEN_TTL_SECONDS: 900,
    REFRESH_TOKEN_TTL_SECONDS: 604800,
    COOKIE_SECRET: 'secreto-de-prueba-para-firmar-cookies',
    COOKIE_SECURE: 'false',
    POST_LOGIN_REDIRECT_URL: 'http://localhost:5173/rooms',
    POST_LOGIN_ERROR_URL: 'http://localhost:5173/login',
    RABBITMQ_URL: 'amqp://ecilost:ecilost@localhost:5672',
    ...overrides,
  } as EnvironmentVariables);
}
