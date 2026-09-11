import { Controller, Get, Header } from '@nestjs/common';
import type { JSONWebKeySet } from 'jose';
import { TokenService } from './tokens/token.service.js';

/**
 * Llave publica del emisor. Catalog, auction-core y realtime la descargan una vez y
 * verifican los access tokens en local, sin convertir a este servicio en cuello de botella
 * de la sala en vivo. La llave privada nunca sale del proceso.
 */
@Controller()
export class JwksController {
  constructor(private readonly tokens: TokenService) {}

  @Get('.well-known/jwks.json')
  @Header('Cache-Control', 'public, max-age=3600')
  jwks(): Promise<JSONWebKeySet> {
    return this.tokens.publicJwks();
  }
}
