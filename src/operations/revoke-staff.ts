import { PrismaPg } from '@prisma/adapter-pg';
import { pathToFileURL } from 'node:url';
import { lockRefreshTokensForUser } from '../auth/tokens/prisma-refresh-token.repository.js';
import { PrismaClient } from '../generated/prisma/client.js';

type RevocationResult =
  | { status: 'revoked'; sessions: number }
  | { status: 'already-student' | 'not-found' };

export async function revokeStaff(
  prisma: PrismaClient,
  userId: string,
): Promise<RevocationResult> {
  return prisma.$transaction(async (tx) => {
    await lockRefreshTokensForUser(tx, userId);
    const changed = await tx.user.updateMany({
      where: { id: userId, role: 'STAFF' },
      data: { role: 'STUDENT' },
    });

    if (changed.count === 0) {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      return { status: user ? 'already-student' : 'not-found' };
    }

    const now = new Date();
    const revoked = await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });
    return { status: 'revoked', sessions: revoked.count };
  });
}

async function main(args: string[]): Promise<number> {
  const userId = args[0]?.toLowerCase();
  if (
    args.length !== 1 ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(userId ?? '')
  ) {
    console.error('Uso: npm run staff:revoke -- <id-uuid-del-usuario>');
    return 1;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      'DATABASE_URL es obligatorio. Configura la base de Auth que deseas administrar.',
    );
    return 1;
  }

  const schema = new URL(databaseUrl).searchParams.get('schema') ?? 'public';
  const prisma = new PrismaClient({
    adapter: new PrismaPg(databaseUrl, { schema }),
  });
  try {
    const result = await revokeStaff(prisma, userId);
    if (result.status === 'not-found') {
      console.error(`No existe el usuario ${userId}.`);
      return 1;
    }

    console.log(JSON.stringify({ action: 'staff.revoke', userId, ...result }));
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error(
        'No se pudo completar la operación. Verifica la configuración de la base y consulta el rol actual.',
      );
      process.exitCode = 1;
    });
}
