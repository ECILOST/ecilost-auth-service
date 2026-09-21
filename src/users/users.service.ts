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
  /** URL del avatar publicada por Google. Puede faltar. */
  avatarUrl?: string;
}

/** Longitud y forma admitidas para el carne. Supuesto permisivo: no conozco el real. */
export const INSTITUTIONAL_CODE_PATTERN = /^[A-Za-z0-9-]{4,20}$/;

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
      avatarUrl: identity.avatarUrl,
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
   * Fija o borra el carne institucional del usuario.
   *
   * Se recorta el texto y se trata la cadena vacia como borrado, que es lo que manda un
   * formulario cuando el usuario limpia el campo. El choque con otra persona lo arbitra la
   * restriccion unica de la base, no una consulta previa.
   */
  async setInstitutionalCode(userId: string, rawCode: string | null): Promise<User> {
    await this.requireActiveById(userId);

    const code = rawCode?.trim() ? rawCode.trim() : null;
    if (code !== null && !INSTITUTIONAL_CODE_PATTERN.test(code)) {
      throw new AuthError('invalid_request', 'formato de codigo institucional invalido');
    }

    return this.users.setInstitutionalCode(userId, code);
  }

  /**
   * Relee al usuario en cada refresco. Sin esto, suspender una cuenta no surtiria efecto
   * hasta que venciera su refresh token, que dura una semana.
   */
  /**
   * Busca a alguien por su correo, para que un funcionario pueda dar con su `userId`.
   *
   * Hace falta porque el resto de la plataforma identifica a las personas por `userId` y no
   * por correo: wallet, auction-core y engagement guardan ese identificador y nada mas. Sin
   * una forma de traducir de lo que un funcionario conoce a lo que los servicios esperan,
   * operaciones como recargar una billetera no se pueden hacer.
   *
   * Es una busqueda exacta y no un listado: sirve para confirmar a quien ya se conoce, no
   * para recorrer el directorio.
   */
  async findByEmail(email: string): Promise<User | null> {
    // Se guarda en minusculas al provisionar, asi que se normaliza igual al buscar.
    return this.users.findByEmail(email.trim().toLowerCase());
  }

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
