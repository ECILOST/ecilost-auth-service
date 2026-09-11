import { execFileSync } from 'node:child_process';

/**
 * Deja el esquema auth_test al dia antes de la primera prueba.
 * Requiere Postgres arriba: `docker compose up -d`.
 */
export default function setup(): void {
  process.env.ENV_FILE = '.env.test';
  process.loadEnvFile('.env.test');

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
}
