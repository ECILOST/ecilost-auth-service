import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { InstitutionalCodeTakenError, type ProvisionUserInput } from '../ports/user.repository.js';
import { PrismaUserRepository } from './prisma-user.repository.js';

function setup() {
  const user = { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() };
  return { user, repository: new PrismaUserRepository({ user } as unknown as PrismaService) };
}

describe('PrismaUserRepository', () => {
  it('looks up a user using the requested unique field', async () => {
    const { user, repository } = setup();
    user.findUnique.mockResolvedValueOnce({ id: 'student' }).mockResolvedValue(null);

    await expect(repository.findById('student')).resolves.toEqual({ id: 'student' });
    await expect(repository.findByEmail('student@example.test')).resolves.toBeNull();
    await expect(repository.findByGoogleSub('google-subject')).resolves.toBeNull();
    expect(user.findUnique.mock.calls).toEqual([
      [{ where: { id: 'student' } }],
      [{ where: { email: 'student@example.test' } }],
      [{ where: { googleSub: 'google-subject' } }],
    ]);
  });

  it.each([undefined, 'https://example.test/avatar.png'])(
    'provisions the outbox event only on creation and refreshes the profile on future logins (%s)',
    async (avatarUrl) => {
      const { user, repository } = setup();
      const input: ProvisionUserInput = {
        googleSub: 'google-subject', email: 'student@example.test', fullName: 'Test Student',
        avatarUrl, role: 'STUDENT',
      };
      const profile = { email: input.email, fullName: input.fullName, avatarUrl: avatarUrl ?? null };
      user.upsert.mockResolvedValue({ id: 'student' });

      await expect(repository.provision(input)).resolves.toEqual({ id: 'student' });
      expect(user.upsert).toHaveBeenCalledWith({
        where: { googleSub: input.googleSub },
        create: {
          ...profile, googleSub: input.googleSub, role: 'STUDENT',
          outboxEvents: { create: { type: 'user.created.v1' } },
        },
        update: profile,
      });
    },
  );

  it('clears an institutional code and translates only the unique constraint error', async () => {
    const { user, repository } = setup();
    const unavailable = new Error('database unavailable');
    user.update.mockResolvedValueOnce({ institutionalCode: null })
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(null);

    await expect(repository.setInstitutionalCode('student', null)).resolves.toEqual({ institutionalCode: null });
    expect(user.update).toHaveBeenCalledWith({
      where: { id: 'student' }, data: { institutionalCode: null },
    });
    await expect(repository.setInstitutionalCode('student', 'DUP-1')).rejects.toBeInstanceOf(InstitutionalCodeTakenError);
    await expect(repository.setInstitutionalCode('student', 'CODE-2')).rejects.toBe(unavailable);
    await expect(repository.setInstitutionalCode('student', 'CODE-3')).rejects.toBeNull();
  });
});
