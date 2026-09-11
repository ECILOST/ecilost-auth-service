import { Role } from '../../generated/prisma/enums.js';

/**
 * Identidad ya autenticada, derivada del access token. Es lo que viaja por el sistema:
 * nunca el correo ni el nombre, para minimizar el PII que cruza cinco microservicios.
 */
export class Principal {
  constructor(
    readonly userId: string,
    readonly role: Role,
  ) {}

  hasRole(role: Role): boolean {
    return this.role === role;
  }

  canManageCatalog(): boolean {
    return this.role === 'STAFF';
  }

  canScheduleRooms(): boolean {
    return this.role === 'STAFF';
  }
}
