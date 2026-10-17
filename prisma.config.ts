import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 ya no lee `url` desde schema.prisma ni carga .env por su cuenta.
// Node 20.12+ trae loadEnvFile, asi que no hace falta dotenv como dependencia directa.
// Solo si existe: el deploy del CI no tiene .env y pasa DATABASE_URL por el entorno.
if (existsSync('.env')) process.loadEnvFile?.();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
