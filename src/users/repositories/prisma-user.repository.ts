import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { User } from '../entities/user.entity.js';
import {
  InstitutionalCodeTakenError,
  type ProvisionUserInput,
  type UserRepository,
} from '../ports/user.repository.js';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByGoogleSub(googleSub: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { googleSub } });
  }

  provision(input: ProvisionUserInput): Promise<User> {
    return this.prisma.user.upsert({
      where: { googleSub: input.googleSub },
      // El alta fija el rol. Un login posterior solo refresca el perfil que manda Google.
      create: {
        googleSub: input.googleSub,
        email: input.email,
        fullName: input.fullName,
        avatarUrl: input.avatarUrl ?? null,
        role: input.role,
        // Prisma ejecuta el alta y este insert anidado de forma atomica. Solo se crea
        // cuando el usuario no existia; los siguientes logins toman la rama `update`.
        outboxEvents: {
          create: { type: 'user.created.v1' },
        },
      },
      update: {
        email: input.email,
        fullName: input.fullName,
        avatarUrl: input.avatarUrl ?? null,
      },
    });
  }

  async setInstitutionalCode(
    userId: string,
    code: string | null,
  ): Promise<User> {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { institutionalCode: code },
      });
    } catch (error) {
      // P2002 es la violacion de restriccion unica. Es la base quien arbitra, no un
      // SELECT previo, que dejaria pasar dos peticiones simultaneas.
      if (isUniqueViolation(error)) throw new InstitutionalCodeTakenError();
      throw error;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
