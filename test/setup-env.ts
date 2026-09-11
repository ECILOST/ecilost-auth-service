// Carga el entorno de pruebas en cada worker de Vitest antes de construir la aplicacion.
process.env.ENV_FILE = '.env.test';
process.loadEnvFile('.env.test');

if (!process.env.DATABASE_URL?.includes('auth_test')) {
  throw new Error(
    'Las pruebas e2e deben apuntar al esquema auth_test. Revisa .env.test.',
  );
}
