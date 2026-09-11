import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { AuthConfig } from './config/auth.config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AuthConfig);

  // Firma las cookies de flujo y de sesion: manipularlas invalida la firma.
  app.use(cookieParser(config.cookieSecret));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
