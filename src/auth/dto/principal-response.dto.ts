import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../generated/prisma/enums.js';

export class PrincipalResponseDto {
  @ApiProperty({
    description:
      'ECILOST identifier of the authenticated user. This is the value other services ' +
      'store as `studentId` or `staffId`; they never store the email address.',
    format: 'uuid',
    example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  })
  userId: string;

  @ApiProperty({
    enum: Role,
    description: 'Role assigned when the account was first provisioned.',
    example: Role.STUDENT,
  })
  role: Role;

  @ApiProperty({
    description: 'True for STAFF. Registers items and groups them into lots.',
    example: false,
  })
  canManageCatalog: boolean;

  @ApiProperty({
    description: 'True for STAFF. Schedules auction rooms and their rounds.',
    example: false,
  })
  canScheduleRooms: boolean;
}
