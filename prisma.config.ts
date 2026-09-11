import { defineConfig } from 'prisma/config';

// Prisma 7 ya no lee `url` desde schema.prisma ni carga .env por su cuenta.
// Node 20.12+ trae loadEnvFile, asi que no hace falta dotenv como dependencia directa.
process.loadEnvFile?.();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
