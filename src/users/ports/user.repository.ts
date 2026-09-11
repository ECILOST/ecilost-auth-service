import type { Role } from '../../generated/prisma/enums.js';
import type { User } from '../entities/user.entity.js';

export interface ProvisionUserInput {
  googleSub: string;
  email: string;
  fullName: string;
  role: Role;
}

/**
 * Puerto de salida hacia el almacen de identidades. Existe para que el caso de uso se
 * pueda probar con un doble y sin Postgres levantado, no para anticipar otro motor.
 */
export interface UserRepository {
  findById(id: string): Promise<User | null>;

  findByGoogleSub(googleSub: string): Promise<User | null>;

  /**
   * Crea el usuario si no existe y actualiza sus datos de perfil si ya existia.
   * Debe ser una sola sentencia atomica: dos logins simultaneos del mismo usuario nuevo
   * chocarian contra las restricciones unicas de `googleSub` y `email`.
   *
   * No toca `role` ni `status` de un usuario existente: el rol se decide una vez, al
   * darlo de alta, y cambiarlo o suspenderlo es una operacion administrativa aparte.
   */
  provision(input: ProvisionUserInput): Promise<User>;
}

export const USER_REPOSITORY = Symbol('UserRepository');
