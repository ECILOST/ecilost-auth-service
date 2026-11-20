import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { revokeStaff } from './revoke-staff.js';

const userId = 'operator-id';

function setup() {
  const tx = {
    $queryRaw: vi.fn(),
    user: { updateMany: vi.fn(), findUnique: vi.fn() },
    refreshToken: { updateMany: vi.fn() },
  };
  const transaction = vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
  return { tx, transaction, prisma: { $transaction: transaction } as unknown as PrismaClient };
}

describe('revokeStaff', () => {
  it('demotes the requested operator and revokes their active sessions within one transaction', async () => {
    const { tx, transaction, prisma } = setup();
    tx.user.updateMany.mockResolvedValue({ count: 1 });
    tx.refreshToken.updateMany.mockResolvedValue({ count: 3 });

    await expect(revokeStaff(prisma, userId)).resolves.toEqual({ status: 'revoked', sessions: 3 });
    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.$queryRaw).toHaveBeenCalledBefore(tx.user.updateMany);
    expect(tx.user.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: userId, role: 'STAFF' },
      data: { role: 'STUDENT' },
    });
    expect(tx.refreshToken.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { userId, revokedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { revokedAt: expect.any(Date) },
    });
    expect(tx.user.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    [{ id: userId }, 'already-student'],
    [null, 'not-found'],
  ] as const)('leaves sessions untouched when the outcome is %j (%s)', async (user, status) => {
    const { tx, prisma } = setup();
    tx.user.updateMany.mockResolvedValue({ count: 0 });
    tx.user.findUnique.mockResolvedValue(user);

    await expect(revokeStaff(prisma, userId)).resolves.toEqual({ status });
    expect(tx.user.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { id: userId }, select: { id: true },
    });
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});
