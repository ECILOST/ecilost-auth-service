import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Principal } from '../../auth/domain/principal.js';
import { TokenService } from '../../auth/tokens/token.service.js';

/** El Principal autenticado, adosado a la peticion por el guard. */
export interface RequestWithPrincipal extends Request {
  principal?: Principal;
}

/**
 * Criterio 3: sin sesion valida, 401.
 *
 * Verifica la firma con la llave publica local, sin llamar a ningun otro servicio.
 * Este mismo guard es el que catalog-service y auction-core reutilizaran; por eso solo
 * depende de TokenService y no del resto del modulo de autenticacion.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithPrincipal>();
    const response = http.getResponse<Response>();

    const token = readBearerToken(request);
    if (!token) {
      return this.reject(response, 'invalid_request', 'Falta el token de acceso.');
    }

    try {
      request.principal = await this.tokens.verifyAccessToken(token);
      return true;
    } catch {
      return this.reject(response, 'invalid_token', 'El token de acceso no es valido.');
    }
  }

  /** RFC 6750: un 401 de recurso protegido debe decir como autenticarse. */
  private reject(response: Response, error: string, message: string): never {
    response.setHeader('WWW-Authenticate', `Bearer error="${error}"`);
    throw new UnauthorizedException(message);
  }
}

function readBearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, value, ...rest] = header.split(' ');
  if (rest.length > 0 || scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value;
}
