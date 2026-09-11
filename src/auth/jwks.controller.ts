import { Controller, Get, Header } from '@nestjs/common';
import type { JSONWebKeySet } from 'jose';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwksResponseDto } from './dto/jwks-response.dto.js';
import { TokenService } from './tokens/token.service.js';

/**
 * Llave publica del emisor. Catalog, auction-core y realtime la descargan una vez y
 * verifican los access tokens en local, sin convertir a este servicio en cuello de botella
 * de la sala en vivo. La llave privada nunca sale del proceso.
 */
@ApiTags('Discovery')
@Controller()
export class JwksController {
  constructor(private readonly tokens: TokenService) {}

  @Get('.well-known/jwks.json')
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOperation({
    summary: 'Public signing keys of this issuer',
    description: [
      'Standard JWKS document (RFC 7517). Public endpoint: no credentials required.',
      '',
      'This is how the rest of ECILOST validates a session. Each service fetches the',
      'document once, caches it, and verifies every access token locally against it. That',
      'is a deliberate architectural choice: asking this service to introspect one token',
      'per request would put it on the critical path of a live auction room and make it',
      'the first thing to fall over under load.',
      '',
      'Verify `RS256`, and check `iss` and `aud` against the values this service is',
      'configured with. Match the token `kid` header against the `kid` of a key here, so',
      'that a key rotation does not invalidate tokens still in flight.',
      '',
      'Only public key material is ever published. The private key never leaves the process.',
    ].join('\n'),
  })
  @ApiOkResponse({
    description: 'The active public keys. Cacheable for one hour.',
    type: JwksResponseDto,
  })
  // JwksResponseDto solo describe la respuesta en OpenAPI: el tipo real lo produce jose.
  jwks(): Promise<JSONWebKeySet> {
    return this.tokens.publicJwks();
  }
}
