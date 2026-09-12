import { randomUUID } from 'node:crypto';
import type {
  NewRefreshToken,
  RefreshTokenRepository,
  StoredRefreshToken,
} from '../../src/auth/tokens/refresh-token.repository.js';
import type { User } from '../../src/users/entities/user.entity.js';
import {
  InstitutionalCodeTakenError,
  type ProvisionUserInput,
  type UserRepository,
} from '../../src/users/ports/user.repository.js';

/**
 * Dobles en memoria de los puertos de salida. Existen para que las pruebas unitarias
 * corran sin Postgres; las de integracion usan las implementaciones reales de Prisma.
 */
export class FakeUserRepository implements UserRepository {
  readonly rows = new Map<string, User>();

  async findById(id: string): Promise<User | null> {
    return this.rows.get(id) ?? null;
  }

  async findByGoogleSub(googleSub: string): Promise<User | null> {
    return [...this.rows.values()].find((u) => u.googleSub === googleSub) ?? null;
  }

  async provision(input: ProvisionUserInput): Promise<User> {
    const existing = await this.findByGoogleSub(input.googleSub);
    if (existing) {
      const updated = {
        ...existing,
        email: input.email,
        fullName: input.fullName,
        avatarUrl: input.avatarUrl ?? null,
      };
      this.rows.set(existing.id, updated);
      return updated;
    }

    const created: User = {
      id: randomUUID(),
      email: input.email,
      googleSub: input.googleSub,
      fullName: input.fullName,
      avatarUrl: input.avatarUrl ?? null,
      institutionalCode: null,
      role: input.role,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(created.id, created);
    return created;
  }

  async setInstitutionalCode(userId: string, code: string | null): Promise<User> {
    const taken = [...this.rows.values()].some(
      (u) => u.id !== userId && code !== null && u.institutionalCode === code,
    );
    if (taken) throw new InstitutionalCodeTakenError();

    const user = this.rows.get(userId);
    const updated = { ...user, institutionalCode: code };
    this.rows.set(userId, updated);
    return updated;
  }

  /** Atajo de prueba: siembra un usuario ya existente. */
  seed(user: Partial<User> & Pick<User, 'googleSub' | 'email'>): User {
    const row: User = {
      id: user.id ?? randomUUID(),
      email: user.email,
      googleSub: user.googleSub,
      fullName: user.fullName ?? 'Estudiante de Prueba',
      avatarUrl: user.avatarUrl ?? null,
      institutionalCode: user.institutionalCode ?? null,
      role: user.role ?? 'STUDENT',
      status: user.status ?? 'ACTIVE',
      createdAt: user.createdAt ?? new Date(),
      updatedAt: user.updatedAt ?? new Date(),
    };
    this.rows.set(row.id, row);
    return row;
  }
}

export class FakeRefreshTokenRepository implements RefreshTokenRepository {
  readonly rows: StoredRefreshToken[] = [];

  async create(token: NewRefreshToken): Promise<void> {
    this.rows.push({ id: randomUUID(), revokedAt: null, ...token });
  }

  async findByHash(tokenHash: string): Promise<StoredRefreshToken | null> {
    return this.rows.find((r) => r.tokenHash === tokenHash) ?? null;
  }

  async consume(id: string): Promise<boolean> {
    const row = this.rows.find((r) => r.id === id && r.revokedAt === null);
    if (!row) return false;
    row.revokedAt = new Date();
    return true;
  }

  async revokeFamily(familyId: string): Promise<void> {
    for (const row of this.rows) {
      if (row.familyId === familyId && row.revokedAt === null) row.revokedAt = new Date();
    }
  }
}
