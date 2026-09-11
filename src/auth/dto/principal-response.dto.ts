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
    description:
      'True for STAFF. Drives two entries of the main menu: **Registrar objeto** and ' +
      '**Crear lote**. They share one flag because they are the same capability, ' +
      'administering the catalogue. Grouping by capability rather than by menu entry ' +
      'means this service does not change every time the frontend reorganises its ' +
      'navigation.',
    example: false,
  })
  canManageCatalog: boolean;

  @ApiProperty({
    description:
      'True for STAFF. Drives the **Programar sala** menu entry, and gates the room ' +
      'scheduling endpoint in auction-core.',
    example: false,
  })
  canScheduleRooms: boolean;

  @ApiProperty({
    description:
      'True for STUDENT. Operators administer lost property and do not take part in the ' +
      'auctions, so this is false for STAFF in every room, not only in the ones they ' +
      'scheduled. Students and operators are disjoint: whoever can bid cannot manage, ' +
      'and the other way round.',
    example: true,
  })
  canBid: boolean;
}
