import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  NewRefreshToken,
  RefreshTokenRepository,
  StoredRefreshToken,
} from './refresh-token.repository.js';

@Injectable()
export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(token: NewRefreshToken): Promise<void> {
    await this.prisma.refreshToken.create({ data: token });
  }

  findByHash(tokenHash: string): Promise<StoredRefreshToken | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  async rotate(id: string, successor: NewRefreshToken): Promise<boolean> {
    // updateMany con revokedAt:null en el WHERE es un UPDATE condicional: la base decide
    // el ganador si dos peticiones llegan a la vez.
    return this.prisma.$transaction(async (tx) => {
      await lockRefreshTokensForUser(tx, successor.userId);
      const now = new Date();
      const result = await tx.refreshToken.updateMany({
        where: { id, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      if (result.count !== 1) return false;

      await tx.refreshToken.create({ data: successor });
      return true;
    });
  }

  async revokeFamily(userId: string, familyId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockRefreshTokensForUser(tx, userId);
      await tx.refreshToken.updateMany({
        where: { userId, familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }
}

/** Ordena rotaciones y revocaciones de un usuario hasta el fin de la transaccion. */
export async function lockRefreshTokensForUser(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${'ecilost-auth:refresh:' + userId}, 0))`;
}
