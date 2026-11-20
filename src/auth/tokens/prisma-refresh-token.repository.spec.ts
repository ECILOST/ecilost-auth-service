import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { PrismaRefreshTokenRepository } from './prisma-refresh-token.repository.js';

describe('PrismaRefreshTokenRepository', () => {
  it('persists a token and looks it up by its stored hash', async () => {
    const refreshToken = { create: vi.fn(), findUnique: vi.fn() };
    const repository = new PrismaRefreshTokenRepository({ refreshToken } as unknown as PrismaService);
    const token = {
      tokenHash: 'stored-hash', familyId: 'family', userId: 'student',
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    };
    const stored = { ...token, id: 'token', revokedAt: null };
    refreshToken.findUnique.mockResolvedValue(stored);

    await repository.create(token);
    await expect(repository.findByHash(token.tokenHash)).resolves.toEqual(stored);
    expect(refreshToken.create).toHaveBeenCalledWith({ data: token });
    expect(refreshToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash: token.tokenHash } });
  });

  it('reports whether it consumed a live token and revokes only live tokens in the requested family', async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 2 });
    const repository = new PrismaRefreshTokenRepository({ refreshToken: { updateMany } } as unknown as PrismaService);

    await expect(repository.consume('token')).resolves.toBe(true);
    await expect(repository.consume('token')).resolves.toBe(false);
    await repository.revokeFamily('family');
    const data = { revokedAt: expect.any(Date) };
    expect(updateMany.mock.calls).toEqual([
      [{ where: { id: 'token', revokedAt: null }, data }],
      [{ where: { id: 'token', revokedAt: null }, data }],
      [{ where: { familyId: 'family', revokedAt: null }, data }],
    ]);
  });
});
