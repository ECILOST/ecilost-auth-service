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

  /** Registrar objetos y agrupar lotes. Solo el operador administra el catalogo. */
  canManageCatalog(): boolean {
    return this.role === 'STAFF';
  }

  /** Programar salas con aforo y rondas. Un estudiante nunca crea una sala. */
  canScheduleRooms(): boolean {
    return this.role === 'STAFF';
  }

  /**
   * Participar en una subasta.
   *
   * El operador administra los objetos perdidos y no participa en las subastas, asi que
   * la regla es del rol y no de la sala concreta. No hace falta comparar contra el dueño
   * de la sala: todo dueño es operador y ningun operador puja, de modo que esa
   * comparacion nunca podria decidir nada por si sola.
   */
  canBid(): boolean {
    return this.role === 'STUDENT';
  }
}
