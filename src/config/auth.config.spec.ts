import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { AuthConfig, validateEnv } from './auth.config.js';

const raw = {
  DATABASE_URL: 'postgresql://test:test@localhost/auth',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'test-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
  JWT_ISSUER: 'https://auth.example.test',
  JWT_AUDIENCE: 'ecilost-test',
  JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----',
  JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nfixture\n-----END PUBLIC KEY-----',
  ACCESS_TOKEN_TTL_SECONDS: '900',
  REFRESH_TOKEN_TTL_SECONDS: '3600',
  COOKIE_SECRET: 'test-cookie-secret',
  POST_LOGIN_REDIRECT_URL: 'http://localhost:5173/rooms',
  POST_LOGIN_ERROR_URL: 'http://localhost:5173/login',
  RABBITMQ_URL: 'amqp://localhost',
};

describe('Auth environment', () => {
  it('converts environment strings to numeric token lifetimes and supplies default settings', () => {
    const config = new AuthConfig(validateEnv(raw));

    expect(config).toMatchObject({
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 3600,
      databaseSchema: 'public',
      cookieSecure: false,
      jwtPrivateKeyPem: raw.JWT_PRIVATE_KEY,
      jwtPublicKeyPem: raw.JWT_PUBLIC_KEY,
    });
    expect(config.staffEmails.size).toBe(0);
  });

  it('reports absent required fields and invalid lifetimes during startup', () => {
    expect(() => validateEnv({
      ...raw, DATABASE_URL: '', ACCESS_TOKEN_TTL_SECONDS: '20',
    })).toThrow(/DATABASE_URL:[\s\S]*ACCESS_TOKEN_TTL_SECONDS:/);
  });

  it('normalizes the staff list and honors explicit schema and cookie settings', () => {
    const config = new AuthConfig(validateEnv({
      ...raw,
      DATABASE_URL: raw.DATABASE_URL + '?schema=auth_test',
      COOKIE_SECURE: 'true',
      STAFF_EMAILS: ' ADMIN@example.test, ,admin@example.test , Other@example.test ',
    }));

    expect(config.databaseSchema).toBe('auth_test');
    expect(config.cookieSecure).toBe(true);
    expect([...config.staffEmails]).toEqual(['admin@example.test', 'other@example.test']);
  });

  it('uses the default schema when the URL cannot be parsed', () => {
    const config = new AuthConfig(validateEnv({ ...raw, DATABASE_URL: 'invalid-url' }));
    expect(config.databaseSchema).toBe('public');
  });
});
