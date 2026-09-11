import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuthError } from '../auth/domain/auth-error.js';
import { AuthConfig } from '../config/auth.config.js';
import type { Role } from '../generated/prisma/enums.js';
import { isActive, type User } from './entities/user.entity.js';
import { USER_REPOSITORY, type UserRepository } from './ports/user.repository.js';

/** Lo que este servicio necesita saber de Google, ya verificado. */
export interface VerifiedGoogleIdentity {
  sub: string;
  email: string;
  fullName: string;
  emailVerified: boolean;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly config: AuthConfig,
  ) {}

  /**
   * Aplica la politica de acceso de ECILOST sobre una identidad ya verificada por Google
   * y devuelve el usuario local.
   *
   * La plataforma esta abierta a cualquier cuenta de Google. Sin filtro de dominio,
   * `email_verified` es la unica barrera que queda contra una cuenta recien creada con el
   * correo de otra persona, por eso se exige siempre. Rechaza antes de escribir: un
   * intento fallido no deja rastro en la base.
   */
  async resolveOrProvision(identity: VerifiedGoogleIdentity): Promise<User> {
    if (!identity.emailVerified) {
      throw new AuthError('email_not_verified', `sub=${identity.sub}`);
    }

    const email = identity.email.toLowerCase();

    const existing = await this.users.findByGoogleSub(identity.sub);
    if (existing && !isActive(existing)) {
      throw new AuthError('account_suspended', `userId=${existing.id}`);
    }

    const user = await this.users.provision({
      googleSub: identity.sub,
      email,
      fullName: identity.fullName,
      role: this.roleFor(email),
    });

    if (!existing) {
      this.logger.log(`Usuario provisionado: ${user.id} con rol ${user.role}`);
    }

    // El upsert pudo encontrar una fila suspendida por `email` aunque no por `googleSub`.
    if (!isActive(user)) {
      throw new AuthError('account_suspended', `userId=${user.id}`);
    }

    return user;
  }

  /**
   * Relee al usuario en cada refresco. Sin esto, suspender una cuenta no surtiria efecto
   * hasta que venciera su refresh token, que dura una semana.
   */
  async requireActiveById(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new AuthError('invalid_request', `usuario ${id} no existe`);
    }
    if (!isActive(user)) {
      throw new AuthError('account_suspended', `userId=${user.id}`);
    }
    return user;
  }

  private roleFor(email: string): Role {
    return this.config.staffEmails.has(email) ? 'STAFF' : 'STUDENT';
  }
}
