import { beforeEach, describe, expect, it } from 'vitest';
import { FakeUserRepository } from '../../test/helpers/fake-repositories.js';
import { InstitutionalCodeTakenError } from './ports/user.repository.js';
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

  describe('foto de perfil', () => {
    it('guarda la que manda Google al dar de alta', async () => {
      const user = await service.resolveOrProvision(
        identity({ avatarUrl: 'https://lh3.googleusercontent.com/a/foto' }),
      );

      expect(user.avatarUrl).toBe('https://lh3.googleusercontent.com/a/foto');
    });

    it('la refresca en el siguiente inicio de sesion', async () => {
      await service.resolveOrProvision(identity({ avatarUrl: 'https://cdn.test/vieja' }));
      const user = await service.resolveOrProvision(
        identity({ avatarUrl: 'https://cdn.test/nueva' }),
      );

      expect(user.avatarUrl).toBe('https://cdn.test/nueva');
      expect(repository.rows.size).toBe(1);
    });

    it('queda vacia cuando Google no la manda', async () => {
      const user = await service.resolveOrProvision(identity());

      expect(user.avatarUrl).toBeNull();
    });
  });

  describe('codigo institucional', () => {
    let userId: string;

    beforeEach(async () => {
      userId = (await service.resolveOrProvision(identity())).id;
    });

    it('nace vacio', async () => {
      const [user] = [...repository.rows.values()];

      expect(user.institutionalCode).toBeNull();
    });

    it('se fija y recorta los espacios', async () => {
      const user = await service.setInstitutionalCode(userId, '  A00123456  ');

      expect(user.institutionalCode).toBe('A00123456');
    });

    it.each([['null', null], ['cadena vacia', ''], ['solo espacios', '   ']])(
      'con %s borra el codigo',
      async (_caso, valor) => {
        await service.setInstitutionalCode(userId, 'A00123456');
        const user = await service.setInstitutionalCode(userId, valor);

        expect(user.institutionalCode).toBeNull();
      },
    );

    it.each([
      ['muy corto', 'A12'],
      ['muy largo', 'A'.repeat(21)],
      ['con caracteres raros', 'A001/234'],
      ['con espacios en medio', 'A00 123'],
    ])('rechaza un codigo %s', async (_caso, valor) => {
      await expect(service.setInstitutionalCode(userId, valor)).rejects.toMatchObject({
        code: 'invalid_request',
      });
    });

    it('rechaza el codigo que ya tiene otra persona', async () => {
      await service.setInstitutionalCode(userId, 'A00123456');
      const otro = await service.resolveOrProvision(
        identity({ sub: 'otro-sub', email: 'otro@gmail.com' }),
      );

      await expect(
        service.setInstitutionalCode(otro.id, 'A00123456'),
      ).rejects.toBeInstanceOf(InstitutionalCodeTakenError);
    });

    it('deja repetir el mismo codigo en el mismo usuario', async () => {
      await service.setInstitutionalCode(userId, 'A00123456');
      const user = await service.setInstitutionalCode(userId, 'A00123456');

      expect(user.institutionalCode).toBe('A00123456');
    });

    it('no altera el rol ni el estado', async () => {
      const user = await service.setInstitutionalCode(userId, 'A00123456');

      expect(user.role).toBe('STUDENT');
      expect(user.status).toBe('ACTIVE');
    });

    it('rechaza a un usuario suspendido', async () => {
      const [user] = [...repository.rows.values()];
      repository.rows.set(user.id, { ...user, status: 'SUSPENDED' });

      await expect(service.setInstitutionalCode(userId, 'A00123456')).rejects.toMatchObject(
        { code: 'account_suspended' },
      );
    });
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
