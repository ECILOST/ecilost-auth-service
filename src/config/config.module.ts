import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AuthConfig, validateEnv } from './auth.config.js';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Las pruebas e2e apuntan a .env.test para no tocar la base de desarrollo.
      envFilePath: process.env.ENV_FILE ?? '.env',
      // Corre al arrancar: si falta una variable el proceso no llega a escuchar.
      validate: validateEnv,
    }),
  ],
  providers: [
    {
      provide: AuthConfig,
      // forRoot ya volco el .env sobre process.env antes de instanciar proveedores.
      useFactory: () => new AuthConfig(validateEnv(process.env)),
    },
  ],
  exports: [AuthConfig],
})
export class AppConfigModule {}
