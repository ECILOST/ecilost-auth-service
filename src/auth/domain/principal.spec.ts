import { describe, expect, it } from 'vitest';
import { Principal } from './principal.js';

const STAFF_ID = '11111111-1111-4111-8111-111111111111';
const STUDENT_ID = '22222222-2222-4222-8222-222222222222';

describe('Principal (capacidades por rol)', () => {
  const staff = new Principal(STAFF_ID, 'STAFF');
  const student = new Principal(STUDENT_ID, 'STUDENT');

  describe('el operador gestiona pero no participa', () => {
    it('puede administrar el catalogo', () => {
      expect(staff.canManageCatalog()).toBe(true);
    });

    it('puede programar salas', () => {
      expect(staff.canScheduleRooms()).toBe(true);
    });

    it('no puede pujar en ninguna subasta', () => {
      expect(staff.canBid()).toBe(false);
    });
  });

  describe('el estudiante participa pero no gestiona', () => {
    it('puede pujar', () => {
      expect(student.canBid()).toBe(true);
    });

    it('no puede administrar el catalogo', () => {
      expect(student.canManageCatalog()).toBe(false);
    });

    it('no puede programar salas', () => {
      expect(student.canScheduleRooms()).toBe(false);
    });
  });

  describe('hasRole', () => {
    it('reconoce el rol propio', () => {
      expect(staff.hasRole('STAFF')).toBe(true);
      expect(student.hasRole('STUDENT')).toBe(true);
    });

    it('rechaza el ajeno', () => {
      expect(staff.hasRole('STUDENT')).toBe(false);
      expect(student.hasRole('STAFF')).toBe(false);
    });
  });

  it('las capacidades de gestion y de participacion son excluyentes', () => {
    for (const principal of [staff, student]) {
      expect(principal.canManageCatalog()).toBe(!principal.canBid());
      expect(principal.canScheduleRooms()).toBe(!principal.canBid());
    }
  });

  it('conserva el identificador que viaja en el token', () => {
    expect(staff.userId).toBe(STAFF_ID);
    expect(student.userId).toBe(STUDENT_ID);
  });
});
