import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { User } from '../entities/user.entity.js';
import type { ProvisionUserInput, UserRepository } from '../ports/user.repository.js';

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
        role: input.role,
      },
      update: {
        email: input.email,
        fullName: input.fullName,
      },
    });
  }
}
