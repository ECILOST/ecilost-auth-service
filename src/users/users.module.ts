import { Module } from '@nestjs/common';
import { USER_REPOSITORY } from './ports/user.repository.js';
import { PrismaUserRepository } from './repositories/prisma-user.repository.js';
import { UsersService } from './users.service.js';

@Module({
  providers: [
    UsersService,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
  ],
  exports: [UsersService],
})
export class UsersModule {}
