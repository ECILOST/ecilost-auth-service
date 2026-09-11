import { beforeEach, describe, expect, it } from 'vitest';
import { FakeUserRepository } from '../../test/helpers/fake-repositories.js';
import { buildTestConfig } from '../../test/helpers/test-config.js';
import { AuthError } from '../auth/domain/auth-error.js';
import { UsersService, type VerifiedGoogleIdentity } from './users.service.js';

function identity(overrides: Partial<VerifiedGoogleIdentity> = {}): VerifiedGoogleIdentity {
  return {
    sub: 'google-sub-1',
    email: 'estudiante@escuelaing.edu.co',
    fullName: 'Estudiante Uno',
    emailVerified: true,
    ...overrides,
  };
}

describe('UsersService (politica de acceso)', () => {
  let repository: FakeUserRepository;
  let service: UsersService;

  beforeEach(() => {
    repository = new FakeUserRepository();
    service = new UsersService(repository, buildTestConfig());
  });

  it('provisiona como STUDENT a una cuenta de Google verificada', async () => {
    const user = await service.resolveOrProvision(identity());

    expect(user.role).toBe('STUDENT');
    expect(user.status).toBe('ACTIVE');
    expect(repository.rows.size).toBe(1);
  });

  it('asigna STAFF a los correos de la lista explicita', async () => {
    const user = await service.resolveOrProvision(
      identity({ email: 'funcionario@escuelaing.edu.co', sub: 'google-sub-staff' }),
    );

    expect(user.role).toBe('STAFF');
  });

  it('normaliza el correo a minusculas antes de decidir el rol', async () => {
    const user = await service.resolveOrProvision(
      identity({ email: 'Funcionario@Escuelaing.Edu.Co', sub: 'google-sub-mayus' }),
    );

    expect(user.role).toBe('STAFF');
    expect(user.email).toBe('funcionario@escuelaing.edu.co');
  });

  // La plataforma esta abierta: no hay filtro de dominio.
  it.each([
    ['una cuenta personal de Gmail', 'persona@gmail.com'],
    ['otra universidad', 'alguien@otra-universidad.edu.co'],
    ['un dominio cualquiera', 'alguien@dominio-random.io'],
  ])('admite %s como STUDENT', async (_caso, email) => {
    const user = await service.resolveOrProvision(identity({ email }));

    expect(user.role).toBe('STUDENT');
    expect(user.email).toBe(email);
    expect(repository.rows.size).toBe(1);
  });

  it('da STAFF a un correo de la lista aunque no sea del dominio institucional', async () => {
    service = new UsersService(
      repository,
      buildTestConfig({ STAFF_EMAILS: 'jefe@gmail.com' }),
    );

    const user = await service.resolveOrProvision(identity({ email: 'jefe@gmail.com' }));

    expect(user.role).toBe('STAFF');
  });

  it('rechaza un correo sin verificar en Google', async () => {
    await expect(
      service.resolveOrProvision(identity({ emailVerified: false })),
    ).rejects.toMatchObject({ code: 'email_not_verified' });

    expect(repository.rows.size).toBe(0);
  });

  it('rechaza a un usuario suspendido', async () => {
    repository.seed({
      googleSub: 'google-sub-1',
      email: 'estudiante@escuelaing.edu.co',
      status: 'SUSPENDED',
    });

    await expect(service.resolveOrProvision(identity())).rejects.toMatchObject({
      code: 'account_suspended',
    });
  });

  it('no cambia el rol de un usuario que ya existia', async () => {
    const seeded = repository.seed({
      googleSub: 'google-sub-1',
      email: 'estudiante@escuelaing.edu.co',
      role: 'STAFF',
    });

    const user = await service.resolveOrProvision(identity());

    expect(user.id).toBe(seeded.id);
    expect(user.role).toBe('STAFF');
    expect(repository.rows.size).toBe(1);
  });

  it('es idempotente: dos inicios de sesion no duplican el usuario', async () => {
    const first = await service.resolveOrProvision(identity());
    const second = await service.resolveOrProvision(identity());

    expect(second.id).toBe(first.id);
    expect(repository.rows.size).toBe(1);
  });

  describe('requireActiveById', () => {
    it('devuelve al usuario activo', async () => {
      const seeded = repository.seed({
        googleSub: 'g',
        email: 'activo@escuelaing.edu.co',
      });

      await expect(service.requireActiveById(seeded.id)).resolves.toMatchObject({
        id: seeded.id,
      });
    });

    it('rechaza a un usuario suspendido despues del alta', async () => {
      const seeded = repository.seed({
        googleSub: 'g',
        email: 'suspendido@escuelaing.edu.co',
        status: 'SUSPENDED',
      });

      await expect(service.requireActiveById(seeded.id)).rejects.toMatchObject({
        code: 'account_suspended',
      });
    });

    it('rechaza un identificador inexistente', async () => {
      await expect(service.requireActiveById('no-existe')).rejects.toBeInstanceOf(AuthError);
    });
  });
});
