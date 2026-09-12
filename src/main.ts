import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { AuthConfig } from './config/auth.config.js';

const API_DESCRIPTION = [
  'Identity service of **ECI Lost & Auction**, the platform where the university auctions',
  'unclaimed lost property to its students using ECICoin, its own currency.',
  '',
  '## What this service does',
  '',
  'It authenticates people with **Google OAuth 2.0** and issues the session the rest of the',
  'platform trusts. It is an OAuth 2.0 **client**, not an authorization server: Google owns',
  'the credentials, and this service never sees or stores a password.',
  '',
  'After Google confirms who someone is, this service issues its **own RS256 access token**',
  'carrying the ECILOST user id and role. Google knows nothing about ECILOST roles, and',
  'tying five microservices to the lifetime of a Google token would make logout and',
  'revocation impossible.',
  '',
  '## The flow, end to end',
  '',
  '1. `GET /auth/google` redirects the browser to Google with PKCE, `state` and `nonce`.',
  '2. Google sends the user back to `GET /auth/google/callback`, which verifies everything,',
  '   finds or creates the user, and sets a session cookie.',
  '3. `POST /auth/token` exchanges that cookie for a short-lived access token.',
  '4. That token opens protected resources, starting with `GET /auth/me`.',
  '',
  'The access token lives 15 minutes and belongs in memory. The refresh token lives only in',
  'a signed `httpOnly` cookie, rotates on every exchange, and is stored hashed.',
  '',
  '## Who can sign in',
  '',
  'Any Google account with a **verified** email address. A first login provisions the person',
  'as `STUDENT`; addresses on the configured staff list become `STAFF`. A suspended account',
  'is rejected at login and again at every token exchange.',
  '',
  '## Roles and permissions',
  '',
  'Two roles, with no overlap. Operators run the lost property office; students take part',
  'in the auctions.',
  '',
  '| Capability | STAFF | STUDENT |',
  '|---|---|---|',
  '| Register items, create lots | yes | no |',
  '| Schedule auction rooms | yes | no |',
  '| Bid in an auction | no | yes |',
  '',
  'An operator cannot bid **in any room**, not merely in the ones they scheduled: running',
  'the auction and competing in it are incompatible. `GET /auth/me` returns the three',
  'flags so a client can build its menu without hardcoding the role.',
  '',
  '### How the other services enforce this',
  '',
  'Role checks belong to whichever service owns the resource. This one issues the role',
  'inside the token and publishes the rule; auction-core and catalog-service apply it by',
  'declaring the roles an endpoint admits, for example STAFF on room scheduling and',
  'STUDENT on bidding.',
  '',
  'Three status codes, and the difference between them matters:',
  '',
  '- `401` means the caller did not prove who they are: no token, a malformed header, or',
  '  a token that fails verification. Sending the user through the login flow fixes it.',
  '- `403` means the caller is authenticated and the role simply does not allow the',
  '  operation. Logging in again changes nothing.',
  '- A resource with no role restriction still answers `401` without a valid token.',
  '',
  '## Profile, and where each field comes from',
  '',
  'Two endpoints answer about the signed-in person, and the split is deliberate.',
  '',
  '`GET /auth/me` decodes the access token and nothing else. It never touches the database,',
  'which is what makes it the reference example of how the other services verify a session',
  'on their own. `GET /auth/profile` reads the database, because that is where the display',
  'data lives.',
  '',
  'The token carries only `sub` and `role`. Email, name and avatar are kept out of it on',
  'purpose: it is a credential that travels across five services, and the less personal',
  'data it carries, the less a leaked token exposes.',
  '',
  '| Field | Source | Who can change it |',
  '|---|---|---|',
  '| `fullName`, `avatarUrl` | Google, refreshed on every sign-in | Google |',
  '| `email`, `role` | Set when the account is provisioned | Nobody, through the API |',
  '| `institutionalCode` | Typed by the person | The person, via `PATCH /auth/profile` |',
  '',
  'The university code is unique and optional. It is **not** the identifier the rest of the',
  'platform uses to refer to someone: that is `userId`, which never changes. Do not store',
  'the code as a foreign key.',
  '',
  '## How other services validate a session',
  '',
  'They fetch `GET /.well-known/jwks.json` once and verify tokens **locally**. No service',
  'calls this one on a per-request basis, which keeps it off the critical path of a live',
  'auction room.',
  '',
  '## Reading the responses',
  '',
  'The two browser-facing endpoints answer with `302` and never with JSON, including when',
  'they reject the attempt: success and failure differ in the `Location` target, not in the',
  'status code. The JSON endpoints use `200`, `204` and `401`, and every `401` carries a',
  '`WWW-Authenticate` header as RFC 6750 requires. The rejection reasons are enumerated on',
  'the ErrorResponse schema.',
].join('\n');

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

  setupSwagger(app);

  await app.listen(process.env.PORT ?? 3000);
}

function setupSwagger(app: Parameters<typeof SwaggerModule.createDocument>[0]): void {
  const documentConfig = new DocumentBuilder()
    .setTitle('ECILOST Auth Service')
    .setDescription(API_DESCRIPTION)
    .setVersion('1.0.0')
    .addTag('Authentication', 'Sign in with Google, manage the session, read the principal')
    .addTag('Discovery', 'Public key material the other microservices consume')
    .addTag('Health', 'Liveness')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Access token issued by POST /auth/token. Send it as ' +
          '`Authorization: Bearer <token>`.',
      },
      'access-token',
    )
    .addCookieAuth(
      'ecilost_rt',
      {
        type: 'apiKey',
        in: 'cookie',
        description:
          'Session cookie set by the Google callback. Signed and httpOnly, so scripts ' +
          'cannot read it and Swagger UI cannot set it by hand: it is sent automatically ' +
          'by the browser once you have completed the login flow.',
      },
      'session-cookie',
    )
    .build();

  SwaggerModule.setup('docs', app, () =>
    SwaggerModule.createDocument(app, documentConfig),
  );
}

await bootstrap();
