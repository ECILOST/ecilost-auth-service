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

  it('rotates a live token once and revokes the requested user family', async () => {
    const successor = {
      tokenHash: 'next-hash', familyId: 'family', userId: 'student',
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    };
    const refreshToken = {
      updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }).mockResolvedValue({ count: 2 }),
      create: vi.fn(),
    };
    const tx = { refreshToken, $queryRaw: vi.fn() };
    const transaction = vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx));
    const repository = new PrismaRefreshTokenRepository({ $transaction: transaction } as unknown as PrismaService);

    await expect(repository.rotate('token', successor)).resolves.toBe(true);
    await expect(repository.rotate('token', successor)).resolves.toBe(false);
    await repository.revokeFamily('student', 'family');

    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(tx.$queryRaw).toHaveBeenCalledBefore(refreshToken.updateMany);
    expect(refreshToken.create).toHaveBeenCalledExactlyOnceWith({ data: successor });
    expect(refreshToken.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'token', revokedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { revokedAt: expect.any(Date) },
    });
    expect(refreshToken.updateMany).toHaveBeenLastCalledWith({
      where: { userId: 'student', familyId: 'family', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
