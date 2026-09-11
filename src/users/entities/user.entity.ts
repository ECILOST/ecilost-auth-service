import type { UserModel } from '../../generated/prisma/models.js';

/** Identidad de ECILOST. La forma del dato la manda prisma/schema.prisma. */
export type User = UserModel;

/** Criterio 1: solo un estudiante con cuenta activa obtiene sesion. */
export function isActive(user: Pick<User, 'status'>): boolean {
  return user.status === 'ACTIVE';
}
